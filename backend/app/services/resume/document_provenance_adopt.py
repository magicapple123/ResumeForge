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
from . import fact_locks
from .document_identity import resolve_object_path, resolve_point_path
from .document_provenance import canonical_fingerprint
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


def _write_text_at_path(payload: Any, path: str, text: str) -> bool:
    """只把**已存在的字符串叶子**改成新文本；不新建键、不改数组长度。"""
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
        if not isinstance(current.get(leaf), str):
            return False
        current[leaf] = text
        return True
    if isinstance(current, list):
        try:
            index = int(leaf)
        except ValueError:
            return False
        if not 0 <= index < len(current) or not isinstance(current[index], str):
            return False
        current[index] = text
        return True
    return False


def _block_base_path(record: ResumeRecord, link: ResumeBlockSource) -> str | None:
    content = record.content or {}
    if link.object_id:
        resolved = (
            resolve_point_path(content, link.object_id, link.point_id)
            if link.point_id
            else resolve_object_path(content, link.object_id)
        )
        if resolved is not None:
            return resolved
    if link.path and _read_path(content, link.path) is not _MISSING:
        return link.path
    return None


def resolve_adopt_target(
    record: ResumeRecord, link: ResumeBlockSource, requested_path: str | None
) -> str:
    """解析「把这段来源文本写到哪」：返回当前正文里的叶子路径；解析不到抛 AdoptError。"""
    base = _block_base_path(record, link)
    if base is None:
        raise AdoptError("关联的目标块在当前正文里找不到（可能已被删除或标识过期）")
    if requested_path:
        candidate = requested_path.strip()
        if candidate != base and not candidate.startswith(base + "."):
            raise AdoptError("写入路径必须位于所关联的目标块内")
    else:
        candidate = base
    value = _read_path(record.content or {}, candidate)
    if isinstance(value, str):
        return candidate
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
    target = resolve_adopt_target(record, link, path)
    new_content = copy.deepcopy(record.content or {})
    if not _write_text_at_path(new_content, target, cleaned):
        raise AdoptError("目标位置不是一段文本，无法写入")
    # 锁闸门在写库之前：事实锁与 lock_content 共用同一份 violations 形状。
    violations = fact_locks.validate_document_locks(db, record, new_content)
    if violations:
        raise fact_locks.FactLockError(violations)
    outcome = save_content(
        db,
        record_id=record.id,
        content=new_content,
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
