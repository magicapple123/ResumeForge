# SPDX-License-Identifier: Apache-2.0
"""离线分享包（R-18）的生成、检索、评论回传与 token 校验。

分享包 = 一份**脱敏后**的简历产物目录，包含：

- ``resume.html`` / ``resume.pdf``：脱敏后的 HTML 与 PDF（复用导出管线）；
- ``resume_snapshot.json``：只读 v2 文档快照（不含照片，与 ``export_json`` 一致）；
- ``manifest.json``：本地离线 token + 权限 + 生成时间（token 落本地目录、可离线校验）；
- ``comments.md``：仅 ``comment`` 权限生成，收件人写评论后交回，导入写回本目录。

权限（``read_only`` / ``comment``）**只做标记**：离线包没有在线鉴权，它决定的是
"是否附带评论回传文件"。源简历 / 岗位删除后 ``SET NULL``，快照与文件清单独立成包，
不连坐。脱敏唯一复用 ``privacy.redact``，导出唯一复用 ``export_pipeline.build_export``。
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ..models.profile import utcnow
from ..models.resume import ResumeRecord
from ..models.share_package import (
    SHARE_PERMISSION_COMMENT,
    SHARE_PERMISSIONS,
    SharePackage,
)
from ..runtime.log_fields import safe_log_text
from ..schemas.resume_document import document_to_json
from ..schemas.share_package import ShareCommentsOut, SharePackageBrief
from . import trash
from .export_pipeline import ExportRequest, RenderContext, build_export
from .pdf_exporter import ResumePDFError
from .privacy import RedactionOptions, redact_document
from .resume import document_io
from .resume.document_html import coerce_document, document_for_delivery, with_document_photo
from .resume.document_view import header_text
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from .resume.resume_record import record_format_config
from .resume.resume_template_store import resolve_style_config, resolve_style_template
from .resume.resume_templates import DEFAULT_FONT_SCALE, DEFAULT_PAGE_LIMIT
from .share_package_paths import (
    SHARE_PACKAGES_DIR,
    package_directory,
    share_root,
)
from .share_package_views import share_package_brief, share_package_out

logger = logging.getLogger(__name__)


MAX_SHARE_PACKAGE_LIST = 500

_HTML_FILE = "resume.html"
_PDF_FILE = "resume.pdf"
_SNAPSHOT_FILE = "resume_snapshot.json"
_MANIFEST_FILE = "manifest.json"
_COMMENTS_FILE = "comments.md"


class SharePackageError(Exception):
    """对外暴露的分享包错误，message 为可直接展示给用户的中文提示。"""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


_SHARE_FOOTER_MARK = "<!--rf-share-footer-->"

# 页脚品牌标识：单色线稿，24px。内联 SVG 而不是引用图片文件——分享包要能离线双击打开，
# `data:`/相对路径都可能被浏览器拦或丢，内联是唯一自带的形态。
_SHARE_LOGO_SVG = (
    '<svg width="24" height="24" viewBox="0 0 512 512" fill="none" '
    'stroke="#16365c" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<rect x="11" y="11" width="490" height="490" rx="55" stroke-width="12"/>'
    '<path stroke-width="14" d="M326 100C379 107 431 111 464 116C476 118 482 128 478 139'
    "C437 245 388 355 335 454C330 464 320 469 310 466C268 455 221 440 186 431"
    "C149 395 98 384 43 360C34 356 29 346 35 335C87 246 135 144 168 59C173 47 183 42 194 46"
    'C223 57 289 79 326 100Z"/>'
    '<path stroke-width="12" d="M326 100C316.6 130 305.7 161 293.9 192.3'
    'M251.7 295.7C230.4 344.2 207.9 390.6 186 431"/>'
    "</svg>"
)


def _with_share_footer(content: bytes, created_at: datetime) -> bytes:
    """在分享版 HTML 末尾追加「由简历通生成 · 日期」页脚（WF-18）。

    只动分享包这一份产物：简历导出的 PDF/Word **不加任何 logo**（用户 2026-11-19 选的口径），
    分享包里的 ``resume.pdf`` 也保持干净。所以注入点必须在这里，而不是 ``export_pipeline``。

    找不到 ``</body>`` 就原样返回：宁可没有页脚，也不要把一份能正常打开的 HTML 改坏。
    """
    footer = (
        f'<footer class="rf-share-footer" style="margin:28px auto 18px;max-width:720px;'
        f"display:flex;align-items:center;justify-content:center;gap:8px;"
        f"font-family:inherit;font-size:12px;line-height:1.6;color:#8a94a6;"
        f"border-top:1px solid #e7ebf0;padding-top:12px;\">"
        f"{_SHARE_LOGO_SVG}"
        f"<span>由简历通生成 · {created_at:%Y-%m-%d}</span>"
        f"</footer>{_SHARE_FOOTER_MARK}"
    )
    text = content.decode("utf-8", errors="replace")
    lower = text.lower()
    index = lower.rfind("</body>")
    if index < 0:
        return content
    patched = f"{text[:index]}{footer}{text[index:]}"
    return patched.encode("utf-8")


def _write_atomically(path: Path, content: bytes) -> None:
    """先写临时文件再原子改名。

    这几个文件是**按需补齐的缓存**：补的过程中如果有另一个下载请求来读，非原子写会让它
    读到半截文件（HTML/PDF 尤其明显）。同盘改名是原子的，读到的要么是旧内容、要么是完整
    的新内容。
    """
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_bytes(content)
    temporary.replace(path)


def ensure_package_files(db: Session, package: SharePackage) -> list[str]:
    """确保分享包目录里的**产物文件**都在；缺哪个就按库里的快照补哪个。返回补出来的文件名。

    为什么要补：那些文件落在磁盘上、**不随备份包走**（随数据走的只有数据库里那份快照）。
    换数据集、或从备份恢复到另一台机器之后目录是空的——列表、详情、备注都还正常（走数据库），
    唯独点「下载」会 404。把文件当成**缓存**而不是数据源，缺了就从快照重新渲染，这条路才完整。

    补的只有**由数据库推导得出来**的那几个（HTML / PDF / 快照 JSON / 清单）：渲染脱敏后的
    内容，与创建时同一套管线。``comments.md`` **不补**——那是收件人写进来的内容，数据库里
    没有第二份；补一个空白模板会在界面上假装成"评论还在"，而它其实随着文件一起没了。
    """
    directory = package_directory(db.get_bind(), package.id)
    if not package.snapshot:
        # 没有快照就无从渲染（理论上不该发生）。如实返回空，由下载接口给出"文件不存在"。
        return []
    wanted = [_HTML_FILE, _PDF_FILE, _SNAPSHOT_FILE, _MANIFEST_FILE]
    if all((directory / name).is_file() for name in wanted):
        return []

    directory.mkdir(parents=True, exist_ok=True)
    resume = document_io.ensure_document_version(package.snapshot)
    # 风格上下文优先取原简历；简历被删了就退回默认版式——内容仍然逐字一致，只是版式不再是
    # 当初那一套。**不去猜**当初用的是什么模板，那只会造出一个看起来对、其实对不上的东西。
    record = trash.get_live(db, ResumeRecord, package.resume_id) if package.resume_id else None
    template_name, template_html = resolve_style_template(
        db, record.template if record is not None else None
    )
    context = RenderContext(
        template=template_name,
        template_html=template_html,
        style_config=resolve_style_config(db, record.template) if record else {},
        page_limit=(record.page_limit or DEFAULT_PAGE_LIMIT) if record else DEFAULT_PAGE_LIMIT,
        font_scale=(record.font_scale or DEFAULT_FONT_SCALE) if record else DEFAULT_FONT_SCALE,
        format_config=record_format_config(db, record) if record else {},
        # 分享包是"发给别人看的那一份"：标题语言必须跟记录一致，否则包里永远是中文。
        # 简历被删（record 为 None）时回落默认语言——这时只剩快照，没有语言可读。
        language=(record.language if record else DEFAULT_RESUME_LANGUAGE)
        or DEFAULT_RESUME_LANGUAGE,
    )

    restored: list[str] = []
    if not (directory / _HTML_FILE).is_file():
        artifact = build_export(ExportRequest(format="html"), resume, context)
        _write_atomically(directory / _HTML_FILE, artifact.content)
        restored.append(_HTML_FILE)
    if not (directory / _PDF_FILE).is_file():
        try:
            artifact = build_export(ExportRequest(format="pdf"), resume, context)
        except ResumePDFError as exc:
            # 没有中文字体时 PDF 出不来；其余几个文件仍该补上，所以只跳过这一个。
            logger.warning("重新生成分享包 PDF 失败（其余文件照常）id=%s：%s", package.id, exc)
        else:
            _write_atomically(directory / _PDF_FILE, artifact.content)
            restored.append(_PDF_FILE)
    if not (directory / _SNAPSHOT_FILE).is_file():
        _write_atomically(
            directory / _SNAPSHOT_FILE,
            json.dumps(package.snapshot, ensure_ascii=False, indent=2).encode("utf-8"),
        )
        restored.append(_SNAPSHOT_FILE)
    if not (directory / _MANIFEST_FILE).is_file():
        created_at = package.created_at.isoformat() if package.created_at else ""
        _write_atomically(
            directory / _MANIFEST_FILE,
            json.dumps(
                {
                    "share_token": package.share_token,
                    "permission": package.permission,
                    "title": package.title,
                    "created_at": created_at,
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8"),
        )
        restored.append(_MANIFEST_FILE)
    if restored:
        logger.info("已按快照重新生成分享包文件 id=%s files=%s", package.id, restored)
    return restored


def create_share_token() -> str:
    """生成本地离线 token（32 个十六进制字符，落在 ``share_token`` 的 64 长度内）。"""
    return secrets.token_hex(16)


def verify_share_token(package: SharePackage, token: str) -> bool:
    """校验 token 是否属于这份分享包（常数时间比较，防时序侧信道）。"""
    return bool(token) and secrets.compare_digest(package.share_token or "", token)


def _build_title(resume: dict) -> str:
    name = header_text(resume, "name") or "简历"
    timestamp = datetime.now().strftime("%Y%m%d%H%M")
    return f"{name}-分享包-{timestamp}"[:200]


def _file_entry(directory: Path, name: str, content: bytes, fmt: str) -> dict:
    """把一段字节写入目录并返回 ``files`` 里的条目。"""
    path = directory / name
    path.write_bytes(content)
    return {
        "name": name,
        "path": str(path),
        "format": fmt,
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _text_file_entry(directory: Path, name: str, content: str, fmt: str) -> dict:
    return _file_entry(directory, name, content.encode("utf-8"), fmt)


def _initial_comments_text(package: SharePackage) -> str:
    return (
        "# 评论回传\n\n"
        f"分享包：{package.title}\n"
        f"分享码：{package.share_token}\n\n"
        "请在下方写下你的评论，保存后把此文件交回给分享人。\n\n"
        "## 评论\n\n"
    )


def create_share_package(
    db: Session,
    *,
    resume_id: int,
    permission: str,
    redact_options: RedactionOptions | None = None,
    include_photo: bool = True,
) -> SharePackage:
    """生成一份分享包：脱敏 → 渲染 HTML/PDF → 写目录 → 记录文件清单与 token。"""
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        raise SharePackageError("简历不存在或已被删除", 404)
    if permission not in SHARE_PERMISSIONS:
        raise SharePackageError(f"无效的分享权限，可选值：{'、'.join(SHARE_PERMISSIONS)}", 422)

    resume, _conversion = document_io.document_for_record(db, record)
    options = redact_options or RedactionOptions()
    # 分享包与导出、脱敏预览复用同一套 v2 掩码规则。
    redacted_resume = redact_document(resume, options)
    # 快照与 export_json 同口径：不带照片 data URL，避免大字段与无意义的个人影像残留。
    snapshot = document_for_delivery(coerce_document(redacted_resume))

    template_name, template_html = resolve_style_template(db, record.template)
    context = RenderContext(
        template=template_name,
        template_html=template_html,
        style_config=resolve_style_config(db, record.template),
        page_limit=record.page_limit or DEFAULT_PAGE_LIMIT,
        font_scale=record.font_scale or DEFAULT_FONT_SCALE,
        format_config=record_format_config(db, record),
        # 同上：这个出口建包时也要带上语言，否则"重新建一个同样的包"会退回中文标题。
        language=record.language or DEFAULT_RESUME_LANGUAGE,
    )

    # 导出唯一复用 export_pipeline：HTML 与 PDF 都从这里出，不另写渲染逻辑。
    # ``include_photo`` 与导出接口同口径地透传（默认 True）。注意 HTML 渲染本身还不消费
    # 这个开关（只有 PDF/DOCX 消费），所以关掉照片时单独把 HTML 那份内容里的照片清空，
    # 保证「HTML 与 PDF 都不含照片」和界面上那句话一致。
    html_resume = (
        redacted_resume
        if include_photo
        else document_to_json(with_document_photo(coerce_document(redacted_resume), ""))
    )
    html_artifact = build_export(
        ExportRequest(format="html", include_photo=include_photo), html_resume, context
    )
    try:
        pdf_artifact = build_export(
            ExportRequest(format="pdf", include_photo=include_photo), redacted_resume, context
        )
    except ResumePDFError as exc:
        # 没有中文字体时无法直出 PDF，与导出接口给出一致的可读提示。
        raise SharePackageError(str(exc), 409) from exc

    package = SharePackage(
        title=_build_title(resume),
        resume_id=record.id,
        job_id=record.job_id,
        files=[],
        permission=permission,
        snapshot=snapshot,
        comments_file="",
        share_token=create_share_token(),
        redaction_config=asdict(options),
    )
    db.add(package)
    db.flush()  # 先拿到自增 id，目录用它命名。

    directory = package_directory(db.get_bind(), package.id)
    directory.mkdir(parents=True, exist_ok=True)

    manifest = {
        "share_token": package.share_token,
        "permission": permission,
        "title": package.title,
        "created_at": utcnow().isoformat(),
    }
    files = [
        # 分享版**只有这一份**带「由简历通生成」页脚（WF-18）：导出接口与分享包里的
        # resume.pdf 都不加 logo，所以注入点必须在这里而不是 export_pipeline。
        _file_entry(
            directory,
            _HTML_FILE,
            _with_share_footer(html_artifact.content, utcnow()),
            "html",
        ),
        _file_entry(directory, _PDF_FILE, pdf_artifact.content, "pdf"),
        _text_file_entry(
            directory,
            _SNAPSHOT_FILE,
            json.dumps(snapshot, ensure_ascii=False, indent=2),
            "json",
        ),
        _text_file_entry(
            directory,
            _MANIFEST_FILE,
            json.dumps(manifest, ensure_ascii=False, indent=2),
            "json",
        ),
    ]
    if permission == SHARE_PERMISSION_COMMENT:
        files.append(
            _text_file_entry(directory, _COMMENTS_FILE, _initial_comments_text(package), "markdown")
        )
        package.comments_file = str(directory / _COMMENTS_FILE)

    package.files = files
    db.commit()
    db.refresh(package)
    logger.info(
        "已生成分享包 id=%s resume_id=%s permission=%s",
        int(package.id),
        int(resume_id),
        safe_log_text(permission),
    )
    return package


def list_share_packages(db: Session, *, keyword: str = "", limit: int = 200) -> list[SharePackage]:
    """列出未软删除的分享包，最近的在前。"""
    query = db.query(SharePackage).filter(trash.live_only(SharePackage))
    if keyword.strip():
        query = query.filter(SharePackage.title.like(f"%{keyword.strip()}%"))
    return (
        query.order_by(SharePackage.created_at.desc(), SharePackage.id.desc())
        .limit(max(1, min(limit, MAX_SHARE_PACKAGE_LIST)))
        .all()
    )


def list_share_package_briefs(
    db: Session, *, keyword: str = "", limit: int = 200
) -> list[SharePackageBrief]:
    """分享包列表的响应视图（列表页与助手动作 ``list_share_packages`` 共用）。

    查询口径在 :func:`list_share_packages`，这里只补"行 -> ``SharePackageBrief``"的投影：
    两处各写一遍列表推导时，改一个字段（例如标题回落到文件名）就会只改到其中一处。
    """
    return [
        share_package_brief(item) for item in list_share_packages(db, keyword=keyword, limit=limit)
    ]


def share_package_or_none(db: Session, share_id: int) -> SharePackage | None:
    """取一条分享包；已在回收站里的当作不存在。"""
    return trash.get_live(db, SharePackage, share_id)


def read_comments(package: SharePackage) -> ShareCommentsOut:
    """读取评论回传文件；没有（或文件缺失）时返回空内容。"""
    if not package.comments_file:
        return ShareCommentsOut(filename=_COMMENTS_FILE, format="markdown", content="")
    path = Path(package.comments_file)
    if not path.exists() or not path.is_file():
        return ShareCommentsOut(filename=path.name, format="markdown", content="")
    content = path.read_text(encoding="utf-8")
    fmt = "json" if path.suffix.lower() == ".json" else "markdown"
    return ShareCommentsOut(filename=path.name, format=fmt, content=content)


def import_comments(
    db: Session, package: SharePackage, *, content: str, format: str
) -> ShareCommentsOut:
    """把收件人回传的评论写回分享包目录，并更新 ``comments_file`` 与文件清单。"""
    if format == "json":
        try:
            json.loads(content)
        except json.JSONDecodeError as exc:
            raise SharePackageError("评论内容不是有效的 JSON", 422) from exc
        filename = "comments.json"
    else:
        filename = _COMMENTS_FILE

    directory = package_directory(db.get_bind(), package.id)
    directory.mkdir(parents=True, exist_ok=True)

    files = [
        item
        for item in (package.files or [])
        if not str(item.get("name", "")).startswith("comments.")
    ]
    files.append(
        _text_file_entry(directory, filename, content, "json" if format == "json" else "markdown")
    )
    package.files = files
    package.comments_file = str(directory / filename)
    db.commit()
    db.refresh(package)
    logger.info("已导入评论分享包 id=%s format=%s", int(package.id), safe_log_text(format))
    return read_comments(package)


__all__ = [
    "MAX_SHARE_PACKAGE_LIST",
    "SHARE_PACKAGES_DIR",
    "SharePackageError",
    "create_share_package",
    "create_share_token",
    "ensure_package_files",
    "import_comments",
    "list_share_package_briefs",
    "list_share_packages",
    "package_directory",
    "read_comments",
    "share_package_brief",
    "share_package_or_none",
    "share_package_out",
    "share_root",
    "verify_share_token",
]
