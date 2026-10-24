# SPDX-License-Identifier: Apache-2.0
"""R04 外发前预览接口：返回"将要发出什么"；正文只留在本次响应（内存）。"""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas.outbound import OutboundPreviewOut, OutboundPreviewRequest
from ..services.llm.outbound_preview import build_outbound_preview

router = APIRouter(prefix="/api/outbound", tags=["outbound"])


@router.post("/preview", response_model=OutboundPreviewOut)
def preview_outbound(payload: OutboundPreviewRequest) -> OutboundPreviewOut:
    """不写库、不写日志；secret_leak_detected 只给 boolean，不回显密钥片段。"""
    return build_outbound_preview(payload)
