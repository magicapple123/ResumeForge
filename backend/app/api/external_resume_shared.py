# SPDX-License-Identifier: Apache-2.0
"""外部简历接口的**共享层**：DTO 组装与 404 语义（`external_resumes` 与 `external_resume_edits` 共用）。

## 为什么要单独一层

`api/` 里不允许路由模块互相 import 具体符号（`test_import_direction` 的
``api-cross-module-imports``：跨路由复用必须经公共层）。拆出"改字"那半边之后，两边都要
``_get_or_404`` / ``_file_meta`` / ``_detail_of`` / ``_revision_out``——它们既不属于列表也不
属于改字，属于这**一个子域**的公共约定，所以放在这里，并在该守卫的
``SHARED_API_MODULES`` 里有意识地登记一次。

## 这里只放"两处都一样才算对"的东西

- ``NOT_FOUND_DETAIL``：404 的措辞必须一致，两处各写一句就会慢慢长出两种说法；
- ``_detail_of``：详情回显的形状（岗位标题 + 原件 MIME）只有一份，改字后回显不会与详情页
  不一致；
- ``_revision_out``：``current`` 的判定是"指向的仍是简历当前文件"，不是另存一个标记位。
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume, ExternalResumeRevision
from ..models.user_file import UserFile
from ..schemas.external_resume import ExternalResumeDetail, ExternalResumeRevisionOut
from ..services import external_resumes as service

NOT_FOUND_DETAIL = "外部简历不存在或已删除"


def get_or_404(db: Session, resume_id: int) -> ExternalResume:
    """未删除的外部简历；已进回收站的当作不存在（列表里也看不到它）。"""
    row = service.get_external_resume(db, resume_id)
    if row is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)
    return row


def job_title(db: Session, row: ExternalResume) -> str:
    if row.job_id is None:
        return ""
    return service.job_titles(db, [row.job_id]).get(row.job_id, "")


def detail_of(db: Session, row: ExternalResume) -> ExternalResumeDetail:
    """详情回显：关联岗位标题 + 原件 MIME 一起带上（前端据此选预览形态）。"""
    mime = service.user_file_mimes(db, [row.file_id]).get(row.file_id, "")
    return service.detail_of(row, job_title=job_title(db, row), mime=mime)


def file_meta(db: Session, file_id: int) -> tuple[str, str]:
    """(原始文件名, MIME)：编辑要按后缀选路，也让回显带上正确的内容类型。"""
    user_file = db.get(UserFile, file_id)
    if user_file is None:
        return "", ""
    return user_file.original_name or "", user_file.mime or ""


def revision_out(
    revision: ExternalResumeRevision, row: ExternalResume
) -> ExternalResumeRevisionOut:
    """版本回显；``current`` 用"指向的仍是简历当前文件"判定，不另存标记。"""
    return ExternalResumeRevisionOut(
        id=int(revision.id),
        file_id=int(revision.file_id),
        text_chars=int(revision.text_chars or 0),
        has_text=bool(revision.has_text),
        source=revision.source or "",
        created_at=revision.created_at,
        current=int(revision.file_id) == int(row.file_id),
    )
