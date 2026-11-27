# SPDX-License-Identifier: Apache-2.0
"""投递台公共常量、异常与通用剪裁。"""
from __future__ import annotations

from typing import Any

from ...models.apply import (
    TASK_STATUS_BREAKER_PAUSED,
    TASK_STATUS_PAUSED,
    TASK_STATUS_PENDING,
    TASK_STATUS_RUNNING,
)
from ...schemas.apply import GREETING_RECORD_MAX_CHARS

APPLY_CONFIG_KEY = "apply_config"
COLLECT_CONFIG_KEY = "collect_config"

# 视为"任务仍在进行中"的状态集合（用于"当前任务"查询与启动前冲突判断）。
ACTIVE_TASK_STATUSES = (
    TASK_STATUS_PENDING,
    TASK_STATUS_RUNNING,
    TASK_STATUS_PAUSED,
    TASK_STATUS_BREAKER_PAUSED,
)


class ApplyServiceError(Exception):
    """业务层对外错误：``status_code`` 供路由层直接映射，``detail`` 为中文（可为结构化 dict）。"""

    def __init__(self, detail: str | dict[str, Any], status_code: int = 400) -> None:
        message = detail if isinstance(detail, str) else str(detail.get("message", "请求无法完成"))
        super().__init__(message)
        self.detail = detail
        self.status_code = status_code


class ApplyBadRequest(ApplyServiceError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 400)


class ApplyNotFound(ApplyServiceError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 404)


class ApplyConflict(ApplyServiceError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 409)


class ApplyUnprocessable(ApplyServiceError):
    """语义上无法处理（422）：字段组合互斥，或指向的对象已失效。

    与 400 分开的理由：400 是"请求缺了东西"（用户得补一个字段），422 是"请求形状对、
    但内容互斥"（内外简历同时给）或"指向的外部简历已删除"——前端据此把提示挂在简历
    选择器上，而不是弹一条笼统的"请求无效"。取值来自 pydantic 的 422 同语义，
    助手工具侧拿到的仍是 ``ApplyServiceError`` 的 ``detail``。
    """

    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 422)


def _clip_greeting(value: str) -> str:
    """招呼语落库前截断到上限（记录用户写给 HR 的全文，但不让单条无限增长）。"""
    text = (value or "").strip()
    return text[:GREETING_RECORD_MAX_CHARS]
