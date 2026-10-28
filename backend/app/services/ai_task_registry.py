# SPDX-License-Identifier: Apache-2.0
"""AI 任务类型注册表：``kind → handler``。

**为什么要这一层**：``POST /ai-tasks`` 只认"任务类型 + 输入摘要"，它不该知道
"岗位匹配要读资料、简历生成要冻结快照"。把这段知识关进 handler 之后，接入一个新入口
（岗位解读 / 风险扫描 / AI 改写 / 网申填写）只需要三步：加一个 handler、在
``ai_task_handlers.py`` 里注册、在 ``models/ai_task.py`` 里加一个 kind 常量。
**API 层、执行器、前端登记表一行都不用改**——这正是本轮建它的目的。

**协议只有一条**：``handler(ctx)``。成功就正常返回（结果用 ``ctx.set_result(dict)``
交回落点标识），可预期失败抛 :class:`AiTaskHandlerError`，被取消抛
:class:`AiTaskCanceled`。异常分类由执行器统一收尾，handler 自己不写数据库状态——
否则每个 handler 都会各写一遍终态仲裁，取消与完成又会打架。

handler 只在**任务线程**里执行（见 ``services/ai_task_runner.py``），可以直接开数据库会话、
驱动事件循环，但不能依赖 HTTP 请求上下文（请求可能早就断了——那正是本机制的意义）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - 仅供类型检查，运行期不导入执行器（避免循环）
    from .ai_task_runner import AiTaskContext


class AiTaskHandlerError(Exception):
    """任务的可预期失败（模型拒绝、资料为空、岗位已删除…）。

    ``str(exc)`` 直接落进 ``ai_task.error`` 给用户看，所以**只写原因**，
    不写"请重试/请先完善"这类引导——那是前端 ``errorGuidance`` 的职责。
    """


class AiTaskCanceled(Exception):
    """任务被协作式取消。

    handler 在两个检查点上发现取消信号后抛它：阶段边界（``ctx.check_canceled()``）
    与等待间隙（``ctx.sleep()``）。挂起的模型调用则由执行器跨线程中断，最终也归到这里。
    执行器收到它就把任务收尾为 ``canceled``（而不是 ``failed``）。
    """


#: handler 的形状：同步函数、只收一个上下文；结果与错误都通过上下文/异常传递。
AiTaskHandler = Callable[["AiTaskContext"], None]

_HANDLERS: dict[str, AiTaskHandler] = {}
_loaded = False


def register_ai_task_handler(kind: str, handler: AiTaskHandler) -> None:
    """登记（或覆盖）一个 kind 的执行体。

    **先确保内置 handler 已导入**：否则"先注册自己的实现、之后查询时才触发内置导入"
    的顺序会让内置实现反过来覆盖调用方的登记（实测踩到过：测试替换的 handler 被
    ``ai_task_handlers`` 的导入副作用悄悄顶掉，表现成"用例跑的是真实模型链路"）。
    """
    _ensure_handlers_loaded()
    _HANDLERS[kind] = handler


def unregister_ai_task_handler(kind: str) -> None:
    """移除一个 kind 的登记（测试用；生产代码不应该调用）。"""
    _HANDLERS.pop(kind, None)


def registered_ai_task_kinds() -> tuple[str, ...]:
    """已登记的全部 kind（排序后返回，便于日志与断言稳定）。"""
    _ensure_handlers_loaded()
    return tuple(sorted(_HANDLERS))


def get_ai_task_handler(kind: str) -> AiTaskHandler | None:
    """取某个 kind 的执行体；未登记返回 ``None``（API 层据此回 400，不猜默认行为）。"""
    _ensure_handlers_loaded()
    return _HANDLERS.get(kind)


def _ensure_handlers_loaded() -> None:
    """首次使用时导入内置 handler 模块（它 import 本模块来注册，故此处延迟导入）。"""
    global _loaded
    if _loaded:
        return
    # 先置位再导入：万一导入期又绕回本函数，也不会递归。
    _loaded = True
    from . import ai_task_handlers  # noqa: F401 - 导入即注册（副作用是本模块的契约）

    _ = ai_task_handlers  # 显式引用，避免 linter 判定"未使用"


def handler_payload_field(payload: dict[str, Any] | None, key: str) -> Any:
    """从 ``payload`` 里取一个字段（顺带挡掉"不是 dict"的脏数据）。"""
    if not isinstance(payload, dict):
        return None
    return payload.get(key)


__all__ = [
    "AiTaskCanceled",
    "AiTaskHandler",
    "AiTaskHandlerError",
    "get_ai_task_handler",
    "handler_payload_field",
    "register_ai_task_handler",
    "registered_ai_task_kinds",
    "unregister_ai_task_handler",
]
