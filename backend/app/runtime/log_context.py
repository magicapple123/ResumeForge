"""后台线程的日志关联上下文（RF-20）。

contextvars 不会自动跨线程：任务线程里 ``get_request_id()`` 返回 "-"，日志行无法
与触发它的任务串联。这里补一套轻量机制，只加字段、不改任何现有日志文本：

- ``bind_log_context(**values)`` / ``bound_context(**values)``：把 ``task_id``、
  ``dataset_id`` 等关联值写进 contextvars；
- ``run_with_bound_context(target, *args, **bindings)``：线程入口包装器——显式
  ``copy_context()`` 复制启动方的上下文（contextvars 不会自动跨线程），再在绑定值
  下运行 target。投递/采集、简历生成、岗位匹配与自动备份线程在
  ``threading.Thread(target=...)`` 处接线；
- ``LogContextFilter``：logging.Filter，把绑定值注入每条 LogRecord
  （``record.task_id`` 等，缺省 "-"），与 ``RequestIdFilter`` 同一模式。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar, Token, copy_context
from typing import Any

_LOG_CONTEXT: ContextVar[dict[str, str] | None] = ContextVar("log_context", default=None)


def _current_context() -> dict[str, str]:
    """取当前上下文 dict；未绑定时返回共享空 dict（只读用途安全）。"""
    current = _LOG_CONTEXT.get()
    return current if current is not None else {}


# 日志行上保证出现的关联键（缺省 "-"，格式占位符不会因缺字段而崩）。
_CONTEXT_KEYS = ("task_id", "dataset_id")


def bind_log_context(**values: Any) -> Token:
    """把关联值并入当前上下文；值统一转字符串。"""
    merged = {**_current_context(), **{key: str(value) for key, value in values.items()}}
    return _LOG_CONTEXT.set(merged)


@contextmanager
def bound_context(**values: Any):
    """临时绑定关联值的上下文管理器（自动恢复）。"""
    token = bind_log_context(**values)
    try:
        yield
    finally:
        _LOG_CONTEXT.reset(token)


def run_with_bound_context(
    target: Callable[..., Any], *args: Any, **bindings: Any
) -> Callable[[], None]:
    """返回包装后的线程入口：复制启动方 contextvars，并在绑定值下运行 target。

    复制发生在 ``threading.Thread`` 启动前，因此任务日志能带上触发它的请求链
    （request_id）；bindings 里的关联值（task_id/dataset_id）写进这份副本，
    不会泄漏回启动方。
    """
    inherited = copy_context()

    def runner() -> None:
        def entry() -> None:
            if bindings:
                bind_log_context(**bindings)
            target(*args)

        inherited.run(entry)

    return runner


class LogContextFilter(logging.Filter):
    """把当前上下文的关联值注入每条 LogRecord（缺省 "-"）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        current = _current_context()
        for key in _CONTEXT_KEYS:
            setattr(record, key, current.get(key, "-"))
        return True


__all__ = ["LogContextFilter", "bind_log_context", "bound_context", "run_with_bound_context"]
