# SPDX-License-Identifier: Apache-2.0
"""模拟面试的会话级端点：时长上报 / 删除 / 转资料。

从 ``api/interview.py`` 拆出来（行数预算：那边原本 486 行只余 14）。这三个端点与
"问答 / 报告生成"那条主链路无关——它们只碰会话行本身（改一列、删一行、读一份报告），
不需要模型、不需要流式，也不参与 ``AnswerPrep`` / ``FinishPrep`` 三段式。拆出来之后
主模块只剩"开一场面试 → 答一题 → 出报告"这条主线。

挂载方式与 ``interview_camera`` 一致：``register_session_routes(router)`` 把路由注册到
调用方的同一个 router 上，路径前缀与鉴权由调用方统一持有，本模块不自建 router。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.interview import InterviewBrief, InterviewDurationUpdate
from ..schemas.material import MaterialCreate, MaterialOut
from ..services.interview.interview_camera import delete_recording
from ..services.interview.interview_report_markdown import _report_markdown
from ..services.materials import create_material as create_material_record
from .interview_shared import _session_or_404, _to_out


def register_session_routes(router: APIRouter) -> None:
    """把会话级端点挂到 ``router`` 上（与 ``interview_camera`` 同一模式）。"""

    @router.put("/{session_id}/duration", response_model=InterviewBrief)
    def update_duration(
        session_id: int, payload: InterviewDurationUpdate, db: Session = Depends(get_db)
    ):
        """上报累计的**有效面试时长**（秒）。

        前端每累计一段就整份上报"本次已累计秒数"（离开页面暂停、回来点「继续面试」后
        接着累计），所以这里是绝对值而不是增量。取 ``max()`` 是为了让乱序到达或重试的
        旧请求不会把时长往回拨。
        """
        session = _session_or_404(db, session_id)
        session.duration_seconds = max(session.duration_seconds, payload.elapsed_seconds)
        db.commit()
        db.refresh(session)
        return _to_out(session)

    @router.delete("/{session_id}", status_code=204)
    def delete_session(session_id: int, db: Session = Depends(get_db)):
        session = _session_or_404(db, session_id)
        # 录像文件不随数据库行级联：先删文件再删记录，避免留下无主的面部画面
        # （录像不进回收站，删除确认框里已写明不可恢复）。
        delete_recording(session_id)
        db.delete(session)
        db.commit()

    @router.post("/{session_id}/to-material", response_model=MaterialOut, status_code=201)
    def report_to_material(session_id: int, db: Session = Depends(get_db)):
        """把这场面试的记录与报告存进资料箱（面试复盘）。"""
        session = _session_or_404(db, session_id)
        return create_material_record(
            db,
            MaterialCreate(
                title=f"面试复盘：{session.title or session.interview_type}"[:256],
                category="面试复盘",
                content=_report_markdown(session),
                note=f"来自模拟面试 #{session.id}",
            ),
        )
