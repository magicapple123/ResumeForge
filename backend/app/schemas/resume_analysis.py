# SPDX-License-Identifier: Apache-2.0
"""版面诊断（「自动一页」）的请求 / 响应 Schema（从 ``schemas.resume`` 迁出，导入路径保持兼容）。

拆分动机：``schemas/resume.py`` 已贴住 500 行预算（零豁免），而这一组模型在依赖上
是**自洽的最小闭包**——它只用到 ``Literal`` / ``pydantic`` 与版式参数常量
（``LONG_CV_MAX_PAGES`` / ``ResumeFontScale``，同在 ``schemas/resume_generation.py``），
不引用任何简历内容结构，因此可以整组搬走。

依赖方向约束：**本模块不 import ``schemas.resume``**（否则循环导入）。
``schemas.resume`` 反向 re-export 这里的全部公开符号，所以既有导入路径
``from app.schemas.resume import LayoutAnalyzeRequest, LayoutDiagnosisOut`` 一处都不用改。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume_generation import LONG_CV_MAX_PAGES, ResumeFontScale


class ResumeLayoutMeasure(BaseModel):
    """「自动一页」时浏览器量出来的两个高度（单位随意，只要两者同单位）。"""

    model_config = ConfigDict(extra="forbid")

    # 正文实际占用的高度：内容顶边到最后一个可见元素底边（含其下外边距）。
    used_height: float = Field(ge=0)
    # 一页里正文可用的高度：页高减去上下页边距。
    page_content_height: float = Field(gt=0)
    # 上限按**两种文档模式里最大的那个**（长 CV 1–10）取，不是普通模式的 3：
    # 诊断请求只是"把屏幕上这一版量到的高度交回来算结论"，page_limit 是客户端当前
    # 草稿的页数上限。普通模式的 1–3 已由 ``mode_page_limit`` 在保存/渲染路径夹紧，
    # 这里再用 3 校验只会让长 CV（用户设置 5/10 页）的每次诊断都 422（2026-10-31 Q19）。
    page_limit: int = Field(default=1, ge=1, le=LONG_CV_MAX_PAGES)


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


class ContentHint(BaseModel):
    """W09 内容精简候选的一条提示（本地确定性计算结果，不调模型）。

    kind 目前只有 low_relevance（要点没命中目标岗位关键词）；保留 Literal 是为了以后
    扩项时不破坏前端（前端按 kind 展示不同文案）。object_id / point_id 是 W01 稳定
    身份，前端据此定位到具体条目/要点；没有稳定身份的条目不产生提示。
    """

    kind: Literal["low_relevance"] = "low_relevance"
    section: str = Field(max_length=32)
    object_id: str = Field(max_length=32)
    point_field: str | None = Field(default=None, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)
    reason: str = Field(default="", max_length=300)
    evidence: list[str] = Field(default_factory=list, max_length=10)


class LayoutAnalyzeOut(BaseModel):
    diagnosis: LayoutDiagnosisOut
    # 逐档收紧的版式清单。内容本来就放得下时为空。
    fit_ladder: list[LayoutFitCandidateOut] = Field(default_factory=list)
    fit_room: LayoutFitRoomOut
    # W09 内容精简候选：低相关要点提示（可选字段，旧后端/旧客户端读到缺省都不受影响）。
    # 信息不足（没有岗位/没有稳定 id）时是空列表——"没有提示"不等于"内容都相关"。
    content_hints: list[ContentHint] | None = None


__all__ = [
    "ContentHint",
    "LayoutAnalyzeOut",
    "LayoutAnalyzeRequest",
    "LayoutDiagnosisOut",
    "LayoutFitCandidateOut",
    "LayoutFitRoomOut",
    "LayoutPageOut",
    "LayoutSuggestionOut",
    "ResumeLayoutMeasure",
]
