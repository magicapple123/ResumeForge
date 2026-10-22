# SPDX-License-Identifier: Apache-2.0
"""导出与脱敏的请求 Schema（R-16 / R-17）。

``ExportRequest`` 是 ``POST /api/resumes/{id}/export`` 的请求体，字段与
``services/export_pipeline.ExportRequest``（内部 dataclass）一一对应，由 API 层转换。
``RedactionOptions`` 是 ``services/privacy.py::RedactionOptions``（内部 dataclass）的
Pydantic 镜像，作为脱敏预览接口的请求体；脱敏规则本身仍只有 ``privacy.redact`` 一份
实现，这里只负责把 HTTP 请求的字段白名单化（``extra="forbid"`` 防注入多余参数）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume import MAX_RESUME_PAGES, ResumeFontScale, ResumeLanguage

ExportFormat = Literal["json", "md", "html", "pdf", "docx", "txt"]


class RedactionOptions(BaseModel):
    """脱敏范围。默认遮罩可直接识别身份的六项，其余按需开启（与 privacy 默认值逐字一致）。"""

    model_config = ConfigDict(extra="forbid")

    mask_name: bool = True
    mask_phone: bool = True
    mask_email: bool = True
    mask_company: bool = True
    mask_school: bool = False
    mask_project: bool = False
    mask_product: bool = False
    # GitHub / 个人主页：一个 handle 或域名足以反查到人，默认遮（见 services/privacy.py）。
    mask_github: bool = True
    mask_website: bool = True


class ExportRequest(BaseModel):
    """全参数导出请求体。缺省项回退到记录里存的版式 / 不做后处理。"""

    model_config = ConfigDict(extra="forbid")

    format: ExportFormat = "pdf"
    watermark: str = Field(default="", max_length=200)
    redact: bool = False
    redact_options: RedactionOptions = Field(default_factory=RedactionOptions)
    # 页边距**兼容字段**（R1）：只在请求未提供 ``format_config.page_padding`` 时作为它的
    # 回落值（收进 8–26mm 后生效），**不再单独覆盖**任何东西。页边距的唯一权威是
    # ``format_config.page_padding``——预览、HTML、PDF、Word 都读它；两套并存就会出现
    # "预览 8mm、PDF 30mm"。新调用方请只发 ``page_padding``。
    margin_mm: float | None = Field(default=None, ge=4, le=40)
    # 字号 / 页数覆盖：None 表示沿用记录里存的值。
    font_scale: ResumeFontScale | None = None
    page_limit: int | None = Field(default=None, ge=1, le=MAX_RESUME_PAGES)
    # 这次导出用的版式覆盖（字号系数 / 行距 / 页边距 / 区块间距 / 强调色等）。
    # **缺省 = 沿用记录里存的版式**（旧前端兼容）；给值时按
    # ``validated_format_config`` 白名单化后**叠加**在记录值之上。这是"预览里把字号拖到
    # 7px、却没点保存就导出，PDF 仍按旧字号排出两页"的直接原因——预览走 /render 已经带上
    # 了草稿版式，导出却只读记录值。
    format_config: dict | None = None
    include_photo: bool = True
    allow_incomplete: bool = False
    # 正式投递存档（RF-17）：为真时这次导出冻结一份投递快照；默认不落库（预览零膨胀）。
    record_delivery: bool = False


class PreviewPdfRequest(BaseModel):
    """精确预览请求体：只决定"这份 PDF 怎么排"，不做任何后处理。

    为什么单独建一个而不是复用 ``ExportRequest``：预览**不是导出**——它不落盘、不记交付、
    不允许水印/脱敏（那些会让预览与屏幕上看到的草稿不是同一份内容）。``extra="forbid"``
    让"顺手加个 watermark"在 422 就被挡住，而不是静默生效。

    **版式字段必须与 ``POST /api/resumes/render`` 对齐**：草稿靠这几个参数排版，少任何一个
    精确预览都会回落到记录里的旧值——那正是"改完模板 / 版式 / 板块顺序，预览不跟着变"的
    根因。导出专有的字段（格式、水印、脱敏、落库）一个都不收。
    """

    model_config = ConfigDict(extra="forbid")

    # 这几个字段与 ``POST /api/resumes/render`` 的版式参数**逐一对应**（去掉正文）。
    #
    # 为什么必须全都带上：草稿的版式是"样式模板 + 版式模板 + 覆盖"三层叠出来的，任何
    # 一层没传，精确预览就会按**记录里的旧值**排版——用户换了模板或版式、又还没点保存，
    # 屏幕上看到的就还是上一版（2026-10-21 用户实测："调整模板、版式、板块顺序，
    # 精确预览不跟着变"）。``None`` 表示"这次不覆盖，用记录值"（旧客户端兼容）。
    template: str | None = Field(default=None, max_length=64)
    format_name: str | None = Field(default=None, max_length=64)
    page_limit: int | None = Field(default=None, ge=1, le=MAX_RESUME_PAGES)
    font_scale: ResumeFontScale | None = None
    # 纸面固定文案的语言（小节标题 / 字段前缀）。``None`` = 用记录里的语言。
    # 与上面几个字段同理：**必须收下**，否则草稿里选了英文、精确预览还是中文。
    language: ResumeLanguage | None = None
    format_config: dict | None = None
    include_photo: bool = True


__all__ = ["ExportFormat", "ExportRequest", "PreviewPdfRequest", "RedactionOptions"]
