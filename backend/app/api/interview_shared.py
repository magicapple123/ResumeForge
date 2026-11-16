# SPDX-License-Identifier: Apache-2.0
"""模拟面试接口的共用读取/序列化原语。

自 ``api/interview.py`` 拆出（#41 加"材料导入 + 追问分相"时那支已经贴着 500 行预算）。
拆出来的是**无路由的纯读写**：进/出 schema 的转换、会话与材料的取数、回答落库与中断
标记。真正的流程控制（什么时候收尾、什么时候出报告）留在 ``api/interview.py``——那些
函数是测试 monkeypatch 的目标（``app.api.interview.generate_report`` /
``_ask_next_question``），搬走会让补丁打在另一个模块上而静默失效。T2 起开场编排
（``create_session``）也整体下沉到 ``services/interview/session_open.py``，但模型调用的
两个打桩点仍由路由以注入方式传入，补丁落点不变；``_resume_record_or_none`` 的实现在
``services/interview/interview_context.py``，本模块只做兼容再导出。

## 材料优先级（#41）

每一侧材料都是"记录 or 导入文件"二选一，**导入文件优先**：

* 岗位侧：``session.job_material_text`` 非空就用它，否则回落到 ``job_id`` 指向的岗位；
* 简历侧：``session.resume_material_text`` 非空就用它，否则回落到 ``resume_id``。

判断放在这里而不是创建会话时"二选一存一份"，是为了让**老会话**（两列材料为空）不需要
任何迁移逻辑就继续按原样工作。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session, object_session

from ..models.interview import (
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from ..models.job import Job
from ..schemas.interview import (
    InterviewBrief,
    InterviewDetail,
)
from ..services.interview.interview import (
    add_message,
    mark_answer_interrupted,
    reuse_interrupted_answer,
)
from ..services.interview.interview_context import (
    resume_record_or_none as _resume_record_or_none,
)
from ..services.interview.interview_read import (
    SESSION_NOT_FOUND_DETAIL,
)
from ..services.interview.interview_read import (
    as_interview_status as _as_interview_status,
)
from ..services.interview.interview_read import (
    session_brief as _session_brief,
)
from ..services.interview.interview_read import (
    session_detail as _session_detail,
)
from ..services.llm import create_provider
from ..services.profile.profile_relevance import build_job_prompt_text
from ..services.resume import document_io
from ..services.resume.document_view import document_text
from ..services.settings_service import get_llm_config

logger = logging.getLogger(__name__)

MAX_JOB_CONTEXT_FOR_INTERVIEW = 6_000


def _session_or_404(db: Session, session_id: int) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND_DETAIL)
    return session


def _require_provider(db: Session):
    """模拟面试每一轮都要调用模型，所以必须已配置。"""
    config = get_llm_config(db)
    if not config.base_url.strip() or not config.model.strip():
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")
    return create_provider(config), config.model


def _resume_text(db: Session, session: InterviewSession) -> str:
    """把这场面试的**候选人材料**序列化成文本，作为面试官唯一的候选人材料。

    优先用导入的简历材料提取结果（#41，图片走识别、文本类走本机提取，两侧同一套格式）；
    没有才回落到关联的那份简历记录。面试官拿到的
    就是"提交的简历 + 岗位 JD"这两份东西（真实面试的边界），所以这里既不再读个人资料，
    也不跨简历读取。
    """
    material = (session.resume_material_text or "").strip()
    if material:
        return material
    if session.resume_id is None:
        return ""
    record = _resume_record_or_none(db, session.resume_id)
    if record is None:
        # 简历被彻底删除：会话仍可用（只按岗位 JD 提问），不阻断面试。
        return ""
    try:
        return document_text(document_io.document_for_record(db, record)[0])
    except Exception:  # noqa: BLE001 - 简历形状异常不该让整场面试 500
        logger.warning("序列化关联简历失败 session=%s", session.id, exc_info=True)
        return ""


def _job_text(db: Session, job_id: int | None) -> str:
    """按岗位 id 取 JD 文本（题库/思路等"没有会话"的链路用它）。"""
    if job_id is None:
        return ""
    job = db.get(Job, job_id)
    if job is None:
        return ""
    return build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)


def _session_job_text(db: Session, session: InterviewSession) -> str:
    """这场面试的**岗位材料**文本：导入的 JD 文件优先，其次才是关联岗位记录。"""
    material = (session.job_material_text or "").strip()
    if material:
        return material
    return _job_text(db, session.job_id)


def _to_out(session: InterviewSession) -> InterviewBrief:
    """兼容再导出：出口视图的唯一实现在 ``services/interview/interview_read.session_brief``。"""
    return _session_brief(session)


def _to_detail(session: InterviewSession) -> InterviewDetail:
    """兼容再导出：出口视图的唯一实现在 ``services/interview/interview_read.session_detail``。"""
    return _session_detail(session)


def _record_answer(session: InterviewSession, content: str) -> InterviewMessage:
    """把这一轮的候选人回答落库。

    上一次被中断（客户端断开 / 用户点「停止本轮」/ 模型这一轮失败）会留下一条
    ``status=interrupted`` 的回答；重答时**复用它**，不再追加第二条同样的用户消息
    ——重答走的就是同一条提问链路，同一句话不该在记录里出现两遍（详见
    ``reuse_interrupted_answer``）。
    """
    reused = reuse_interrupted_answer(session, content)
    if reused is not None:
        logger.info("重答复用被中断的一轮 session=%s message=%s", session.id, reused.id)
        return reused
    return add_message(session, role="user", content=content)


def _mark_interrupted(db: Session, answer: InterviewMessage) -> None:
    """把"这一轮没答完"写进记录：**只改状态，绝不删除用户那条消息**。

    放在收尾/取消路径上调用，所以自己吞掉写库异常：中断标记失败只该降级成"这轮看起来
    没答完但没标出来"，不能因为写状态把客户端断开这件事变成 500。
    """
    if not mark_answer_interrupted(answer):
        return
    try:
        db.commit()
        logger.info("面试一轮被中断 message=%s（用户回答保留，可重答）", answer.id)
    except Exception:  # noqa: BLE001 - 取消路径不能再抛
        logger.warning("标记面试中断状态失败 message=%s", answer.id, exc_info=True)
        db.rollback()


def _mark_interrupted_by_id(db: Session, answer_id: int) -> None:
    """按 id 收口"这一轮没答完"（跨 ``await`` 只传 id，不传那条 ORM 消息）。"""
    answer = db.get(InterviewMessage, answer_id)
    if answer is not None:
        _mark_interrupted(db, answer)


# ===== 同步工作单元（RF-02：这些函数**只能**经 ``run_sync`` 在 worker 里调用）=====
#
# 本批的切分口径：路由里"碰 Session 的那一段"整体是一个工作单元，worker 结束时把状态
# 收口到"事件循环只读已加载标量"的程度——``commit`` / ``refresh`` / 关系读热都留在里面。
# 这样 ``await`` 之后按属性读的都是内存值，不会在事件循环上触发 SELECT。


@dataclass(frozen=True)
class SessionMaterial:
    """面试官要读的两份材料文本（跨 ``await`` 的**冻结快照**）。

    材料是文件 IO + 简历反序列化，必须在 worker 里读；读成这个不可变对象之后，事件循环
    只持有字符串，不再持有任何需要懒加载的 ORM 关系。
    """

    resume_text: str = ""
    job_text: str = ""


def _warm_messages(session: InterviewSession) -> None:
    """把 ``messages`` 关系读热（**只能在 worker 里调**）。

    ``commit()`` / ``refresh()`` 之后关系是过期的，事件循环上第一次访问
    ``session.messages`` 会触发一次同步 SELECT——正是本批要挪走的那种阻塞。所以每个写
    工作单元的末尾都顺手读一遍。会话已 detached（测试里手工构造的对象）时直接跳过。
    """
    if object_session(session) is None:
        return
    _ = [item.id for item in session.messages]


def _commit_and_refresh(db: Session, session: InterviewSession) -> None:
    """提交 + 刷新 + 读热关系：一个完整的「写事务收尾」工作单元。"""
    db.commit()
    db.refresh(session)
    _warm_messages(session)


def _session_material(db: Session, session: InterviewSession) -> SessionMaterial:
    """读出候选人 / 岗位两份材料文本（含文件 IO），顺手读热消息关系。"""
    _warm_messages(session)
    return SessionMaterial(
        resume_text=_resume_text(db, session),
        job_text=_session_job_text(db, session),
    )


__all__ = [
    "INTERVIEW_STATUS_ACTIVE",
    "INTERVIEW_STATUS_FINISHED",
    "MAX_JOB_CONTEXT_FOR_INTERVIEW",
    "SessionMaterial",
    "_as_interview_status",
    "_commit_and_refresh",
    "_job_text",
    "_mark_interrupted",
    "_mark_interrupted_by_id",
    "_record_answer",
    "_require_provider",
    "_resume_record_or_none",
    "_resume_text",
    "_session_job_text",
    "_session_material",
    "_session_or_404",
    "_to_detail",
    "_to_out",
    "_warm_messages",
]
