# SPDX-License-Identifier: Apache-2.0
"""「只在这次对话」提案落库（T2：从 `api/job_preferences.py` 下沉）。

为什么单独成文件而不是并入 `job_preference_service.py`：本函数需要条件 UPDATE 语义
（pending → executed 占住提案，双击并发只有一个能成功）与状态判定，并复用服务层的
参数校验/落库；并入后那个文件会超出 495 行的目标线，所以按 T2 施工单的预案拆到本模块。
**不新增任何提交点**：落库仍由 `job_preference_service.record_session_note` 内部事务
收尾，失败路径统一 rollback，HTTP 错误映射与响应组装留在路由。
"""

from __future__ import annotations

import logging
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..models.assistant import AssistantWriteProposal
from ..models.job_preference import JobPreference
from ..models.profile import utcnow
from . import job_preference_catalog as catalog
from .assistant_tools import proposal_store
from .job_preference_service import (
    PREFERENCE_WRITE_TOOLS,
    PreferenceConflict,
    build_session_note_text,
    current_dataset_key,
    find_proposal,
    record_session_note,
)

logger = logging.getLogger(__name__)

_SESSION_NOTE_SUMMARY = "仅本次对话，未长期生效"


class SessionProposalNotFound(Exception):
    """提案不存在或已失效（路由映射 404）。"""


class SessionProposalInvalid(Exception):
    """提案参数不合法（路由映射 422；与"写入阶段意外"区分，后者仍是 500）。"""


@dataclass
class SessionProposalResult:
    """一次「只在这次对话」的结果：session_note 行 + 可直接展示的摘要。"""

    record: JobPreference
    summary: str


def _claim_pending_proposal(db: Session, proposal_id: str) -> bool:
    """条件 UPDATE（pending → executed）：并发双击时只有一个请求拿到 rowcount=1。

    条件写要读 `rowcount`；`execute` 的静态返回类型是 `Result`，显式收窄成 DML
    的运行时真实类型（同 services/resume/document_save.py）。
    """
    claimed = cast(
        "CursorResult[Any]",
        db.execute(
            update(AssistantWriteProposal)
            .where(
                AssistantWriteProposal.proposal_id == proposal_id,
                AssistantWriteProposal.status == "pending",
            )
            .values(
                status="executed",
                result_summary=_SESSION_NOTE_SUMMARY,
                executed_at=utcnow(),
            )
        ),
    )
    if claimed.rowcount == 1:
        return True
    db.rollback()
    return False


def record_session_only(db: Session, proposal_id: str) -> SessionProposalResult:
    """把待确认提案转成 session_note，并把提案置 executed，返回可展示的结果。

    只接受 pending 的偏好写入提案（create_job_preference / update_job_preference）。
    先校验提案状态与参数，再用条件 UPDATE 占住提案，最后复用服务层落一行
    `kind=session_note`（source=user_edited、source_proposal_id=提案），
    session_note 永不进系统提示注入块。
    """
    proposal = find_proposal(db, proposal_id)
    if proposal is None:
        raise SessionProposalNotFound("提案不存在或已失效")
    if proposal.dataset_key != current_dataset_key():
        raise PreferenceConflict("dataset_mismatch", "数据集已切换，本提案失效")
    if utcnow() >= proposal.expires_at:
        raise PreferenceConflict("proposal_not_pending", "提案已过期，请让助手重新发起")
    if proposal.status != "pending":
        raise PreferenceConflict(
            "proposal_not_pending", f"提案当前状态为 {proposal.status}，不能只用于本次对话"
        )
    if proposal.tool_name not in PREFERENCE_WRITE_TOOLS:
        raise PreferenceConflict("unsupported_tool", f"提案 {proposal.tool_name} 不是求职偏好写入")
    arguments = dict(proposal.arguments or {})
    # 只把**校验阶段**的参数错误翻成 422（与路由原行为一致：落库阶段的意外仍走 500）。
    try:
        build_session_note_text(db, proposal.tool_name, arguments)
    except catalog.PreferenceValidationError as exc:
        raise SessionProposalInvalid(str(exc)) from exc
    if not _claim_pending_proposal(db, proposal_id):
        raise PreferenceConflict("proposal_not_pending", "提案状态已变化，不能只用于本次对话")
    try:
        result = record_session_note(
            db, proposal_id=proposal_id, tool_name=proposal.tool_name, arguments=arguments
        )
    except Exception:
        db.rollback()
        raise
    # 派生回写（proposal_result 消息）是 best-effort：状态已落库，失败不影响本次结果。
    with suppress(Exception):
        proposal_store.mark_executed(proposal_id, _SESSION_NOTE_SUMMARY)
    logger.info("提案 %s 仅用于本次对话（pref_id=%s）", proposal_id, result.record.pref_id)
    return SessionProposalResult(record=result.record, summary=_SESSION_NOTE_SUMMARY)


__all__ = [
    "SessionProposalInvalid",
    "SessionProposalNotFound",
    "SessionProposalResult",
    "record_session_only",
]
