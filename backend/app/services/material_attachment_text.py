# SPDX-License-Identifier: Apache-2.0
"""资料箱附件的本地文本提取（第 23 条）。

为什么单独成模块：document_text 已贴着 500 行预算，而"资料箱附件"这一档比面试
材料链路多收 json / csv、并且**扫描件 PDF 不做视觉识别**——差异都收在这里，
document_text.extract_material_text 保持面试链路原有语义不变。

底层解析（pypdf / docx / 纯文本解码 / 截断）复用 document_text 的同一份实现；
这里只做"资料箱这一档"的格式分派与警告口径。**图片不走这里**：图片由
attachments.normalize_image_attachment 规范化后直接进 material.files。
"""

from __future__ import annotations

from . import document_text
from .document_text import (
    MATERIAL_LEGACY_DOC,
    MATERIAL_SCAN_NO_VISION_WARNING,  # noqa: F401 - 测试与调用方按本模块取
    MATERIAL_TRUNCATED_WARNING,
    MATERIAL_UNSUPPORTED,
    MAX_DOCUMENT_TEXT_CHARS,
    MAX_MATERIAL_FILE_BYTES,
    MaterialText,
    extract_material_text,
    material_suffix,
)

# 资料箱附件接受的文本类扩展名：比面试材料那条链路多收 json / csv。
MATERIAL_ATTACHMENT_TEXT_SUFFIXES = frozenset(
    {"pdf", "docx", "txt", "md", "markdown", "json", "csv"}
)


def _truncate_attachment(text: str) -> tuple[str, list[str]]:
    """与 document_text 同一套截断口径（同上限、同警告文案）。"""
    if len(text) <= MAX_DOCUMENT_TEXT_CHARS:
        return text, []
    return text[:MAX_DOCUMENT_TEXT_CHARS], [MATERIAL_TRUNCATED_WARNING]


def extract_attachment_text(name: str, raw: bytes) -> MaterialText:
    """把资料箱上传的文件提取成纯文本。

    与 document_text.extract_material_text 的三点不同：

    1. 多收 json / csv（资料箱一直允许这两类纯文本附件）；
    2. 扫描件 PDF **不做视觉识别**：文字层空白时返回空文本 + 常驻警告，而不是渲染
       扫描页（视觉识别是面试材料链路的预算与语义，资料箱没有那条通道）；
    3. 只做提取，不判断"要不要给模型看"——调用方拿 text 与 warnings 组装附件
       元信息，原件由调用方另存。

    .doc 与其它格式抛面向用户的 ValueError（前端在选文件时也拦一道）。
    """
    suffix = material_suffix(name)
    if suffix == ".doc":
        raise ValueError(MATERIAL_LEGACY_DOC)
    if suffix in {".json", ".csv"}:
        # 复用 document_text 里的同一句用户文案，不在这里复制一份中文。
        if not raw:
            raise ValueError(document_text._MATERIAL_EMPTY_FILE)
        if len(raw) > MAX_MATERIAL_FILE_BYTES:
            raise ValueError(document_text._MATERIAL_TOO_LARGE)
        # json / csv 就是纯文本：不解码成结构化数据（用户要的是可复制的文本）。
        text = document_text._decode_plain_text(raw).strip()
        if not text:
            raise ValueError(document_text._MATERIAL_NO_TEXT)
        truncated, warnings = _truncate_attachment(text)
        return MaterialText(truncated, warnings)
    if suffix.lstrip(".") not in MATERIAL_ATTACHMENT_TEXT_SUFFIXES:
        raise ValueError(MATERIAL_UNSUPPORTED)
    return extract_material_text(name, raw, render_scan_pages=False)


__all__ = [
    "MATERIAL_ATTACHMENT_TEXT_SUFFIXES",
    "MATERIAL_SCAN_NO_VISION_WARNING",
    "extract_attachment_text",
]
