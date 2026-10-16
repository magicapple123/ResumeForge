"""求职助手历史快照、SSE 事件和模型流编排。"""

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable
from typing import Any

from ..runtime import dataset_scope
from ..runtime.dataset_scope import DatasetScopeError
from ..runtime.operation_budget import OperationCancelled
from ..schemas.assistant import AssistantMessageCreate
from ..services.assistant.assistant_service import (
    current_user_message_for_model,
    history_messages_for_model,
)
from ..services.assistant.assistant_sources import SourceNumberer
from ..services.assistant.assistant_web_search import (
    AssistantSearchError,
    is_local_resume_forge_question,
)
from ..services.assistant_tools import policy as tool_policy
from ..services.assistant_tools import tool_definitions
from ..services.llm.base import BaseLLMProvider, LLMError
from ..services.llm.tool_messages import assistant_tool_call_message
from ..services.llm.usage import FINISH_BUDGET_EXHAUSTED
from ..services.settings_service import get_assistant_relaxed_mode, get_search_config
from .assistant_budget import AssistantStreamBudget
from .assistant_context import web_context
from .assistant_persistence import (
    cancel_pending_assistant_message,
    finish_assistant_message,
    format_sse,
    history_snapshot,
    update_message_context,
)
from .assistant_tool_exec import is_web_search, run_tool_call

logger = logging.getLogger(__name__)

# 一次回复里最多允许几轮工具调用；防止模型在两个工具之间来回打转。
MAX_TOOL_ROUNDS = 5
# 一轮回答里最多搜几次网，**含自动预搜的那一次**。系统提示、README 与使用指南都写着
# "最多 3 次"，这里把它变成真的：此前只有提示词里那句话，代码侧真正的约束是 5 轮工具
# 调用，而且每轮可以并行发多个搜索——用户按文档预期 3 次，实际可能多花好几倍。
MAX_WEB_SEARCHES = 3

# 思考内容写进助手消息 `context` 的上限（字符数）。**为什么必须限长**：
#   1) 思考内容常常比正文长一个量级（高强度思考尤甚），而 context 是随每条历史消息
#      一起被批量加载的 JSON；不设限会让单条消息无限膨胀，历史列表的内存与带宽都会失控。
#   2) 该上限只作用于历史展示；DeepSeek 当次工具续轮的协议字段保留完整原文。
# 超限时**如实截断并打标记**（context 里 `reasoning_truncated=True`），不静默丢弃。
MAX_REASONING_CONTEXT_CHARS = 20_000


def _truncate_reasoning(text: str) -> tuple[str, bool]:
    """把思考内容裁到存储上限，返回 ``(文本, 是否被截断)``。"""
    if len(text) <= MAX_REASONING_CONTEXT_CHARS:
        return text, False
    return text[:MAX_REASONING_CONTEXT_CHARS], True


async def _stream_message_events(
    *,
    factory: Any,
    payload: AssistantMessageCreate,
    attachments: list[dict[str, Any]],
    provider: BaseLLMProvider,
    history: list[dict[str, Any]],
    context_blocks: list[str],
    context_metadata: dict[str, Any],
    user_message_id: int,
    assistant_message_id: int,
    generated_title: str,
    system_prompt: str,
    search_web_fn: Callable[[str], Awaitable[list[dict[str, str]]]],
    quoted: dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    parts: list[str] = []
    metadata = dict(context_metadata)
    model_context = list(context_blocks)
    # 助手这条消息的 context：思考内容与工具记录都挂在这里，供历史回看。
    # 用**同一个** dict 累积再整体写回——`update_message_context` 是整体替换而非合并，
    # 分开写会把先写进去的字段冲掉。
    assistant_context: dict[str, Any] = {}
    # 思考内容跨轮累积（模型可能每轮都先想一段再调用工具）。
    reasoning_parts: list[str] = []
    # 本次回答里所有联网来源的全局编号器：自动预搜与后续的 web_search 工具共用，
    # 保证正文里的 [来源N] 能对应到模型当时看到的那条 URL（跨两个入口不重号）。
    numberer = SourceNumberer()
    # RF-14 §2.1.b/§2.2/§2.5：整链预算与用量遥测的协调器（assistant_budget）。
    budget = AssistantStreamBudget()
    # 活预算硬墙钟接线（审计 PR-07-3）：provider 的每次传输尝试以整链剩余预算做
    # asyncio.timeout 上限——首字前静默、只发心跳帧的流也会被硬切；finally 复位。
    provider.request_budget = budget.operation_budget
    try:
        yield format_sse(
            {
                "type": "start",
                "user_message_id": user_message_id,
                "assistant_message_id": assistant_message_id,
                "conversation_title": generated_title,
            }
        )
        if payload.web_search:
            yield format_sse({"type": "progress", "message": "正在联网搜索公开资料…"})
            query = payload.content or " ".join(item["name"] for item in attachments)
            if is_local_resume_forge_question(query):
                # 产品使用问题的权威信息就在本地能力地图/文档；公开搜索同名产品会把模型带偏。
                model_context.append(
                    "[联网搜索状态]\n"
                    "这是 ResumeForge（简历通）本身的使用问题，已跳过公开搜索。"
                    "请依据系统提示中的本地能力地图和平台说明回答，不要声称引用了外部来源。"
                )
                metadata["search_skipped"] = "local_resume_forge_question"
            else:
                try:
                    sources = await search_web_fn(query)
                    metadata["sources"] = sources
                    model_context.append(web_context(sources, numberer))
                except AssistantSearchError as exc:
                    metadata["search_error"] = exc.public_message
                    model_context.append(
                        f"[联网搜索状态]\n{exc.public_message}，请勿声称已获得联网资料。"
                    )
            update_message_context(user_message_id, metadata, factory=factory)
            yield format_sse(
                {
                    "type": "sources",
                    "sources": metadata.get("sources", []),
                    "source_map": numberer.mapping(),
                    "error": metadata.get("search_error", ""),
                }
            )

        messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        messages.extend(history_messages_for_model(history))
        messages.append(
            current_user_message_for_model(payload.content, attachments, model_context, quoted)
        )

        tool_records: list[dict[str, Any]] = []
        # 工具里搜到的来源与手动搜索的来源合并展示，按 URL 去重。
        collected_sources: list[dict[str, Any]] = list(metadata.get("sources") or [])
        seen_source_urls = {str(item.get("url", "")) for item in collected_sources}
        # 上面那次自动预搜**也算一次**：它同样真的发了网络请求、真的花了时间。此前这个
        # 计数从 0 起算，于是开了联网开关时"最多 3 次"实际是 4 次，和系统提示、README、
        # 使用指南里写的数字对不上。失败的预搜不计数——它没给模型任何资料，这时更需要
        # 让工具补上。
        web_searches_used = 1 if metadata.get("sources") else 0
        # token 估算遥测（RF-14 §2.5）：组装完 messages 后估算，只进 estimated_* 遥测字段。
        budget.estimate_prompt_tokens(messages)
        for _round in range(MAX_TOOL_ROUNDS):
            # RF-14 §2.1.b 检查点 1：每轮工具循环开始——到期就不发起新一轮模型调用。
            budget.check()
            # RF-01：每轮重建执行上下文并重读设置——放宽模式/抓取条数是全局设置，
            # 用户在流中途关掉后下一轮立即生效（撤销策略不依赖模型自觉，也不依赖
            # 请求开始时的旧快照）。下发集合与执行白名单同源（policy）。
            with factory() as db:
                relaxed_now = get_assistant_relaxed_mode(db)
                fetch_pages_now = get_search_config(db).fetch_pages
            ctx = tool_policy.build_context(
                web_search=payload.web_search,
                fetch_pages=fetch_pages_now,
                relaxed=relaxed_now,
                writable=payload.allow_write,
            )
            # 写类工具按需下发（AI 提速）：闲聊轮只带查询类工具，用户消息命中写入
            # 意图（或放宽模式）才全量下发——写工具的描述体积大，常驻每轮请求会
            # 白白拉长首字延迟。每轮循环重建时重新判定。
            tools = tool_policy.tools_for_turn(
                tool_definitions(ctx),
                latest_user_text=payload.content or "",
                session_used_writes=False,
                relaxed=relaxed_now,
            )
            calls: list[dict[str, Any]] = []
            round_reasoning: list[str] = []
            # aclosing 纪律（审计 PR-07-4）：取消/超时/异常路径也显式关闭 provider 流
            # ——provider 的 finally 才能写 last_usage、response 才能及时关闭。
            model_stream = provider.stream_chat_events(messages, tools)
            try:
                async for delta in model_stream:
                    # RF-14 §2.1.b 检查点 3：每个 delta 之后——到期就在下一边界收尾。
                    budget.check()
                    if delta.text:
                        parts.append(delta.text)
                        yield format_sse({"type": "delta", "text": delta.text})
                    if delta.reasoning:
                        # 思考单独下发、存档，不混入正文；工具续轮是否回传由协议适配决定。
                        reasoning_parts.append(delta.reasoning)
                        round_reasoning.append(delta.reasoning)
                        yield format_sse({"type": "reasoning", "text": delta.reasoning})
                    if delta.tool_calls:
                        calls.extend(delta.tool_calls)
            finally:
                await model_stream.aclose()
            # §2.2：各轮用量——provider 只保留最后一次调用，跨轮累计在 budget 里做。
            budget.record_round(provider)
            if round_reasoning:
                # 把"到目前为止的全部思考"写进 context 并立刻落库，这样即使这一轮之后
                # 流被中断，已经产生的思考历史回看仍能看到。
                stored, truncated = _truncate_reasoning("".join(reasoning_parts))
                assistant_context["reasoning"] = stored
                if truncated:
                    assistant_context["reasoning_truncated"] = True
                update_message_context(
                    assistant_message_id, dict(assistant_context), factory=factory
                )
            if not calls:
                break

            # 把助手的这次调用原样回填进消息，模型才能把结果对上号。
            messages.append(
                assistant_tool_call_message(
                    getattr(provider, "config", None), calls, "".join(round_reasoning)
                )
            )
            for call in calls:
                if is_web_search(call) and web_searches_used >= MAX_WEB_SEARCHES:
                    # 超预算时**明确告诉模型**次数用完了，而不是静默丢掉这次调用：
                    # 静默丢弃会让它以为搜索失败、换个词再来一轮，白烧一轮调用。
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id") or "",
                            "content": (
                                f"本轮联网搜索次数已用完（最多 {MAX_WEB_SEARCHES} 次）。"
                                "请基于已经拿到的结果作答，并说明信息可能不完整。"
                            ),
                        }
                    )
                    continue
                if is_web_search(call):
                    web_searches_used += 1
                # RF-14 §2.1.b 检查点 2：每个工具调用发起前（运行中的工具不强制中断）。
                budget.check()
                record = await run_tool_call(call, numberer, factory, ctx)
                tool_records.append(record)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or "",
                        "content": record["result_text"],
                    }
                )
                yield format_sse(
                    {
                        "type": "tool",
                        "name": record["name"],
                        "arguments": record["arguments"],
                        "summary": record["summary"],
                        "link": record["link"],
                        "ok": record["ok"],
                        "error": record["error"],
                        # 透传"是否真的改了数据"：前端折叠标题要用它写「改动了 N 项」。
                        # 让后端说了算，前端就不必再按工具名猜哪些是写操作（猜一份必然漂移）。
                        "changed": record["changed"],
                    }
                )
                if record.get("proposal"):
                    # RF-01：写入提案单独成事件，前端渲染确认卡片；批准/拒绝走 REST。
                    yield format_sse({"type": "write_proposal", "proposal": record["proposal"]})
                new_sources = [
                    item
                    for item in record.get("sources") or []
                    if str(item.get("url", "")) not in seen_source_urls
                ]
                if new_sources:
                    for item in new_sources:
                        seen_source_urls.add(str(item.get("url", "")))
                    collected_sources.extend(new_sources)
                    metadata["sources"] = collected_sources
                    # 来源属于用户那条消息：它说明"这次回答参考了哪些公开来源"。
                    update_message_context(user_message_id, metadata, factory=factory)
                    yield format_sse(
                        {
                            "type": "sources",
                            "sources": collected_sources,
                            "source_map": numberer.mapping(),
                            "error": "",
                        }
                    )
            # 工具记录属于**助手这条消息**：它描述的是助手做了什么，历史回看时挂在
            # 助手回复下最自然（来源则属于用户那条消息，见上面的联网分支）。
            assistant_context["tool_calls"] = tool_records
            update_message_context(assistant_message_id, dict(assistant_context), factory=factory)
        else:
            # 到达轮次上限：停止继续调用工具，让用户看到已经做了什么。
            parts.append(
                f"\n\n（已经连续执行了 {MAX_TOOL_ROUNDS} 轮工具调用，为避免失控先停在这里，"
                "你可以继续追问。）"
            )

        # 来源编号映射随助手这条消息一起落库：前端渲染正文里的 [来源N] 时按它解析，
        # 而不是拿"去重后的参考来源"下标去对——那会跳错来源。即使这轮没有工具调用/
        # 思考，只要预搜命中过，也要在结束前写回。
        assistant_context["source_map"] = numberer.mapping()
        update_message_context(assistant_message_id, dict(assistant_context), factory=factory)

        content = "".join(parts)
        if not content.strip():
            if tool_records:
                # 只调了工具、没输出正文：把做过的事说清楚，而不是报错。
                content = "已完成：\n" + "\n".join(
                    f"- {record['summary'] or record['name']}" for record in tool_records
                )
            else:
                raise LLMError("模型没有返回内容，请重试或更换模型")
        # 用量总口径（§2.2-5）：token 缺失是 null（「未知」）不是 0；estimated_* 只在
        # 估算开启时存在。
        usage_payload = budget.usage_summary(provider=provider)
        saved = finish_assistant_message(
            assistant_message_id,
            content=content,
            status="complete",
            factory=factory,
            usage=usage_payload,
        )
        if saved is None:
            raise RuntimeError("assistant message disappeared")
        yield format_sse(
            {"type": "done", "message": saved.model_dump(mode="json"), "usage": usage_payload}
        )
    except OperationCancelled as exc:
        # RF-14 §2.1.b-4：整链预算到期按 error 收尾，结束原因如实记 budget_exhausted——
        # 不冒充网络错误，也不归入用户取消分支（cancelled）。
        logger.warning("AI 助手回复超出时间预算，已中止：%s", exc)
        message = "回复超出时间预算，已中止"
        # 失败路径也收集最后一轮 usage（PR-07-6）：轮循环的 record_round 因异常
        # 被跳过，provider 的 last_usage 在上面的 aclose finally 里已写好。
        budget.record_round(provider)
        usage_payload = budget.usage_summary(
            provider=provider, finish_reason=FINISH_BUDGET_EXHAUSTED
        )
        finish_assistant_message(
            assistant_message_id,
            content="".join(parts),
            status="error",
            error=message,
            factory=factory,
            usage=usage_payload,
        )
        yield format_sse({"type": "error", "message": message})
    except asyncio.CancelledError:
        # 用户断开（浏览器取消）路径同样收集最后一轮 usage：能拿到多少算多少。
        budget.record_round(provider)
        finish_assistant_message(
            assistant_message_id,
            content="".join(parts),
            status="cancelled",
            error="回复已中断",
            factory=factory,
            usage=budget.usage_summary(),
        )
        raise
    except LLMError:
        logger.warning("AI 助手模型调用失败（用户可见错误已固定脱敏）")
        budget.record_round(provider)
        finish_assistant_message(
            assistant_message_id,
            content="".join(parts),
            status="error",
            error="模型服务暂时无法处理本次请求，请稍后重试",
            factory=factory,
            usage=budget.usage_summary(),
        )
        yield format_sse({"type": "error", "message": "模型服务暂时无法处理本次请求，请稍后重试"})
    except Exception:  # noqa: BLE001 - 流式响应必须转换内部异常
        logger.exception("AI 助手流式回复发生内部错误")
        message = "回复过程中发生内部错误，请查看后端日志"
        budget.record_round(provider)
        finish_assistant_message(
            assistant_message_id,
            content="".join(parts),
            status="error",
            error=message,
            factory=factory,
            usage=budget.usage_summary(),
        )
        yield format_sse({"type": "error", "message": message})
    finally:
        # 活预算接线复位（防御性纪律，provider 实例不复用）；GeneratorExit（浏览器
        # 断开）也可能走这里，cancel_pending 在任何路径上都要把 pending 消息收尾。
        provider.request_budget = None
        # Closing an async generator can bypass CancelledError when the browser断开。
        cancel_pending_assistant_message(assistant_message_id, "".join(parts), factory=factory)


async def stream_message_events(
    *,
    payload: AssistantMessageCreate,
    attachments: list[dict[str, Any]],
    provider: BaseLLMProvider,
    history: list[dict[str, Any]],
    context_blocks: list[str],
    context_metadata: dict[str, Any],
    user_message_id: int,
    assistant_message_id: int,
    generated_title: str,
    system_prompt: str,
    search_web_fn: Callable[[str], Awaitable[list[dict[str, str]]]],
    quoted: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    """流级租约入口（RF-03）：建流先取租约，切换持锁期间给出可读的 error 事件。

    拿到租约后按值冻结当前 engine，流内全部会话（工具调用、上下文写回、收尾）
    都从它建——即使之后发生切换，也绝不漂到新库。切换进行中有流活动时选择
    **直接报错（409 语义）而不是排队**：助手流持续几十秒到几分钟，排队需要跨请求
    协调且用户无感知地等，明确报"数据集正在切换中"最诚实，也与切换侧的排空
    超时语义一致。放宽模式/抓取条数不再从请求快照传入：每轮工具循环重读设置（RF-01）。
    """
    try:
        lease = dataset_scope.acquire_lease("assistant-stream")
    except DatasetScopeError as exc:
        yield format_sse({"type": "error", "message": exc.public_message})
        return
    # 租约在手：身份不会再变（切换会被排空挡住），此刻冻结的就是流全程的库。
    factory = dataset_scope.frozen_session_factory()
    inner = _stream_message_events(
        factory=factory,
        payload=payload,
        attachments=attachments,
        provider=provider,
        history=history,
        context_blocks=context_blocks,
        context_metadata=context_metadata,
        user_message_id=user_message_id,
        assistant_message_id=assistant_message_id,
        generated_title=generated_title,
        system_prompt=system_prompt,
        search_web_fn=search_web_fn,
        quoted=quoted,
    )
    try:
        async for event in inner:
            yield event
    finally:
        # GeneratorExit 只会抛进外层生成器，async for 不会把关闭传播给内层——
        # 浏览器断开时必须显式 aclose 内层，它 finally 里的
        # cancel_pending_assistant_message 才能把 pending 消息收尾成 cancelled。
        try:
            await inner.aclose()
        finally:
            lease.release()


__all__ = [
    "format_sse",
    "history_snapshot",
    "update_message_context",
    "finish_assistant_message",
    "cancel_pending_assistant_message",
    "stream_message_events",
]
