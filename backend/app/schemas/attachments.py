# SPDX-License-Identifier: Apache-2.0
"""PDF 预览接口的请求 / 响应模型（项 7 / D14 / D15）。

只回"前 N 页的位图"，不回文本、不回整份 PDF：预览的目的是"确认传对了文件"，
首页足够；整份 30 页 PDF 渲染会吃掉几十秒 CPU 与几十 MB 内存（D15）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PdfPreviewRequest(BaseModel):
    """要预览的 PDF（base64 data URL 或裸 base64）与前几页。"""

    name: str = ""
    mime_type: str = "application/pdf"
    data: str = Field(..., description="base64 data URL 或裸 base64")
    # 上限 3：预览只用于"确认是这份文件"，再往后翻对判断没有帮助（D15）。
    pages: int = Field(1, ge=1, le=3)


class PdfPreviewPage(BaseModel):
    """一页位图：`page` 是**1 起始**的真实页码（与 PDF 阅读器一致）。"""

    page: int
    image: str  # data:image/jpeg;base64,...


class PdfPreviewOut(BaseModel):
    pages: list[PdfPreviewPage]
