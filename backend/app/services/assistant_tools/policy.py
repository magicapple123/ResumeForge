"""工具下发与执行的同源授权策略（RF-01）。

职责：**下发过滤与执行白名单共用同一份实现**——``allowed_tools`` 是唯一判断处，
``tool_definitions``（发给模型的声明）与 ``execute_tool*``（执行入口）都从它取集合。
这样"Provider 幻觉出一个没下发的工具名"不可能再被执行：执行层只认本模块的判定，
不再相信"下发时过滤过"这个前提。

撤销策略：``build_context`` 在**每轮工具循环**重建（不是整条流共用一份快照）。
放宽模式与抓取条数是全局设置，流中途可能被用户改掉；每轮重读设置后下一轮立即
生效——不依赖模型自觉遵守系统提示词，也不依赖请求开始时的旧快照。

依赖方向：本模块只依赖 ``runtime.dataset_scope``（取数据集身份）；对 ``_registry``
的引用放在函数体内（函数级导入），因为 ``_registry`` 在模块顶层导入本模块。
"""
from __future__ import annotations

from dataclasses import dataclass

from ...runtime import dataset_scope


@dataclass(frozen=True)
class ToolExecutionContext:
    """一次工具执行的权限快照（请求级开关 + 数据集身份）。

    ``web_search`` 来自请求体的联网开关（每次请求由前端显式带上）；
    ``relaxed`` / ``fetch_pages`` 是全局设置，每轮工具循环重读；
    ``writable`` 是用户对**本次请求**显式同意写入的唯一通道（请求级
    ``allow_write``，默认 False）——模型文本声称"用户已确认"不会改变它；
    ``dataset_id`` / ``dataset_generation`` 来自 dataset_scope：切换数据集后
    旧上下文的授权不延续到新库。
    """

    dataset_id: str
    dataset_generation: int
    web_search: bool
    fetch_pages: int
    relaxed: bool
    writable: bool
    request_id: str = ""


class ToolNotAuthorizedError(Exception):
    """执行层拒绝（工具未下发或未获授权）。message 面向模型可读。"""


def build_context(
    *,
    web_search: bool = False,
    fetch_pages: int = 0,
    relaxed: bool = False,
    writable: bool = False,
    request_id: str = "",
) -> ToolExecutionContext:
    """构建当前轮次的执行上下文。

    每轮工具循环调用一次：``relaxed``/``fetch_pages`` 由调用方重读设置后传入，
    数据集身份在这里快照。**不要**把一条流的全部轮次共用同一份上下文。
    """
    return ToolExecutionContext(
        dataset_id=dataset_scope.current_dataset_id(),
        dataset_generation=dataset_scope.current_generation(),
        web_search=web_search,
        fetch_pages=fetch_pages,
        relaxed=relaxed,
        writable=writable,
        request_id=request_id,
    )


def tool_visible(tool: object, *, web_search: bool, relaxed: bool) -> bool:
    """单条工具的可见性判断（``allowed_tools`` 的唯一实现）。

    语义与历史行为一致：关联网搜索不下发联网工具、关放宽模式不下发敏感读取
    工具——只是判断逻辑从 ``_registry`` 搬到这里，让下发与执行共用。
    """
    if tool.requires_web_search and not web_search:
        return False
    return not (tool.requires_relaxed and not relaxed)


def allowed_tools(ctx: ToolExecutionContext) -> list[str]:
    """当前上下文允许**下发与执行**的工具名（唯一过滤实现）。"""
    from ._registry import _TOOLS  # 函数级导入：_registry 顶层导入本模块，避免环。

    return [
        tool.name
        for tool in _TOOLS
        if tool_visible(tool, web_search=ctx.web_search, relaxed=ctx.relaxed)
    ]


def is_allowed(ctx: ToolExecutionContext, name: str) -> bool:
    """``name`` 是否在当前上下文的白名单里。未注册的工具一律 False。"""
    from ._registry import _TOOLS

    for tool in _TOOLS:
        if tool.name == name:
            return tool_visible(tool, web_search=ctx.web_search, relaxed=ctx.relaxed)
    return False
