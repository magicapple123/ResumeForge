# SPDX-License-Identifier: Apache-2.0
"""W12 来源读侧：聚合视图 / 影响反查 / 块来源链。

从 document_provenance.py 拆出（行数预算）：写侧（来源 upsert 与关联建立）与读侧
（给界面的视图）各自内聚，读写两侧不共享可变状态。

约定：
- 未关联 = objects[].link 为 None，**不是**一种猜测出来的状态；
- status 是算出来的：关联时的来源指纹与来源当前指纹不同即 stale；
- 影响反查按"简历块"给出，不推测文本相似度。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.provenance import (
    ResumeBlockSource,
    ResumeSource,
    ResumeSourceRevision,
)
from ...models.resume import ResumeRecord
from .document_provenance import (
    iter_document_objects,
    link_status,
    resolve_target,
)


def _revisions_by_source(
    db: Session, source_ids: list[int]
) -> dict[int, list[ResumeSourceRevision]]:
    if not source_ids:
        return {}
    rows = (
        db.execute(
            select(ResumeSourceRevision)
            .where(ResumeSourceRevision.source_id.in_(source_ids))
            .order_by(ResumeSourceRevision.source_id, ResumeSourceRevision.revision_no)
        )
        .scalars()
        .all()
    )
    grouped: dict[int, list[ResumeSourceRevision]] = {source_id: [] for source_id in source_ids}
    for row in rows:
        grouped.setdefault(row.source_id, []).append(row)
    return grouped


def provenance_view(db: Session, record: ResumeRecord) -> dict[str, Any]:
    """一份简历的来源视图：来源+修订+关联、每个可关联块的关联状态、覆盖率。"""
    links = (
        db.execute(
            select(ResumeBlockSource)
            .where(ResumeBlockSource.resume_id == record.id)
            .order_by(ResumeBlockSource.id)
        )
        .scalars()
        .all()
    )
    source_ids = sorted({link.source_id for link in links})
    sources = (
        db.execute(select(ResumeSource).where(ResumeSource.id.in_(source_ids))).scalars().all()
        if source_ids
        else []
    )
    revisions = _revisions_by_source(db, source_ids)
    source_by_id = {source.id: source for source in sources}
    link_by_key: dict[tuple[str, str | None], ResumeBlockSource] = {}
    for link in links:
        link_by_key.setdefault((link.object_id or link.path, link.point_id), link)

    def _link_payload(link: ResumeBlockSource) -> dict[str, Any] | None:
        source = source_by_id.get(link.source_id)
        if source is None:
            return None
        return {
            "link_id": link.id,
            "source_id": source.id,
            "object_id": link.object_id,
            "point_id": link.point_id,
            "path": link.path,
            "field": link.field,
            "source_fingerprint": link.source_fingerprint,
            "status": link_status(source, link),
        }

    source_payload: list[dict[str, Any]] = []
    for source in sources:
        revision_rows = revisions.get(source.id, [])
        source_payload.append(
            {
                "id": source.id,
                "kind": source.kind,
                "external_ref": source.external_ref,
                "title": source.title,
                "current_fingerprint": source.current_fingerprint,
                "latest_revision_no": revision_rows[-1].revision_no if revision_rows else 0,
                "revisions": [
                    {
                        "revision_no": revision.revision_no,
                        "fingerprint": revision.fingerprint,
                        "summary": revision.summary,
                        "captured_at": revision.captured_at,
                    }
                    for revision in revision_rows
                ],
                "blocks": [
                    payload
                    for link in links
                    if link.source_id == source.id
                    for payload in [_link_payload(link)]
                    if payload is not None
                ],
            }
        )

    objects: list[dict[str, Any]] = []
    linked_count = 0
    for item in iter_document_objects(record.content or {}):
        link = link_by_key.get((item.object_id or item.path, item.point_id))
        if item.object_id is not None and link is not None and link.object_id != item.object_id:
            link = None
        if item.object_id is None and link is not None and link.object_id is not None:
            link = None
        payload = _link_payload(link) if link is not None else None
        if payload is not None:
            linked_count += 1
        objects.append(
            {
                "path": item.path,
                "field": item.field,
                "object_id": item.object_id,
                "point_id": item.point_id,
                "label": item.label,
                "link": payload,
            }
        )
    return {
        "resume_id": record.id,
        "revision": int(record.revision or 0),
        "sources": source_payload,
        "objects": objects,
        "coverage": {
            "total": len(objects),
            "linked": linked_count,
            "unlinked": len(objects) - linked_count,
        },
    }


def source_impact(db: Session, source_id: int) -> dict[str, Any] | None:
    """反查：哪些简历块引用了这条来源；关联后来源又变了的标记 stale。"""
    source = db.get(ResumeSource, source_id)
    if source is None:
        return None
    links = (
        db.execute(
            select(ResumeBlockSource)
            .where(ResumeBlockSource.source_id == source_id)
            .order_by(ResumeBlockSource.resume_id, ResumeBlockSource.id)
        )
        .scalars()
        .all()
    )
    resume_ids = sorted({link.resume_id for link in links})
    resumes = (
        db.execute(select(ResumeRecord).where(ResumeRecord.id.in_(resume_ids))).scalars().all()
        if resume_ids
        else []
    )
    resume_by_id = {record.id: record for record in resumes}
    affected = []
    for link in links:
        record = resume_by_id.get(link.resume_id)
        affected.append(
            {
                "resume_id": link.resume_id,
                "resume_title": (record.title if record is not None else ""),
                "link_id": link.id,
                "source_id": source.id,
                "object_id": link.object_id,
                "point_id": link.point_id,
                "path": link.path,
                "field": link.field,
                "linked_fingerprint": link.source_fingerprint,
                "current_fingerprint": source.current_fingerprint,
                "stale": link.source_fingerprint != source.current_fingerprint,
                "resume_deleted": bool(record is not None and record.deleted_at is not None),
            }
        )
    return {
        "source_id": source.id,
        "kind": source.kind,
        "title": source.title,
        "current_fingerprint": source.current_fingerprint,
        "affected": affected,
        "stale_count": sum(1 for item in affected if item["stale"]),
    }


def source_chain(
    db: Session,
    record: ResumeRecord,
    *,
    object_id: str | None = None,
    point_id: str | None = None,
    path: str | None = None,
) -> dict[str, Any]:
    """某个块的来源链：关联到的来源及其全部修订（按修订号升序）。"""
    try:
        resolved_path, _field = resolve_target(
            record.content or {}, object_id=object_id, point_id=point_id, path=path
        )
    except ValueError:
        resolved_path = path or ""
    links = (
        db.execute(
            select(ResumeBlockSource).where(
                ResumeBlockSource.resume_id == record.id,
                ResumeBlockSource.path == resolved_path,
            )
        )
        .scalars()
        .all()
    )
    source_ids = sorted({link.source_id for link in links})
    sources = (
        db.execute(select(ResumeSource).where(ResumeSource.id.in_(source_ids))).scalars().all()
        if source_ids
        else []
    )
    view = provenance_view(db, record)
    by_id = {item["id"]: item for item in view["sources"]}
    return {
        "resume_id": record.id,
        "object_id": object_id,
        "point_id": point_id,
        "path": resolved_path,
        "sources": [by_id[source.id] for source in sources if source.id in by_id],
    }


def source_detail(db: Session, source_id: int) -> dict[str, Any] | None:
    """一条来源及其全部修订（界面在来源详情里列"第 N 版"）。"""
    source = db.get(ResumeSource, source_id)
    if source is None:
        return None
    revisions = _revisions_by_source(db, [source.id]).get(source.id, [])
    links = (
        db.execute(
            select(ResumeBlockSource)
            .where(ResumeBlockSource.source_id == source.id)
            .order_by(ResumeBlockSource.id)
        )
        .scalars()
        .all()
    )
    return {
        "id": source.id,
        "kind": source.kind,
        "external_ref": source.external_ref,
        "title": source.title,
        "current_fingerprint": source.current_fingerprint,
        "latest_revision_no": revisions[-1].revision_no if revisions else 0,
        "revisions": [
            {
                "revision_no": revision.revision_no,
                "fingerprint": revision.fingerprint,
                "summary": revision.summary,
                "captured_at": revision.captured_at,
            }
            for revision in revisions
        ],
        "blocks": [
            {
                "link_id": link.id,
                "source_id": source.id,
                "object_id": link.object_id,
                "point_id": link.point_id,
                "path": link.path,
                "field": link.field,
                "source_fingerprint": link.source_fingerprint,
                "status": link_status(source, link),
            }
            for link in links
        ],
    }
