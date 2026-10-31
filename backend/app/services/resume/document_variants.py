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
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant, ResumeVersion
from .document_paths import read_document_value, write_document_value
from .document_variants_view import (
    MAX_LAYOUT_BYTES,
    normalize_layout,
)
from .document_variants_view import (
    variant_brief as variant_brief_view,
)
from .document_variants_view import (
    variant_detail as variant_detail_view,
)
from .document_versions import (
    VersionNotFound,
    _get_version,
    _job_snapshot,
    document_content,
    layout_snapshot,
)
from .resume_delivery import canonical_content_sha256

_MISSING = object()


def variant_brief(variant: ResumeVariant) -> dict[str, Any]:
    """变体只读摘要（实现见 document_variants_view）。"""
    return variant_brief_view(variant)


def variant_detail(variant: ResumeVariant) -> dict[str, Any]:
    """变体详情：旧快照（v1）在读取边界统一收口为 v2。"""
    content = document_content(variant.content, variant.render_context)
    return variant_detail_view(variant, content)


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
    context = (
        copy.deepcopy(base.render_context or {})
        if base is not None
        else layout_snapshot(db, record)
    )
    # 落库的永远是 v2：旧命名版本（v1 快照）在这里一次性转换，新版本/当前简历直通。
    content = document_content(
        base.content if base is not None else record.content,
        base.render_context if base is not None else context,
    )
    # A5：显式给定的上下文优先（按职业场景派生变体）；否则继承"哪个来源的上下文"与
    # 内容/排版同源——指定命名版本时用版本的冻结快照，否则用当前简历的。之后
    # **互不影响**（同步/翻译都不改它）。
    if context_snapshot is None:
        context_snapshot = copy.deepcopy(
            base.context_snapshot if base is not None else getattr(record, "context_snapshot", None)
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
        layout=normalize_layout(layout),
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


# v1 顶层标量 -> v2 页眉 item key（photo 不同步：它是二进制派生值，不走文本同步）。


def read_document_path(document: dict, path: str) -> Any:
    return read_document_value(document, path, _MISSING)


def write_document_path(document: dict, path: str, value: Any) -> bool:
    if document.get("version") != 2:
        return _write_path(document, path, value)
    return write_document_value(document, path, value)


def _variant_document(variant: ResumeVariant) -> dict:
    """变体内容 -> v2 文档（旧变体 v1 快照在这里一次性转换，之后按 v2 原生改）。"""
    return document_content(variant.content, variant.render_context)


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
        if read_document_path(source_content, cleaned) is _MISSING:
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
        # 变体内容统一收口为 v2 后在文档上原生写入：不同步的 item（位置/版式/隐藏）原样保留。
        content = _variant_document(variant)
        applied: list[str] = []
        for path in normalized_paths:
            value = read_document_path(source_content, path)
            if value is _MISSING:
                continue
            if write_document_path(content, path, value):
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
    variant.layout = normalize_layout(layout)
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
    content = document_content(variant.content, layout)
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
    "read_document_path",
    "resolve_variant_export",
    "set_variant_layout",
    "sync_variants",
    "variant_brief",
    "variant_detail",
    "write_document_path",
]
