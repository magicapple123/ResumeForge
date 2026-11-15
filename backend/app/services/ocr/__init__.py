# SPDX-License-Identifier: Apache-2.0
"""扫描件识别包：DeepSeek OCR 的客户端、引擎策略与链路合并。

对外的三件事：
- :func:`recognize_document` —— 一次同步识别（调用方放线程池）；
- :func:`load_ocr_context` —— 按设置与本机 Key 决定这次"该不该用 OCR"；
- :func:`extract_scan_pages` / :func:`prepare_extraction_images` —— 接进既有提取链路。
"""

from __future__ import annotations

from .client import OcrError, OcrPage, OcrResult, recognize_document
from .policy import (
    ENGINE_LABELS,
    OCR_ENGINES,
    OcrContext,
    OcrEngine,
    get_ocr_config,
    load_ocr_context,
    ocr_key_configured,
    save_ocr_config,
)
from .scan import (
    ImageOcrOutcome,
    ScanOutcome,
    extract_scan_pages,
    merge_ocr_pages,
    prepare_extraction_images,
)

__all__ = [
    "ENGINE_LABELS",
    "ImageOcrOutcome",
    "OCR_ENGINES",
    "OcrContext",
    "OcrEngine",
    "OcrError",
    "OcrPage",
    "OcrResult",
    "ScanOutcome",
    "extract_scan_pages",
    "get_ocr_config",
    "load_ocr_context",
    "merge_ocr_pages",
    "ocr_key_configured",
    "prepare_extraction_images",
    "recognize_document",
    "save_ocr_config",
]
