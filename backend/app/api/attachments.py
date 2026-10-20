# SPDX-License-Identifier: Apache-2.0
"""附件预览接口（项 7 / D14 / D15）：把 PDF 的前 N 页渲染成 JPEG 返回。

为什么在**服务端**渲染，而不是把 data URL 交给浏览器打开：Chrome/Edge 早已禁止顶层
导航到 ``data:``，Electron 里根本没有内置 PDF 查看器——``window.open(dataUrl)`` 必然
失败（老实现的"点预览打不开"就是这么来的）。仓库里已经有 ``pypdfium2``（扫描页识别在用），
复用它渲染首页是**零新增依赖**；返回 JPEG 后前端用 antd 的图片预览组展示，与图片附件
共用同一套 UI（D14）。

只看前 N 页（默认 1、上限 3，D15）：预览要回答的是"我传的是这份文件吗"，首页足够。

校验不在这里重写：扩展名白名单 / MIME 一致性 / 魔数 / 2 MB 上限都在
:func:`app.services.attachments.document_source` 里，两个入口共用同一份文案。
"""

from __future__ import annotations

import io

import pypdfium2 as pdfium
from fastapi import APIRouter, HTTPException

from app.schemas.attachments import PdfPreviewOut, PdfPreviewPage, PdfPreviewRequest
from app.services.attachments import document_source
from app.services.pdf_page_images import page_image_data_url, render_pdf_page_images

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

# 底层异常（pdfium 的解析错误、PIL 的编码错误）对用户没有意义，也可能带出内部路径。
# 统一成一句能指导下一步的话。
_BROKEN_PDF = "这个文件不是有效的 PDF，或已损坏"


def _as_data_url(mime_type: str, data: str) -> str:
    """把裸 base64 补成 data URL。

    `document_source` 只吃 data URL（``decode_data_url`` 的正则要求 ``data:`` 前缀），
    而本接口的契约两种形态都收（前端手上是哪种取决于附件来源）。**只补前缀**，
    校验仍然只有 `document_source` 一份，不在这里重新判格式。
    """
    text = data.strip()
    if text.startswith("data:"):
        return text
    return f"data:{mime_type or 'application/pdf'};base64,{text}"


@router.post("/pdf-preview", response_model=PdfPreviewOut)
def preview_pdf(payload: PdfPreviewRequest) -> PdfPreviewOut:
    """把上传的 PDF 前 N 页渲染成 JPEG，供前端预览（不做识别、不落库）。

    - 422 的 ``detail`` 都是**面向用户**的原文（来自 ``document_source`` 或下面几条）；
    - 只渲染、不解析文字：扫描件与文本 PDF 在这里同等对待。
    """
    try:
        safe_name, mime, raw = document_source(
            payload.name or "preview.pdf",
            payload.mime_type or "application/pdf",
            _as_data_url(payload.mime_type, payload.data),
        )
    except ValueError as exc:
        # `document_source` 的文案已经写了"为什么不行 + 该怎么办"，直接透给用户。
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if mime != "application/pdf":
        raise HTTPException(status_code=422, detail="这个文件不是 PDF，无法预览")

    try:
        with pdfium.PdfDocument(io.BytesIO(raw)) as document:
            total = len(document)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - 底层异常一律折算成用户能懂的 422
        raise HTTPException(status_code=422, detail=_BROKEN_PDF) from exc

    if payload.pages > total:
        # 说清"这份有几页"，用户才知道是自己记错了还是文件不对。
        raise HTTPException(
            status_code=422,
            detail=f"这份 PDF 只有 {total} 页，无法预览第 {payload.pages} 页",
        )

    page_count = min(payload.pages, total)
    try:
        images = render_pdf_page_images(raw, range(1, page_count + 1))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - 同上
        raise HTTPException(status_code=422, detail=_BROKEN_PDF) from exc

    return PdfPreviewOut(
        pages=[
            PdfPreviewPage(page=number, image=page_image_data_url(jpeg)) for number, jpeg in images
        ]
    )
