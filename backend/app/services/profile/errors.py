# SPDX-License-Identifier: Apache-2.0
"""资料域的共享异常层次：Task C 的三个 store 与 API 层共用一套错误契约。

**为什么单独一个模块**（契约 §4）：错误码一旦各写一套，同一个"版本过期"会在一处叫
revision_conflict、另一处叫 stale，前端 ApiError.businessCode 就无法统一处理。这里只有
异常类，不 import 任何业务模块，因此 store、API、回收站都能安全引用。

**属性的意义**：
- `detail`：给人看的中文文案，必须说清"发生了什么 + 怎么办"（AGENTS 文案硬约束）；
- `code`：给前端判断的机器码；类属性是默认值，实例可用 `code=` 覆盖；
- `extra`：附加到响应体顶层的少量字段（如 `revision`、`affected_entries`），
  API 处理器按 `{detail, code, **extra}` 组装，所以这里不塞任何资料内容。
"""

from __future__ import annotations

from typing import Any


class StoreError(Exception):
    """资料存储层错误的基类：默认 400，由 application.py 统一映射成 HTTP。"""

    status_code: int = 400
    code: str = "profile_store_error"

    def __init__(self, detail: str, *, code: str | None = None, **extra: Any) -> None:
        text = str(detail or "").strip() or self.code
        super().__init__(text)
        self.detail = text
        self.code = code if code is not None else type(self).code
        self.extra: dict[str, Any] = dict(extra)


class NotFound(StoreError):
    """目标不存在或已软删：404，detail 提示刷新后重试。"""

    status_code = 404
    code = "not_found"


class ValidationError(StoreError):
    """输入不合法（名称/值/顺序/归属）：400。"""

    status_code = 400
    code = "validation_error"


class Conflict(StoreError):
    """当前状态拒绝该操作（含值未确认删除等业务冲突）：409。"""

    status_code = 409
    code = "conflict"


class RevisionConflict(Conflict):
    """条件写没命中：调用方手里的 revision 已过期。

    current_revision 是库里**现在**的值；extra 里的 revision 让 API 直接带进 409 响应体，
    前端拿它去刷新比较，而不是盲目重试（与 fact_store.RevisionConflict 同语义）。
    """

    code = "revision_conflict"

    def __init__(
        self,
        current_revision: int,
        detail: str = "内容已在其他窗口被修改，请刷新后再保存",
    ) -> None:
        super().__init__(detail, revision=int(current_revision))
        self.current_revision = int(current_revision)


class LimitReached(ValidationError):
    """数量上限（200 条 / 20 个自定义字段 / 20 个组）：400，code 固定 limit_reached。"""

    code = "limit_reached"


__all__ = [
    "Conflict",
    "LimitReached",
    "NotFound",
    "RevisionConflict",
    "StoreError",
    "ValidationError",
]
