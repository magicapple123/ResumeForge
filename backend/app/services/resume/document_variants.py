# SPDX-License-Identifier: Apache-2.0
"""W13/W16 岗位变体的业务编排（从 document_versions.py 拆出：单文件行数预算）。

版本（不可变快照）与变体（独立表达）是两类对象，拆分只按职责、不改语义：
变体有自己的 content/render_context；只有用户显式"选择性同步"时才会改指定路径，
其余岗位定制原样保留。

W16「两份独立排版」（0060）：变体新增 ``layout`` —用户显式保存的独立排版上下文；
NULL = 继承（render_context 基底快照 → 当前简历 layout_snapshot）。导出/预览统一走
:func:`resolve_variant_export` 取"这一份变体的内容 + 生效排版"，不在导出路由里另拼一套。
"""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant, ResumeVersion
from ...schemas.resume_generation import MODE_PAGE_LIMITS
from .document_versions import (
    VersionNotFound,
    _get_version,
    _job_snapshot,
    _snapshot_content,
    layout_snapshot,
)
from .resume_delivery import canonical_content_sha256

_MISSING = object()

# 变体独立排版的大小上限：排版上下文只有模板名/版式名/页数/字号/语言与 format_config，
# 64KB 足够且能拦住"把整份正文塞进 layout"的误用（layout 不是第二个 content）。
MAX_LAYOUT_BYTES = 64 * 1024
_LAYOUT_STRING_KEYS = ("template", "format_name", "font_scale", "language", "document_mode")


def _normalize_layout(layout: Any) -> dict[str, Any] | None:
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
        # A4 长 CV：上限按这份排版自己的 document_mode 判定（旧变体没有该键 →
        # resume → 仍是 1–3 页，旧行为不变）。此前固定按 MAX_RESUME_PAGES 校验会把
        # 10 页的长 CV 变体当成非法输入——那是"模式切换后旧页数规则误拦"。
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
    return {
        "id": variant.id,
        "resume_id": variant.resume_id,
        "name": variant.name,
        "job_id": variant.job_id,
        "job_title": variant.job_title,
        "company": variant.company,
        "content_sha256": variant.content_sha256,
        # A5：派生变体继承的生成上下文（命名版本优先，否则当前简历）。NULL = 未记录。
        # 变体另选场景不在本批：这里只做继承与只读展示，不提供改写入参。
        "context_snapshot": copy.deepcopy(variant.context_snapshot),
        "base_version_id": variant.base_version_id,
        "last_synced_version_id": variant.last_synced_version_id,
        "synced_at": variant.synced_at,
        # W16 语言变体字段（旧变体为 ""/None）与独立排版覆盖标记。
        "language": variant.language or "",
        "variant_group_id": variant.variant_group_id,
        "has_layout": variant.layout is not None,
        "created_at": variant.created_at,
        "updated_at": variant.updated_at,
    }


def variant_detail(variant: ResumeVariant) -> dict[str, Any]:
    return {
        **variant_brief(variant),
        "content": variant.content or {},
        "render_context": variant.render_context or {},
        # 原始覆盖值（None = 继承）；生效排版走 resolve_variant_export。
        "layout": copy.deepcopy(variant.layout) if variant.layout is not None else None,
    }


def _get_variant(db: Session, resume_id: int, variant_id: int) -> ResumeVariant:
    variant = db.get(ResumeVariant, variant_id)
    if variant is None or variant.resume_id != resume_id:
        raise VersionNotFound("岗位变体不存在")
    return variant


def create_variant(
    db: Session,
    record: ResumeRecord,
    *,
    name: str,
    job_id: int | None = None,
    base_version_id: int | None = None,
    layout: dict[str, Any] | None = None,
    context_snapshot: dict[str, Any] | None = None,
) -> ResumeVariant:
    """派生岗位变体：内容/排版取自当前简历或指定命名版本，之后与它们互不影响。

    ``layout``（W16）：创建时就带一份独立排版覆盖；None = 继承基底快照，行为与旧版一致。

    ``context_snapshot``（A5）：显式给定时作为这条变体自己的生成上下文（用于"按职业
    场景派生变体"）；None = 沿用来源（命名版本优先，否则当前简历）的快照，旧行为不变。
    """
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("变体名称不能为空")
    if len(cleaned) > 256:
        raise ValueError("变体名称过长")
    base: ResumeVersion | None = None
    if base_version_id is not None:
        base = _get_version(db, record.id, base_version_id)
    resolved_job_id, job_title, company = _job_snapshot(db, record, job_id)
    if resolved_job_id is None and base is not None:
        resolved_job_id = base.job_id
    content = _snapshot_content(base.content if base is not None else record.content)
    context = (
        copy.deepcopy(base.render_context or {})
        if base is not None
        else layout_snapshot(db, record)
    )
    # A5：显式给定的上下文优先（按职业场景派生变体）；否则继承"哪个来源的上下文"与
    # 内容/排版同源——指定命名版本时用版本的冻结快照，否则用当前简历的。之后
    # **互不影响**（同步/翻译都不改它）。
    if context_snapshot is None:
        context_snapshot = copy.deepcopy(
            base.context_snapshot
            if base is not None
            else getattr(record, "context_snapshot", None)
        )
    else:
        context_snapshot = copy.deepcopy(context_snapshot)
    variant = ResumeVariant(
        resume_id=record.id,
        name=cleaned,
        job_id=resolved_job_id,
        job_title=job_title,
        company=company,
        content=content,
        render_context=context,
        layout=_normalize_layout(layout),
        content_sha256=canonical_content_sha256(content),
        base_version_id=base.id if base is not None else None,
        context_snapshot=context_snapshot,
    )
    db.add(variant)
    db.commit()
    db.refresh(variant)
    return variant


def list_variants(db: Session, resume_id: int) -> list[ResumeVariant]:
    return list(
        db.execute(
            select(ResumeVariant)
            .where(ResumeVariant.resume_id == resume_id)
            .order_by(ResumeVariant.id)
        )
        .scalars()
        .all()
    )


def get_variant(db: Session, resume_id: int, variant_id: int) -> ResumeVariant:
    return _get_variant(db, resume_id, variant_id)


def _read_path(payload: Any, path: str) -> Any:
    current: Any = payload
    for segment in path.split("."):
        if isinstance(current, dict):
            if segment not in current:
                return _MISSING
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return _MISSING
        else:
            return _MISSING
    return current


def _write_path(payload: Any, path: str, value: Any) -> bool:
    """只改已存在的路径（不新建数组元素），返回是否写入成功。"""
    segments = path.split(".")
    current: Any = payload
    for segment in segments[:-1]:
        if isinstance(current, dict):
            if segment not in current:
                return False
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return False
        else:
            return False
    leaf = segments[-1]
    if isinstance(current, dict):
        if leaf not in current:
            return False
        current[leaf] = copy.deepcopy(value)
        return True
    if isinstance(current, list):
        try:
            index = int(leaf)
        except ValueError:
            return False
        if not 0 <= index < len(current):
            return False
        current[index] = copy.deepcopy(value)
        return True
    return False


def sync_variants(
    db: Session,
    record: ResumeRecord,
    *,
    source_version_id: int | None,
    variant_ids: list[int],
    paths: list[str],
) -> list[dict[str, Any]]:
    """选择性同步：只把来源里列出的路径写进列出的变体，其余内容原样保留。"""
    if not variant_ids or not paths:
        raise ValueError("需要至少一个变体与一条路径")
    if len(variant_ids) > 50 or len(paths) > 200:
        raise ValueError("一次同步的变体或路径数量过多")
    source_version: ResumeVersion | None = None
    if source_version_id is not None:
        source_version = _get_version(db, record.id, source_version_id)
    source_content = (
        source_version.content if source_version is not None else (record.content or {})
    )
    normalized_paths: list[str] = []
    for path in paths:
        cleaned = (path or "").strip()
        if not cleaned or len(cleaned) > 256:
            raise ValueError("同步路径不合法")
        if _read_path(source_content, cleaned) is _MISSING:
            raise ValueError(f"来源内容里没有这条路径：{cleaned}")
        if cleaned not in normalized_paths:
            normalized_paths.append(cleaned)
    seen: set[int] = set()
    results: list[dict[str, Any]] = []
    for variant_id in variant_ids:
        if variant_id in seen:
            continue
        seen.add(variant_id)
        variant = _get_variant(db, record.id, variant_id)
        content = copy.deepcopy(variant.content or {})
        applied: list[str] = []
        for path in normalized_paths:
            value = _read_path(source_content, path)
            if value is _MISSING:
                continue
            if _write_path(content, path, value):
                applied.append(path)
        if applied:
            # 选择性同步只写勾选路径：content_snapshot 是"派生时的场景上下文"，
            # 不是内容路径的一部分，**同步不覆盖它**（目标变体的上下文保持原样）。
            variant.content = content
            variant.content_sha256 = canonical_content_sha256(content)
            variant.last_synced_version_id = (
                source_version.id if source_version is not None else None
            )
            variant.synced_at = datetime.now(UTC)
        results.append(
            {
                "variant_id": variant.id,
                "applied_paths": applied,
                "content_sha256": variant.content_sha256 or "",
            }
        )
    db.commit()
    return results


def set_variant_layout(
    db: Session, variant: ResumeVariant, layout: dict[str, Any] | None
) -> ResumeVariant:
    """保存/清除变体的独立排版覆盖（None = 清除，回到继承）。"""
    variant.layout = _normalize_layout(layout)
    db.commit()
    db.refresh(variant)
    return variant


def _load_resume(db: Session, record: ResumeRecord | int) -> ResumeRecord:
    resume = db.get(ResumeRecord, record) if isinstance(record, int) else record
    if resume is None or getattr(resume, "deleted_at", None) is not None:
        raise VersionNotFound("简历记录不存在或已被删除")
    return resume


def resolve_variant_export(
    db: Session, record: ResumeRecord | int, variant_id: int
) -> dict[str, Any]:
    """解析"导出/预览这条变体"所需的内容与生效排版（W16 唯一入口）。

    - content 恒取变体自己的内容（**不是**当前简历的）；
    - layout 的优先级：变体独立覆盖（source="variant"）→ 派生时的 render_context 基底
      快照（source="snapshot"，旧变体兼容路径）→ 当前简历 layout_snapshot（source="resume"，
      旧变体没有 render_context 时的兜底）；
    - 非法/跨简历/已删 variant 抛 :class:`VersionNotFound`，路由转 404。
    """
    resume = _load_resume(db, record)
    variant = _get_variant(db, resume.id, variant_id)
    snapshot_layout = variant.render_context if isinstance(variant.render_context, dict) else {}
    stored_layout = variant.layout if isinstance(variant.layout, dict) else None
    if stored_layout is not None:
        layout = copy.deepcopy(stored_layout)
        layout_source = "variant"
    elif snapshot_layout:
        layout = copy.deepcopy(snapshot_layout)
        layout_source = "snapshot"
    else:
        layout = layout_snapshot(db, resume)
        layout_source = "resume"
    content = copy.deepcopy(variant.content or {})
    return {
        "resume_id": resume.id,
        "variant_id": variant.id,
        "name": variant.name,
        "language": variant.language or "",
        "content": content,
        "layout": layout,
        "layout_source": layout_source,
        "content_sha256": variant.content_sha256 or "",
        "variant_updated_at": variant.updated_at,
    }


__all__ = [
    "MAX_LAYOUT_BYTES",
    "VersionNotFound",
    "create_variant",
    "get_variant",
    "list_variants",
    "resolve_variant_export",
    "set_variant_layout",
    "sync_variants",
    "variant_brief",
    "variant_detail",
]
