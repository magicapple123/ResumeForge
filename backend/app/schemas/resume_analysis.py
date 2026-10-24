# SPDX-License-Identifier: Apache-2.0
"""版面诊断（「自动一页」）的请求 / 响应 Schema（从 ``schemas.resume`` 迁出，导入路径保持兼容）。

拆分动机：``schemas/resume.py`` 已贴住 500 行预算（零豁免），而这一组模型在依赖上
是**自洽的最小闭包**——它只用到 ``Literal`` / ``pydantic`` 与版式参数常量
（``MAX_RESUME_PAGES`` / ``ResumeFontScale``，同在 ``schemas/resume_generation.py``），
不引用任何简历内容结构，因此可以整组搬走。

依赖方向约束：**本模块不 import ``schemas.resume``**（否则循环导入）。
``schemas.resume`` 反向 re-export 这里的全部公开符号，所以既有导入路径
``from app.schemas.resume import LayoutAnalyzeRequest, LayoutDiagnosisOut`` 一处都不用改。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .resume_generation import MAX_RESUME_PAGES, ResumeFontScale


class ResumeLayoutMeasure(BaseModel):
    """「自动一页」时浏览器量出来的两个高度（单位随意，只要两者同单位）。"""

    model_config = ConfigDict(extra="forbid")

    # 正文实际占用的高度：内容顶边到最后一个可见元素底边（含其下外边距）。
    used_height: float = Field(ge=0)
    # 一页里正文可用的高度：页高减去上下页边距。
    page_content_height: float = Field(gt=0)
    page_limit: int = Field(default=1, ge=1, le=MAX_RESUME_PAGES)


class LayoutSuggestionOut(BaseModel):
    kind: str
    title: str
    detail: str


class LayoutPageOut(BaseModel):
    page: int
    fill: float


class LayoutDiagnosisOut(BaseModel):
    status: str
    status_label: str
    summary: str
    fill: float
    pages_needed: int
    page_limit: int
    pages: list[LayoutPageOut] = Field(default_factory=list)
    suggestions: list[LayoutSuggestionOut] = Field(default_factory=list)


class LayoutFitCandidateOut(BaseModel):
    """一档候选版式：客户端把它注入预览、量一次，够放下就采用。"""

    key: str
    label: str
    config: dict = Field(default_factory=dict)
    css: str = ""


class LayoutFitRoomOut(BaseModel):
    has_room: bool
    steps: int
    font_floor_px: float
    font_adjust_floor: float
    font_floor_note: str


class LayoutAnalyzeRequest(BaseModel):
    """版面诊断请求：浏览器量到的两个高度 + **屏幕上这一版**的草稿版式。

    为什么版式也要传：诊断里的「自动一页」清单（`fit_ladder`）与收紧余地
    （`fit_room`）都是"从当前版式再往紧收一档"算出来的。只按记录值算，用户在
    拖完滑块、还没点保存时点「自动一页」，就会从一个**他没在看的版式**起步——
    表现为"诊断说的和我屏幕上的不是一回事"（2026-10-21 用户实测：精确模式里
    改参数，诊断内容整块不动）。

    ``None`` 表示"这次不覆盖，用记录值"：旧客户端不传这些字段，行为与之前一致。
    """

    model_config = ConfigDict(extra="forbid")

    measure: ResumeLayoutMeasure
    # 与 ``PreviewPdfRequest`` / ``POST /resumes/render`` 的版式字段逐一对应。
    template: str | None = Field(default=None, max_length=64)
    format_name: str | None = Field(default=None, max_length=64)
    font_scale: ResumeFontScale | None = None
    format_config: dict | None = None


class LayoutAnalyzeOut(BaseModel):
    diagnosis: LayoutDiagnosisOut
    # 逐档收紧的版式清单。内容本来就放得下时为空。
    fit_ladder: list[LayoutFitCandidateOut] = Field(default_factory=list)
    fit_room: LayoutFitRoomOut


__all__ = [
    "LayoutAnalyzeOut",
    "LayoutAnalyzeRequest",
    "LayoutDiagnosisOut",
    "LayoutFitCandidateOut",
    "LayoutFitRoomOut",
    "LayoutPageOut",
    "LayoutSuggestionOut",
    "ResumeLayoutMeasure",
]
