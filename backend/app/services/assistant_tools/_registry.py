"""工具注册表（``_TOOLS``）与执行入口（``execute_tool`` / ``execute_tool_async``）。

下发与执行的过滤逻辑在 ``policy.py``（唯一实现）；本模块只负责组装 OpenAI 声明
结构、按 ctx 校验后执行 handler。**模型路径必须传 ctx**（assistant_stream 每轮
重建）；``ctx=None`` 的缺省路径仅供受信调用方（既有测试、非模型内部工具）使用，
文档化的信任边界，不构成模型可利用的旁路。
"""
from __future__ import annotations

import inspect
import logging

from sqlalchemy.orm import Session

from ..assistant.assistant_sources import SourceNumberer
from ._tools_specs_core import CORE_TOOLS
from ._tools_specs_data import DATA_TOOLS
from ._tools_specs_relaxed import RELAXED_TOOLS
from ._tools_specs_report import REPORT_TOOLS
from ._tools_specs_search import SEARCH_TOOLS
from ._types import _WEB_SEARCH_TOOL_NAME, Tool, ToolResult, web_search_description
from .policy import ToolExecutionContext, is_allowed, tool_visible

logger = logging.getLogger(__name__)

# 工具严格按原文件顺序拼接：core → data → relaxed（放宽模式，位置与拆分前一致）→
# report → search。顺序是行为契约（tool_definitions 输出顺序 = 发给模型的工具列表顺序），不得重排。
_TOOLS: tuple[Tool, ...] = (*CORE_TOOLS, *DATA_TOOLS, *RELAXED_TOOLS, *REPORT_TOOLS, *SEARCH_TOOLS)


def tool_definitions(
    ctx: ToolExecutionContext | None = None,
    *,
    enabled: bool = True,
    web_search: bool = False,
    fetch_pages: int = 0,
    relaxed: bool = False,
) -> list[dict]:
    """OpenAI 工具声明。

    首选传 ``ctx``：过滤条件与 ``execute_tool*`` 的白名单**同源**（policy.allowed_tools），
    恒等性由测试钉住。不传 ctx 时按 kwargs 构造等价上下文（兼容既有调用方/测试）。
    ``enabled=False`` 返回空列表（用于关闭工具调用）；``web_search=False`` 时不
    下发联网搜索工具——用户关掉联网开关就是不希望助手联网。``relaxed=False``
    （默认）不下发放宽模式工具——那些工具会读到敏感信息（身份字段、网申填写值、
    历史对话），只有用户显式开启才可见。

    ``fetch_pages`` 是设置里"抓取正文的条数"，只影响联网搜索那条工具的描述措辞
    （见 ``web_search_description``）。
    """
    if not enabled:
        return []
    if ctx is None:
        ctx = ToolExecutionContext(
            dataset_id="",
            dataset_generation=0,
            web_search=web_search,
            fetch_pages=fetch_pages,
            relaxed=relaxed,
            writable=False,
        )
    definitions = []
    for tool in _TOOLS:
        if not tool_visible(tool, web_search=ctx.web_search, relaxed=ctx.relaxed):
            continue
        description = (
            web_search_description(ctx.fetch_pages)
            if tool.name == _WEB_SEARCH_TOOL_NAME
            else tool.description
        )
        definitions.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": description,
                    "parameters": tool.parameters,
                },
            }
        )
    return definitions


def tool_names() -> list[str]:
    return [tool.name for tool in _TOOLS]


def get_tool(name: str) -> Tool | None:
    for tool in _TOOLS:
        if tool.name == name:
            return tool
    return None


def tool_writes(name: str) -> bool:
    """``name`` 是否是写工具（未注册工具返回 False）。"""
    tool = get_tool(name)
    return bool(tool and tool.writes)


def _find_tool(name: str) -> Tool:
    for tool in _TOOLS:
        if tool.name == name:
            return tool
    raise ValueError(f"未知工具：{name}")


def _refuse(name: str, reason: str) -> ToolResult:
    """结构化拒绝：不执行 handler，回给模型可读原因（它往往能据此调整行为）。"""
    logger.warning("助手工具 %s 被执行层拒绝：%s", name, reason)
    return ToolResult(text=f"工具未获授权：{name}（{reason}）", summary="", changed=False)


def _ensure_allowed(ctx: ToolExecutionContext | None, name: str) -> ToolResult | None:
    """执行前的授权闸门；返回 None 表示放行，否则返回拒绝结果。

    ``ctx=None``（受信调用方缺省）放行；``is_allowed`` 覆盖"未下发/未注册"；
    写工具还要求 ``ctx.writable``——未确认的写入由流层转提案，这里是兜底防线。
    """
    if ctx is None:
        return None
    if not is_allowed(ctx, name):
        return _refuse(name, "未在本次请求的授权清单里")
    tool = get_tool(name)
    if tool is not None and tool.writes and not ctx.writable:
        return _refuse(name, "写入操作未获用户确认")
    return None


def execute_tool(
    db: Session, name: str, arguments: dict, *, ctx: ToolExecutionContext | None = None
) -> ToolResult:
    """同步执行工具（仅同步工具）。

    聊天流走 ``execute_tool_async``；这个入口保留给不需要联网搜索的调用方与测试，
    让它们不必把自己变成异步。模型路径必须传 ``ctx``。
    """
    refusal = _ensure_allowed(ctx, name)
    if refusal is not None:
        return refusal
    tool = _find_tool(name)
    if inspect.iscoroutinefunction(tool.handler):
        raise RuntimeError(f"工具 {name} 需要在异步上下文中执行，请使用 execute_tool_async")
    return tool.handler(db, arguments)


async def execute_tool_async(
    db: Session,
    name: str,
    arguments: dict,
    *,
    numberer: SourceNumberer | None = None,
    ctx: ToolExecutionContext | None = None,
) -> ToolResult:
    """执行工具（同步与异步 handler 都支持）。

    异常由调用方转成"给模型看的错误结果"，不要让整轮对话中断。联网搜索需要 await
    网络请求，其余工具是纯数据库操作。``numberer`` 是这一次回答里跨所有联网搜索
    共享的来源编号器，只传给联网搜索 handler。模型路径必须传 ``ctx``。
    """
    refusal = _ensure_allowed(ctx, name)
    if refusal is not None:
        return refusal
    tool = _find_tool(name)
    if inspect.iscoroutinefunction(tool.handler):
        if name == _WEB_SEARCH_TOOL_NAME:
            return await tool.handler(db, arguments, numberer=numberer)
        return await tool.handler(db, arguments)
    return tool.handler(db, arguments)
