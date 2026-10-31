# SPDX-License-Identifier: Apache-2.0
"""岗位变体的只读视图与排版校验（从 document_variants.py 拆出：单文件 500 行预算）。

纯函数、不碰数据库：variant_brief / variant_detail 决定变体对外形状，normalize_layout
决定独立排版覆盖的合法性。拆出来只按行数，不改语义。
"""

from __future__ import annotations

import copy
import json
from typing import Any

from ...models.versions import ResumeVariant
from ...schemas.resume_generation import MODE_PAGE_LIMITS

MAX_LAYOUT_BYTES = 64 * 1024
_LAYOUT_STRING_KEYS = ("template", "format_name", "font_scale", "language", "document_mode")


def normalize_layout(layout: Any) -> dict[str, Any] | None:
    """校验并复制变体排版；None 表示"清除独立排版、回到继承"。

    只校验会影响渲染的类型（页数/字符串键/format_config），未知顶层键原样保留：
    渲染层新增参数时不需要同步改这里（与 format_config 的扩展机制同一思路）。
    """
    if layout is None:
        return None
    if not isinstance(layout, dict):
        raise ValueError("排版配置必须是对象")
    try:
        serialized = json.dumps(layout, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise ValueError("排版配置包含无法序列化的值") from exc
    if len(serialized.encode("utf-8")) > MAX_LAYOUT_BYTES:
        raise ValueError("排版配置过大")
    cleaned = copy.deepcopy(layout)
    page_limit = cleaned.get("page_limit")
    if page_limit is not None:
        if isinstance(page_limit, bool) or not isinstance(page_limit, int):
            raise ValueError("page_limit 必须是整数")
        low, high = MODE_PAGE_LIMITS.get(
            str(cleaned.get("document_mode") or "resume"), MODE_PAGE_LIMITS["resume"]
        )
        if not low <= page_limit <= high:
            raise ValueError(f"page_limit 必须在 {low} 到 {high} 之间")
    for key in _LAYOUT_STRING_KEYS:
        value = cleaned.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{key} 必须是字符串")
    format_config = cleaned.get("format_config")
    if format_config is not None and not isinstance(format_config, dict):
        raise ValueError("format_config 必须是对象")
    return cleaned


def variant_brief(variant: ResumeVariant) -> dict[str, Any]:
    """变体列表/详情共有的只读摘要（不含 content）。"""
    return {
        "id": variant.id,
        "resume_id": variant.resume_id,
        "name": variant.name,
        "job_id": variant.job_id,
        "job_title": variant.job_title,
        "company": variant.company,
        "content_sha256": variant.content_sha256,
        "context_snapshot": copy.deepcopy(variant.context_snapshot),
        "base_version_id": variant.base_version_id,
        "last_synced_version_id": variant.last_synced_version_id,
        "synced_at": variant.synced_at,
        "language": variant.language or "",
        "variant_group_id": variant.variant_group_id,
        "has_layout": variant.layout is not None,
        "created_at": variant.created_at,
        "updated_at": variant.updated_at,
    }


def variant_detail(variant: ResumeVariant, content: dict[str, Any]) -> dict[str, Any]:
    """变体详情：摘要 + **v2 content**（调用方负责版本收口，见 document_variants）。"""
    return {
        **variant_brief(variant),
        "content": content,
        "render_context": variant.render_context or {},
        "layout": copy.deepcopy(variant.layout) if variant.layout is not None else None,
    }


__all__ = ["MAX_LAYOUT_BYTES", "normalize_layout", "variant_brief", "variant_detail"]
