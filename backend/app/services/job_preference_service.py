# SPDX-License-Identifier: Apache-2.0
"""求职偏好档服务（计划 §6.3.2 / §6.3.3）：唯一读取入口 + 写入状态机 + 撤销 + 历史裁剪。

三条结构性约束都落在这里：

1. **读取必须走统一入口**：本表同时存在 active / superseded / undone 三种版本状态，
   而 superseded 与 undone 行的 deleted_at 也都是 NULL——所以 live_only() 对本表不够。
   列表 / 详情 / 注入块 / 工具一律经 active_pref()（= live_only & state='active'），
   本模块之外禁止裸查本表（tests/test_job_preference.py 有 grep 断言）。
2. **来源闭集且不含 assistant**：user_stated 必须指向一条 approved/executed 的写入提案，
   否则抛 PreferenceSourceError——绕开界面确认直接落库的路在这里被堵死。
3. **deleted_at 只表示用户删除**：编辑只把旧行置 superseded、撤销只把当前行置 undone，
   两处都不写 deleted_at，所以不会与 partial unique index（只在活动行之间生效）打架。

approve 端点的时序是 approve → consume → handler → mark_executed，所以 handler 执行
upsert 时提案状态是 approved 而不是 executed（且本轨道不得改 api/assistant_proposals.py）。
user_stated 的来源校验因此接受 {approved, executed} 两态，其余状态（pending / rejected /
failed / expired / unknown）一律拒绝；没有提案 id 也拒绝。
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.orm import Session

from ..models.assistant import AssistantWriteProposal
from ..models.job_preference import (
    PREF_SOURCE_USER_EDITED,
    PREF_SOURCE_USER_STATED,
    PREF_SOURCES,
    PREF_STATE_ACTIVE,
    PREF_STATE_SUPERSEDED,
    PREF_STATE_UNDONE,
    JobPreference,
)
from ..models.profile import utcnow
from ..runtime import dataset_scope
from . import job_preference_catalog as catalog
from . import trash
from .assistant_tools.proposal_store import fingerprint_payload

# 同一 kind 保留多少条 superseded 历史；超过就硬删最旧的（机器动作，不进回收站）。
HISTORY_LIMIT = 20

# 允许作为 user_stated 来源的写工具：偏好只能由"用户确认过的偏好写入"产生。
PREFERENCE_WRITE_TOOLS = frozenset({"create_job_preference", "update_job_preference"})

# 提案处于这两态时视为"用户已确认"：approve 端点在 handler 执行期是 approved，
# 执行成功后才置 executed（见模块注释）。
_EXECUTABLE_PROPOSAL_STATUSES = ("approved", "executed")

PREF_SOURCE_LABELS: dict[str, str] = {
    "user_stated": "用户陈述",
    "user_edited": "用户修改",
    "imported": "导入",
}


class PreferenceConflict(Exception):
    """状态机冲突（撤销/删除前置条件不满足）。code 是给前端分支的稳定码。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class PreferenceSourceError(ValueError):
    """偏好来源不合法（user_stated 必须有已确认提案等）。"""


@dataclass
class UpsertResult:
    """一次写入的结果：record / 是否新建版本 / 可直接展示的中文摘要。"""

    record: JobPreference
    created: bool
    summary: str


@dataclass
class PreferenceView:
    """列表行：记录 + 同 kind 是否有可撤销的上一版。"""

    record: JobPreference
    has_previous: bool


def current_dataset_key() -> str:
    """当前数据集标识（main / 16 位 hex）；写入与读取都只认这一份。"""
    return dataset_scope.current_dataset_id()


def _query(db: Session):
    """本表唯一查询构造点：所有读取/维护都从这里链式过滤（grep 断言的锚点）。"""
    return db.query(JobPreference)


def active_pref(db: Session, dataset_key: str, kind: str) -> JobPreference | None:
    """同 dataset_key + kind 的当前活动行；没有返回 None。列表/详情/注入都必须走它。"""
    return (
        _query(db)
        .filter(
            JobPreference.dataset_key == dataset_key,
            JobPreference.kind == kind,
            JobPreference.state == PREF_STATE_ACTIVE,
            JobPreference.deleted_at.is_(None),
        )
        .one_or_none()
    )


def list_active_preferences(db: Session, dataset_key: str | None = None) -> list[JobPreference]:
    """当前数据集全部活动（未删除）偏好，按目录顺序排序（顺序是注入顺序的契约）。"""
    key = dataset_key or current_dataset_key()
    rows = (
        _query(db)
        .filter(
            JobPreference.dataset_key == key,
            JobPreference.state == PREF_STATE_ACTIVE,
            JobPreference.deleted_at.is_(None),
        )
        .all()
    )
    order = {spec.kind: index for index, spec in enumerate(catalog.kind_specs())}
    rows.sort(key=lambda row: (order.get(row.kind, len(order)), row.id))
    return rows


def active_preference_by_id(db: Session, pref_id: str) -> JobPreference | None:
    """按外部稳定 id 取活动行；已删除/非当前版本一律当作不存在。"""
    return (
        _query(db)
        .filter(
            JobPreference.pref_id == (pref_id or "").strip(),
            JobPreference.state == PREF_STATE_ACTIVE,
            JobPreference.deleted_at.is_(None),
        )
        .one_or_none()
    )


def has_previous(db: Session, record: JobPreference) -> bool:
    """同 kind 是否有可撤销的上一版（superseded 且未删除）。"""
    return (
        _query(db)
        .filter(
            JobPreference.dataset_key == record.dataset_key,
            JobPreference.kind == record.kind,
            JobPreference.state == PREF_STATE_SUPERSEDED,
            JobPreference.deleted_at.is_(None),
            JobPreference.id != record.id,
        )
        .first()
        is not None
    )


def list_preferences(db: Session, dataset_key: str | None = None) -> list[PreferenceView]:
    """列表页数据：只含 active 且未删除的行；superseded / undone / 回收站永不出现。"""
    return [
        PreferenceView(record=row, has_previous=has_previous(db, row))
        for row in list_active_preferences(db, dataset_key)
    ]


def _ensure_source(
    db: Session,
    *,
    source: str,
    source_proposal_id: str | None,
    dataset_key: str,
) -> None:
    """来源闭集 + user_stated 的提案约束（防绕过确认直写）。"""
    if source not in PREF_SOURCES:
        raise PreferenceSourceError(
            f"非法来源 {source!r}；只允许 {'、'.join(PREF_SOURCES)}（不含 assistant）"
        )
    if source != PREF_SOURCE_USER_STATED:
        return
    proposal_id = (source_proposal_id or "").strip()
    if not proposal_id:
        raise PreferenceSourceError(
            "用户陈述的偏好必须来自已确认的写入提案（缺少 source_proposal_id）"
        )
    record = (
        db.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal_id)
        .one_or_none()
    )
    if record is None:
        raise PreferenceSourceError("来源提案不存在，不能写入用户陈述的偏好")
    if record.dataset_key != dataset_key:
        raise PreferenceSourceError("来源提案属于另一个数据集，不能写入当前数据集")
    if record.status not in _EXECUTABLE_PROPOSAL_STATUSES:
        raise PreferenceSourceError(
            f"来源提案当前状态为 {record.status}，只有已确认的提案才能写入用户陈述的偏好"
        )
    if record.tool_name not in PREFERENCE_WRITE_TOOLS:
        raise PreferenceSourceError(f"提案 {record.tool_name} 不是求职偏好写入")


def find_proposal(db: Session, proposal_id: str) -> AssistantWriteProposal | None:
    """按提案 id 取一条写入提案（查不到返回 None）。

    为什么放服务层：提案的读取口径已收在本模块（见 find_executing_proposal），
    路由只该做状态判定与错误映射，不该自己拼 ORM 查询。
    """
    return (
        db.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal_id)
        .one_or_none()
    )


def find_executing_proposal(db: Session, tool_name: str, target_fingerprint: str) -> str:
    """找出**正在执行**的那条已批准提案（approve 端点执行 handler 时的来源证据）。

    approve 端点先 approve（pending→approved）再调 handler，最后 mark_executed，
    而 handler 收到的只有存储参数、没有 proposal_id。所以按
    (tool_name, dataset, status=approved, 预览指纹) 定位：预览指纹由同一份参数与同一份
    目标状态重算，能在不修改 approve 端点的前提下唯一对应"用户刚确认的那张卡"。
    找不到就拒绝写入——宁可让模型重来，也不接受无来源的用户陈述。
    """
    key = current_dataset_key()
    rows = (
        db.query(AssistantWriteProposal)
        .filter(
            AssistantWriteProposal.tool_name == tool_name,
            AssistantWriteProposal.dataset_key == key,
            AssistantWriteProposal.status == "approved",
        )
        .order_by(AssistantWriteProposal.created_at.desc(), AssistantWriteProposal.id.desc())
        .all()
    )
    for row in rows:
        if row.target_fingerprint and row.target_fingerprint == target_fingerprint:
            return row.proposal_id
    raise PreferenceSourceError("这次偏好写入没有可核对的用户确认提案，已拒绝执行")


def _trim_history(db: Session, dataset_key: str, kind: str) -> None:
    """同一 kind 的 superseded 历史超过 HISTORY_LIMIT 时硬删最旧的（不进回收站）。"""
    rows = (
        _query(db)
        .filter(
            JobPreference.dataset_key == dataset_key,
            JobPreference.kind == kind,
            JobPreference.state == PREF_STATE_SUPERSEDED,
            JobPreference.deleted_at.is_(None),
        )
        .order_by(JobPreference.updated_at.desc(), JobPreference.id.desc())
        .all()
    )
    for row in rows[HISTORY_LIMIT:]:
        db.delete(row)


def upsert_preference(
    db: Session,
    kind: str,
    value,
    *,
    source: str,
    source_proposal_id: str | None = None,
    source_message_id: int | None = None,
    note: str = "",
    dataset_key: str | None = None,
) -> UpsertResult:
    """写入一条偏好（§6.3.3 第 4 步）。

    - 同 kind 同 value_digest 的当前 active 行 → **no-op**（updated_at 不变）；
    - 否则旧 active → superseded，插新行 active（不碰 deleted_at）；
    - user_stated 必须带已确认提案（见 _ensure_source）。
    """
    spec = catalog.spec_for_kind(kind)
    normalized = catalog.normalize_value(spec.kind, value)
    key = dataset_key or current_dataset_key()
    _ensure_source(db, source=source, source_proposal_id=source_proposal_id, dataset_key=key)
    # 幂等摘要按**集合**算（列表顺序不算新值）：「杭州、上海」与「上海、杭州」是同一条
    # 偏好，否则用户换个语序就会多出一个历史版本。展示仍保留用户给出的顺序。
    digest_value = sorted(normalized) if isinstance(normalized, list) else normalized
    digest = fingerprint_payload({"kind": spec.kind, "value": digest_value, "value_schema": 1})
    active = active_pref(db, key, spec.kind)
    if active is not None and active.value_digest == digest:
        return UpsertResult(record=active, created=False, summary="已存在，未改动")

    display = catalog.describe_value(spec.kind, normalized)
    if active is not None:
        # 先让位再插入：partial unique index 只允许一条活动行，同一 flush 里也按序。
        active.state = PREF_STATE_SUPERSEDED
        db.flush()
        summary = f"更新了{spec.label}：{display}"
    else:
        summary = f"已记住{spec.label}：{display}"

    record = JobPreference(
        pref_id=uuid4().hex[:24],
        dataset_key=key,
        kind=spec.kind,
        value_kind=spec.value_kind,
        value=normalized,
        value_digest=digest,
        value_schema=1,
        source=source,
        source_proposal_id=(source_proposal_id or None),
        source_message_id=source_message_id,
        note=(note or "")[:200],
        state=PREF_STATE_ACTIVE,
    )
    db.add(record)
    db.flush()
    _trim_history(db, key, spec.kind)
    db.commit()
    db.refresh(record)
    return UpsertResult(record=record, created=True, summary=summary)


def undo_preference(db: Session, pref_id: str) -> JobPreference:
    """撤销到上一版：当前 active → undone，最近一条 superseded → active（不碰 deleted_at）。

    同一事务内**先让位后复原**：先 flush 让当前行离开活动集合，再把上一版置 active，
    否则 partial unique index 会在两个 UPDATE 之间看到两行活动。
    """
    record = active_preference_by_id(db, pref_id)
    if record is None:
        raise PreferenceConflict(
            "not_current", "这条偏好已不是当前版本（可能已被更新、撤销或删除）"
        )
    previous = (
        _query(db)
        .filter(
            JobPreference.dataset_key == record.dataset_key,
            JobPreference.kind == record.kind,
            JobPreference.state == PREF_STATE_SUPERSEDED,
            JobPreference.deleted_at.is_(None),
            JobPreference.id != record.id,
        )
        .order_by(JobPreference.updated_at.desc(), JobPreference.id.desc())
        .first()
    )
    if previous is None:
        raise PreferenceConflict("no_previous", "这条偏好没有可撤销的上一版")
    record.state = PREF_STATE_UNDONE
    db.flush()
    previous.state = PREF_STATE_ACTIVE
    previous.updated_at = utcnow()
    db.commit()
    db.refresh(previous)
    return previous


def delete_preference(db: Session, pref_id: str) -> JobPreference:
    """删除进入回收站：只写 deleted_at，state 保持 active（休眠），不 commit（调用方提交）。"""
    record = active_preference_by_id(db, pref_id)
    if record is None:
        raise PreferenceConflict("not_current", "这条偏好已不存在或已被删除")
    trash.soft_delete(db, "job_preference", record)
    return record


def build_session_note_text(db: Session, tool_name: str, arguments: dict) -> str:
    """把一条待确认提案转成「仅本次对话」的中文说明（session_note 的值）。"""
    kind = str(arguments.get("kind") or "").strip()
    if tool_name == "update_job_preference":
        record = active_preference_by_id(db, str(arguments.get("pref_id") or ""))
        if record is None:
            raise catalog.PreferenceValidationError("要更新的偏好已不存在")
        kind = record.kind
    spec = catalog.spec_for_kind(kind)
    normalized = catalog.normalize_value(spec.kind, arguments.get("value"))
    return f"{spec.label}：{catalog.describe_value(spec.kind, normalized)}"


def record_session_note(
    db: Session, *, proposal_id: str, tool_name: str, arguments: dict
) -> UpsertResult:
    """「只在这次对话」：把提案参数落成一行 session_note（source=user_edited）。

    多次点击会累积在这一行里（用「；」连接）；超过单值 200 字符上限时只保留最新一条，
    避免把"这次"的说明撑爆。session_note 不进注入块，只在前端可见。
    """
    addition = build_session_note_text(db, tool_name, arguments)
    key = current_dataset_key()
    active = active_pref(db, key, "session_note")
    existing = ""
    if active is not None and isinstance(active.value, str):
        existing = active.value
        if addition in existing:
            return UpsertResult(record=active, created=False, summary="已存在，未改动")
    combined = f"{existing}；{addition}" if existing else addition
    text = combined if len(combined) <= 200 else addition
    return upsert_preference(
        db,
        "session_note",
        text,
        source=PREF_SOURCE_USER_EDITED,
        source_proposal_id=proposal_id,
        note="仅本次对话",
    )


__all__ = [
    "HISTORY_LIMIT",
    "PREFERENCE_WRITE_TOOLS",
    "PREF_SOURCE_LABELS",
    "PreferenceConflict",
    "PreferenceSourceError",
    "PreferenceView",
    "UpsertResult",
    "active_pref",
    "active_preference_by_id",
    "build_session_note_text",
    "current_dataset_key",
    "delete_preference",
    "find_executing_proposal",
    "find_proposal",
    "has_previous",
    "list_active_preferences",
    "list_preferences",
    "record_session_note",
    "undo_preference",
    "upsert_preference",
]
