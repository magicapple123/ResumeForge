"""网申填表的公共异常。形状与 ``services/apply/_base.py`` 一致：``status_code`` 供路由层
直接映射，``detail`` 为中文（可为结构化 dict）。"""
from __future__ import annotations

from typing import Any


class WebFormError(Exception):
    def __init__(self, detail: str | dict[str, Any], status_code: int = 400) -> None:
        message = detail if isinstance(detail, str) else str(detail.get("message", "请求无法完成"))
        super().__init__(message)
        self.detail = detail
        self.status_code = status_code


class WebFormBadRequest(WebFormError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 400)


class WebFormNotFound(WebFormError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 404)


class WebFormConflict(WebFormError):
    def __init__(self, detail: str | dict[str, Any]) -> None:
        super().__init__(detail, 409)


__all__ = ["WebFormBadRequest", "WebFormConflict", "WebFormError", "WebFormNotFound"]
