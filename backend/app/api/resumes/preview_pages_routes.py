# SPDX-License-Identifier: Apache-2.0
"""精确预览的**逐页位图**端点（P3-2）：`POST …/preview-pages` + 两个 GET。

为什么要这条端点：精确预览此前把导出 PDF 塞进 `<iframe>` 交给浏览器内置查看器，导致
① 查看器自己画两条无用滚动条（外层 CSS 够不到）、② 纸边一圈深色描边、③ 无头 Chromium
不出图（截图链与 CI 一直是盲区）。改成"服务端渲染成 WebP + 前端逐页 `<img>`"之后三条
一次消失（渲染细节见 `services/resume/preview_pages.py`）。

三件事刻意与 `preview-pdf` 保持一致，否则"预览"就不再是"导出产物"：

1. 排版走**同一条管线**（这里直接复用 `export_routes` 的预览出口，不另拼参数）；
2. 位图来源就是那条管线吐出的 PDF 字节，一页不多一页不少；
3. 预览不落库、不冻结交付、不写「生成内容保存位置」——这些开关由那条出口统一表达。

派生位图落系统临时目录，不进数据集/备份。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as HTTPRequest
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.export import PreviewPdfRequest
from ...services.resume import preview_pages as pages_service
from ..resumes._shared import (
    PDF_PAGE_LIMIT_HEADER,
    PDF_PAGES_NEEDED_HEADER,
    RESUME_OVERFLOW_HEADER,
    _get_live_resume,
)
from .export_routes import _require_local_export_request, preview_pdf_response

logger = logging.getLogger(__name__)

router = APIRouter()


def _header_int(headers: Mapping[str, str], name: str) -> int | None:
    """响应头里的整数（缺失/非法 → None）。这些头由导出管线统一产出，只读不重算。"""
    raw = headers.get(name)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


class PreviewPagesRequest(PreviewPdfRequest):
    """精确预览位图请求体：**在 PDF 预览那组字段上多一个宽高口径**。

    为什么要 `width` / `dpr`：位图分辨率必须在请求时定死（渲染 200–600ms），而相框宽度
    由前端的 `ResizeObserver` 量出来——后端猜不到，也不能按"最多 3000px"一律满配（3 页
    会吃掉几十 MB 内存）。`extra="forbid"` 随父类继承，拼错的字段照样 422。
    """

    model_config = ConfigDict(extra="forbid")

    width: int = Field(default=900, ge=200, le=4000, description="相框的 CSS 像素宽（分桶使用）")
    dpr: float = Field(default=1.0, ge=0.5, le=4.0, description="设备像素比（分桶并夹在 1–3）")


class PreviewPageSizeModel(BaseModel):
    """一页位图的像素尺寸。前端按 `height / width` 折算 CSS 高度，不假设 A4 比例。"""

    index: int
    width: int
    height: int


class PreviewPagesResponse(BaseModel):
    """逐页位图的清单：token + 每页尺寸 + 与 PDF 预览同一套页数/溢出结论。"""

    token: str
    page_count: int
    pages: list[PreviewPageSizeModel]
    pages_needed: int | None
    overflow: bool
    page_limit: int | None
    pdf_url: str


@router.post("/{resume_id}/preview-pages", response_model=PreviewPagesResponse)
def create_preview_pages(
    request: HTTPRequest,
    resume_id: int,
    payload: PreviewPagesRequest,
    db: Session = Depends(get_db),
):
    """把这一版导出的每一页渲染成 WebP，返回清单（token 用来拼图片地址）。

    图片走 `GET …/{token}/{index}.webp`（token 内容寻址，可长缓存），
    「在新标签打开」走 `GET …/{token}/document.pdf`（同一份字节，不再重排）。
    """
    _require_local_export_request(request)
    record = _get_live_resume(db, resume_id)
    # 复用 PDF 预览那条出口：同一条管线、同一组参数、同一份字节。
    pdf_response = preview_pdf_response(db, record, payload)
    pdf_bytes = bytes(pdf_response.body)
    try:
        rendered = pages_service.render_preview_pages(
            pdf_bytes, width_px=payload.width, dpr=payload.dpr
        )
    except pages_service.PreviewPagesError as exc:
        # 渲染不出图属于"这一版排不出来"，与 PDF 导出失败同一档（409 + 可读文案）。
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    headers = pdf_response.headers
    return PreviewPagesResponse(
        token=rendered.token,
        page_count=rendered.page_count,
        pages=[
            PreviewPageSizeModel(index=page.index, width=page.width, height=page.height)
            for page in rendered.pages
        ],
        pages_needed=_header_int(headers, PDF_PAGES_NEEDED_HEADER),
        overflow=headers.get(RESUME_OVERFLOW_HEADER) == "true",
        # 「不限篇幅」时导出管线回 0（语义值原样），前端按 ``=== 0`` 判定。
        page_limit=_header_int(headers, PDF_PAGE_LIMIT_HEADER),
        pdf_url=f"/api/resumes/{resume_id}/preview-pages/{rendered.token}/document.pdf",
    )


@router.get("/{resume_id}/preview-pages/{token}/{index}.webp")
def get_preview_page(resume_id: int, token: str, index: int):
    """一页位图。token 是内容哈希，可以放心长缓存（`immutable`）。"""
    if not token.isalnum() or len(token) != 32:
        raise HTTPException(status_code=404, detail="预览页不存在")
    path = pages_service.page_path(token, index)
    if not path.is_file():
        # 目录可能已被 LRU 回收 / 服务重启后重建：前端拿到 404 会退回"重新请求清单"。
        raise HTTPException(status_code=404, detail="预览页不存在")
    return FileResponse(
        str(path),
        media_type=pages_service.PAGE_MEDIA_TYPE,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/{resume_id}/preview-pages/{token}/document.pdf")
def get_preview_document(resume_id: int, token: str):
    """「在新标签打开」用的 PDF：与位图同一份字节，直接读缓存目录，不重排。"""
    if not token.isalnum() or len(token) != 32:
        raise HTTPException(status_code=404, detail="预览文件不存在")
    path = pages_service.pdf_path(token)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="预览文件不存在")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="resume-preview-{token[:8]}.pdf"',
            "Cache-Control": "no-store",
        },
    )
