# SPDX-License-Identifier: Apache-2.0
"""R04 外发前预览：说明"这次要发出去什么"，正文只留在本次响应的内存里。

边界（与任务书 R04 对齐）：

- 预览是**展示**，不是编辑器：不改写正文，否则用户看到的与实际发送的不一致。
- 正文不落库、不写日志；本模块没有任何 logger 调用，也不接受数据库会话。
- 只做体检：识别疑似密钥形态（sk-…、dpapi:v1:、api_key=…、Bearer …），响应里只给
  boolean，不回显命中的密钥片段。
- 正文长度有上限（MAX_PREVIEW_BODY_CHARS）；超出部分不回显，但 body_chars 与哈希
  仍按完整正文计算，用户能看出"预览被截断了"。
"""

from __future__ import annotations

import hashlib
import re

from ...schemas.outbound import (
    MAX_PREVIEW_BODY_CHARS,
    OutboundPreviewOut,
    OutboundPreviewRequest,
)

_SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"dpapi:v1:"),
    re.compile(r"(?i)api[_-]?key\s*[:=]\s*\S{8,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]{16,}"),
    re.compile(r"(?i)(password|passwd|secret)\s*[:=]\s*\S{6,}"),
)


def detect_secret_leak(text: str) -> bool:
    """是否像包含凭据；只返回 boolean，绝不回显命中的片段。"""
    if not text:
        return False
    return any(pattern.search(text) for pattern in _SECRET_PATTERNS)


def build_outbound_preview(request: OutboundPreviewRequest) -> OutboundPreviewOut:
    """构造预览；不持久化、不记录正文。"""
    body = request.body or ""
    truncated = len(body) > MAX_PREVIEW_BODY_CHARS
    return OutboundPreviewOut(
        target_service=request.target_service.strip(),
        material_categories=list(request.material_categories),
        attachment_types=list(request.attachment_types),
        excluded_fields=list(request.excluded_fields),
        fetch_pages=request.fetch_pages,
        body_preview=body[:MAX_PREVIEW_BODY_CHARS],
        body_chars=len(body),
        body_truncated=truncated,
        body_sha256=hashlib.sha256(body.encode("utf-8")).hexdigest(),
        secret_leak_detected=detect_secret_leak(body),
        persistence="memory_only",
    )
