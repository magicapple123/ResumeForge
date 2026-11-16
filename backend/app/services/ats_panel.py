# SPDX-License-Identifier: Apache-2.0
"""ATS 面板出口：按简历 id 取到内容，再跑一遍本地检测。

**为什么单独一个模块**：``services/ats_check.py`` 是纯计算（不给它任何会话依赖），
而"面板这一个对外出口"还要多做三件事——按 id 找简历、过滤已进回收站的行、打开产物
解析检查（真渲染一遍 PDF 再读回来）。这三件事原先只长在路由 handler 里，助手动作要
同一份能力时只能去调路由，于是同一段业务同时"长在 api 层"又被动作调用。

路由（``POST /api/resumes/{resume_id}/ats-check``）与动作 ``check_ats_match`` 现在都
调 :func:`check_resume_ats`：``parse_check=True`` 这个取舍（渲染有成本，只有面板需要）
只在这里出现一次。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.resume import ResumeRecord
from ..schemas.ats import AtsCheckOut
from . import trash
from .ats_check import check_ats
from .resume import document_io

#: 找不到（或已进回收站）简历时的对外文案。路由与动作都用它，避免两处各写一句。
RESUME_NOT_FOUND_DETAIL = "简历记录不存在或已被删除"


class AtsResumeNotFound(Exception):
    """按 id 找不到可用的简历：``status_code``/``detail`` 由 HTTP 边界各自映射。

    服务层不 import FastAPI：路由侧把它翻成 ``HTTPException(404, detail)``，助手动作
    同样翻成 ``HTTPException(404, detail)``（两侧 detail 逐字一致，见 ``RESUME_NOT_FOUND_DETAIL``）。
    """

    status_code = 404
    detail = RESUME_NOT_FOUND_DETAIL

    def __init__(self) -> None:
        super().__init__(RESUME_NOT_FOUND_DETAIL)


def resume_content_or_none(db: Session, resume_id: int) -> dict | None:
    """取该简历可检测的内容；记录不存在或已进回收站时返回 ``None``。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        return None
    content, _conversion = document_io.document_for_record(db, record)
    return content


def check_resume_ats(db: Session, *, resume_id: int, jd_text: str = "") -> AtsCheckOut:
    """ATS 面板：加载简历 → 本地检测（含产物解析检查）→ 带免责声明的结论。

    简历不存在时抛 :class:`AtsResumeNotFound`；纯本地计算，不调用模型。
    """
    content = resume_content_or_none(db, resume_id)
    if content is None:
        raise AtsResumeNotFound()
    # 面板是唯一面向用户的 ATS 出口：这里打开产物解析检查（真渲染 PDF 再读回来）。
    return check_ats(content, jd_text=jd_text, resume_id=resume_id, parse_check=True)


__all__ = [
    "RESUME_NOT_FOUND_DETAIL",
    "AtsResumeNotFound",
    "check_resume_ats",
    "resume_content_or_none",
]
