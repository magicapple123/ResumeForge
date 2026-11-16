# SPDX-License-Identifier: Apache-2.0
"""ATS 本地检测接口（prefix ``/api/resumes``）。

纯本地计算，不调用模型：加载简历 → 调 ``services/ats_check`` → 返回带免责声明的结论。
加载简历那一段（含回收站过滤与产物解析检查）在 ``services/ats_panel``——助手动作
``check_ats_match`` 也要同一份行为，两处各写一遍就等于两份"哪个简历算存在"的判断。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.ats import AtsCheckOut, AtsCheckRequest
from ..services.actions import add_action_route
from ..services.actions.catalog import registered_action
from ..services.ats_panel import AtsResumeNotFound, check_resume_ats

router = APIRouter(prefix="/api/resumes", tags=["ats"])


add_action_route(router, registered_action("check_ats_match"), route_path="/{resume_id}/ats-check")


def ats_check(
    resume_id: int, payload: AtsCheckRequest, db: Session = Depends(get_db)
) -> AtsCheckOut:
    """对某份简历做 ATS 本地检测（关键词覆盖 / 格式风险 / 信息位置）。

    薄壳：业务在 ``services.ats_panel.check_resume_ats``（路由与助手动作共用同一份实现）。
    """
    try:
        return check_resume_ats(db, resume_id=resume_id, jd_text=payload.jd_text)
    except AtsResumeNotFound as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


__all__ = ["router"]
