# SPDX-License-Identifier: Apache-2.0
"""求职助手一次回答的运行状态与轮次编排（T1 从回合主函数拆出）。

StreamRun 承载一次回答的全部可变状态；_open_stream_run 建运行状态；_run_rounds 下发
start 事件、装配 messages 并跑模型/工具轮循环；_finish_success 成功收尾；_finalize_run
是 4 个 except 分支的唯一收尾实现（差异由参数表达）。拆分是**纯搬家**：SSE 事件顺序、
落库终态、日志与固定文案逐字保持；assistant_stream_turns 只留公开入口、常量与 finally。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

import anyio

from ...runtime.blocking import run_sync
from ...schemas.assistant import AssistantMessageCreate
from .. import settings_service
from ..assistant_limits import (
    get_max_tool_rounds,
    get_stream_budget_override,
    get_tool_result_max_chars,
)
from ..assistant_run_trace import utcnow
from ..assistant_tools import policy as tool_policy
from ..assistant_tools import tool_definitions
from ..llm.base import BaseLLMProvider, LLMError
from ..llm.tool_messages import assistant_tool_call_message
from ..model_context_windows import configured_model_window
from ..settings_service import (
    get_llm_config,
    get_search_config,
    resolve_assistant_relaxed_mode,
)
from .assistant_context_policy import compact_turn_context
from .assistant_context_usage import connectors_text, conversation_text, turn_usage
from .assistant_persistence import (
    finish_assistant_message,
    format_sse,
    update_message_context,
)
from .assistant_service import current_user_message_for_model, history_messages_for_model
from .assistant_stream_budget import AssistantStreamBudget
from .assistant_stream_run_state import MAX_REASONING_CONTEXT_CHARS as MAX_REASONING_CONTEXT_CHARS
from .assistant_stream_run_state import StreamRun, _truncate_reasoning
from .assistant_system_prompt import build_system_prompt_parts
from .assistant_tool_exec import (
    begin_run_trace,
    close_run_trace,
    is_web_search,
    record_run_trace_step,
    run_tool_call,
    run_trace_payload,
)
from .memory_injection import injected_memories


def _open_stream_run(
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
    quoted: dict[str, Any] | None = None,
    conversation_id: int | None = None,
) -> StreamRun:
    """建运行状态（原主函数 try 之前的局部状态初始化段）。"""
    run = StreamRun(
        factory=factory,
        payload=payload,
        attachments=attachments,
        provider=provider,
        history=history,
        user_message_id=user_message_id,
        assistant_message_id=assistant_message_id,
        generated_title=generated_title,
        system_prompt=system_prompt,
        quoted=quoted,
        conversation_id=conversation_id,
    )
    run.metadata = dict(context_metadata)
    run.model_context = list(context_blocks)
    # 助手这条消息的 context：思考内容与工具记录都挂在这里，供历史回看。
    # 用**同一个** dict 累积再整体写回——`update_message_context` 是整体替换而非合并，
    # 分开写会把先写进去的字段冲掉。
    # T24：技能记录不再挂在助手消息上——技能属于**用户那条消息**（context.skills），
    # 助手 context 只描述"它做了什么"，不再读旧的对话级关联表。
    # RF-14 §2.1.b/§2.2/§2.5：整链预算与用量遥测的协调器（assistant_budget）。
    # 预算秒数**请求开始时读一次** DB 覆盖值（设置页可改）；用户没设过就是 None，
    # 由协调器回落到 config 的部署默认（1800 秒），不把部署侧配置顶掉。
    with factory() as db:
        budget_override = get_stream_budget_override(db)
    run.budget = AssistantStreamBudget(stream_budget_seconds=budget_override)
    # T21 运行轨迹：进程内记录，收尾把白名单视图写进助手消息 context（JSON 列，零迁移）。
    run.trace = begin_run_trace(provider, assistant_message_id, conversation_id)
    # 活预算硬墙钟接线（审计 PR-07-3）：provider 的每次传输尝试以整链剩余预算做
    # asyncio.timeout 上限——首字前静默、只发心跳帧的流也会被硬切；finally 复位。
    provider.request_budget = run.budget.operation_budget
    # T11 读轴覆盖：请求级放宽模式，finally 里用 token 复位，不能跨请求泄漏。
    run.override_token = settings_service.set_runtime_relaxed_override(payload.relaxed_mode)
    return run


async def _run_rounds(run: StreamRun) -> AsyncGenerator[str, None]:
    """下发 start 事件、装配 messages/上下文用量，再跑模型轮次与工具调用循环。"""
    # patch 锚点：既有测试 monkeypatch 的是 assistant_stream_turns.truncate_tool_result，
    # MAX_WEB_SEARCHES 的公开 import 路径也在那个模块；运行期从原模块取，直接绑定到本
    # 模块会让注入静默失效（用例仍绿，但守的东西没了）。
    from .assistant_stream_turns import MAX_WEB_SEARCHES, truncate_tool_result

    yield format_sse(
        {
            "type": "start",
            "user_message_id": run.user_message_id,
            "assistant_message_id": run.assistant_message_id,
            "conversation_title": run.generated_title,
        }
    )
    # 历史与当前消息各算一次、两处复用：拼进 ``messages`` 的内容与「对话消息」桶
    # 计量的内容必须是同一份，否则面板上的数字和真正发出去的东西会对不上。
    history_messages = history_messages_for_model(run.history)
    user_message = current_user_message_for_model(
        run.payload.content,
        run.attachments,
        run.model_context,
        run.quoted,
        # T24：本条消息勾选的技能提示词（prepare 阶段已写进 metadata）；只拼一次。
        str(run.metadata.get("skill_prompt") or ""),
    )
    messages: list[dict[str, Any]] = [{"role": "system", "content": run.system_prompt}]
    messages.extend(history_messages)
    messages.append(user_message)
    # 需求 #6「上下文用量」：按**构造**分桶，不解析最终 messages。与轮次无关的三段
    # （系统提示词 / 技能 / 连接器）先算好；每轮只重算"工具"桶——工具 schema 在同一
    # 轮里不变，工具结果随工具调用累积。
    with run.factory() as db:
        prompt_parts = build_system_prompt_parts(
            db,
            relaxed=resolve_assistant_relaxed_mode(db, run.payload.relaxed_mode),
            conversation_id=run.conversation_id,
            client_context=run.payload.client_context,
        )
        # 百分比分母：当前生效模型的上下文窗口。优先用 provider 带的那份配置；测试
        # 替身或自定义 provider 没有它时回落到设置里的当前生效配置——与 api 层建
        # provider 用的是同一个 get_llm_config，两处取到的不会是两个值。
        config = getattr(run.provider, "config", None) or get_llm_config(db)
        window = configured_model_window(config)
        window_tokens = window.tokens
        # T23：本轮真正注入的记忆（id + 内容快照）写进助手消息的 context，供消息下方
        # 一行「参考了 N 条记忆」展开。与注入走同一个 injected_memories，口径一致。
        try:
            run.assistant_context["memories"] = [
                {"id": item.id, "kind": item.kind, "value": item.value}
                for item in injected_memories(db, run.conversation_id)
            ]
        except Exception:  # noqa: BLE001 - 追溯信息失败不能挡住这一轮回答
            run.assistant_context["memories"] = []
    # 连接器及 MCP 桶 = 界面上下文块 + 项目上下文块 + 附件文本（没有文本就跳过）。
    connectors_source = connectors_text(prompt_parts["client"], run.model_context, run.attachments)
    conversation_source = conversation_text([*history_messages, user_message])

    # 工具里搜到的来源合并展示，按 URL 去重。
    collected_sources: list[dict[str, Any]] = list(run.metadata.get("sources") or [])
    seen_source_urls = {str(item.get("url", "")) for item in collected_sources}
    # 已用掉的搜索次数从 0 起算，且**只有工具调用会加**：打开联网开关不再自动预搜
    # （R08），所以"最多 3 次"就是模型自己最多能搜 3 次，与系统提示、README、
    # 使用指南里写的数字一致。
    web_searches_used = 0
    # token 估算遥测（RF-14 §2.5）：组装完 messages 后估算，只进 estimated_* 遥测字段。
    run.budget.estimate_prompt_tokens(messages)
    # 轮次上限**逐轮重读**（需求 #5）：用户生成途中把它改小，下一轮立刻按新值收尾。
    rounds_run = 0
    hit_round_limit = False
    while True:
        # RF-14 §2.1.b 检查点 1：每轮工具循环开始——到期就不发起新一轮模型调用。
        run.budget.check()
        # RF-01：每轮重建执行上下文并重读设置——请求显式覆盖的 relaxed_mode 优先，
        # 否则读全局设置；流中途改全局后下一轮立即生效（撤销不依赖模型自觉，也不依赖
        # 请求开始时的旧快照）。下发集合与执行白名单同源（policy）。
        with run.factory() as db:
            rounds_allowed = get_max_tool_rounds(db)
            # 详册 #5 的 5.3 L1：单条工具结果上限。与轮次同一个读口，设置页改完
            # 下一轮就生效；0 = 不限。
            tool_result_limit = get_tool_result_max_chars(db)
            relaxed_now = resolve_assistant_relaxed_mode(db, run.payload.relaxed_mode)
            search_config_now = get_search_config(db)
            fetch_pages_now = search_config_now.fetch_pages
            max_results_now = search_config_now.max_results
        if rounds_run >= rounds_allowed:
            hit_round_limit = True
            break
        rounds_run += 1
        ctx = tool_policy.build_context(
            web_search=run.payload.web_search,
            fetch_pages=fetch_pages_now,
            max_results=max_results_now,
            relaxed=relaxed_now,
            writable=run.payload.allow_write,
        )
        # 写类工具按需下发（AI 提速）：闲聊轮只带查询类工具，用户消息命中写入
        # 意图（或放宽模式）才全量下发——写工具的描述体积大，常驻每轮请求会
        # 白白拉长首字延迟。每轮循环重建时重新判定。
        tools = tool_policy.tools_for_turn(
            tool_definitions(ctx),
            latest_user_text=run.payload.content or "",
            session_used_writes=False,
            relaxed=relaxed_now,
        )
        # #6：本轮上下文用量（估算）。`messages` 与 `tools` 都定下来了才计量——
        # 每轮算一次，绝不在每个 delta 里重算（工具 schema 是最大的静态块）。
        context_usage = turn_usage(
            prompt_parts=prompt_parts,
            connectors_source=connectors_source,
            conversation_source=conversation_source,
            tools=tools,
            messages=messages,
            window_tokens=window_tokens,
            usage_actual=run.budget.last_prompt_tokens,
        )
        messages, compaction_flags, context_usage = await compact_turn_context(
            messages,
            usage=context_usage,
            window=window,
            threshold_tokens=run.payload.compaction_threshold_tokens,
            history=run.history,
            history_count=len(history_messages),
            factory=run.factory,
            conversation_id=run.conversation_id,
            provider=run.provider,
        )
        run.assistant_context["context_usage"] = {
            key: value for key, value in context_usage.items() if not key.endswith("trigger_tokens")
        }
        yield format_sse({"type": "context_usage", "usage": context_usage})
        if compaction_flags.get("failed"):
            run.assistant_context["compaction_failed"] = True
        # 面板上的「对话消息」桶按**真正发出去的**那份算：压缩后它变小了，数字要跟着变。
        conversation_source = conversation_text(messages[1:])
        calls: list[dict[str, Any]] = []
        round_reasoning: list[str] = []
        # aclosing 纪律（审计 PR-07-4）：取消/超时/异常路径也显式关闭 provider 流
        # ——provider 的 finally 才能写 last_usage、response 才能及时关闭。
        model_stream = run.provider.stream_chat_events(messages, tools)
        try:
            async for delta in model_stream:
                # RF-14 §2.1.b 检查点 3：每个 delta 之后——到期就在下一边界收尾。
                run.budget.check()
                if delta.text:
                    run.parts.append(delta.text)
                    yield format_sse({"type": "delta", "text": delta.text})
                if delta.reasoning:
                    # 思考单独下发、存档，不混入正文；工具续轮是否回传由协议适配决定。
                    run.reasoning_parts.append(delta.reasoning)
                    round_reasoning.append(delta.reasoning)
                    yield format_sse({"type": "reasoning", "text": delta.reasoning})
                if delta.tool_calls:
                    calls.extend(delta.tool_calls)
        finally:
            await model_stream.aclose()
        # §2.2：各轮用量——provider 只保留最后一次调用，跨轮累计在 budget 里做。
        run.budget.record_round(run.provider)
        if round_reasoning:
            # 把"到目前为止的全部思考"写进 context 并立刻落库，这样即使这一轮之后
            # 流被中断，已经产生的思考历史回看仍能看到。
            stored, truncated = _truncate_reasoning("".join(run.reasoning_parts))
            run.assistant_context["reasoning"] = stored
            if truncated:
                run.assistant_context["reasoning_truncated"] = True
            await run_sync(
                update_message_context,
                run.assistant_message_id,
                dict(run.assistant_context),
                factory=run.factory,
            )
        if not calls:
            break

        # 把助手的这次调用原样回填进消息，模型才能把结果对上号。
        messages.append(
            assistant_tool_call_message(
                getattr(run.provider, "config", None), calls, "".join(round_reasoning)
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
            run.budget.check()
            step_started = utcnow()
            record = await run_tool_call(
                call,
                run.numberer,
                run.factory,
                ctx,
                conversation_id=run.conversation_id,
                message_id=run.assistant_message_id,
            )
            record_run_trace_step(run.trace, record, ctx, step_started, run.provider)
            run.tool_records.append(record)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id") or "",
                    "content": truncate_tool_result(record["result_text"], tool_result_limit),
                }
            )
            yield format_sse(
                {
                    "type": "tool",
                    "name": record["name"],
                    "arguments": record["arguments"],
                    # #13C：参数的安全投影（白名单键带值）。前端工具卡展开后
                    # 只渲染这份，不直接展示 arguments 里的全部字段。
                    "args_preview": record.get("args_preview") or [],
                    # #13D：简历文档写操作的 diff / 撤销入口；没有就是 null。
                    "preview": record.get("preview"),
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
                run.metadata["sources"] = collected_sources
                # 来源属于用户那条消息：它说明"这次回答参考了哪些公开来源"。
                await run_sync(
                    update_message_context, run.user_message_id, run.metadata, factory=run.factory
                )
                yield format_sse(
                    {
                        "type": "sources",
                        "sources": collected_sources,
                        "source_map": run.numberer.mapping(),
                        "error": "",
                    }
                )
        # 工具记录属于**助手这条消息**：它描述的是助手做了什么，历史回看时挂在
        # 助手回复下最自然（来源则属于用户那条消息，见上面的来源分支）。
        run.assistant_context["tool_calls"] = run.tool_records
        run.assistant_context["run_trace"] = run_trace_payload(run.trace)
        await run_sync(
            update_message_context,
            run.assistant_message_id,
            dict(run.assistant_context),
            factory=run.factory,
        )
    if hit_round_limit:
        # 到达轮次上限：停止继续调用工具，让用户看到已经做了什么，并由前端给一个
        # 「继续」入口（复用现有发送链路，不新开端点）。
        run.parts.append(
            f"\n\n（已经连续执行了 {rounds_run} 轮工具调用，为避免失控先停在这里，"
            "你可以点「继续」或继续追问。）"
        )
        yield format_sse({"type": "round_limit", "rounds": rounds_run})


async def _finish_success(run: StreamRun) -> AsyncGenerator[str, None]:
    """成功收尾：来源映射落库、空回复兜底、usage 汇总，最后下发 done 事件。"""
    # 来源编号映射随助手这条消息一起落库：前端渲染正文里的 [来源N] 时按它解析，
    # 而不是拿"去重后的参考来源"下标去对——那会跳错来源。即使这轮没有工具调用/
    # 思考，只要工具搜到过来源，也要在结束前写回。
    run.assistant_context["source_map"] = run.numberer.mapping()
    await run_sync(
        update_message_context,
        run.assistant_message_id,
        dict(run.assistant_context),
        factory=run.factory,
    )

    content = "".join(run.parts)
    if not content.strip():
        if run.tool_records:
            # 只调了工具、没输出正文：把做过的事说清楚，而不是报错。
            content = "已完成：\n" + "\n".join(
                f"- {record['summary'] or record['name']}" for record in run.tool_records
            )
        else:
            raise LLMError("模型没有返回内容，请重试或更换模型")
    # 用量总口径（§2.2-5）：token 缺失是 null（「未知」）不是 0；estimated_* 只在
    # 估算开启时存在。
    usage_payload = run.budget.usage_summary(provider=run.provider)
    await run_sync(
        close_run_trace,
        run.trace,
        run.assistant_context,
        run.assistant_message_id,
        run.factory,
        status="ok",
    )
    saved = await run_sync(
        finish_assistant_message,
        run.assistant_message_id,
        content=content,
        status="complete",
        factory=run.factory,
        usage=usage_payload,
    )
    if saved is None:
        raise RuntimeError("assistant message disappeared")
    yield format_sse(
        {"type": "done", "message": saved.model_dump(mode="json"), "usage": usage_payload}
    )


async def _finalize_run(
    run: StreamRun,
    status: str,
    *,
    error_event: dict[str, Any] | None = None,
    usage_finish_reason: str | None = None,
    rereraise: bool = False,
) -> AsyncGenerator[str, None]:
    """4 个 except 分支的唯一收尾实现（差异只有 status / 文案 / 是否 re-raise）。

    顺序与旧代码逐行一致：关轨迹 → 记最后一轮 usage → 汇总用量 → 消息终态 → 可选 error
    事件。status 兼作轨迹口径（cancelled 之外一律 failed）；error_event 为 None 表示该
    路径没有 SSE 事件可发（用户取消）。
    """
    trace_status = "cancelled" if status == "cancelled" else "failed"
    # 终态落库必须**扛住取消**：这段原本是同步执行（天然不可打断），搬进 worker 之后
    # 就多了一个 await 点，客户端断开时可能还没写就抛 CancelledError，留下永远 pending
    # 的消息。shield 让这几步跑完；取消在退出作用域后照常抛出。
    with anyio.CancelScope(shield=True):
        await run_sync(
            close_run_trace,
            run.trace,
            run.assistant_context,
            run.assistant_message_id,
            run.factory,
            trace_status,
        )
        # 失败路径也收集最后一轮 usage（PR-07-6）：轮循环的 record_round 因异常被跳过，
        # provider 的 last_usage 在上面的 aclose finally 里已写好。能拿到多少算多少。
        run.budget.record_round(run.provider)
        usage_payload = run.budget.usage_summary(
            provider=run.provider, finish_reason=usage_finish_reason
        )
        # 用户取消没有 SSE 事件可发（旧实现只落库）；固定文案与旧实现逐字一致。
        error_text = (error_event or {}).get("message") or "回复已中断"
        await run_sync(
            finish_assistant_message,
            run.assistant_message_id,
            content="".join(run.parts),
            status=status,
            error=error_text,
            factory=run.factory,
            usage=usage_payload,
        )
    if error_event is not None:
        yield format_sse(error_event)
    if rereraise:
        raise asyncio.CancelledError()
