# SPDX-License-Identifier: Apache-2.0
"""助手流单次工具调用的执行与结构化结果封装。

从 ``api/assistant_stream`` 下沉的接缝：**一次工具调用怎么执行**（写工具的确认提案、
搜索类工具的异步入口、失败转结构化结果回给模型）属于"工具执行"职责，与"流编排"
（轮次循环、SSE 事件下发、预算检查点）分开——后者留在 ``assistant_stream_events``。

测试注入点：假工具执行器 monkeypatch **本模块**的 ``execute_tool_async``。``run_tool_call``
按模块全局名查找它，因此注入点必须与本模块同址——搬到别处会让注入静默失效。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..assistant_run_trace import (
    MAX_TRACE_STEPS,
    ModelUsage,
    RunTraceRecorder,
    authorization_decision,
    message_context_payload,
    utcnow,
)
from ..assistant_tools import (
    execute_tool_async,
    get_tool,
    tool_writes,
)
from ..assistant_tools import policy as tool_policy
from ..assistant_tools.authorization import create_proposal
from .assistant_persistence import update_message_context

logger = logging.getLogger(__name__)


def _parse_tool_arguments(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"工具参数不是合法 JSON：{raw[:120]}") from exc
    if not isinstance(value, dict):
        raise ValueError("工具参数必须是 JSON 对象")
    return value


def is_web_search(call: dict[str, Any]) -> bool:
    return ((call.get("function") or {}).get("name") or "") == "web_search"


async def run_tool_call(
    call: dict[str, Any],
    numberer: Any,
    factory: Any,
    ctx: tool_policy.ToolExecutionContext,
    *,
    conversation_id: int | None = None,
    message_id: int | None = None,
) -> dict[str, Any]:
    """执行一次工具调用。

    任何失败都转成结构化的"工具结果"回给模型，而不是抛出去中断整轮对话——模型
    往往能据此换个参数重试，或者在回答里如实说明没做到。``numberer`` 是本次回答
    跨所有联网搜索共享的来源编号器；``factory`` 是流开始时冻结的会话工厂（RF-03），
    工具的读写都落在流开始时的那份数据集上；``ctx`` 是本轮的执行授权上下文（RF-01），
    未获准的工具在这里被挡下，写工具在用户未同意时转为待确认提案。
    """
    function = call.get("function") or {}
    name = function.get("name") or ""
    record: dict[str, Any] = {
        "name": name,
        "arguments": {},
        "summary": "",
        "link": "",
        "ok": True,
        "error": "",
        "result_text": "",
        "changed": False,
        "sources": [],
    }
    try:
        arguments = _parse_tool_arguments(function.get("arguments") or "")
        record["arguments"] = arguments
        if tool_writes(name) and tool_policy.requires_proposal(name, writable=ctx.writable):
            # 写工具 + 用户未同意写入（RF-01）：不执行 handler，生成结构化提案等
            # 用户在界面上确认。批准走 REST 端点用存储参数执行，token 不进模型
            # 消息——模型文本说"用户确认过"产生不了任何授权。
            with factory() as db:
                tool = get_tool(name)
                preview = None
                if tool is not None and tool.preview is not None:
                    preview = tool.preview(db, arguments)
                if preview is None:
                    record["ok"] = False
                    record["error"] = "该写入工具没有预览能力"
                    record["result_text"] = f"写入工具 {name} 无法生成确认预览，已拒绝执行。"
                    logger.warning("助手写工具 %s 缺少 preview，已拒绝", name)
                    return record
                # T01：提案落库并记下会话/消息归属，终态回写与下一轮状态注入都要用到。
                proposal = create_proposal(
                    ctx,
                    name,
                    arguments,
                    preview,
                    conversation_id=conversation_id,
                    message_id=message_id,
                    db=db,
                    factory=factory,
                )
            record["proposal"] = proposal.model_dump(mode="json")
            record["summary"] = f"待确认：{preview.target}"
            record["result_text"] = (
                f"已为 {name} 生成写入提案（目标：{preview.target}），等待用户在界面上确认。"
                "在用户确认之前它不会执行；你不能替用户确认，也不要再次调用该工具。"
            )
            return record
        # 和本模块其它写回一样自开会话：不把连接跨整个流持有。会话工厂是冻结的。
        with factory() as db:
            # 搜索类工具要 await（联网请求），所以走异步入口。
            result = await execute_tool_async(db, name, arguments, numberer=numberer, ctx=ctx)
        record["summary"] = result.summary
        record["link"] = result.link
        record["result_text"] = result.text
        record["changed"] = result.changed
        record["sources"] = result.sources
    except Exception as exc:  # noqa: BLE001 - 工具失败不能拖垮整轮回复
        record["ok"] = False
        record["error"] = str(exc)
        record["result_text"] = f"工具执行失败：{exc}"
        logger.warning("助手工具 %s 执行失败：%s", name, exc)
    return record


# ---------------------------------------------------------------------------
# T21 运行轨迹接线（内存记录 + 收尾写进助手消息 context；不新建表）
# ---------------------------------------------------------------------------


def _trace_model(provider: Any) -> str:
    return str(getattr(getattr(provider, "config", None), "model", "") or "")


def begin_run_trace(
    provider: Any, assistant_message_id: int, conversation_id: int | None = None
) -> RunTraceRecorder:
    """一次助手回复建一个内存 run：run_id 用消息 id + 毫秒时间，request_id 取中间件。"""
    from ...middleware.request_context import get_request_id  # 局部导入：服务层不长期依赖中间件

    trace = RunTraceRecorder(
        max_runs=1,
        max_steps_per_run=MAX_TRACE_STEPS,
        default_model=_trace_model(provider),
    )
    trace.begin_run(
        run_id=f"run-{assistant_message_id}-{int(utcnow().timestamp() * 1000)}",
        conversation_id=conversation_id,
        request_id=get_request_id(),
    )
    return trace


def _trace_authorization(record: dict[str, Any], ctx: tool_policy.ToolExecutionContext) -> str:
    """只读 / 直接执行 / 转提案 / 执行层拒绝，四种授权结果。"""
    name = str(record.get("name") or "")
    writes = tool_writes(name)
    if not tool_policy.is_allowed(ctx, name):
        return authorization_decision(writes=writes, writable=ctx.writable, allowed=False)
    if record.get("proposal"):
        return "pending_approval"
    return authorization_decision(writes=writes, writable=ctx.writable)


def record_run_trace_step(
    trace: RunTraceRecorder,
    record: dict[str, Any],
    ctx: tool_policy.ToolExecutionContext,
    started_at: Any,
    provider: Any,
) -> None:
    """把一次已完成的工具调用记成轨迹步（只读派生；不复制参数/结果正文）。"""
    usage = getattr(provider, "last_usage", None)
    trace.record_step(
        record,
        started_at=started_at,
        finished_at=utcnow(),
        authorization=_trace_authorization(record, ctx),
        usage=ModelUsage.from_llm_usage(usage) if usage is not None else None,
    )


def run_trace_payload(trace: RunTraceRecorder) -> dict[str, Any]:
    """进行中 run 的白名单视图（每轮工具循环后先落一次，断流也留得住已经发生的步）。"""
    return message_context_payload(trace.current_run() or {})


def close_run_trace(
    trace: RunTraceRecorder,
    context: dict[str, Any],
    message_id: int,
    factory: Any,
    status: str | None = None,
) -> None:
    """收尾：结束 run 并把白名单视图写进消息 context（幂等，失败不影响消息落库）。"""
    if not trace.is_open:
        return
    final_status = status or "cancelled"
    try:
        context["run_trace"] = message_context_payload(trace.end_run(status=final_status))
        update_message_context(message_id, dict(context), factory=factory)
    except (RuntimeError, ValueError):
        logger.warning("T21 运行轨迹收尾失败（不影响消息落库）", exc_info=True)


__all__ = [
    "begin_run_trace",
    "close_run_trace",
    "is_web_search",
    "record_run_trace_step",
    "run_tool_call",
    "run_trace_payload",
]
