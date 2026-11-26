# SPDX-License-Identifier: Apache-2.0
"""外部简历（清单 `21）：上传 / 列表 / 改名 / 关联岗位 / 软删 / 原件 / 文本检查。

**只读快照**：外部简历独立成表（见 `models/external_resume.py`），这里只维护这一张表 +
`user_file` 的副本登记，**不碰** `resume_record` / 版式 / 导出。文件由既有
`user_files.save_from_bytes` 落盘（sha256 去重、安全命名、自愈补写），所以备份的资产
类别不用改——`user_files/` 本来就是按 `user_file` 整表收集的。

**上传即本地提取，失败不静默**（与面试材料同一原则）：

- pdf / docx / txt / md 走 `document_text.extract_material_text(..., render_scan_pages=False)`
  本机提取；**不调用视觉模型**（简历中心的上传要快、可离线，视觉识别是面试材料链路的语义）；
- 扫描件 / 无文字层：行照样创建、`text=""`，返回一条明确的警告；原件仍可预览；
- 损坏 / 不支持 / 超大：抛面向用户的 `ValueError`，由接口层转成 4xx，不留半条记录。

**删除只软删表行，不删物理文件**：同一份内容可能被资料照片 / 聊天附件等其它入口引用，
而 `user_file` 行是内容去重后的共享登记。彻底删除（清空回收站）同样不删磁盘文件。
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
from pathlib import Path
from typing import Literal, NamedTuple

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..models.external_resume import SOURCE_UPLOAD, ExternalResume, ExternalResumeRevision
from ..models.job import Job
from ..models.user_file import UserFile
from ..schemas.external_resume import (
    MAX_EXTERNAL_RESUME_BYTES,
    MAX_NAME_CHARS,
    ExternalResumeAnalysisOut,
    ExternalResumeBrief,
    ExternalResumeDetail,
    ExternalResumeUpdateInput,
)
from . import trash
from .document_text import (
    _MATERIAL_DOCX_NO_TEXT,
    _MATERIAL_NO_TEXT,
    MATERIAL_LEGACY_DOC,
    MATERIAL_SCAN_NO_VISION_WARNING,
    MATERIAL_TEXT_SUFFIXES,
    MATERIAL_UNSUPPORTED,
    extract_material_text,
    material_suffix,
)
from .external_resume_analysis import analyze_external_resume
from .external_resume_pdf_scan import normalize_cid_encoding
from .user_files import save_from_bytes, user_files_dir

logger = logging.getLogger(__name__)

# 回收站注册表里的类型 key（见 services/trash_registry.py）。
TRASH_KEY = "external_resume"
# user_file 的来源标记：与其它入口（material / photo / job_note / …）同一套写法。
SOURCE_TYPE = "external_resume"
# 没有文字层时的用户警告。措辞刻意说"暂时"：面试材料链路仍可对扫描件做视觉识别，
# 用户之后可以用那条通道；这里只是**不做**，不是这份文件永久没用。
NO_TEXT_WARNING = "这份文件没有文字层，暂时无法检查内容"
# 提取层"没有可提取的文字"的两种文案（pdf/txt 与 docx 各一句）。命中它们表示文件本身
# 合法、只是没有文字层，按"允许空正文"处理；其余 ValueError（损坏 / 加密 / 不支持）
# 必须原样抛出去当失败——两种结果对用户是两件事，不能一起静默。
_NO_TEXT_MESSAGES = frozenset({_MATERIAL_NO_TEXT, _MATERIAL_DOCX_NO_TEXT})


class ExternalResumeFileMissing(Exception):
    """原件在磁盘上缺失 / 路径不合法（对外 404）。"""


class ExtractedUpload(NamedTuple):
    """上传文件的本地提取结果：展示名 + 正文 + 面向用户的警告。"""

    name: str
    text: str
    warnings: list[str]


def _display_name(original_name: str) -> str:
    """展示用文件名：只留最后一段（挡掉浏览器带来的目录部分），截到列宽。"""
    base = (original_name or "").strip().rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    return (base or "外部简历")[:MAX_NAME_CHARS]


def validate_upload(original_name: str, content: bytes) -> None:
    """上传前的硬边界：格式 / 空文件 / 体积。失败抛面向用户的 `ValueError`。"""
    suffix = material_suffix(original_name)
    if suffix == ".doc":
        raise ValueError(MATERIAL_LEGACY_DOC)
    if suffix.lstrip(".") not in MATERIAL_TEXT_SUFFIXES:
        raise ValueError(MATERIAL_UNSUPPORTED)
    if not content:
        raise ValueError("文件是空的")
    if len(content) > MAX_EXTERNAL_RESUME_BYTES:
        size_mb = MAX_EXTERNAL_RESUME_BYTES // (1024 * 1024)
        raise ValueError(f"文件超过 {size_mb} MB，无法上传")


#: 浏览器"我不知道这是什么"的万能答案。Windows 上传 .md / .doc 时经常报它。
OCTET_STREAM = "application/octet-stream"

#: 本功能接受的后缀 → MIME（`MATERIAL_TEXT_SUFFIXES` 的镜像）。
#: 不只靠 `mimetypes.guess_type`：它读操作系统的映射表，Windows 上 `guess_type("note.md")`
#: 返回 `(None, None)`（本机实测），正好漏掉这个 bug 的主场。写死这五档，三平台一致；
#: 不认识的后缀才交给 `guess_type`。
_SUFFIX_MIMES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
    "markdown": "text/markdown",
}


def resolve_mime(original_name: str, mime: str) -> str:
    """上传时声明的 MIME 归一：``application/octet-stream`` 与空串按扩展名重新猜一次。

    为什么必须做（T09 / R9）：列表的类型徽标与"能不能在浏览器里直接预览"都读
    ``user_file.mime``，而前端**先看扩展名、后看 MIME**（``utils/fileKind.ts``）。Windows
    上传的 ``.md`` 常带 ``application/octet-stream``，原样落库后判断只能靠文件名兜底。

    归一顺序：剥掉 ``; charset=`` 参数并小写；**不是** octet-stream 就原样保留（浏览器给
    的精确值比猜的可信）；是万能答案或空串才猜——先 :data:`_SUFFIX_MIMES`（跨平台确定），
    再 ``mimetypes.guess_type``；都猜不到就保留原值（猜不到就承认猜不到，不编类型）。
    """
    cleaned = (mime or "").split(";", 1)[0].strip().lower()
    if cleaned and cleaned != OCTET_STREAM:
        return cleaned
    suffix = material_suffix(original_name or "").lstrip(".")
    known = _SUFFIX_MIMES.get(suffix)
    if known:
        return known
    guessed, _encoding = mimetypes.guess_type(original_name or "")
    if guessed:
        return guessed
    return cleaned or OCTET_STREAM


def prepare_upload(original_name: str, content: bytes) -> ExtractedUpload:
    """校验并本地提取一份上传文件（纯函数，可下沉线程池；不碰数据库）。

    扫描件 PDF 不渲染扫描页、不调视觉模型：`extract_material_text` 的
    `render_scan_pages=False` 形态返回空正文 + 一条"不做图片识别"的通用警告；那条警告
    是给资料箱附件写的，这里换成外部简历自己的口径（只留`NO_TEXT_WARNING`）。
    """
    validate_upload(original_name, content)
    name = _display_name(original_name)
    payload = content
    if material_suffix(name) == ".pdf":
        # fpdf2 2.9 + OTF 导出的 PDF 用内嵌 CMap 做 /Encoding，pdfminer 只按 CMap **名字**
        # 查表，读出来是零个字形——不先归一化成 /Identity-H，本应用自己导出的 PDF 会被
        # 误判成扫描件（正文空、"没有文字层"）。归一化只作用于解析副本，原件不动。
        payload = normalize_cid_encoding(content)[0]
    try:
        extracted = extract_material_text(name, payload, render_scan_pages=False)
    except ValueError as exc:
        if str(exc) in _NO_TEXT_MESSAGES:
            return ExtractedUpload(name=name, text="", warnings=[NO_TEXT_WARNING])
        raise
    text = extracted.text.strip()
    warnings = [item for item in extracted.warnings if item != MATERIAL_SCAN_NO_VISION_WARNING]
    if not text:
        warnings.append(NO_TEXT_WARNING)
    return ExtractedUpload(name=name, text=text, warnings=list(dict.fromkeys(warnings)))


def _live_job_or_none(db: Session, job_id: int | None) -> Job | None:
    """关联岗位必须存在且未删；给了非法 id 就明确失败，而不是悄悄丢关联。"""
    if job_id is None:
        return None
    job = trash.get_live(db, Job, job_id)
    if job is None:
        raise ValueError("关联岗位不存在或已被删除")
    return job


def create_external_resume(
    db: Session,
    *,
    content: bytes,
    original_name: str,
    mime: str,
    name: str = "",
    job_id: int | None = None,
    extracted: ExtractedUpload | None = None,
) -> tuple[ExternalResume, list[str]]:
    """落盘 + 提取 + 建行。返回（行, 上传警告）。

    `extracted` 允许接口层把耗时的提取先在线程池里做完再进来（同步调用方传 None，
    函数内部自己提取）。文件登记与建行在同一事务里；磁盘文件由既有副本库管理。
    """
    prepared = extracted or prepare_upload(original_name, content)
    job = _live_job_or_none(db, job_id)
    save_from_bytes(
        db,
        content,
        original_name=original_name or prepared.name,
        # 归一在这里而不是接口层：`create_external_resume` 是**唯一**把 mime 落库的入口
        # （上传接口、测试夹具、将来的批量导入都走它），放在接口层就会有第二条路绕过。
        mime=resolve_mime(original_name or prepared.name, mime),
        source_type=SOURCE_TYPE,
        source_ref="",
    )
    sha = hashlib.sha256(content).hexdigest()
    user_file = db.query(UserFile).filter(UserFile.sha256 == sha).one_or_none()
    if user_file is None:
        raise ValueError("文件保存失败，请重试")
    display = (name or "").strip()[:MAX_NAME_CHARS] or prepared.name
    row = ExternalResume(
        file_id=user_file.id,
        # 首传那份：编辑另存新版本后，"回到原件"仍指它（#5）。
        original_file_id=user_file.id,
        name=display,
        text=prepared.text,
        text_chars=len(prepared.text),
        job_id=job.id if job is not None else None,
    )
    db.add(row)
    db.flush()
    # 上传也记一版（source=upload）：历史列表从第一天起就是完整的，
    # 不必让读侧为"升级前的老行"另写一条补录逻辑。
    db.add(
        ExternalResumeRevision(
            resume_id=int(row.id),
            file_id=int(user_file.id),
            text_chars=len(prepared.text),
            has_text=bool(prepared.text.strip()),
            source=SOURCE_UPLOAD,
        )
    )
    db.commit()
    db.refresh(row)
    logger.info("已保存外部简历 id=%s file_id=%s chars=%s", row.id, row.file_id, row.text_chars)
    return row, list(prepared.warnings)


#: 列表排序：``sort``（字段）+ ``order``（方向）→ ORDER BY 子句。
#
# 口径与内部简历（``resume_read_service.RESUME_SORT_ORDERS``）一致，差别只有方向是独立
# 参数（``?sort=name&order=asc``），所以键是 ``字段_方向`` 的复合名。三条硬约束：
# 1. 每个键都以 ``id`` 收尾且方向一致——同时刻创建的两行跨页时才不重复/漏行；
# 2. 姓名与岗位名走 ``rf_pinyin``（``database.py`` 在每条连接上注册）：BINARY 会把
#    ASCII 名全排在中文前、中文再按码点，用户看到的顺序与"按名字排"无关；
# 3. 岗位名 ``coalesce`` 到空串：外连接后没有岗位的行是 ``NULL``，直接排序时位置取决于
#    ASC/DESC，``coalesce`` 让"没有岗位"与"岗位名为空"归到同一档。
EXTERNAL_RESUME_SORT_ORDERS = {
    "name_asc": (ExternalResume.name.collate("rf_pinyin").asc(), ExternalResume.id.asc()),
    "name_desc": (ExternalResume.name.collate("rf_pinyin").desc(), ExternalResume.id.desc()),
    "job_title_asc": (
        func.coalesce(Job.title, "").collate("rf_pinyin").asc(),
        ExternalResume.id.asc(),
    ),
    "job_title_desc": (
        func.coalesce(Job.title, "").collate("rf_pinyin").desc(),
        ExternalResume.id.desc(),
    ),
    "created_at_asc": (ExternalResume.created_at.asc(), ExternalResume.id.asc()),
    "created_at_desc": (ExternalResume.created_at.desc(), ExternalResume.id.desc()),
    "text_chars_asc": (ExternalResume.text_chars.asc(), ExternalResume.id.asc()),
    "text_chars_desc": (ExternalResume.text_chars.desc(), ExternalResume.id.desc()),
}

#: 可排序字段（与前端列头一一对应；``text_chars`` 没有独立列，只能由 URL 指定）。
ExternalResumeSortKey = Literal["name", "job_title", "created_at", "text_chars"]
#: 排序方向。
ExternalResumeSortOrder = Literal["asc", "desc"]
#: 列表默认排序：最近上传在前（与改造前逐字一致，老调用方不受影响）。
DEFAULT_EXTERNAL_SORT_KEY: ExternalResumeSortKey = "created_at"
DEFAULT_EXTERNAL_SORT_ORDER: ExternalResumeSortOrder = "desc"


def _sort_order_by(
    sort: ExternalResumeSortKey, order: ExternalResumeSortOrder
) -> tuple[object, ...]:
    """``(sort, order)`` → ORDER BY 子句；未知组合回落到默认（不抛，交给接口层校验）。"""
    compound = f"{sort}_{order}"
    return EXTERNAL_RESUME_SORT_ORDERS.get(
        compound,
        EXTERNAL_RESUME_SORT_ORDERS[f"{DEFAULT_EXTERNAL_SORT_KEY}_{DEFAULT_EXTERNAL_SORT_ORDER}"],
    )


def list_external_resumes(
    db: Session,
    *,
    keyword: str = "",
    job_id: int | None = None,
    include_general: bool = False,
    page: int = 1,
    page_size: int = 20,
    sort: ExternalResumeSortKey = DEFAULT_EXTERNAL_SORT_KEY,
    order: ExternalResumeSortOrder = DEFAULT_EXTERNAL_SORT_ORDER,
) -> tuple[list[ExternalResume], int]:
    """Filter before paging; deleted jobs never contribute searchable metadata.

    ``include_general``（T6）：与内部简历 ``GET /api/resumes?include_general=true`` 同
    口径——``job_id == ? OR job_id IS NULL``。"通用"就是没挂任何岗位的那一份
    （``job_id IS NULL``），求职进度选"使用的简历"时候选范围要包含它，否则专门写的
    通用简历会从下拉里消失。岗位被彻底删除导致 ``job_id`` 被 SET NULL 的行会因此
    被当成通用——这是既有口径已知的边界，两处（内部/外部）刻意保持一致。

    ``sort`` / ``order``（T09）：服务端排序，**必须下推 SQL**——列表只取当页
    （默认 20 条），在前端排只能排到当前页，翻页就会看到"排好的顺序又乱了"。
    默认值与改造前逐字一致（``created_at desc, id desc``），既有调用方不用改。
    """
    query = (
        db.query(ExternalResume)
        .outerjoin(Job, and_(ExternalResume.job_id == Job.id, trash.live_only(Job)))
        .filter(trash.live_only(ExternalResume))
    )
    if job_id is not None:
        if include_general:
            query = query.filter(
                or_(ExternalResume.job_id == job_id, ExternalResume.job_id.is_(None))
            )
        else:
            query = query.filter(ExternalResume.job_id == job_id)
    cleaned = (keyword or "").strip()
    if cleaned:
        # Preserve existing LIKE semantics: percent and underscore remain wildcards.
        pattern = f"%{cleaned}%"
        query = query.filter(
            or_(
                ExternalResume.name.like(pattern),
                Job.title.like(pattern),
                Job.company.like(pattern),
            )
        )
    total = query.count()
    rows = (
        query.order_by(*_sort_order_by(sort, order))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def get_external_resume(db: Session, resume_id: int) -> ExternalResume | None:
    """按 id 取一条未删除的外部简历；已在回收站里的当作不存在（404）。"""
    return trash.get_live(db, ExternalResume, resume_id)


def job_titles(db: Session, job_ids: list[int]) -> dict[int, str]:
    """批量取关联岗位标题（列表页一个查询搞定，避免 N+1）。"""
    wanted = [job_id for job_id in set(job_ids) if job_id]
    if not wanted:
        return {}
    rows = db.query(Job.id, Job.title).filter(Job.id.in_(wanted)).filter(trash.live_only(Job)).all()
    return {int(job_id): str(title or "") for job_id, title in rows}


def user_file_mimes(db: Session, file_ids: list[int]) -> dict[int, str]:
    """批量取副本 MIME（列表页一个查询搞定；前端据此决定原件预览形态）。"""
    wanted = [file_id for file_id in set(file_ids) if file_id]
    if not wanted:
        return {}
    rows = db.query(UserFile.id, UserFile.mime).filter(UserFile.id.in_(wanted)).all()
    return {int(file_id): str(mime or "") for file_id, mime in rows}


def brief_of(row: ExternalResume, *, job_title: str = "", mime: str = "") -> ExternalResumeBrief:
    return ExternalResumeBrief(
        id=int(row.id),
        file_id=int(row.file_id),
        name=row.name or "",
        mime=mime,
        text_chars=int(row.text_chars or 0),
        has_text=bool((row.text or "").strip()),
        job_id=row.job_id,
        job_title=job_title,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def detail_of(row: ExternalResume, *, job_title: str = "", mime: str = "") -> ExternalResumeDetail:
    return ExternalResumeDetail(
        **brief_of(row, job_title=job_title, mime=mime).model_dump(),
        text=row.text or "",
    )


def update_external_resume(
    db: Session, row: ExternalResume, payload: ExternalResumeUpdateInput
) -> ExternalResume:
    """改名 / 关联岗位（PATCH）。

    `job_id` 只有在调用方**显式传了**这个键时才处理：`model_fields_set` 区分"没传"
    （保留原关联）与"传 null"（取消关联）——只用 None 当默认值会让取消关联做不到。
    """
    if payload.name is not None:
        display = payload.name.strip()[:MAX_NAME_CHARS]
        if not display:
            raise ValueError("名称不能为空")
        row.name = display
    if "job_id" in payload.model_fields_set:
        job = _live_job_or_none(db, payload.job_id)
        row.job_id = job.id if job is not None else None
    db.commit()
    db.refresh(row)
    return row


def delete_external_resume(db: Session, row: ExternalResume) -> None:
    """软删进回收站：**只写 deleted_at**，物理文件与 user_file 行原样保留。"""
    trash.soft_delete(db, TRASH_KEY, row)
    db.commit()


def resolve_original_path(db: Session, row: ExternalResume) -> Path:
    """按行取原件路径；路径必须仍落在副本目录内，缺失 / 越界一律 404。"""
    user_file = db.get(UserFile, row.file_id)
    if user_file is None:
        raise ExternalResumeFileMissing("原件不存在")
    directory = user_files_dir(db.get_bind()).resolve()
    candidate = (directory / user_file.disk_name).resolve()
    if candidate.parent != directory or not candidate.is_file():
        raise ExternalResumeFileMissing("原件不存在")
    return candidate


def extract_text(db: Session, row: ExternalResume) -> str:
    """读取正文：上传时已提取；正文为空时按 file_id 重提取一次并回写（自愈）。

    自愈只补"行里有文件、库里 text 空"这种状态（例如升级前的老行），不猜测内容：
    重新提取仍为空就保持空串，让调用方按"没有文字"处理。
    """
    if (row.text or "").strip():
        return row.text
    try:
        path = resolve_original_path(db, row)
        user_file = db.get(UserFile, row.file_id)
        original_name = (
            (user_file.original_name if user_file is not None else "") or row.name or "外部简历"
        )
        prepared = prepare_upload(original_name, path.read_bytes())
    except (ExternalResumeFileMissing, OSError, ValueError):
        logger.info("外部简历正文自愈失败 id=%s（原件缺失或无法解析）", row.id)
        return ""
    if not prepared.text:
        return ""
    row.text = prepared.text
    row.text_chars = len(prepared.text)
    db.commit()
    db.refresh(row)
    return row.text


def _jd_text_for_resume(db: Session, row: ExternalResume) -> str:
    """关联岗位的 JD 文本（描述 + 任职要求）；没有关联或岗位已删则返回空串。"""
    if row.job_id is None:
        return ""
    job = trash.get_live(db, Job, row.job_id)
    if job is None:
        return ""
    return "\n".join(
        part.strip() for part in (job.description or "", job.requirements or "") if part.strip()
    )


def analyze(db: Session, row: ExternalResume) -> ExternalResumeAnalysisOut:
    """文本级检查：正文按需自愈，JD 取自关联岗位（没有 JD 就没有关键词分项）。"""
    text = extract_text(db, row)
    return analyze_external_resume(
        text,
        jd_text=_jd_text_for_resume(db, row),
        resume_id=int(row.id),
    )


__all__ = [
    "NO_TEXT_WARNING",
    "SOURCE_TYPE",
    "TRASH_KEY",
    "ExtractedUpload",
    "ExternalResumeFileMissing",
    "analyze",
    "brief_of",
    "create_external_resume",
    "delete_external_resume",
    "detail_of",
    "extract_text",
    "get_external_resume",
    "job_titles",
    "list_external_resumes",
    "prepare_upload",
    "resolve_original_path",
    "update_external_resume",
    "user_file_mimes",
    "validate_upload",
]
