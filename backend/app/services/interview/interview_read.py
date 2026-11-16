# SPDX-License-Identifier: Apache-2.0
"""模拟面试会话的只读查询与出口视图。

列表查询从 api/interview.py 搬来：该文件已贴着 500 行预算，而"按创建时间倒序
列出会话"是模拟面试域的主读路径。为什么放服务层：路由只该做参数校验与响应转换，
取数口径（排序、上限）跟着面试域走，助手工具与后续的分页入口才能复用同一份。

**出口视图也在这里**（``session_brief`` / ``session_detail``）：一份 ``InterviewSession``
投影成 ``InterviewBrief`` / ``InterviewDetail`` 的规则原先只长在 ``api/interview_shared``，
路由能调、助手动作不能——于是动作只能去调路由 handler 才能拿到同样的形状。搬进服务层后
两条入口都调这里，"出口视图是什么"只有一份实现（``api/interview_shared`` 保留同名薄封装，
那里还有 20 多处调用点）。
"""

from __future__ import annotations

from typing import get_args

from sqlalchemy.orm import Session

from ...models.interview import InterviewSession
from ...schemas.interview import (
    InterviewBrief,
    InterviewDetail,
    InterviewMessageOut,
    InterviewStatus,
)
from .interview import answered_rounds

#: 读不到会话时的对外文案：路由与助手动作都用它（两处各写一句就会漂移）。
SESSION_NOT_FOUND_DETAIL = "面试不存在或已被删除"

_INTERVIEW_STATUS_VALUES: tuple[InterviewStatus, ...] = get_args(InterviewStatus)


def list_sessions(db: Session, limit: int = 50) -> list[InterviewSession]:
    """按创建时间倒序取最近的模拟面试会话（不做分页，上限由调用方给）。"""
    return (
        db.query(InterviewSession).order_by(InterviewSession.created_at.desc()).limit(limit).all()
    )


def as_interview_status(value: str) -> InterviewStatus:
    """模型层 ``status`` 是 ``str``，出口处收窄为 schema 的 ``Literal``。

    取值由开场 / 结束链路用常量写入，正常不会走到兜底；万一库里出现未知值，在这里
    大声失败（与 pydantic Literal 字段的校验行为一致），不悄悄把非法状态发给前端。
    """
    if value not in _INTERVIEW_STATUS_VALUES:
        raise ValueError(f"未知的面试状态：{value!r}")
    return value


def session_brief(session: InterviewSession) -> InterviewBrief:
    """一场会话的列表视图（不含正文消息）。"""
    return InterviewBrief(
        id=session.id,
        title=session.title,
        job_id=session.job_id,
        job_title=session.job_title,
        company=session.company,
        resume_id=session.resume_id,
        resume_title=session.resume_title,
        job_material_name=session.job_material_name or "",
        resume_material_name=session.resume_material_name or "",
        duration_seconds=session.duration_seconds,
        interview_type=session.interview_type,
        difficulty=session.difficulty,
        interviewer_style=session.interviewer_style,
        rounds=session.rounds,
        rounds_min=session.rounds_min,
        status=as_interview_status(session.status),
        created_at=session.created_at,
        updated_at=session.updated_at,
        follow_up_closed_at=session.follow_up_closed_at,
        answered_rounds=answered_rounds(session),
    )


def session_detail(session: InterviewSession) -> InterviewDetail:
    """一场会话的详情视图：列表视图的全部字段 + 人设/重点/模型/报告/全部消息。

    消息是延迟加载关系，调用方必须在会话还活着、且在工作线程里时调它（路由侧一律经
    ``run_sync``）。
    """
    return InterviewDetail(
        **session_brief(session).model_dump(),
        persona=session.persona,
        focus=session.focus,
        model=session.model,
        report=session.report or {},
        messages=[InterviewMessageOut.model_validate(item) for item in session.messages],
    )


def list_session_briefs(db: Session, limit: int = 50) -> list[InterviewBrief]:
    """会话列表的响应视图（``GET /api/interview`` 与动作 ``list_interview_sessions`` 共用）。"""
    return [session_brief(item) for item in list_sessions(db, limit)]


def session_detail_or_none(db: Session, session_id: int) -> InterviewDetail | None:
    """按 id 取会话详情；不存在（或已软删除）时返回 ``None``。

    不存在是"取不到"而不是服务层错误：HTTP 侧要 404、助手侧要同一句 404 文案，
    判空与抛错的位置由两个边界各自决定（文案见 ``SESSION_NOT_FOUND_DETAIL``）。
    """
    session = db.get(InterviewSession, session_id)
    if session is None:
        return None
    return session_detail(session)


__all__ = [
    "SESSION_NOT_FOUND_DETAIL",
    "as_interview_status",
    "list_session_briefs",
    "list_sessions",
    "session_brief",
    "session_detail",
    "session_detail_or_none",
]
