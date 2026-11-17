# SPDX-License-Identifier: Apache-2.0
"""把 OCR 接进既有的文档/图片提取链路（``document_text`` 与识别接口调用这里）。

分工：
- :mod:`client` 只负责 HTTP；:mod:`policy` 只负责"该不该用 OCR"；
- 本模块负责**合并**：PDF 的文字层页照旧走 pypdf（免费、离线、锚定更硬），
  只有无文字层的扫描页换成 OCR 文本，并按页序拼回一份完整正文；
- OCR 成功时**不再**把同一批页渲染成位图发给视觉模型——同一份内容付两次钱。

页序很重要：字段锚定要把识别结果对回原文，乱序拼接会让锚定整体失效。所以这里
按"页码 → 文本"逐页合并，而不是把两段文本简单相加。
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from ..attachments import decode_data_url
from ..document_text_parse import IMAGE_PAGE_MIN_CHARS
from .client import OcrError, OcrPage, OcrResult, recognize_document
from .policy import (
    OCR_EMPTY_PAGES_WARNING,
    OCR_FAILED_FALLBACK_WARNING,
    OCR_IMAGE_FAILED_WARNING,
    OCR_IMAGES_USED_WARNING,
    OCR_PAGE_TRUNCATED_WARNING,
    OCR_PARTIAL_WARNING,
    OCR_USED_WARNING,
    OcrContext,
)

logger = logging.getLogger(__name__)

# OCR 单张图片的体积上限（与 client 的 100 MiB 一致，这里只用于提前短路）。
_IMAGE_MIME_FALLBACK = "image/jpeg"

# 原因码 → 面向用户的一句话（只写**原因**，动作由前端 errorGuidance 补）。
_OCR_ERROR_MESSAGES: dict[str, str] = {
    "missing_key": "识别引擎设为只用 OCR，但没有配置 DeepSeek API Key",
    "bad_purpose": "OCR 识别模式参数无效",
    "empty_file": "文件是空的",
    "unauthorized": "DeepSeek API Key 无效（401）",
    "forbidden": "DeepSeek 拒绝了这次识别（403）",
    "insufficient_balance": "DeepSeek 账户余额不足（402）",
    "file_too_large": "文件超过 OCR 的 100 MiB 上限",
    "too_many_pages": "文档超过 OCR 的 1000 页上限",
    "password_protected": "这份 PDF 有密码保护，OCR 读不了",
    "unparsable": "OCR 无法解析这个文件（格式不支持或已损坏）",
    "upload_timeout": "上传太慢，OCR 已放弃（服务端要求 120 秒内传完）",
    "timeout": "OCR 识别超时（服务端上限 180 秒）",
    "service_busy": "OCR 服务繁忙",
    "too_many_recognitions": "同时进行的 OCR 识别太多（账号上限 15 个）",
    "submit_failed": "OCR 文件提交失败",
    "network": "OCR 服务无法连接",
    "bad_json": "OCR 返回了无法解析的内容",
    "bad_image": "图片无法解码",
    "empty_result": "OCR 没有识别出任何文字",
}


def user_message_for(exc: OcrError) -> str:
    """把原因码翻成一句中文原因；未知原因退回 "OCR 识别失败" + 原始 detail。"""
    message = _OCR_ERROR_MESSAGES.get(exc.code)
    if message:
        if exc.code == "network":
            # T04：代理在用就提代理——同一次断网，不要"模型页说代理、识别页只说网络"。
            from .. import net_proxy

            return f"{message}{net_proxy.proxy_note()}"
        return message
    suffix = f"（{exc.detail}）" if exc.detail else ""
    return f"OCR 识别失败{suffix}"


@dataclass(frozen=True)
class ScanOutcome:
    """一次"扫描页换 OCR"的结果。``ok=False`` 表示尝试过但失败，调用方应回落位图。"""

    text: str = ""
    warnings: tuple[str, ...] = ()
    pages_recognized: tuple[int, ...] = ()
    ok: bool = False
    page_count: int = 0


def merge_ocr_pages(
    page_texts: Sequence[str], result: OcrResult, *, min_chars: int = IMAGE_PAGE_MIN_CHARS
) -> tuple[str, tuple[int, ...]]:
    """按页序合并：文字层够用的页保留 pypdf 文本，其余页用 OCR 文本。

    返回 ``(完整正文, 实际采用 OCR 的页码)``。OCR 返回的页数可能多于本地解析到的
    页数（本地只读前 ``MAX_PDF_PAGES`` 页），多出来的页同样按页序补在末尾。
    """
    ocr_by_index = {page.index: page.text.strip() for page in result.pages}
    total = max(len(page_texts), result.page_count, (max(ocr_by_index) + 1) if ocr_by_index else 0)
    blocks: list[str] = []
    used: list[int] = []
    for index in range(total):
        layer = page_texts[index] if index < len(page_texts) else ""
        if len(layer.strip()) >= min_chars:
            blocks.append(layer.strip())
            continue
        ocr_text = ocr_by_index.get(index, "")
        if ocr_text:
            blocks.append(ocr_text)
            used.append(index + 1)
            continue
        # 两种来源都没有内容：保留文字层（可能是一行页码水印），不要凭空删掉。
        if layer.strip():
            blocks.append(layer.strip())
    return "\n".join(block for block in blocks if block), tuple(used)


#: 一次多页识别里最多为多少页做"逐页补识别"。再多就不是补漏而是重做整份，
#: 该让用户重新发起一次任务（`/api/ocr/tasks` 是逐页的，更适合大文件）。
MAX_PAGE_RETRIES = 30


def _ocr_texts(result: OcrResult) -> dict[int, str]:
    return {page.index: page.text.strip() for page in result.pages}


def _empty_pages(page_texts: Sequence[str], result: OcrResult) -> list[int]:
    """本地没有文字层、OCR 也没给字 = 这一页真的缺内容（0 起始页号）。"""
    texts = _ocr_texts(result)
    return [
        index
        for index, layer in enumerate(page_texts)
        if len(layer.strip()) < IMAGE_PAGE_MIN_CHARS and not texts.get(index, "")
    ]


def _split_single_pages(raw: bytes) -> list[bytes]:
    """把 PDF 拆成单页字节（只为补识别；失败返回空列表，不把补漏做成硬失败）。"""
    try:
        import io as _io

        from pypdf import PdfReader, PdfWriter

        reader = PdfReader(_io.BytesIO(raw))
        if reader.is_encrypted and not reader.decrypt(""):
            return []
        pages: list[bytes] = []
        for page in reader.pages[: MAX_PAGE_RETRIES + 1]:
            writer = PdfWriter()
            writer.add_page(page)
            buffer = _io.BytesIO()
            writer.write(buffer)
            pages.append(buffer.getvalue())
        return pages
    except Exception:  # noqa: BLE001 - 补漏失败只影响质量，不该让整次识别报错
        logger.warning("OCR 补识别前拆分 PDF 失败，保留首次结果", exc_info=True)
        return []


def _fill_missing_pages(
    raw: bytes,
    page_texts: Sequence[str],
    result: OcrResult,
    ctx: OcrContext,
    content_type: str,
) -> OcrResult:
    """把"整份一次识别"里漏掉的页**逐页补识别**。

    实测：同一份 9 页扫描件，整份一次请求偶尔只回来 4–8 页文本（页序还在，就是某些页
    空着），而逐页请求几乎必成。空页照常计费，所以补一次比让用户拿到残缺正文划算。
    补完仍为空的页交给上层写进警告，绝不假装完整。
    """
    missing = _empty_pages(page_texts, result)
    if not missing:
        return result
    if len(missing) > MAX_PAGE_RETRIES:
        logger.info(
            "OCR 漏页 %s 页，超过补识别上限 %s，保留首次结果", len(missing), MAX_PAGE_RETRIES
        )
        return result
    single_pages = _split_single_pages(raw)
    if not single_pages:
        return result

    texts = _ocr_texts(result)
    finishes = {page.index: page.finish_reason for page in result.pages}
    recovered = 0
    for index in missing:
        if index >= len(single_pages):
            continue
        name = f"page-{index + 1}.pdf"
        text = ""
        # 补一页最多发两次：单页也空时再试一次（与逐页任务的口径一致）。
        for _attempt in range(2):
            try:
                page_result = recognize_document(
                    single_pages[index],
                    name,
                    ctx.api_key,
                    purpose=ctx.purpose,
                    content_type=content_type,
                )
            except OcrError as exc:
                logger.warning("OCR 补识别第 %s 页失败：%s", index + 1, exc.code)
                break
            text = page_result.text.strip()
            if text:
                break
        if text:
            texts[index] = text
            recovered += 1
    if not recovered:
        return result
    logger.info("OCR 补识别补回 %s / %s 页", recovered, len(missing))
    pages = tuple(
        OcrPage(index=index, text=texts[index], finish_reason=finishes.get(index, "stop"))
        for index in sorted(texts)
    )
    return OcrResult(
        request_id=result.request_id,
        purpose=result.purpose,
        page_count=max(result.page_count, len(pages)),
        pages=pages,
    )


def extract_scan_pages(
    raw: bytes,
    page_texts: Sequence[str],
    ctx: OcrContext | None,
    *,
    filename: str = "document.pdf",
    content_type: str = "application/pdf",
    page_count: int = 0,
) -> ScanOutcome | None:
    """扫描页走 OCR。返回 ``None`` 表示"本次不该用 OCR"（调用方保持原行为）。

    ``engine=ocr`` 且没有 Key、或 OCR 失败时抛 :class:`OcrError`：用户明确选了
    "只用 OCR"，就不能让原件悄悄发给另一个服务商，也不能假装识别成功。
    """
    if ctx is None or not ctx.uses_ocr():
        return None
    if not ctx.configured:
        if ctx.ocr_required():
            raise OcrError("missing_key")
        return None

    try:
        result = recognize_document(
            raw, filename, ctx.api_key, purpose=ctx.purpose, content_type=content_type
        )
    except OcrError as exc:
        if ctx.ocr_required():
            raise
        logger.warning("OCR 识别失败，回落视觉模型：%s", exc.code)
        return ScanOutcome(warnings=(OCR_FAILED_FALLBACK_WARNING,), ok=False)

    result = _fill_missing_pages(raw, page_texts, result, ctx, content_type)
    text, used = merge_ocr_pages(page_texts, result)
    total = page_count or result.page_count
    warnings: list[str] = []
    if used:
        warnings.append(OCR_USED_WARNING.format(pages=len(used)))
    if total and len(used) < total and not text.strip():
        warnings.append(OCR_PARTIAL_WARNING.format(total=total))
    if result.truncated_pages:
        pages = "、".join(str(page) for page in result.truncated_pages)
        warnings.append(OCR_PAGE_TRUNCATED_WARNING.format(pages=pages))
    # 服务端偶发整页空文本（补识别后仍空）：必须点名是哪一页，不能悄悄少一段。
    missing = [index + 1 for index in _empty_pages(page_texts, result)]
    if missing:
        warnings.append(OCR_EMPTY_PAGES_WARNING.format(pages="、".join(str(p) for p in missing)))
    if not text.strip():
        # OCR 成功但一个字都没有：等同于失败，交给调用方按原有空文本口径处理。
        return ScanOutcome(warnings=tuple(warnings), ok=False, page_count=total)
    return ScanOutcome(
        text=text, warnings=tuple(warnings), pages_recognized=used, ok=True, page_count=total
    )


@dataclass(frozen=True)
class SingleImageOutcome:
    """单张图片的 OCR 结果。``used=True`` 表示 OCR 拿到了文字，调用方不必再走视觉模型。"""

    text: str = ""
    warnings: tuple[str, ...] = ()
    used: bool = False


def recognize_single_image(
    raw: bytes, filename: str, mime: str, ctx: OcrContext | None
) -> SingleImageOutcome:
    """单张图片走 OCR（面试材料图片用）。

    与 :func:`prepare_extraction_images` 的差别只在返回形状：这里由调用方自己决定
    拿到文字之后做什么（面试材料要拼接、判空、截断），所以不替它拼 data URL。
    """
    if ctx is None or not ctx.uses_ocr():
        return SingleImageOutcome()
    if not ctx.configured:
        if ctx.ocr_required():
            raise OcrError("missing_key")
        return SingleImageOutcome()
    try:
        result = recognize_document(
            raw, filename or "image.jpg", ctx.api_key, purpose=ctx.purpose, content_type=mime
        )
    except OcrError as exc:
        if ctx.ocr_required():
            raise
        logger.warning("图片 OCR 失败，回落视觉模型：%s", exc.code)
        return SingleImageOutcome(warnings=(OCR_FAILED_FALLBACK_WARNING,))
    text = result.text.strip()
    if not text:
        if ctx.ocr_required():
            raise OcrError("empty_result")
        return SingleImageOutcome(warnings=(OCR_FAILED_FALLBACK_WARNING,))
    return SingleImageOutcome(
        text=text,
        warnings=(OCR_IMAGES_USED_WARNING.format(count=result.page_count or 1),),
        used=True,
    )


@dataclass
class ImageOcrOutcome:
    """图片附件的 OCR 结果：``remaining`` 是仍需交给视觉模型的 data URL。"""

    text: str = ""
    remaining: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    pages_recognized: int = 0
    ok: bool = False


def _image_mime(data_url: str) -> str:
    if data_url.startswith("data:"):
        head = data_url[5:].split(";", 1)[0].strip()
        if head:
            return head
    return _IMAGE_MIME_FALLBACK


def prepare_extraction_images(
    images: Sequence[dict[str, Any]], ctx: OcrContext | None
) -> ImageOcrOutcome:
    """把用户上传的截图/图片简历逐张过 OCR，成功的不再送进视觉模型。

    逐张调用是刻意的：OCR 端点一次只收一个文件，而"某一张失败、其余成功"在现实里
    很常见（模糊、截图被裁）。失败的那张仍保留在 ``remaining`` 里走视觉模型，并在
    警告里说明——不能因为一张坏图把整次识别判失败。
    """
    outcome = ImageOcrOutcome()
    for image in images:
        data_url = str(image.get("data_url") or "")
        if not data_url:
            continue
        if ctx is None or not ctx.uses_ocr():
            outcome.remaining.append(data_url)
            continue
        if not ctx.configured:
            if ctx.ocr_required():
                raise OcrError("missing_key")
            outcome.remaining.append(data_url)
            continue
        name = str(image.get("name") or "image.jpg")
        try:
            _, raw = decode_data_url(data_url)
            result = recognize_document(
                raw, name, ctx.api_key, purpose=ctx.purpose, content_type=_image_mime(data_url)
            )
        except (OcrError, ValueError) as exc:
            if ctx.ocr_required():
                if isinstance(exc, OcrError):
                    raise
                raise OcrError("bad_image", detail=str(exc)) from exc
            logger.warning("图片 OCR 失败，回落视觉模型：%s", type(exc).__name__)
            outcome.remaining.append(data_url)
            outcome.warnings.append(OCR_IMAGE_FAILED_WARNING.format(index=len(outcome.remaining)))
            continue
        text = result.text.strip()
        if not text:
            if ctx.ocr_required():
                raise OcrError("empty_result")
            outcome.remaining.append(data_url)
            continue
        outcome.text = "\n\n".join(part for part in (outcome.text, text) if part)
        outcome.pages_recognized += result.page_count or 1
        outcome.ok = True

    if outcome.pages_recognized:
        outcome.warnings.insert(0, OCR_IMAGES_USED_WARNING.format(count=outcome.pages_recognized))
    return outcome


def image_data_url_bytes(data_url: str) -> bytes:
    """仅供测试与诊断：解出 data URL 的原始字节。"""
    _, raw = decode_data_url(data_url)
    return raw


def image_data_url_of(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


__all__ = [
    "ImageOcrOutcome",
    "ScanOutcome",
    "SingleImageOutcome",
    "extract_scan_pages",
    "image_data_url_bytes",
    "image_data_url_of",
    "merge_ocr_pages",
    "prepare_extraction_images",
    "recognize_single_image",
]
