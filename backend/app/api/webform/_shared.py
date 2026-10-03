"""api/webform 各路由子模块共享的小工具：``WebFormError``→``HTTPException`` 映射与 logger。

logger 显式沿用拆分前单文件的 logger 名（``app.api.webform``），日志观测行为不变。
"""
from __future__ import annotations

import logging

from fastapi import HTTPException

from ...services import webform as webform_service

logger = logging.getLogger("app.api.webform")


def _raise(exc: webform_service.WebFormError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)
