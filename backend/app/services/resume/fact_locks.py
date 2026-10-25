# SPDX-License-Identifier: Apache-2.0
"""W12 事实锁：服务端的"AI 不许改动这些值"校验。

锁什么：姓名、机构、时间、数字、职责边界——AI 可以改善表达，但不能擅自改这些值。
**这不是提示词约束**：服务端在 AI 结果落库前逐项比对，改了就不写并返回 409。

实现约定：

- 锁同时记 object_id/point_id（W01 稳定身份）与 path（旧数据兜底）。有身份时按身份
  解析当前路径（条目排序后仍跟得住）；身份找不到再按 path，两者都不命中即
  "锁定对象已不存在"——同样拒绝，而不是放行。
- 比对用规范化文本（strip 后逐字比较）。数字/日期的"换个写法"也算改值，
  因此不做宽松归一：宁可拒绝并让用户确认，也不静默改掉事实。
- 用户自己手写保存（PUT content）不经过这里：锁的是 AI 行为。AI 改写/翻译/片段插入/
  优化器/来源采纳统一调用 enforce_ai_content，这是唯一入口。
- **W06 lock_content**（条目内 ``lock_content=true``）也在这里校验：锁正文的条目只能调
  排版/隐藏，不能改正文；锁定条目被删同样拒绝。violations 复用同一形状（lock_id=0、
  kind="lock_content"），因此调用方只需要处理一种 409 + fact_lock_conflict。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.provenance import (
    FACT_LOCK_AUTHORSHIP,
    FACT_LOCK_IDENTIFIER,
    FACT_LOCK_INSTITUTION,
    FACT_LOCK_KINDS,
    FACT_LOCK_NAME,
    FACT_LOCK_NUMBER,
    FACT_LOCK_RESPONSIBILITY,
    FACT_LOCK_STATUS,
    FACT_LOCK_TIME,
    ResumeFactLock,
)
from ...models.resume import ResumeRecord

# 正文锁实现拆在 content_locks（行数预算）；这里既有 re-export 保持外部 import 不变：
#   fact_locks.validate_content_locks / FactLockViolation / LOCK_CONTENT_*（be-doc 的集成
#   测试仍从本模块取这些名字）。
from .content_locks import (  # noqa: F401 - re-export
    LOCK_CONTENT_CHANGED_REASON,
    LOCK_CONTENT_KIND,
    LOCK_CONTENT_MISSING_REASON,
    FactLockViolation,
    restore_lock_flags,
    validate_content_locks,
    validate_content_locks_for,
)
from .document_identity import is_object_id, resolve_object_path, resolve_point_path

_MISSING = object()


# 路径 → 事实锁类型的识别表（W14 科研字段纳入同一份清单；按叶子字段名匹配，
# publications.0.status / patents.2.status 都命中 status）。
_FIELD_KIND_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("status",), FACT_LOCK_STATUS),
    (("doi", "patent_number", "isbn", "arxiv_id"), FACT_LOCK_IDENTIFIER),
    (("is_self", "corresponding", "author_order", "author_position"), FACT_LOCK_AUTHORSHIP),
    (("year", "start_date", "end_date", "date", "published_at", "filed_at"), FACT_LOCK_TIME),
    (("company", "school", "organization", "institution", "issuer"), FACT_LOCK_INSTITUTION),
    (("boundary", "responsibility", "responsibility_boundary"), FACT_LOCK_RESPONSIBILITY),
    (("name",), FACT_LOCK_NAME),
)
_RESEARCH_PREFIXES = ("publications", "patents", "publication", "patent")


def infer_fact_lock_kind(path: str) -> str:
    """按字段识别事实锁类型；识别不到时按既有兜底（研究栏目→identifier，其余→number）。"""
    leaf = (path or "").rstrip(".").split(".")[-1].strip().lower()
    for names, kind in _FIELD_KIND_HINTS:
        if leaf in names:
            return kind
    root = (path or "").split(".", 1)[0].strip().lower()
    if root in _RESEARCH_PREFIXES:
        return FACT_LOCK_IDENTIFIER
    return FACT_LOCK_NUMBER


FACT_LOCK_CONFLICT_CODE = "fact_lock_conflict"
# 同时覆盖事实锁与 W06 正文锁；detail 用同一句话，前端只处理一种业务码。
FACT_LOCK_CONFLICT_DETAIL = "本次修改会改动已锁定的事实或正文，已拒绝写入"
_MAX_LOCK_VALUE = 500


def _read_path(content: Any, path: str) -> Any:
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


def normalize_lock_value(value: Any) -> str:
    """把锁定的值变成可比较文本；结构化值用规范化 JSON（键序稳定）。"""
    if value is _MISSING or value is None:
        return ""
    if isinstance(value, str):
        return value.strip()[:_MAX_LOCK_VALUE]
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))[
            :_MAX_LOCK_VALUE
        ]
    except (TypeError, ValueError):
        return str(value)[:_MAX_LOCK_VALUE]


class FactLockError(ValueError):
    """AI 结果会改动已锁定的事实。路由把它转成 409 + 业务码。"""

    def __init__(self, violations: list[FactLockViolation]) -> None:
        super().__init__(
            FACT_LOCK_CONFLICT_CODE + ": " + ", ".join(item.path for item in violations)
        )
        self.violations = violations


def fact_lock_conflict_response(violations: list[FactLockViolation]) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": FACT_LOCK_CONFLICT_DETAIL,
            "code": FACT_LOCK_CONFLICT_CODE,
            "violations": [item.to_dict() for item in violations],
        },
    )


def _validate_kind(kind: str) -> str:
    if kind not in FACT_LOCK_KINDS:
        raise ValueError(f"事实锁类型不受支持：{kind}")
    return kind


def _resolve_lock_target(
    content: dict[str, Any],
    *,
    object_id: str | None,
    point_id: str | None,
    path: str | None,
) -> tuple[str, str, str, str]:
    """返回 (当前路径, 相对字段路径, 字段, 当前值文本)；解析不到抛 ValueError。

    传了 object_id 又传了 path 时，path 是对象内部字段的完整路径（例如
    experience.0.company）：相对字段随对象身份保存，条目排序后仍能跟住同一条目。
    """
    if object_id is not None:
        if not is_object_id(object_id):
            raise ValueError("对象标识不合法")
        base = (
            resolve_point_path(content, object_id, point_id)
            if point_id is not None
            else resolve_object_path(content, object_id)
        )
        if base is None:
            raise ValueError("要锁定的块在当前正文里找不到")
        relative = ""
        resolved = base
        if path and path.startswith(base + ".") and _read_path(content, path) is not _MISSING:
            relative = path[len(base) + 1 :]
            resolved = path
        value = _read_path(content, resolved)
        field = relative.rsplit(".", 1)[-1] if relative else resolved.split(".")[0]
        return resolved, relative, field, normalize_lock_value(value)
    if path:
        value = _read_path(content, path)
        if value is _MISSING:
            raise ValueError("要锁定的路径在当前正文里找不到")
        return path, "", path.split(".")[-1], normalize_lock_value(value)
    raise ValueError("需要 object_id 或 path 指定要锁定的位置")


def create_fact_lock(
    db: Session,
    record: ResumeRecord,
    *,
    kind: str | None = None,
    object_id: str | None = None,
    point_id: str | None = None,
    path: str | None = None,
    label: str = "",
) -> ResumeFactLock:
    """锁定当前位置的值；同一对象/路径 + 同一类型重复锁定时刷新锁定值。"""
    resolved_path, relative_path, resolved_field, locked_value = _resolve_lock_target(
        record.content or {}, object_id=object_id, point_id=point_id, path=path
    )
    # kind 缺省时按路径识别（W14 科研字段：status/identifier/authorship/年份…）。
    kind = _validate_kind(kind or infer_fact_lock_kind(resolved_path))
    if object_id is not None:
        conditions = (
            ResumeFactLock.resume_id == record.id,
            ResumeFactLock.lock_kind == kind,
            ResumeFactLock.object_id == object_id,
            ResumeFactLock.point_id == point_id,
            ResumeFactLock.relative_path == relative_path,
        )
    else:
        conditions = (
            ResumeFactLock.resume_id == record.id,
            ResumeFactLock.lock_kind == kind,
            ResumeFactLock.path == resolved_path,
        )
    existing = db.execute(select(ResumeFactLock).where(*conditions)).scalar_one_or_none()
    if existing is not None:
        existing.path = resolved_path
        existing.relative_path = relative_path
        existing.field = resolved_field
        existing.locked_value = locked_value
        existing.label = (label or "").strip()[:64]
        db.commit()
        db.refresh(existing)
        return existing
    lock = ResumeFactLock(
        resume_id=record.id,
        object_id=object_id,
        point_id=point_id,
        path=resolved_path,
        relative_path=relative_path,
        field=resolved_field,
        lock_kind=kind,
        locked_value=locked_value,
        label=(label or "").strip()[:64],
    )
    db.add(lock)
    db.commit()
    db.refresh(lock)
    return lock


def list_fact_locks(db: Session, resume_id: int) -> list[ResumeFactLock]:
    return list(
        db.execute(
            select(ResumeFactLock)
            .where(ResumeFactLock.resume_id == resume_id)
            .order_by(ResumeFactLock.id)
        )
        .scalars()
        .all()
    )


def delete_fact_lock(db: Session, *, resume_id: int, lock_id: int) -> bool:
    lock = db.get(ResumeFactLock, lock_id)
    if lock is None or lock.resume_id != resume_id:
        return False
    db.delete(lock)
    db.commit()
    return True


def _current_path_for_lock(content: dict[str, Any], lock: ResumeFactLock) -> str | None:
    if lock.object_id and is_object_id(lock.object_id):
        base = (
            resolve_point_path(content, lock.object_id, lock.point_id)
            if lock.point_id
            else resolve_object_path(content, lock.object_id)
        )
        if base is not None:
            resolved = f"{base}.{lock.relative_path}" if lock.relative_path else base
            if _read_path(content, resolved) is not _MISSING:
                return resolved
    # 身份解析不到（旧数据没有 id / 对象被删）才退回存储路径；仍解析不到即"不存在"。
    if lock.path and _read_path(content, lock.path) is not _MISSING:
        return lock.path
    return None


def validate_document_locks(
    db: Session, record: ResumeRecord, content: dict[str, Any]
) -> list[FactLockViolation]:
    """事实锁 + 正文锁的合并校验（409 一次说清全部违规）。"""
    return validate_fact_locks(db, record, content) + validate_content_locks_for(
        record.content or {}, content
    )


def validate_fact_locks(
    db: Session, record: ResumeRecord, content: dict[str, Any]
) -> list[FactLockViolation]:
    """逐条比对锁定值；返回全部违规（一次说清，不让用户逐次试错）。"""
    violations: list[FactLockViolation] = []
    for lock in list_fact_locks(db, record.id):
        current_path = _current_path_for_lock(content, lock)
        if current_path is None:
            violations.append(
                FactLockViolation(
                    lock_id=lock.id,
                    kind=lock.lock_kind,
                    label=lock.label,
                    path=lock.path,
                    field=lock.field,
                    reason="锁定对象在本次修改后已不存在",
                    locked_value=lock.locked_value,
                    current_value="",
                )
            )
            continue
        current_value = normalize_lock_value(_read_path(content, current_path))
        if current_value != lock.locked_value:
            violations.append(
                FactLockViolation(
                    lock_id=lock.id,
                    kind=lock.lock_kind,
                    label=lock.label,
                    path=current_path,
                    field=lock.field,
                    reason="锁定值被改动",
                    locked_value=lock.locked_value,
                    current_value=current_value,
                )
            )
    return violations


def enforce_ai_content(db: Session, record: ResumeRecord, content: dict[str, Any]) -> None:
    """AI/来源采纳落库前的唯一闸门：有违规就抛 FactLockError，调用方不得继续写库。

    通过校验后会把旧正文的锁标记带回新正文（见 :func:`content_locks.restore_lock_flags`）：
    模型没有回显锁字段，不补就会"改写一次 = 锁没了"。
    """
    violations = validate_document_locks(db, record, content)
    if violations:
        raise FactLockError(violations)
    restore_lock_flags(record.content or {}, content)
