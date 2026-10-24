# SPDX-License-Identifier: Apache-2.0
"""W13 岗位变体的业务编排（从 document_versions.py 拆出：单文件行数预算）。

版本（不可变快照）与变体（独立表达）是两类对象，拆分只按职责、不改语义：
变体有自己的 content/render_context；只有用户显式"选择性同步"时才会改指定路径，
其余岗位定制原样保留。
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant, ResumeVersion
from .document_versions import (
    VersionNotFound,
    _get_version,
    _job_snapshot,
    _snapshot_content,
    layout_snapshot,
)
from .resume_delivery import canonical_content_sha256

_MISSING = object()


def variant_brief(variant: ResumeVariant) -> dict[str, Any]:
    return {
        "id": variant.id,
        "resume_id": variant.resume_id,
        "name": variant.name,
        "job_id": variant.job_id,
        "job_title": variant.job_title,
        "company": variant.company,
        "content_sha256": variant.content_sha256,
        "base_version_id": variant.base_version_id,
        "last_synced_version_id": variant.last_synced_version_id,
        "synced_at": variant.synced_at,
        # W16 语言变体字段（旧变体为 ""/None）。
        "language": variant.language or "",
        "variant_group_id": variant.variant_group_id,
        "created_at": variant.created_at,
        "updated_at": variant.updated_at,
    }


def variant_detail(variant: ResumeVariant) -> dict[str, Any]:
    return {
        **variant_brief(variant),
        "content": variant.content or {},
        "render_context": variant.render_context or {},
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
) -> ResumeVariant:
    """派生岗位变体：内容/排版取自当前简历或指定命名版本，之后与它们互不影响。"""
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
    variant = ResumeVariant(
        resume_id=record.id,
        name=cleaned,
        job_id=resolved_job_id,
        job_title=job_title,
        company=company,
        content=content,
        render_context=context,
        content_sha256=canonical_content_sha256(content),
        base_version_id=base.id if base is not None else None,
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


__all__ = [
    "VersionNotFound",
    "create_variant",
    "get_variant",
    "list_variants",
    "sync_variants",
    "variant_brief",
    "variant_detail",
]
