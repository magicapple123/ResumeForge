# SPDX-License-Identifier: Apache-2.0
"""PDF 扫描页位图渲染（T03）：图片页走现有 LLM 视觉链路。

PDF 里没有文字层的页（扫描件、纯图片导出）无法靠 pypdf 提取文字。这里的做法是
把这些页渲染成 JPEG 位图，交给调用方并进图片附件通路——与用户手动上传的截图
**同一条模型调用路径、同一份体积预算**（见 ``attachments.MAX_ATTACHMENTS_TOTAL_BYTES``）。

隐私语义：渲染出的位图会作为图片发给所配置的模型服务商，这一点与截图上传完全
相同；界面不为此单独弹窗，但 ``document_text`` 的警告文案会明确告知"已按图片识别"。
该语义已经项目主理人确认。

模块只做渲染，不做预算判定：预算（按页跳过、超限截断）由 ``document_text`` 统一
裁决，因为它掌握整次请求的附件体积上下文。
"""

from __future__ import annotations

import base64
import io
import logging
from collections.abc import Sequence
from typing import cast

import pypdfium2 as pdfium

logger = logging.getLogger(__name__)

# 约 150 DPI：让模型读清简历字号足够，再高只会白白消耗附件体积预算。
RENDER_SCALE = 150 / 72
# 渲染位图长边上限（px）：与常见截图同量级，防止竖版页面渲染出巨型图片。
MAX_RENDER_LONG_EDGE = 1600
JPEG_QUALITY = 80
# 一份 PDF 最多转图的页数：8 页 × 数百 KB 在 5 MB 附件预算内是安全量级。
MAX_PDF_IMAGE_PAGES = 8

PAGE_IMAGE_MIME = "image/jpeg"


def render_pdf_page_images(raw: bytes, page_numbers: Sequence[int]) -> list[tuple[int, bytes]]:
    """把指定页（1 起始编号）渲染成 JPEG，返回 ``[(页码, JPEG 字节)]``。

    单页渲染失败抛出原始异常，由调用方统一降级——在这里吞掉异常会变成"静默丢页"，
    用户不知道扫描内容没被识别。
    """
    images: list[tuple[int, bytes]] = []
    with pdfium.PdfDocument(io.BytesIO(raw)) as document:
        for page_number in page_numbers:
            page = document[page_number - 1]
            width, height = page.get_size()
            long_edge = max(width, height)
            # 分辨率取"150 DPI"与"长边不超过上限"两者中更保守的一个。
            scale = (
                min(RENDER_SCALE, MAX_RENDER_LONG_EDGE / long_edge) if long_edge else RENDER_SCALE
            )
            # pypdfium2 的 `scale` 没有类型标注（默认值 `1` 让静态检查以为只收 int），
            # 运行时是浮点缩放系数：取整会让 150 DPI 掉到 144，识别质量跟着变，所以按
            # 浮点传，`cast` 说明"这里是上游标注缺失，不是我们要 int"。
            pil_image = page.render(scale=cast(int, scale)).to_pil()
            if pil_image.mode != "RGB":
                # JPEG 不支持 alpha：PDF 渲染常见 RGBA，先并成不透明 RGB。
                pil_image = pil_image.convert("RGB")
            buffer = io.BytesIO()
            pil_image.save(buffer, format="JPEG", quality=JPEG_QUALITY)
            images.append((page_number, buffer.getvalue()))
    return images


def page_image_data_url(jpeg_bytes: bytes) -> str:
    return f"data:{PAGE_IMAGE_MIME};base64,{base64.b64encode(jpeg_bytes).decode('ascii')}"
