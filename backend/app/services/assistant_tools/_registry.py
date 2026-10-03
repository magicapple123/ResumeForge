"""工具注册表（``_TOOLS``）与执行入口（``execute_tool`` / ``execute_tool_async``）。"""
from __future__ import annotations

import inspect

from sqlalchemy.orm import Session

from ..assistant.assistant_sources import SourceNumberer
from ._tools_specs_core import CORE_TOOLS
from ._tools_specs_data import DATA_TOOLS
from ._tools_specs_report import REPORT_TOOLS
from ._tools_specs_search import SEARCH_TOOLS
from ._types import Tool, ToolResult, _WEB_SEARCH_TOOL_NAME, web_search_description

# 54 个工具严格按原文件顺序拼接：core → data → report → search。
# 顺序是行为契约（tool_definitions 输出顺序 = 发给模型的工具列表顺序），不得重排。
_TOOLS: tuple[Tool, ...] = (*CORE_TOOLS, *DATA_TOOLS, *REPORT_TOOLS, *SEARCH_TOOLS)


def tool_definitions(
    enabled: bool = True, *, web_search: bool = False, fetch_pages: int = 0
) -> list[dict]:
    """OpenAI 工具声明。

    ``enabled=False`` 返回空列表（用于关闭工具调用）；``web_search=False`` 时不
    下发联网搜索工具——用户关掉联网开关就是不希望助手联网。

    ``fetch_pages`` 是设置里"抓取正文的条数"，只影响联网搜索那条工具的描述措辞
    （见 ``web_search_description``）。
    """
    if not enabled:
        return []
    definitions = []
    for tool in _TOOLS:
        if tool.requires_web_search and not web_search:
            continue
        description = (
            web_search_description(fetch_pages)
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


def _find_tool(name: str) -> Tool:
    for tool in _TOOLS:
        if tool.name == name:
            return tool
    raise ValueError(f"未知工具：{name}")


def execute_tool(db: Session, name: str, arguments: dict) -> ToolResult:
    """同步执行工具（仅同步工具）。

    聊天流走 ``execute_tool_async``；这个入口保留给不需要联网搜索的调用方与测试，
    让它们不必把自己变成异步。
    """
    tool = _find_tool(name)
    if inspect.iscoroutinefunction(tool.handler):
        raise RuntimeError(f"工具 {name} 需要在异步上下文中执行，请使用 execute_tool_async")
    return tool.handler(db, arguments)


async def execute_tool_async(
    db: Session, name: str, arguments: dict, *, numberer: SourceNumberer | None = None
) -> ToolResult:
    """执行工具（同步与异步 handler 都支持）。

    异常由调用方转成"给模型看的错误结果"，不要让整轮对话中断。联网搜索需要 await
    网络请求，其余工具是纯数据库操作。``numberer`` 是这一次回答里跨所有联网搜索
    共享的来源编号器，只传给联网搜索 handler。
    """
    tool = _find_tool(name)
    if inspect.iscoroutinefunction(tool.handler):
        if name == _WEB_SEARCH_TOOL_NAME:
            return await tool.handler(db, arguments, numberer=numberer)
        return await tool.handler(db, arguments)
    return tool.handler(db, arguments)
