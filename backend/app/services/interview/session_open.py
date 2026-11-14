# SPDX-License-Identifier: Apache-2.0
"""模拟面试开场（T2：从 `api/interview.py` 的 create_session 下沉）。

会话行创建、材料校验与开场题落库都在这里；**"什么时候调用模型、客户端断开怎么取消"
留在路由**——那是 HTTP 请求生命周期，而且测试通过 `app.api.interview._require_provider` /
`_ask_next_question` 打桩，注入点必须保持在路由（否则补丁会打空、用例静默失去约束力）。

事务边界留在路由：本模块只 `add/flush`，提交与失败回滚由 `create_session` 路由收尾；
模型失败/客户端断开时"删掉空会话再提交"也在路由（那是请求结果的一部分）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.interview import InterviewSession
from ...models.job import Job
from ...schemas.interview import InterviewCreate
from .. import trash
from ..interview.interview import add_message, session_persona
from ..interview.interview_context import resume_record_or_none


class InterviewSessionOpenError(Exception):
    """开场前置条件不满足：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class InterviewSessionDraft:
    """已 `flush`（待路由提交）的会话行 + 本轮开局模型调用需要的 provider。"""

    session: InterviewSession
    provider: Any
    model: str


def _default_title(payload: InterviewCreate, job: Job | None) -> str:
    """标题默认值：用户填了就用用户的；否则按岗位/材料文件名/面试类型兜底。"""
    if payload.title.strip():
        return payload.title.strip()[:128]
    if job is not None and job.title:
        return f"{job.title} 模拟面试"[:128]
    material = (payload.job_material.name if payload.job_material else "").strip()
    if material:
        return f"{material} 模拟面试"[:128]
    return f"{payload.interview_type}模拟面试"[:128]


def prepare_interview_session(
    db: Session, payload: InterviewCreate, *, require_provider
) -> InterviewSessionDraft:
    """材料校验 + 会话行 `add/flush`（不提交）。

    每一侧材料都是**二选一**（记录 or 导入的文件）：面试官只会读这两份内容，所以指向
    一份已删除的简历/岗位时，与其开一场看不到材料的面试，不如直接告诉用户。
    """
    provider, model = require_provider(db)
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_material is None and payload.job_id is None:
        # 缺来源与"指向的已被删除"是两件事：前者是用户少选了一步，后者是数据变了，
        # 说清是哪一种，用户才知道该去补选还是重选。
        raise InterviewSessionOpenError(422, "这场面试缺少岗位材料：既没有选记录，也没有导入文件")
    if payload.job_material is None and (job is None or trash.is_deleted(job)):
        raise InterviewSessionOpenError(404, "关联岗位不存在或已被删除")
    record = resume_record_or_none(db, payload.resume_id) if payload.resume_id is not None else None
    if payload.resume_material is None and payload.resume_id is None:
        raise InterviewSessionOpenError(422, "这场面试缺少简历材料：既没有选记录，也没有导入文件")
    if payload.resume_material is None and record is None:
        raise InterviewSessionOpenError(404, "关联简历不存在或已被删除")
    session = InterviewSession(
        title=_default_title(payload, job),
        job_id=job.id if job is not None else None,
        job_title=(job.title if job is not None else ""),
        company=(job.company if job is not None else ""),
        resume_id=record.id if record is not None else None,
        resume_title=(record.title[:256] if record is not None else ""),
        # 导入的材料是快照：文件名进列表，正文进提示词（#41）。
        job_material_name=(payload.job_material.name if payload.job_material else ""),
        job_material_text=(payload.job_material.text if payload.job_material else ""),
        resume_material_name=(payload.resume_material.name if payload.resume_material else ""),
        resume_material_text=(payload.resume_material.text if payload.resume_material else ""),
        interview_type=payload.interview_type,
        difficulty=payload.difficulty,
        interviewer_style=payload.interviewer_style,
        rounds=payload.rounds,
        rounds_min=payload.rounds_min,
        persona=payload.persona.strip(),
        focus=payload.focus.strip(),
        model=model,
    )
    db.add(session)
    db.flush()
    return InterviewSessionDraft(session=session, provider=provider, model=model)


def record_opening_question(session: InterviewSession, question: str) -> None:
    """把开场题落成面试官消息（不提交、不刷新，由路由收尾事务）。"""
    add_message(
        session,
        role="interviewer",
        content=question,
        context={"index": 1, "rounds": session.rounds, "persona": session_persona(session)},
    )


__all__ = [
    "InterviewSessionDraft",
    "InterviewSessionOpenError",
    "prepare_interview_session",
    "record_opening_question",
]
