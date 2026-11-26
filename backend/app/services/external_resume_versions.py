# SPDX-License-Identifier: Apache-2.0
"""外部简历的历史版本链（#5）：写新版本、列版本、恢复到旧版本。

**版本语义是"只增不改"**：每次编辑 / 恢复都新增一条
``external_resume_revision``，谁也不删历史。``external_resume.file_id`` 永远指向
**最新**那份；``original_file_id`` 保留首次上传那份（"回到原件"）。

**为什么每次都写新 `user_file`**：`user_file` 是内容寻址（sha256）的共享登记，同一份
内容可能被资料照片 / 聊天附件引用，覆盖文件会连累别的入口。编辑产物写成一个新
`user_file` 正好复用它既有的去重、安全命名与备份收集。

**编辑后必须重新提取正文**：`text / text_chars / has_text` 是"用于面试"和文本检查的
输入，不刷新的话用户改完字，面试材料拿到的还是旧正文。
"""

from __future__ import annotations

import logging
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader
from sqlalchemy.orm import Session

from ..models.external_resume import (
    SOURCE_EDIT,
    SOURCE_RESTORE,
    SOURCE_UPLOAD,
    ExternalResume,
    ExternalResumeRevision,
)
from ..models.user_file import UserFile
from .external_resume_pdf_scan import normalize_cid_encoding
from .external_resumes import SOURCE_TYPE, prepare_upload
from .user_files import save_from_bytes, user_files_dir

logger = logging.getLogger(__name__)


class RevisionFileMissing(Exception):
    """历史版本的文件在磁盘上缺失 / 路径越界（对外 404）。"""


def revision_of(
    row: ExternalResume, *, text: str, file_id: int, source: str
) -> ExternalResumeRevision:
    """构造一条版本快照（不落库）：字数与"有没有文字"从正文现算，不信任调用方。"""
    return ExternalResumeRevision(
        resume_id=int(row.id),
        file_id=int(file_id),
        text_chars=len(text),
        has_text=bool(text.strip()),
        source=source,
    )


def list_revisions(db: Session, row: ExternalResume) -> list[ExternalResumeRevision]:
    """按时间倒序列出历史版本（同一时刻再按 id 倒序，保证顺序稳定）。"""
    return (
        db.query(ExternalResumeRevision)
        .filter(ExternalResumeRevision.resume_id == row.id)
        .order_by(ExternalResumeRevision.created_at.desc(), ExternalResumeRevision.id.desc())
        .all()
    )


def get_revision(
    db: Session, row: ExternalResume, revision_id: int
) -> ExternalResumeRevision | None:
    """取属于这份外部简历的某个版本；别的简历的版本一律当不存在。"""
    return (
        db.query(ExternalResumeRevision)
        .filter(
            ExternalResumeRevision.id == revision_id,
            ExternalResumeRevision.resume_id == row.id,
        )
        .one_or_none()
    )


def path_of_file(db: Session, file_id: int) -> Path:
    """按 `user_file` 取磁盘路径；路径必须仍落在副本目录内。"""
    user_file = db.get(UserFile, file_id)
    if user_file is None:
        raise RevisionFileMissing("这一版的文件已不存在")
    directory = user_files_dir(db.get_bind()).resolve()
    candidate = (directory / user_file.disk_name).resolve()
    if candidate.parent != directory or not candidate.is_file():
        raise RevisionFileMissing("这一版的文件已不存在")
    return candidate


def _apply_version(
    db: Session,
    row: ExternalResume,
    *,
    file_id: int,
    source: str,
    text: str,
) -> ExternalResumeRevision:
    """把 `row` 指向这一版并追加一条历史（不 commit，由调用方统一提交）。"""
    row.file_id = int(file_id)
    row.text = text
    row.text_chars = len(text)
    revision = revision_of(row, text=text, file_id=file_id, source=source)
    db.add(revision)
    return revision


def record_upload(
    db: Session, row: ExternalResume, *, file_id: int, text: str
) -> ExternalResumeRevision:
    """上传时补第一版：`original_file_id` 与 `file_id` 都指向它。"""
    row.original_file_id = int(file_id)
    revision = revision_of(row, text=text, file_id=file_id, source=SOURCE_UPLOAD)
    db.add(revision)
    return revision


def persist_edit(
    db: Session,
    row: ExternalResume,
    *,
    content: bytes,
    original_name: str,
    mime: str,
) -> tuple[ExternalResumeRevision, list[str]]:
    """把编辑产物写成新版本并刷新正文，返回（新版本, 提取警告）。"""
    save_from_bytes(
        db,
        content,
        original_name=original_name or row.name or "外部简历",
        mime=mime,
        source_type=SOURCE_TYPE,
        source_ref=f"edit:{row.id}",
    )
    digest = sha256(content).hexdigest()
    user_file = db.query(UserFile).filter(UserFile.sha256 == digest).one_or_none()
    if user_file is None:
        raise ValueError("编辑后的文件保存失败，请重试")

    text, warnings = _extract(original_name or row.name, content)
    revision = _apply_version(db, row, file_id=user_file.id, source=SOURCE_EDIT, text=text)
    db.commit()
    db.refresh(row)
    db.refresh(revision)
    logger.info(
        "外部简历已保存新版本 id=%s revision=%s chars=%s", row.id, revision.id, revision.text_chars
    )
    return revision, warnings


def restore(
    db: Session, row: ExternalResume, revision: ExternalResumeRevision
) -> tuple[ExternalResumeRevision, list[str]]:
    """恢复到某一版：**再写一条** `source=restore` 的新版本，不改写历史。"""
    path = path_of_file(db, revision.file_id)
    content = path.read_bytes()
    text, warnings = _extract(row.name, content)
    new_revision = _apply_version(
        db, row, file_id=revision.file_id, source=SOURCE_RESTORE, text=text
    )
    db.commit()
    db.refresh(row)
    db.refresh(new_revision)
    logger.info("外部简历已恢复到 revision=%s（新版本 %s）", revision.id, new_revision.id)
    return new_revision, warnings


def _extract(name: str, content: bytes) -> tuple[str, list[str]]:
    """编辑产物重新提取正文；提取不出来时留空串并给一条警告（不吞掉整次保存）。

    `prepare_upload` 的 PDF 路径带"整页不足 30 字就按扫描页处理"的口径（那是给上传
    判断扫描件的），短文档会被它判成空正文。编辑产物不一样——我们刚刚在同一份文件上
    逐个字形读过、还写过覆盖层，它**确定**有文字层。所以这里在空正文时按 pypdf 再直读
    一遍（不做扫描页判定），避免"改完字、正文却变空"。
    """
    try:
        prepared = prepare_upload(name or "外部简历", content)
    except ValueError as exc:
        logger.info("编辑后的文件无法提取正文：%s", exc)
        return "", [f"新文件暂时无法提取正文：{exc}"]
    text = prepared.text
    if not text.strip() and (name or "").lower().endswith(".pdf"):
        text = _pdf_text_without_scan_heuristics(content)
    return text, list(prepared.warnings)


def _pdf_text_without_scan_heuristics(content: bytes) -> str:
    """按页直读 PDF 文字（先做 CID 编码归一化，才能读到 fpdf2 导出件的字）。"""
    try:
        raw = normalize_cid_encoding(content)[0]
        reader = PdfReader(BytesIO(raw), strict=False)
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception:  # noqa: BLE001 - 读不出来就维持空正文，上面的警告已经说明
        logger.info("编辑产物直读正文失败", exc_info=True)
        return ""


__all__ = [
    "RevisionFileMissing",
    "get_revision",
    "list_revisions",
    "path_of_file",
    "persist_edit",
    "record_upload",
    "restore",
    "revision_of",
]
