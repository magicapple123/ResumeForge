# SPDX-License-Identifier: Apache-2.0
"""W12 持久来源服务：来源实体 / 来源修订 / 目标块关联与反向查询。

硬约束（来自计划书 P1-06 与本轮任务书）：

- **不凭相似文本猜关系**：关联只能由用户显式建立；没有行就是未关联。
- **来源修订追加而不是覆盖**：只有内容指纹变化才追加一版，修订号只增不减。
- **反查**：给定来源修订（或来源当前指纹），能列出所有引用它的简历块，并区分
  已过期（stale：来源在关联之后又变了）与仍一致。
- **不复制用户正文**：来源侧只存标题/摘要/指纹，不落库完整资料。

本模块只做数据库读写与内存定位，不 import 路由。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.provenance import (
    SOURCE_KINDS,
    ResumeBlockSource,
    ResumeSource,
    ResumeSourceRevision,
)
from ...models.resume import ResumeRecord
from .document_identity import (
    ENTRY_FIELDS,
    POINT_FIELDS,
    is_object_id,
    resolve_object_path,
    resolve_point_path,
)

_MAX_TITLE = 256
_MAX_SUMMARY = 300
_MAX_METADATA_VALUE = 200

_MISSING = object()


def canonical_fingerprint(payload: Any) -> str:
    """规范化 JSON 的 SHA-256；字符串按 strip 后原文参与，None 视为空。

    不用 repr：dict 的键序在两次请求里可能不同，会让"内容没变"被算成新修订。
    """
    if payload is None:
        text = ""
    elif isinstance(payload, str):
        text = payload.strip()
    else:
        text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _validate_source_kind(kind: str) -> str:
    if kind not in SOURCE_KINDS:
        raise ValueError(f"来源类型不受支持：{kind}")
    return kind


def _clean_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """只保留短的展示字段；嵌套正文一律不收，避免把完整资料复制进来源表。"""
    if not isinstance(metadata, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for key, value in metadata.items():
        if not isinstance(key, str):
            continue
        if isinstance(value, str):
            cleaned[key] = value[:_MAX_METADATA_VALUE]
        elif isinstance(value, (int, float, bool)) or value is None:
            cleaned[key] = value
    return cleaned


@dataclass
class SourceSnapshot:
    """一次 upsert 的结果：来源实体 + 当前（或最新）修订 + 是否新增了修订。"""

    source: ResumeSource
    revision: ResumeSourceRevision
    appended: bool


def find_source(db: Session, *, kind: str, external_ref: str | None) -> ResumeSource | None:
    if external_ref is None:
        return None
    return db.execute(
        select(ResumeSource).where(
            ResumeSource.kind == kind, ResumeSource.external_ref == external_ref
        )
    ).scalar_one_or_none()


def _latest_revision(db: Session, source_id: int) -> ResumeSourceRevision | None:
    return db.execute(
        select(ResumeSourceRevision)
        .where(ResumeSourceRevision.source_id == source_id)
        .order_by(ResumeSourceRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()


def upsert_source(
    db: Session,
    *,
    kind: str,
    external_ref: str | None = None,
    title: str = "",
    payload: Any = None,
    metadata: dict[str, Any] | None = None,
) -> SourceSnapshot:
    """按 (kind, external_ref) 复用来源；内容指纹变化时追加一版修订。

    external_ref 为空表示手工来源：每次都新建（没有稳定业务行可复用）。
    """
    _validate_source_kind(kind)
    if external_ref is not None:
        external_ref = external_ref.strip()
        if not external_ref or len(external_ref) > 64:
            raise ValueError("来源引用不能为空且最长 64 个字符")
    fingerprint = canonical_fingerprint(payload)
    cleaned_title = (title or "").strip()[:_MAX_TITLE]
    cleaned_metadata = _clean_metadata(metadata)

    source = find_source(db, kind=kind, external_ref=external_ref)
    if source is None:
        source = ResumeSource(
            kind=kind,
            external_ref=external_ref,
            title=cleaned_title,
            current_fingerprint=fingerprint,
            metadata_json=cleaned_metadata,
        )
        db.add(source)
        db.flush()
        revision = ResumeSourceRevision(
            source_id=source.id,
            revision_no=1,
            fingerprint=fingerprint,
            summary=cleaned_title[:_MAX_SUMMARY],
        )
        db.add(revision)
        db.commit()
        db.refresh(source)
        db.refresh(revision)
        return SourceSnapshot(source=source, revision=revision, appended=True)

    if cleaned_title:
        source.title = cleaned_title
    if cleaned_metadata:
        merged = dict(source.metadata_json or {})
        merged.update(cleaned_metadata)
        source.metadata_json = merged
    appended = False
    revision = _latest_revision(db, source.id)
    if revision is None or source.current_fingerprint != fingerprint:
        revision = ResumeSourceRevision(
            source_id=source.id,
            revision_no=(revision.revision_no + 1) if revision is not None else 1,
            fingerprint=fingerprint,
            summary=cleaned_title[:_MAX_SUMMARY],
        )
        db.add(revision)
        source.current_fingerprint = fingerprint
        appended = True
    db.commit()
    db.refresh(source)
    db.refresh(revision)
    return SourceSnapshot(source=source, revision=revision, appended=appended)


@dataclass
class DocumentObject:
    path: str
    field: str
    object_id: str | None = None
    point_id: str | None = None
    label: str = ""


_ENTRY_LABEL_KEYS = (
    "company",
    "school",
    "organization",
    "name",
    "title",
    "role",
    "position",
    "major",
)


def _entry_label(entry: dict[str, Any]) -> str:
    for key in _ENTRY_LABEL_KEYS:
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:60]
    return ""


def _point_text(entry: dict[str, Any], key: str, index: int) -> str:
    values = entry.get(key)
    if isinstance(values, list) and 0 <= index < len(values):
        value = values[index]
        if isinstance(value, str):
            return value.strip()[:60]
    return ""


def iter_document_objects(content: dict[str, Any] | None) -> list[DocumentObject]:
    """列出正文里可关联的块：条目 + 声明了 point_ids 的要点。

    旧记录没有 id 的条目也列出来（path 定位），但**不会**因此产生任何关联。
    """
    objects: list[DocumentObject] = []
    if not isinstance(content, dict):
        return objects
    for field_name in ENTRY_FIELDS:
        points = POINT_FIELDS[field_name]
        entries = content.get(field_name) or []
        if not isinstance(entries, list):
            continue
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            object_id = entry.get("id") if is_object_id(entry.get("id")) else None
            objects.append(
                DocumentObject(
                    path=f"{field_name}.{index}",
                    field=field_name,
                    object_id=object_id,
                    label=_entry_label(entry),
                )
            )
            point_ids = entry.get("point_ids")
            if not isinstance(point_ids, dict):
                continue
            for key in points:
                values = point_ids.get(key)
                if not isinstance(values, list):
                    continue
                for point_index, point_id in enumerate(values):
                    if not is_object_id(point_id):
                        continue
                    objects.append(
                        DocumentObject(
                            path=f"{field_name}.{index}.{key}.{point_index}",
                            field=field_name,
                            object_id=object_id,
                            point_id=point_id,
                            label=_point_text(entry, key, point_index),
                        )
                    )
    return objects


def _lookup_value(content: Any, path: str) -> Any:
    current: Any = content
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


def resolve_target(
    content: dict[str, Any],
    *,
    object_id: str | None,
    point_id: str | None,
    path: str | None,
) -> tuple[str, str]:
    """把请求里的目标块解析成 (当前路径, 字段)；解析不到抛 ValueError。"""
    if object_id is not None:
        if not is_object_id(object_id):
            raise ValueError("对象标识不合法")
        resolved = (
            resolve_point_path(content, object_id, point_id)
            if point_id is not None
            else resolve_object_path(content, object_id)
        )
        if resolved is None:
            raise ValueError("这个块在当前正文里找不到（可能已被删除或标识过期）")
        return resolved, resolved.split(".")[0]
    if path:
        if _lookup_value(content, path) is _MISSING:
            raise ValueError("路径在当前正文里找不到")
        return path, path.split(".")[0]
    raise ValueError("需要 object_id 或 path 指定要关联的块")


def get_source(db: Session, source_id: int) -> ResumeSource | None:
    return db.get(ResumeSource, source_id)


def get_revision(db: Session, revision_id: int) -> ResumeSourceRevision | None:
    return db.get(ResumeSourceRevision, revision_id)


def _upsert_link(
    db: Session,
    *,
    record: ResumeRecord,
    source: ResumeSource,
    revision: ResumeSourceRevision | None,
    object_id: str | None = None,
    point_id: str | None = None,
    path: str | None = None,
    field: str | None = None,
) -> ResumeBlockSource:
    """建立（或刷新）一个块 → 来源的关联；同一来源 + 同一块只保留一条。

    关联时记的来源指纹 = 所选修订的指纹（缺修订时回退来源当前指纹）。这样
    ``link_status`` 才能如实区分"关联的就是最新版"与"关联的是旧版"。
    """
    resolved_path, resolved_field = resolve_target(
        record.content or {}, object_id=object_id, point_id=point_id, path=path
    )
    fingerprint = revision.fingerprint if revision is not None else source.current_fingerprint
    revision_id = revision.id if revision is not None else None
    existing = db.execute(
        select(ResumeBlockSource).where(
            ResumeBlockSource.resume_id == record.id,
            ResumeBlockSource.source_id == source.id,
            ResumeBlockSource.object_id == object_id,
            ResumeBlockSource.point_id == point_id,
            ResumeBlockSource.path == resolved_path,
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.path = resolved_path
        existing.field = resolved_field if field is None else field
        existing.source_revision_id = revision_id
        existing.source_fingerprint = fingerprint
        db.commit()
        db.refresh(existing)
        return existing
    link = ResumeBlockSource(
        resume_id=record.id,
        source_id=source.id,
        source_revision_id=revision_id,
        object_id=object_id,
        point_id=point_id,
        path=resolved_path,
        field=resolved_field if field is None else field,
        source_fingerprint=fingerprint,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def create_link(
    db: Session,
    *,
    record: ResumeRecord,
    snapshot: SourceSnapshot,
    object_id: str | None = None,
    point_id: str | None = None,
    path: str | None = None,
    field: str | None = None,
) -> ResumeBlockSource:
    """建立/刷新关联（内嵌来源描述路径：先 upsert 来源再关联）。"""
    return _upsert_link(
        db,
        record=record,
        source=snapshot.source,
        revision=snapshot.revision,
        object_id=object_id,
        point_id=point_id,
        path=path,
        field=field,
    )


def link_source(
    db: Session,
    *,
    record: ResumeRecord,
    source: ResumeSource,
    revision: ResumeSourceRevision | None = None,
    object_id: str | None = None,
    point_id: str | None = None,
    path: str | None = None,
    field: str | None = None,
) -> ResumeBlockSource:
    """把已有来源（可选指定某版修订）关联到简历块；重复关联去重/刷新。

    来源/修订的存在性与归属由调用方（路由）先校验；修订不属于来源时这里拒绝。
    """
    if revision is None:
        revision = _latest_revision(db, source.id)
    if revision is not None and revision.source_id != source.id:
        raise ValueError("来源修订不属于这条来源")
    return _upsert_link(
        db,
        record=record,
        source=source,
        revision=revision,
        object_id=object_id,
        point_id=point_id,
        path=path,
        field=field,
    )


def delete_link(db: Session, *, resume_id: int, link_id: int) -> bool:
    link = db.get(ResumeBlockSource, link_id)
    if link is None or link.resume_id != resume_id:
        return False
    db.delete(link)
    db.commit()
    return True


def link_status(source: ResumeSource, link: ResumeBlockSource) -> Literal["linked", "stale"]:
    # 返回值只有这两种（Literal 与 schemas.provenance.LinkStatus 同口径），
    # API 层直接把它填进 BlockLinkOut.status，不需要运行时转换。
    return "linked" if link.source_fingerprint == source.current_fingerprint else "stale"
