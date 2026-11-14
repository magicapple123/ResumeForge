# SPDX-License-Identifier: Apache-2.0
"""从 ``document_text`` 拆出：PDF / DOCX 的**低层文字解析**（无业务口径）。

PDF 走 pypdf 逐页取文字层，DOCX 只读白名单成员 ``word/document.xml``（绝不 extractall）。
任何第三方解析异常都在这里转成面向用户的 ``ValueError``；扫描页渲染与账目留在
``document_text``（渲染函数被测试在模块命名空间上 monkeypatch）。
"""

from __future__ import annotations

import io
import logging
import zipfile
from xml.etree import ElementTree

from pypdf import PdfReader

logger = logging.getLogger(__name__)

# 一份文档最多读多少页。简历和招聘信息没有超过这个数的正当理由，而页数直接决定
# 解析耗时。
MAX_PDF_PAGES = 30
# 单页字符数低于该阈值判为"图片页"（扫描页）：正常文本页哪怕只有几行也远超这个数，
# 而扫描页经 OCR 侧的提取通常只给出空串或页码水印。超过 MAX_PDF_PAGES 的部分本就
# 不参与解析，图片页判定只覆盖前 MAX_PDF_PAGES 页。
IMAGE_PAGE_MIN_CHARS = 30


_DOCX_DOCUMENT_XML = "word/document.xml"
_DOCX_WORD_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


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


def _pdf_page_split(page_texts: list[str]) -> tuple[str, list[int]]:
    """逐页切分：返回（文字页的正文, 文字层过少、按扫描页处理的页码）。"""
    image_page_numbers = [
        number
        for number, text in enumerate(page_texts, start=1)
        if len(text.strip()) < IMAGE_PAGE_MIN_CHARS
    ]
    scanned = set(image_page_numbers)
    text = "\n".join(
        page_text for number, page_text in enumerate(page_texts, start=1) if number not in scanned
    )
    return text, image_page_numbers


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
