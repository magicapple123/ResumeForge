# SPDX-License-Identifier: Apache-2.0
"""ATS 本地检测接口（prefix ``/api/resumes``）。

纯本地计算，不调用模型：加载简历 → 调 ``services/ats_check`` → 返回带免责声明的结论。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.resume import ResumeRecord
from ..schemas.ats import AtsCheckRequest
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.ats_check import check_ats
from ..services.resume import document_io

router = APIRouter(prefix="/api/resumes", tags=["ats"])


def _load_record(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record


add_action_route(router, all_actions()["check_ats_match"], route_path="/{resume_id}/ats-check")
def ats_check(resume_id: int, payload: AtsCheckRequest, db: Session = Depends(get_db)):
    record = _load_record(db, resume_id)
    content, _conversion = document_io.document_for_record(db, record)
    # 面板是唯一面向用户的 ATS 出口：这里打开产物解析检查（真渲染 PDF 再读回来）。
    return check_ats(content, jd_text=payload.jd_text, resume_id=resume_id, parse_check=True)


__all__ = ["router"]