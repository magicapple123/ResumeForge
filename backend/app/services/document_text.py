# SPDX-License-Identifier: Apache-2.0
"""从上传的文档里在本机提取文字（PDF、DOCX）。

为什么不是把文件交给模型：项目只支持 OpenAI Chat Completions 兼容协议，多数服务商
不接受 PDF 入参，多模态能力也参差不齐。本地提取换来三件事——离线可用（未配置模型时
本地规则仍能解析这些文字）、不把原始文件发给第三方、以及识别结果可以走**真正的原文
锚定**（见 ``text_extraction._anchor_text``：图片只能靠模型自己抄录一遍再对照，天然更弱）。

**扫描页例外（T03）**：PDF 里没有文字层的页（< 30 字符判为图片页）提取不出文字，
会把整页渲染成位图、作为图片附件发给所配置的模型服务商识别——与用户手动上传的
截图**同路径、同预算**（``attachments.MAX_ATTACHMENTS_TOTAL_BYTES``）。这是"扫描件
可识别"能力的必要条件，主理人已确认该语义；界面不单独弹窗，但警告文案会明确写
"已按图片识别"。纯文字 PDF 的行为与此前完全一致，仍不发出任何原始文件。

解析的是不可信输入，所以每条限制都有理由：页数、字符数、体积都封顶，PDF 走 pypdf，
DOCX 只读白名单成员，绝不 ``extractall``。任何解析失败都转成面向用户的中文提示。
"""

from __future__ import annotations

import io
import logging
import zipfile
from collections.abc import Sequence
from typing import Any, NamedTuple
from xml.etree import ElementTree

from pypdf import PdfReader

from .attachments import (
    DOCX_MIME,
    MAX_ATTACHMENTS_TOTAL_BYTES,
    document_source,
)
from .pdf_page_images import (
    MAX_PDF_IMAGE_PAGES,
    page_image_data_url,
    render_pdf_page_images,
)
from .resume.resume_rich_text import strip_markers

logger = logging.getLogger(__name__)

# 一份文档最多读多少页。简历和招聘信息没有超过这个数的正当理由，而页数直接决定
# 解析耗时。
MAX_PDF_PAGES = 30
# 单页字符数低于该阈值判为"图片页"（扫描页）：正常文本页哪怕只有几行也远超这个数，
# 而扫描页经 OCR 侧的提取通常只给出空串或页码水印。超过 MAX_PDF_PAGES 的部分本就
# 不参与解析，图片页判定只覆盖前 MAX_PDF_PAGES 页。
IMAGE_PAGE_MIN_CHARS = 30
# 一次识别里所有文档提取出的纯文字上限（不是每份文档各一份）。超过后截断并明确告知
# 用户，不做静默丢弃。
#
# 20,000 而不是跟粘贴文本一样的 100,000：这段文字要过一遍本地规则解析，而解析在
# **单行超长文本**上是平方级（实测 30,000 字单行要 9 秒，20,000 字 4 秒；正常多行
# 文本 35,000 字只要 0.13 秒）。一份简历或招聘信息的正文远用不到 20,000 字，
# 把上限留在这个量级可以避免一次上传让请求卡住十几秒。
MAX_DOCUMENT_TEXT_CHARS = 20_000

_DOCX_DOCUMENT_XML = "word/document.xml"
_DOCX_WORD_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

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


def _pdf_text(raw: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(raw))
        # 空密码是某些导出工具的常见情况，能打开就不该拦。
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("文件有密码保护，请先解除限制后再上传")
        pages = reader.pages[:MAX_PDF_PAGES]
        return "\n".join(page.extract_text() or "" for page in pages)
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001 - 第三方解析器抛出的异常类型不固定
        logger.warning("PDF 文字提取失败：%s", type(exc).__name__)
        raise ValueError("文件无法解析，可能已损坏或不是真正的 PDF") from exc


def _pdf_page_texts(raw: bytes) -> list[str]:
    """逐页提取 PDF 文字（最多前 ``MAX_PDF_PAGES`` 页）；失败转成用户可读的 ``ValueError``。"""
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("文件有密码保护，请先解除限制后再上传")
        return [page.extract_text() or "" for page in reader.pages[:MAX_PDF_PAGES]]
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001 - 第三方解析器抛出的异常类型不固定
        logger.warning("PDF 文字提取失败：%s", type(exc).__name__)
        raise ValueError("文件无法解析，可能已损坏或不是真正的 PDF") from exc


def _pdf_extract_with_images(
    raw: bytes, image_budget_bytes: int
) -> tuple[str, list[tuple[str, int]], list[str]]:
    """PDF 逐页提取：文本页贡献文字，图片页（扫描页）渲染成位图走图片识别。

    ``image_budget_bytes`` 是本次请求剩余的附件体积预算：渲染出的页超出预算时
    **按页跳过并警告**，不做静默丢弃。渲染整体失败时回退为纯文字行为（没有文字
    则由调用方按原有的空文本报错处理）。

    返回 ``(文字, [(图片 data URL, 字节数)], 警告)``。
    """
    page_texts = _pdf_page_texts(raw)
    image_page_numbers = [
        number
        for number, text in enumerate(page_texts, start=1)
        if len(text.strip()) < IMAGE_PAGE_MIN_CHARS
    ]
    image_page_set = set(image_page_numbers)
    text = "\n".join(
        page_text
        for number, page_text in enumerate(page_texts, start=1)
        if number not in image_page_set
    )

    warnings: list[str] = []
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


def _docx_text(raw: bytes) -> str:
    try:
        # 只读白名单成员，不走 extractall：docx 是 zip，解压路径由上传者控制。
        with (
            zipfile.ZipFile(io.BytesIO(raw)) as archive,
            archive.open(_DOCX_DOCUMENT_XML) as stream,
        ):
            tree = ElementTree.parse(stream)
    except KeyError as exc:
        raise ValueError("文件不是有效的 docx（缺少正文），请另存为 .docx 后重新上传") from exc
    except (zipfile.BadZipFile, ElementTree.ParseError, OSError) as exc:
        raise ValueError("文件无法解析，可能已损坏或不是真正的 DOCX") from exc

    paragraphs: list[str] = []
    for paragraph_element in tree.iter(f"{_DOCX_WORD_NAMESPACE}p"):
        # 表格单元格里也是 w:p，所以按文档顺序遍历段落就能同时覆盖正文与表格。
        text = "".join(
            node.text or "" for node in paragraph_element.iter(f"{_DOCX_WORD_NAMESPACE}t")
        )
        if text.strip():
            paragraphs.append(text.strip())
    return "\n".join(paragraphs)


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


def extract_documents_text(documents: Sequence[Any]) -> ExtractedDocuments:
    """把若干份文档提取成一段可解析文本，供岗位/资料识别使用。

    **不插入任何来源标记**：这段文字要和粘贴文本一样喂给本地规则，而规则会把开头的
    孤行当作正文——`[文档：jd.docx]` 这样的标记会直接混进岗位描述。文件来源在界面上
    本来就看得见（附件会以文件形式列出），不值得为此污染解析结果。

    所有文档都会被校验，即使前面的文档已经用完了字符预算——否则一份损坏的文件会因为
    排在后面而被静默忽略。

    PDF 的扫描页会渲染成图片（见 ``_pdf_extract_with_images``）：图片字节数计入
    ``size_bytes``，最终由调用方的 ``assert_attachment_budget`` 一并把关；渲染端用
    ``MAX_ATTACHMENTS_TOTAL_BYTES`` 减去已累计的文档字节做逐页预算，超出的页跳过并
    警告，绝不静默丢弃。
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
                raw, MAX_ATTACHMENTS_TOTAL_BYTES - total_bytes
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
_UNSUPPORTED_PREVIEW_MESSAGE = (
    "这种格式暂不支持在线预览；请用「打开所在文件夹」用系统程序查看。"
)


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
