# SPDX-License-Identifier: Apache-2.0
"""从上传的文档里在本机提取文字（PDF、DOCX）。

为什么不是把文件交给模型：项目只支持 OpenAI Chat Completions 兼容协议，多数服务商
不接受 PDF 入参，多模态能力也参差不齐。本地提取换来三件事——离线可用（未配置模型时
本地规则仍能解析这些文字）、不把原始文件发给第三方、以及识别结果可以走**真正的原文
锚定**（见 ``text_extraction._anchor_text``：图片只能靠模型自己抄录一遍再对照，天然更弱）。

**扫描页例外（T03）**：PDF 里没有文字层的页（< 30 字符判为图片页）提取不出文字，
按"识别引擎"设置走两条路之一（默认 ``auto``）：

- 配了 DeepSeek Key → 扫描页发给 **DeepSeek OCR**，按页计费，返回逐页文本；
- 没配 Key、或把引擎设为"只用视觉模型" → 整页渲染成位图，作为图片附件发给**用户
  自己配置的模型服务商**识别——与用户手动上传的截图同路径、同预算
  （``attachments.MAX_ATTACHMENTS_TOTAL_BYTES``）。

两条路都是"把原件发给第三方"，所以警告文案必须如实写明是**哪一家**、是否计费（见
``ocr.policy`` 的 ``OCR_USED_WARNING`` 与 ``pdf_page_images`` 的说明）。纯文字 PDF
的行为与此前完全一致，仍不发出任何原始文件。

解析的是不可信输入，所以每条限制都有理由：页数、字符数、体积都封顶，PDF 走 pypdf，
DOCX 只读白名单成员，绝不 ``extractall``。任何解析失败都转成面向用户的中文提示。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any, NamedTuple

from .attachments import (
    DOCX_MIME,
    MAX_ATTACHMENTS_TOTAL_BYTES,
    document_source,
)
from .document_text_parse import _docx_text, _pdf_page_split, _pdf_page_texts, _pdf_text
from .ocr.client import OcrError
from .ocr.policy import OcrContext
from .ocr.scan import extract_scan_pages, user_message_for
from .pdf_page_images import (
    MAX_PDF_IMAGE_PAGES,
    page_image_data_url,
    render_pdf_page_images,
)
from .resume.resume_rich_text import strip_markers

logger = logging.getLogger(__name__)

# 一次识别里所有文档提取出的纯文字上限（不是每份文档各一份）。超过后截断并明确告知
# 用户，不做静默丢弃。
#
# 20,000 而不是跟粘贴文本一样的 100,000：这段文字要过一遍本地规则解析，而解析在
# **单行超长文本**上是平方级（实测 30,000 字单行要 9 秒，20,000 字 4 秒；正常多行
# 文本 35,000 字只要 0.13 秒）。一份简历或招聘信息的正文远用不到 20,000 字，
# 把上限留在这个量级可以避免一次上传让请求卡住十几秒。
MAX_DOCUMENT_TEXT_CHARS = 20_000

_TRUNCATED_WARNING = "文档内容较长，本次只识别了前一部分；其余内容请复制为文本粘贴。"
_EMPTY_TEXT_MESSAGE = (
    "没有从这份文件里提取到文字，可能是扫描件或纯图片文件；请改用截图上传，截图会走图片识别。"
)
# 扫描页（图片页）相关的警告：区分"部分页是扫描页"与"整份没有文字层"两种形态。
_PURE_IMAGE_PDF_WARNING = "整份 PDF 无文字层，已逐页按图片识别。"
_MIXED_SCAN_PDF_WARNING = "第 {page} 页起为扫描页，已按图片识别。"
_SCAN_PAGES_TRUNCATED_WARNING = "PDF 有 {total} 页扫描内容，为控制体积只识别前 {limit} 页的扫描页。"
_SCAN_PAGE_OVER_BUDGET_WARNING = (
    "第 {page} 页的扫描内容超出附件体积预算，已跳过；需要识别这一页请改用截图上传。"
)
_SCAN_RENDER_FAILED_WARNING = "这份 PDF 的扫描页渲染失败，扫描内容没有被识别；请改用截图上传。"


class ExtractedDocument(NamedTuple):
    """一份文档的提取结果。``size_bytes`` 是**原始文件**大小，供体积预算使用。"""

    name: str
    mime_type: str
    size_bytes: int
    text: str
    warnings: list[str]


class ExtractedDocuments(NamedTuple):
    text: str
    warnings: list[str]
    size_bytes: int
    """原始文件字节与**渲染出的扫描页图片字节**之和，供附件体积预算使用。"""
    images: tuple[str, ...] = ()
    """扫描页渲染出的图片 data URL（JPEG）；纯文字文档为空。"""


def _truncate(text: str) -> tuple[str, list[str]]:
    if len(text) <= MAX_DOCUMENT_TEXT_CHARS:
        return text, []
    return text[:MAX_DOCUMENT_TEXT_CHARS], [_TRUNCATED_WARNING]


def _pdf_extract_with_images(
    raw: bytes,
    image_budget_bytes: int,
    page_texts: list[str] | None = None,
    ocr: OcrContext | None = None,
    filename: str = "document.pdf",
) -> tuple[str, list[tuple[str, int]], list[str]]:
    """PDF 逐页提取：文本页贡献文字，图片页（扫描页）交给 OCR 或视觉模型。

    ``ocr`` 非空且允许时，扫描页先走 DeepSeek OCR（一次请求拿回逐页文本，不受
    "最多 8 页 / 5 MB"的位图预算限制）；OCR 成功就不再渲染位图——同一份内容不该
    付两次钱。只有 OCR 未启用或失败时，才回落到渲染位图的老路。

    ``image_budget_bytes`` 是本次请求剩余的附件体积预算：渲染出的页超出预算时
    **按页跳过并警告**，不做静默丢弃。渲染整体失败时回退为纯文字行为（没有文字
    则由调用方按原有的空文本报错处理）。

    ``page_texts`` 允许调用方把已经解析好的逐页文本传进来，避免同一份 PDF 解析两遍。

    返回 ``(文字, [(图片 data URL, 字节数)], 警告)``。
    """
    if page_texts is None:
        page_texts = _pdf_page_texts(raw)
    text, image_page_numbers = _pdf_page_split(page_texts)

    warnings: list[str] = []
    if image_page_numbers and ocr is not None:
        try:
            outcome = extract_scan_pages(
                raw,
                page_texts,
                ocr,
                filename=filename,
                page_count=len(page_texts),
            )
        except OcrError as exc:
            # engine=ocr：用户明确选了只用 OCR，失败就必须说清原因，不能偷偷换服务商。
            raise ValueError(user_message_for(exc)) from exc
        if outcome is not None and outcome.ok:
            # OCR 已完成逐页替换（含文字层页的原有文本），不需要再发任何位图。
            return outcome.text, [], [*outcome.warnings]
        if outcome is not None:
            warnings.extend(outcome.warnings)

    if image_page_numbers:
        if not text.strip():
            warnings.append(_PURE_IMAGE_PDF_WARNING)
        else:
            warnings.append(_MIXED_SCAN_PDF_WARNING.format(page=image_page_numbers[0]))
        if len(image_page_numbers) > MAX_PDF_IMAGE_PAGES:
            warnings.append(
                _SCAN_PAGES_TRUNCATED_WARNING.format(
                    total=len(image_page_numbers), limit=MAX_PDF_IMAGE_PAGES
                )
            )

    rendered: list[tuple[str, int]] = []
    if image_page_numbers:
        try:
            jpeg_pages = render_pdf_page_images(raw, image_page_numbers[:MAX_PDF_IMAGE_PAGES])
        except Exception as exc:  # noqa: BLE001 - 渲染库抛出的异常类型不固定
            logger.warning("PDF 扫描页渲染失败：%s", type(exc).__name__)
            jpeg_pages = []
            warnings.append(_SCAN_RENDER_FAILED_WARNING)
        used = 0
        for page_number, jpeg in jpeg_pages:
            if used + len(jpeg) > image_budget_bytes:
                warnings.append(_SCAN_PAGE_OVER_BUDGET_WARNING.format(page=page_number))
                continue
            used += len(jpeg)
            rendered.append((page_image_data_url(jpeg), len(jpeg)))
    return text, rendered, warnings


def extract_document_text(name: str, mime_type: str, data: str) -> ExtractedDocument:
    """校验并提取一份文档的文字。

    校验失败抛出面向用户的 ``ValueError``；提取不到文字也算失败——传一份空文档给模型
    只会换来一段基于臆测的识别结果。
    """
    safe_name, canonical_mime, raw = document_source(name, mime_type, data)
    extracted = _docx_text(raw) if canonical_mime == DOCX_MIME else _pdf_text(raw)
    text = extracted.strip()
    if not text:
        raise ValueError(f"附件“{safe_name}”：{_EMPTY_TEXT_MESSAGE}")
    body, warnings = _truncate(strip_markers(text))
    return ExtractedDocument(
        name=safe_name,
        mime_type=canonical_mime,
        size_bytes=len(raw),
        text=body,
        warnings=warnings,
    )


def extract_documents_text(
    documents: Sequence[Any], ocr: OcrContext | None = None
) -> ExtractedDocuments:
    """把若干份文档提取成一段可解析文本，供岗位/资料识别使用。

    **不插入任何来源标记**：这段文字要和粘贴文本一样喂给本地规则，而规则会把开头的
    孤行当作正文——`[文档：jd.docx]` 这样的标记会直接混进岗位描述。文件来源在界面上
    本来就看得见（附件会以文件形式列出），不值得为此污染解析结果。

    所有文档都会被校验，即使前面的文档已经用完了字符预算——否则一份损坏的文件会因为
    排在后面而被静默忽略。

    PDF 的扫描页优先走 OCR（见 ``_pdf_extract_with_images``）：识别出的文字直接并进
    ``text``，因此扫描件也能享受与文本页**同一套原文锚定**。``ocr`` 为空或未启用时
    保持改造前的行为——渲染位图，字节数计入 ``size_bytes``，由调用方的
    ``assert_attachment_budget`` 一并把关。
    """
    blocks: list[str] = []
    warnings: list[str] = []
    images: list[str] = []
    total_bytes = 0
    remaining = MAX_DOCUMENT_TEXT_CHARS
    for document in documents:
        safe_name, canonical_mime, raw = document_source(
            document.name, document.mime_type, document.data
        )
        total_bytes += len(raw)
        doc_images: list[tuple[str, int]] = []
        if canonical_mime == DOCX_MIME:
            text = _docx_text(raw).strip()
            if not text:
                raise ValueError(f"附件“{safe_name}”：{_EMPTY_TEXT_MESSAGE}")
            body, doc_warnings = _truncate(text)
        else:
            text, doc_images, doc_warnings = _pdf_extract_with_images(
                raw,
                MAX_ATTACHMENTS_TOTAL_BYTES - total_bytes,
                ocr=ocr,
                filename=safe_name,
            )
            # 渲染成功时纯图片 PDF 也能识别（文字为空但图片非空）；两者皆空才报错，
            # 与此前的"提取不到文字就算失败"语义对齐。
            if not text.strip() and not doc_images:
                raise ValueError(f"附件“{safe_name}”：{_EMPTY_TEXT_MESSAGE}")
            body, truncate_warning = _truncate(text.strip())
            if truncate_warning:
                doc_warnings = [*doc_warnings, *truncate_warning]
        warnings.extend(doc_warnings)
        for image_data_url, image_bytes in doc_images:
            images.append(image_data_url)
            total_bytes += image_bytes
        if len(body) > remaining:
            body = body[:remaining].rstrip()
            warnings.append(_TRUNCATED_WARNING)
        remaining -= len(body)
        blocks.append(body)
    return ExtractedDocuments(
        # 提取出的文字会被当成**纯文本**喂给本地规则与模型：文档里的 `**加粗**`
        # 是排版标记，不该留在解析输入里（否则关键词、日期、字数都跟着偏）。
        text="\n\n".join(strip_markers(block) for block in blocks),
        warnings=list(dict.fromkeys(warnings)),
        size_bytes=total_bytes,
        images=tuple(images),
    )


# 「我的文件」里能直接当文本看的扩展名：这些没有解析成本，读出来即可。
_PLAIN_TEXT_SUFFIXES = frozenset(
    {"txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "xml", "html", "htm"}
)
_UNSUPPORTED_PREVIEW_MESSAGE = "这种格式暂不支持在线预览；请用「打开所在文件夹」用系统程序查看。"


def _decode_plain_text(raw: bytes) -> str:
    """按 UTF-8 解码，失败退回 GB18030（中文 Windows 上的记事本 / Excel 常见）。

    不用 ``errors="replace"`` 直接糊过去：那会把 GBK 文件解成一屏乱码，用户以为文件坏了。
    两种都失败才用 replace 兜底，至少还能看到一部分。
    """
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


# 面试材料导入（#41，问题 6）接受的**文本类**文件：两侧统一，解析路径由扩展名决定，
# ``kind`` 只表示"放哪一侧"（界面左右栏），不再决定收什么格式。
# 图片不走这里（图片识别在 ``services/interview/interview_material.py``）。
MATERIAL_TEXT_SUFFIXES = frozenset({"pdf", "txt", "md", "markdown", "docx"})
# 单份材料文件上限：10 MB（**面试材料那一档**）。JD 与简历都在这个量级以内。
MAX_MATERIAL_FILE_BYTES = 10 * 1024 * 1024
# 资料箱那一档的上限：50 MB。**两档刻意不同**——面试材料是"当场读一遍就进对话"，
# 资料箱是"存起来以后还能取用"，而扫描件体积主要来自位图（一页 300dpi 彩色 300–800 KB）。
# 上限值本身住在 `api/materials.py`（端点校验），这里只提供解析层要认的那个数，
# 两处必须同源，否则会出现"传输通过了、解析层又按 10 MB 顶回来"（T02 返工 1 的成因）。
MAX_LOOSE_MATERIAL_BYTES = 50 * 1024 * 1024
# 文字层少于这个字数就按"扫描件"处理：渲染前 8 页走图片识别。
# 正常带文字层的 JD / 简历哪怕只有几行也远超 200 字，而扫描件经 pypdf 只能拿到空串
# 或页码水印。阈值写死是为了让**正常 PDF 不会每次都多花一次模型调用**——
# 有文字层的文件永远走不到视觉分支，未配置模型也照常可用。
MATERIAL_SCAN_TEXT_THRESHOLD = 200


def material_too_large_message(limit_bytes: int) -> str:
    """体积超限的用户文案。按**实际生效的上限**生成：两档上限不同，写死 10 MB 会撒谎。"""
    return f"文件超过 {limit_bytes // (1024 * 1024)} MB，无法导入"


_MATERIAL_TOO_LARGE = material_too_large_message(MAX_MATERIAL_FILE_BYTES)
# 两侧共用同一句：类型不再按侧别区分，写死"岗位材料 / 简历截图"会撒谎。
MATERIAL_UNSUPPORTED = "这份文件不支持导入，可换成图片 / PDF / TXT / Word / Markdown"
MATERIAL_LEGACY_DOC = "Word 2003 的 .doc 格式读不了，另存为 .docx 后再导入"
_MATERIAL_NO_TEXT = "这份文件没有可提取的文字，可能是扫描件"
_MATERIAL_DOCX_NO_TEXT = "这份 Word 里没有可提取的文字"
_MATERIAL_EMPTY_FILE = "文件是空的"
# 文本类与图片类共用同一句截断警告（上限已拉平到同一个数，见 MAX_DOCUMENT_TEXT_CHARS）。
MATERIAL_TRUNCATED_WARNING = "内容较长，本次只读取了前一部分"

# 扫描件 PDF 在资料箱里**不做视觉识别**（视觉识别是面试材料链路的预算与语义）：
# 提取不到文字就如实给一条警告，用户仍可用「另存为」保存原件。
MATERIAL_SCAN_NO_VISION_WARNING = (
    "这份 PDF 没有可提取的文字层（疑似扫描件）；资料箱不做图片识别，"
    "仍可用「另存为」保存原件，需要识别文字请用面试材料导入。"
)


class MaterialText(NamedTuple):
    """一份面试材料的本地提取结果。

    ``images`` 非空表示这是**扫描件 PDF**：文字层几乎空白，需要调用方拿这些页面走一次
    视觉识别。``scan_warnings`` 只在那件事真的做成之后才成立，所以与 ``warnings`` 分开
    存——识别失败时不能对用户说"已按图片识别"。

    ``parser`` 记录正文是**怎么来的**：``text`` 本机文字层、``ocr`` DeepSeek OCR、
    ``vision`` 视觉模型（由调用方在识别后改写）。界面按它决定是否提示"已发往第三方"。
    """

    text: str
    warnings: list[str]
    images: tuple[str, ...] = ()
    scan_warnings: tuple[str, ...] = ()
    parser: str = "text"


def material_suffix(name: str) -> str:
    """材料文件的扩展名（小写、带点）；无扩展名返回空串。"""
    base = (name or "").strip().rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return f".{base.rsplit('.', 1)[-1].lower()}" if "." in base else ""


def _truncate_material(text: str) -> tuple[str, list[str]]:
    if len(text) <= MAX_DOCUMENT_TEXT_CHARS:
        return text, []
    return text[:MAX_DOCUMENT_TEXT_CHARS], [MATERIAL_TRUNCATED_WARNING]


def _extract_pdf_material(
    raw: bytes,
    render_scan_pages: bool = True,
    ocr: OcrContext | None = None,
    filename: str = "material.pdf",
) -> MaterialText:
    """PDF 材料：文字层够用就只返回文字，几乎空白且存在扫描页才交给 OCR 或位图。

    ``ocr`` 非空且允许时先走 DeepSeek OCR：识别成功就直接拿到整份正文（不再需要
    调用方做视觉识别），资料箱那种"明确不做视觉识别"的调用方也因此能读到扫描件。

    ``render_scan_pages=False`` 时**不渲染扫描页**（资料箱附件链路：不做视觉识别）：
    返回已经提取到的文字（可能为空）+ 一条常驻警告，由调用方决定怎么呈现。
    """
    page_texts = _pdf_page_texts(raw)
    layer, image_pages = _pdf_page_split(page_texts)
    body = layer.strip()
    if not image_pages or len(body) >= MATERIAL_SCAN_TEXT_THRESHOLD:
        if not body:
            raise ValueError(_MATERIAL_NO_TEXT)
        truncated, warnings = _truncate_material(body)
        return MaterialText(truncated, warnings)
    if ocr is not None:
        try:
            outcome = extract_scan_pages(
                raw, page_texts, ocr, filename=filename, page_count=len(page_texts)
            )
        except OcrError as exc:
            raise ValueError(user_message_for(exc)) from exc
        if outcome is not None and outcome.ok:
            truncated, warnings = _truncate_material(outcome.text)
            return MaterialText(
                truncated, [*warnings, *outcome.warnings], parser="ocr"
            )
    if not render_scan_pages:
        # 扫描件但没有视觉识别：不能假装提取成功，也不能把空文本当失败（原件仍可另存为）。
        truncated, warnings = _truncate_material(body)
        return MaterialText(truncated, [MATERIAL_SCAN_NO_VISION_WARNING, *warnings])

    # 文字层几乎空白 + 存在扫描页：渲染（复用已解析的逐页文本，不再二次解析 PDF）。
    _, rendered, scan_warnings = _pdf_extract_with_images(
        raw, MAX_ATTACHMENTS_TOTAL_BYTES, page_texts
    )
    images = tuple(data_url for data_url, _ in rendered)
    truncated, warnings = _truncate_material(body)
    if not images:
        # 渲染失败 / 附件体积不够：只能退回文字层，一句都没有就是失败。
        if not body:
            raise ValueError(_MATERIAL_NO_TEXT)
        # 既然没真的识别过，就不能留下"已按图片识别"这类说法（渲染失败、预算不足的
        # 告警仍然有用，必须留着）。
        kept = [item for item in scan_warnings if "按图片识别" not in item]
        return MaterialText(truncated, [*warnings, *kept])
    return MaterialText(truncated, warnings, images, tuple(scan_warnings))


def extract_material_text(
    name: str,
    raw: bytes,
    *,
    render_scan_pages: bool = True,
    ocr: OcrContext | None = None,
    max_bytes: int | None = None,
) -> MaterialText:
    """把用户导入的材料文件（PDF / TXT / Markdown / Word）提取成纯文本。

    与 :func:`preview_text_of_file` 的区别是**用途不同所以口径不同**：这里是"用户主动
    上传的一份新材料"，所以要卡体积（默认 10 MB，资料箱档通过 ``max_bytes`` 放宽到
    50 MB）、只认上面那组扩展名、并且把"没提到文字"说成"可能是扫描件"——那是用户
    真正需要知道的事。

    ``.doc``（Word 2003 二进制格式）单独给一句"另存为 .docx"：读不了就不假装能读。

    ``render_scan_pages=False`` 供**不做视觉识别**的调用方使用（资料箱附件）：扫描页
    不渲染、不抛"没文字"失败，而是返回空文本 + 常驻警告，让用户仍能另存为原件。
    默认 ``True`` 保持面试材料链路的既有行为不变。

    ``max_bytes`` 缺省取 :data:`MAX_MATERIAL_FILE_BYTES`（10 MB）。资料箱传
    :data:`MAX_LOOSE_MATERIAL_BYTES`（50 MB）——**上限必须由调用方显式传入**，
    否则会出现"端点放行 50 MB、解析层仍按 10 MB 拒绝"的错配。

    失败一律抛 ``ValueError``，文案是面向用户的**原因**（动作由前端补）。
    """
    limit = MAX_MATERIAL_FILE_BYTES if max_bytes is None else max_bytes
    suffix = material_suffix(name)
    if suffix == ".doc":
        raise ValueError(MATERIAL_LEGACY_DOC)
    if suffix.lstrip(".") not in MATERIAL_TEXT_SUFFIXES:
        raise ValueError(MATERIAL_UNSUPPORTED)
    if not raw:
        raise ValueError(_MATERIAL_EMPTY_FILE)
    if len(raw) > limit:
        raise ValueError(material_too_large_message(limit))

    if suffix == ".pdf":
        return _extract_pdf_material(raw, render_scan_pages=render_scan_pages, ocr=ocr, filename=name)

    if suffix == ".docx":
        body = strip_markers(_docx_text(raw)).strip()
        if not body:
            raise ValueError(_MATERIAL_DOCX_NO_TEXT)
        truncated, warnings = _truncate_material(body)
        return MaterialText(truncated, warnings)

    # .txt / .md / .markdown：Markdown 的标记（`#`、表格、代码围栏）**原样保留**——
    # 本机提取不做渲染，而 JD 常常就是 md 原文；TXT 仍按既有口径剥掉 `**加粗**`
    # 与链接 URL（那不是纯文本里的可见字符）。
    text = _decode_plain_text(raw)
    body = (text if suffix in {".md", ".markdown"} else strip_markers(text)).strip()
    if not body:
        raise ValueError(_MATERIAL_NO_TEXT)
    truncated, warnings = _truncate_material(body)
    return MaterialText(truncated, warnings)


def preview_text_of_file(name: str, mime_type: str, raw: bytes) -> tuple[str, list[str]]:
    """把**本机副本**渲染成可读文本，供「我的文件」的预览抽屉使用。

    与 :func:`extract_document_text` 的区别只有两点，都是"预览"这个用途决定的：

    1. **不做 2 MB 附件体积校验**——副本目录里存的是用户真实文件（PDF 十几 MB 很常见），
       按上传预算拦下来会让最该预览的文件恰好打不开；
    2. 支持纯文本类扩展名（txt / md / csv / json…），它们没有解析成本。

    格式不认识就抛出面向用户的 ``ValueError``，由调用方转成 400。
    """
    suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    declared = mime_type.split(";", 1)[0].strip().lower()

    if suffix == "docx" or declared == DOCX_MIME:
        text = _docx_text(raw)
    elif suffix == "pdf" or declared == "application/pdf":
        text = _pdf_text(raw)
    elif suffix in _PLAIN_TEXT_SUFFIXES or declared.startswith("text/"):
        text = _decode_plain_text(raw)
    else:
        raise ValueError(_UNSUPPORTED_PREVIEW_MESSAGE)

    body = strip_markers(text).strip()
    if not body:
        raise ValueError(_EMPTY_TEXT_MESSAGE)
    truncated, warnings = _truncate(body)
    return truncated, list(warnings)
