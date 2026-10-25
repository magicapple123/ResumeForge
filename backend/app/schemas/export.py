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

from .resume import (
    LONG_CV_MAX_PAGES,
    ResumeContent,
    ResumeFontScale,
    ResumeLanguage,
)

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
    # 回落值（收进 0–26mm 后生效），**不再单独覆盖**任何东西。页边距的唯一权威是
    # ``format_config.page_padding``——预览、HTML、PDF、Word 都读它；两套并存就会出现
    # "预览 8mm、PDF 30mm"。新调用方请只发 ``page_padding``。
    margin_mm: float | None = Field(default=None, ge=4, le=40)
    # 字号 / 页数覆盖：None 表示沿用记录里存的值。
    font_scale: ResumeFontScale | None = None
    # W14：页数上限由文档模式决定（普通 1–3 / 长 CV 1–10）；路由用 mode_page_limit 夹紧。
    page_limit: int | None = Field(default=None, ge=1, le=LONG_CV_MAX_PAGES)
    # 这次导出用的版式覆盖（字号系数 / 行距 / 页边距 / 区块间距 / 强调色等）。
    # **缺省 = 沿用记录里存的版式**（旧前端兼容）；给值时按
    # ``validated_format_config`` 白名单化后**叠加**在记录值之上。这是"预览里把字号拖到
    # 7px、却没点保存就导出，PDF 仍按旧字号排出两页"的直接原因——预览走 /render 已经带上
    # 了草稿版式，导出却只读记录值。
    format_config: dict | None = None
    # 本次导出的**草稿语言**（纸面固定文案：小节标题 / 字段前缀）；``None`` = 用记录值。
    #
    # 与 ``format_config`` 同一条路：预览里把语言切成 English、还没点「保存版式」时，
    # 导出也必须按英文排——否则用户眼前是 Summary、下载到的 PDF 里仍是「个人总结」。
    language: ResumeLanguage | None = None
    include_photo: bool = True
    allow_incomplete: bool = False
    # W19：下载与预览同快照——请求可带当前草稿 content（未保存正文）。给定则不读库内
    # 正文、不落库、不冻结交付；响应头 X-Content-Sha256 与预览是同一口径。
    content: ResumeContent | None = None
    # 正式投递存档（RF-17）：为真时这次导出冻结一份投递快照；默认不落库（预览零膨胀）。
    record_delivery: bool = False
    # **预览请求**（2026-10-24）：简历中心每次点开一份简历都要取一次渲染产物（`format=html`），
    # 走的是同一条导出管线。默认行为（落一份副本、不进结果缓存）对"用户真的要一个文件"
    # 是对的，对"屏幕上的一次查看"纯属浪费：既写盘，又让每次重新打开都重排一遍。
    # 为真时只做两件事：不落盘副本 + 结果进预览缓存（同一组输入第二次 0ms）。
    # 产物字节与从前的预览请求**完全一致**，所以前端可以无感切换。
    preview: bool = False
    # W16 岗位变体（2026-10-25）：按 variant_id 用变体的内容 + 版式快照导出。
    # 解析委托 `services.resume.document_variants.resolve_variant_export`（be-prov 契约），
    # 解析失败/不属于本简历 → 404。None = 沿用记录（旧调用方零变化）。
    variant_id: int | None = Field(default=None, ge=1)


class PreviewPdfRequest(BaseModel):
    """精确预览请求体：决定"这份 PDF 怎么排"，并可按最终交付配置叠加后处理（W04）。

    为什么单独建一个而不是复用 ``ExportRequest``：预览**不是导出**——它不落盘、不记交付、
    不落库。但 W04 要求"支持水印/脱敏的最终配置预览"：用户需要在**下载之前**看到带水印
    与脱敏的最终版式，所以 ``watermark`` / ``redact`` / ``redact_options`` 按与
    ``ExportRequest`` 相同的语义收下，并走同一条管线（脱敏是前置、水印是渲染后叠加）。
    仍属导出专有的字段（``format``、``record_delivery``）继续由 ``extra="forbid"`` 在 422 挡住。

    **版式字段必须与 ``POST /api/resumes/render`` 对齐**：草稿靠这几个参数排版，少任何一个
    精确预览都会回落到记录里的旧值——那正是"改完模板 / 版式 / 板块顺序，预览不跟着变"的
    根因。
    """

    model_config = ConfigDict(extra="forbid")

    # 这几个字段与 ``POST /api/resumes/render`` 的版式参数**逐一对应**（去掉正文）。
    #
    # 为什么必须全都带上：草稿的版式是"模板 + 版式 + 覆盖"三层叠出来的，任何
    # 一层没传，精确预览就会按**记录里的旧值**排版——用户换了模板或版式、又还没点保存，
    # 屏幕上看到的就还是上一版（2026-10-21 用户实测："调整模板、版式、板块顺序，
    # 精确预览不跟着变"）。``None`` 表示"这次不覆盖，用记录值"（旧客户端兼容）。
    template: str | None = Field(default=None, max_length=64)
    format_name: str | None = Field(default=None, max_length=64)
    # W14：同上，长 CV 允许到 10 页；普通模式由记录 document_mode 夹紧。
    page_limit: int | None = Field(default=None, ge=1, le=LONG_CV_MAX_PAGES)
    font_scale: ResumeFontScale | None = None
    # 纸面固定文案的语言（小节标题 / 字段前缀）。``None`` = 用记录里的语言。
    # 与上面几个字段同理：**必须收下**，否则草稿里选了英文、精确预览还是中文。
    language: ResumeLanguage | None = None
    format_config: dict | None = None
    include_photo: bool = True
    # **未保存正文**（W04 / P0-03）：制作台里改了几句话还没点保存，精确预览也要按新内容排。
    #
    # 边界：只用于预览——不落库、不冻结交付、不触发 AI。整份内容走 schema 校验（与保存
    # 同一条 `ResumeContent`），所以长度/图片/字段上限全部继承，不会变成"预览管道
    # 可以塞任意 JSON"的后门。`None` = 用记录里已保存的那一版（旧客户端逐字不变）。
    content: ResumeContent | None = None
    # 最终交付配置预览（W04）：与 `ExportRequest` 同字段名、同语义；预览管线里脱敏是
    # 渲染前置、水印是渲染后叠加，仍是"不落库/不冻结交付/不写副本"的一次查看。
    watermark: str = Field(default="", max_length=200)
    redact: bool = False
    redact_options: RedactionOptions = Field(default_factory=RedactionOptions)
    # W16 岗位变体：用变体的内容 + 版式快照预览（解析契约同 `ExportRequest.variant_id`）。
    variant_id: int | None = Field(default=None, ge=1)


__all__ = ["ExportFormat", "ExportRequest", "PreviewPdfRequest", "RedactionOptions"]
