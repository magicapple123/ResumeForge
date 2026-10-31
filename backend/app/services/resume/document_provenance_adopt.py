# SPDX-License-Identifier: Apache-2.0
"""W12「来源更新 → 采纳写正文」（POST /api/provenance/links/{id}/adopt）。

为什么单独成模块：采纳要同时满足四件事，放在路由里写会散成第二套保存实现——

1. **来源文本可信**：请求里的 ``text`` 必须与所选来源修订的内容指纹一致。来源在用户
   查看之后又变了时返回 409 ``source_revision_stale``，而不是把旧文本当最新版写进去；
2. **目标块明确**：point 级关联直接写要点数组元素；条目级关联必须由请求显式给字段
   路径（例如 ``experience.0.description.0``），服务端不猜该写哪个字段；
3. **锁闸门**：事实锁与 W06 ``lock_content`` 复用 ``fact_locks.validate_document_locks``，
   有任何违规就抛同一个 ``FactLockError``（路由转 409 + fact_lock_conflict + violations），
   正文一个字节都不写；
4. **条件写**：复用 ``document_save.save_content``（全仓库唯一保存实现），
   ``expected_revision`` 过期 → ``RevisionConflict`` → 409 resume_revision_conflict。

成功后才把关联刷新到所采纳的修订：状态从 stale 回到 linked；失败不更新关联。
"""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.provenance import ResumeBlockSource, ResumeSource, ResumeSourceRevision
from ...models.resume import ResumeRecord
from . import document_io, fact_locks
from .document_paths import resolve_document_path, write_document_value
from .document_provenance import canonical_fingerprint
from .document_provenance_nodes import resolved_link_path
from .document_provenance_source_text import resolve_current_source_text
from .document_save import save_content

_MISSING = object()
SOURCE_REVISION_STALE_CODE = "source_revision_stale"
# 409 响应的 detail 用这条**静态文案**（与异常消息同源）；直接 str(exc) 会被
# CodeQL py/stack-trace-exposure 认成把异常内容透给客户端。
SOURCE_REVISION_STALE_DETAIL = "来源在查看之后又更新了，请先刷新来源再采纳"


class AdoptError(ValueError):
    """采纳请求无法解析（目标块/修订/文本位置不合法）→ 路由 400。"""


class SourceRevisionStale(ValueError):
    """请求文本与来源修订指纹不一致（来源在查看后又变了）→ 路由 409 稳定码。"""

    code = SOURCE_REVISION_STALE_CODE

    def __init__(self, expected_fingerprint: str) -> None:
        super().__init__(SOURCE_REVISION_STALE_DETAIL)
        self.expected_fingerprint = expected_fingerprint


def _block_base_path(
    record: ResumeRecord, link: ResumeBlockSource, document: dict | None = None
) -> str | None:
    document = (
        document if document is not None else document_io.document_for_record(None, record)[0]
    )
    return resolved_link_path(document, link)


def resolve_adopt_target(
    record: ResumeRecord,
    link: ResumeBlockSource,
    requested_path: str | None,
    *,
    document: dict | None = None,
) -> str:
    document = (
        document if document is not None else document_io.document_for_record(None, record)[0]
    )
    base = _block_base_path(record, link, document)
    if base is None:
        raise AdoptError("关联的目标块在当前正文里找不到（可能已被删除或标识过期）")
    target = resolve_document_path(document, requested_path.strip() if requested_path else base)
    if target is None:
        raise AdoptError("目标位置在当前正文里找不到")
    if target.path != base and not target.path.startswith(base + "."):
        raise AdoptError("写入路径必须位于所关联的目标块内")
    if isinstance(target.read(), str):
        return target.path
    if (
        target.item is not None
        and target.item.get("kind") == "list"
        and not target.suffix
        and link.point_id == target.item.get("id")
    ):
        return target.path
    raise AdoptError("这条关联指向条目而不是一段文字，请指定要写入的字段路径")


def _pick_revision(
    db: Session, link: ResumeBlockSource, source_revision_id: int | None
) -> ResumeSourceRevision | None:
    if source_revision_id is not None:
        revision = db.get(ResumeSourceRevision, source_revision_id)
        if revision is None or revision.source_id != link.source_id:
            raise AdoptError("来源修订不存在或不属于这条来源")
        return revision
    return db.execute(
        select(ResumeSourceRevision)
        .where(ResumeSourceRevision.source_id == link.source_id)
        .order_by(ResumeSourceRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()


def adopt_source_text(
    db: Session,
    *,
    record: ResumeRecord,
    link: ResumeBlockSource,
    text: str,
    expected_revision: int | None,
    source_revision_id: int | None = None,
    path: str | None = None,
) -> dict[str, Any]:
    """把来源修订的文本写进目标块：锁闸门 → 条件写 → 刷新关联。"""
    cleaned = (text or "").strip()
    if not cleaned:
        raise AdoptError("采纳文本不能为空")
    revision = _pick_revision(db, link, source_revision_id)
    source = db.get(ResumeSource, link.source_id)
    expected_fingerprint = ""
    if revision is not None:
        expected_fingerprint = revision.fingerprint or ""
    else:
        expected_fingerprint = (source.current_fingerprint if source is not None else "") or ""
    if expected_fingerprint and canonical_fingerprint(cleaned) != expected_fingerprint:
        # 兼容可解析来源：历史来源的指纹可能是用结构化 payload 算的（前端拿不到同一串
        # 文本），此时允许"文本 == 该来源当前可解析正文"作为等价校验——它同时满足
        # "用户看到的就是来源现在的内容"（来源又变过则 resolved 文本不同，仍会 stale）。
        latest = _pick_revision(db, link, None)
        is_latest = latest is not None and revision is not None and revision.id == latest.id
        resolved_text = (
            resolve_current_source_text(db, source) if source is not None and is_latest else None
        )
        if resolved_text is None or canonical_fingerprint(cleaned) != canonical_fingerprint(
            resolved_text
        ):
            raise SourceRevisionStale(expected_fingerprint)
    document = document_io.document_for_record(db, record)[0]
    target = resolve_adopt_target(record, link, path, document=document)
    new_content = copy.deepcopy(document)
    node = resolve_document_path(new_content, target)
    value: str | list[str] = cleaned
    if node.item is not None and node.item.get("kind") == "list" and not node.suffix:
        hidden = set(node.item.get("hidden_values") or [])
        value = [
            cleaned,
            *(v for v in node.item.get("values") or [] if v in hidden and v != cleaned),
        ]
    if not write_document_value(new_content, target, value):
        raise AdoptError("目标位置不是一段可写入的文本，无法采纳")
    # 锁闸门在写库之前：事实锁与 lock_content 共用同一份 violations 形状。
    violations = fact_locks.validate_document_locks(db, record, new_content)
    if violations:
        raise fact_locks.FactLockError(violations)
    outcome = save_content(
        db,
        record_id=record.id,
        content=document_io.prepare_document_for_save(
            new_content,
            language=record.language,
            format_config=record.format_config or {},
            custom_fields=document_io.custom_field_definitions(db),
        ),
        expected_revision=expected_revision,
    )
    if outcome is None:
        raise LookupError("简历记录不存在或已被删除")
    # 只有真的写成功才刷新关联：失败时关联仍是 stale，用户能看到「还没采纳」。
    link.source_revision_id = revision.id if revision is not None else link.source_revision_id
    link.source_fingerprint = (
        revision.fingerprint if revision is not None else canonical_fingerprint(cleaned)
    )
    db.commit()
    db.refresh(link)
    return {
        "resume_id": outcome.record.id,
        "revision": outcome.revision,
        "content": outcome.record.content or new_content,
        "applied_path": target,
        "source_revision_no": revision.revision_no if revision is not None else 0,
        "link": link,
    }


__all__ = [
    "AdoptError",
    "SOURCE_REVISION_STALE_CODE",
    "SourceRevisionStale",
    "adopt_source_text",
    "resolve_adopt_target",
]
