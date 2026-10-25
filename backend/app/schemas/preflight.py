# SPDX-License-Identifier: Apache-2.0
"""统一检查（W11 / P0-04、R03）的请求与响应 schema。

三层检查（内容 / 排版 / 产物）共用**同一个问题模型**：每条问题都有对象定位、原因、
影响、修复入口与稳定 id。前端按 `issue.id` 做"复检后是否消失"的比对，因此 id 不能
随请求次序或时间变化——它是 `code + locator` 的规范化指纹（见 `services/preflight.py`）。

**为什么不复用 ATS 的 `AtsIssue`**：ATS 那个模型只有 category/severity/detail，没有
对象定位与修复入口，而 W11 的验收要求"每项问题必须有对象定位、原因、影响、修复入口
和复检状态"。把 ATS 硬改造成通用模型会让既有 ATS 端点与前端面板跟着变——本轮只做
"编排 + 统一模型"，ATS 的判据与输出原样复用（见 `preflight_rules_content`）。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .ats import MAX_JD_TEXT_CHARS
from .export import ExportFormat
from .resume import ResumeContent, ResumeLanguage
from .resume_generation import LONG_CV_MAX_PAGES, ResumeFontScale, _validate_format_config_shape

PreflightLayer = Literal["content", "layout", "product"]
# 请求里的层可以额外点名 risk（事实风险，用户显式触发；默认层必须全本地确定性）。
PreflightRequestLayer = Literal["content", "layout", "product", "risk"]
PreflightSeverity = Literal["blocker", "verify", "suggestion"]
PreflightScope = Literal["document", "section", "object", "point", "field", "page", "export"]
PreflightFixAction = Literal[
    "focus_field",
    "apply_format_config",
    "add_page",
    "open_layout_analyze",
    "open_preflight",
    "open_settings",
    "open_preview_exact",
    "unhide_entry",
]
PreflightProductFormat = Literal["pdf", "docx"]


class PreflightLayoutInput(BaseModel):
    """草稿版式覆盖（与 `PreviewPdfRequest` 的版式字段同形）。

    草稿里换了模板 / 版式 / 页数还没保存时，检查必须按**眼前这一版**算，否则用户会
    看到"面板说没问题、导出却报错"。
    """

    model_config = ConfigDict(extra="forbid")

    template: str | None = Field(default=None, max_length=64)
    format_name: str | None = Field(default=None, max_length=64)
    # A4 长 CV：上限由文档模式决定（普通 1–3 / 长 CV 1–10）；路由按记录/变体的
    # document_mode 用 mode_page_limit 夹紧。这里放宽到 10，否则长 CV 草稿预检会 422。
    page_limit: int | None = Field(default=None, ge=1, le=LONG_CV_MAX_PAGES)
    font_scale: ResumeFontScale | None = None
    language: Literal["zh-CN", "en-US"] | None = None
    # 形状/键数上限与生成、保存两条路径共用同一个校验（不重写一份规则）。
    format_config: dict | None = None

    @field_validator("format_config", mode="before")
    @classmethod
    def _check_format_config_shape(cls, value: object) -> object:
        if value is None:
            return None
        return _validate_format_config_shape(value)


class PreflightMeasure(BaseModel):
    """浏览器量到的版面高度（mm）。

    排版诊断需要一个真实的页面尺寸。服务端可以用 PDF 引擎自己量，但草稿预览与 PDF
    的断点规则不同；用户已经在制作台里时，直接把浏览器量到的值交上来更接近他眼前的版面。
    """

    model_config = ConfigDict(extra="forbid")

    used_height: float = Field(ge=0.0, le=100_000.0)
    page_content_height: float = Field(gt=0.0, le=100_000.0)


class PreflightRequest(BaseModel):
    """统一检查请求：一个端点、三个可选层。"""

    model_config = ConfigDict(extra="forbid")

    # 未保存正文；`None` = 用记录里已保存的那一版（与精确预览同一条边界）。
    content: ResumeContent | None = None
    layout: PreflightLayoutInput | None = None
    # 默认三层；product 最贵（真渲染），但仍然只在用户主动点检查时跑。
    layers: list[PreflightRequestLayer] = Field(
        default_factory=lambda: ["content", "layout", "product"], max_length=4
    )
    product_formats: list[PreflightProductFormat] = Field(
        default_factory=lambda: ["pdf"], max_length=2
    )
    measure: PreflightMeasure | None = None
    # ATS 关键词可选：提供后才检查 JD 覆盖，不提供不发起额外规则。
    jd_text: str = Field(default="", max_length=MAX_JD_TEXT_CHARS)

    # ===== D20 导出前核对（purpose=export）=====
    #
    # edit（缺省）= 原来的编辑态检查，行为逐字不变；export = 从"导出前核对"视角检查，
    # 响应多一个 export_summary（目标岗位/文件名/联系方式/版本/隐藏条目/文档模式）。
    purpose: Literal["edit", "export"] = "edit"
    # 岗位变体（W16）：给定时正文与排版快照取自这条变体（唯一解析入口
    # document_variants.resolve_variant_export，与导出路由同一实现）。
    variant_id: int | None = Field(default=None, ge=1)
    # 以下字段是前端导出配置（ExportBundleRequest）的投影：前端会把同一份请求体直接
    # 发给 preflight 做核对。**必须收下**（本模型 extra="forbid"），否则核对请求会 422。
    # 语义与导出完全相同（由 preflight 路由按 export_bundle 的口径折算）。
    preset_id: int | None = Field(default=None, ge=1)
    formats: list[ExportFormat] | None = Field(default=None, min_length=1, max_length=6)
    watermark: str | None = Field(default=None, max_length=200)
    redact: bool | None = None
    include_photo: bool | None = None
    archive_original: bool | None = None
    resume_revision: int | None = Field(default=None, ge=0)
    strict_revision: bool = False
    margin_mm: float | None = Field(default=None, ge=4, le=40)
    font_scale: ResumeFontScale | None = None
    page_limit: int | None = Field(default=None, ge=1, le=LONG_CV_MAX_PAGES)
    format_config: dict | None = None
    language: ResumeLanguage | None = None
    allow_incomplete: bool = False

    @field_validator("format_config", mode="before")
    @classmethod
    def _check_export_format_config_shape(cls, value: object) -> object:
        if value is None:
            return None
        return _validate_format_config_shape(value)


class CheckLocator(BaseModel):
    """对象定位：与模板的 `data-resume-path` / W01 稳定 id 双向对齐。"""

    scope: PreflightScope = "document"
    section: str | None = None
    object_id: str | None = None
    point_id: str | None = None
    field: str | None = None
    # 兼容旧 data-resume-path（experience.0.description.1）。
    path: str | None = None
    page: int | None = Field(default=None, ge=1)


class CheckFix(BaseModel):
    """可执行的修复入口。

    前端按 `action` 分派到**真实既有入口**；`label_key` 是 i18n 词条键，后端不下发中文。
    `payload` 只放该动作需要的参数（字段路径 / 建议的 format_config 增量 / 目标页数）。
    """

    action: PreflightFixAction
    payload: dict = Field(default_factory=dict)
    label_key: str = Field(max_length=64)


class CheckIssue(BaseModel):
    """一条统一问题。`id` 是稳定指纹，复检按它比对。"""

    id: str = Field(max_length=16)
    layer: PreflightLayer
    severity: PreflightSeverity
    code: str = Field(max_length=64)
    title_key: str = Field(max_length=64)
    detail: str = Field(default="", max_length=2000)
    impact: str = Field(default="", max_length=600)
    locator: CheckLocator = Field(default_factory=CheckLocator)
    fix: CheckFix | None = None
    evidence: list[str] = Field(default_factory=list, max_length=20)


class PreflightSnapshot(BaseModel):
    """同一快照：所有层的结论都必须来自这一组输入。前端据此丢弃过时响应。"""

    content_sha256: str = Field(max_length=64)
    render_config_sha256: str = Field(max_length=64)
    template: str = ""
    page_limit: int = 1
    font_scale: str = "standard"
    language: str = "zh-CN"
    document_mode: Literal["resume", "long_cv"] = "resume"


class MachineTextPage(BaseModel):
    """产物层抽出来的一页文本（D11「机器读到的正文」视图）。第 1 页起，按 PDF 页码顺序。"""

    page: int = Field(ge=1)
    text: str = Field(default="", max_length=200_000)


class FontCoverageOut(BaseModel):
    """缺字/粗体可用性结论（D08）。

    ``checked=False`` 表示这台机器解析不了字体（不是"没有问题"）——前端必须显示
    "未检查"而不是绿勾。``missing`` 的键是字体角色（regular / bold），值是缺失字符；
    字太多时只回前若干个并置 ``truncated=True``。
    """

    checked: bool = False
    font: str | None = None
    bold_available: bool = True
    missing: dict[str, list[str]] = Field(default_factory=dict)
    truncated: bool = False


class TextOrderDiff(BaseModel):
    """结构化正文与产物文本的顺序/完整性差异（D11）。"""

    kind: Literal["missing", "out_of_order", "garbled"]
    token: str = Field(max_length=200)
    page: int | None = None
    expected_index: int | None = None


class ExportCheckSummary(BaseModel):
    """D20 导出前核对摘要（purpose=export 时随 preflight 响应返回）。

    字段与前端 ExportCheckSummary 逐字对应（fe-delivery 已按此实现）；数值都取自
    **这次核对使用的同一份快照**（变体/草稿正文 + 生效版式），不另算一份。
    """

    target_company: str = ""
    target_job_title: str = ""
    resume_title: str = ""
    contact_present: bool = False
    document_mode: Literal["resume", "long_cv"] = "resume"
    revision: int = 0
    revision_changed: bool = False
    hidden_count: int = 0


class PreflightOut(BaseModel):
    snapshot: PreflightSnapshot
    issues: list[CheckIssue] = Field(default_factory=list, max_length=200)
    # blocker / verify / suggestion 的计数（前端顶部徽标直接显示）。
    summary: dict[str, int] = Field(default_factory=dict)
    # format -> capability -> level；前端不另写一份矩阵。
    capabilities: dict[str, dict[str, str]] = Field(default_factory=dict)
    # ATS / 产物免责声明（逐字复用 `ATS_DISCLAIMER`）。
    disclaimer: str = ""
    # 本轮实际执行的层（前端据此说明"产物层未检查"是没点还是不支持）。
    # 允许出现 risk：它是内容层的显式追加，不新增第四种 issue layer。
    layers_run: list[PreflightRequestLayer] = Field(default_factory=list)
    # 累计耗时（毫秒），用于"检查太慢"的诊断，不含模型调用。
    elapsed_ms: int = Field(default=0, ge=0)
    # D11：产物层抽到的逐页文本；没跑产物层时为空（不是"没有文本"）。
    machine_text: list[MachineTextPage] = Field(default_factory=list, max_length=20)
    # D08：缺字/粗体可用性；没跑或本机解析不了字体时为 None（前端显示"未检查"）。
    font_coverage: FontCoverageOut | None = None
    # D11：结构化正文与产物文本的差异（missing / out_of_order / garbled）。
    order_diffs: list[TextOrderDiff] = Field(default_factory=list, max_length=50)
    # D20：导出前核对摘要；只有 purpose=export 时才有值（编辑态检查为 None，
    # 旧客户端读不到这个键也不受影响）。
    export_summary: ExportCheckSummary | None = None


__all__ = [
    "CheckFix",
    "CheckIssue",
    "CheckLocator",
    "ExportCheckSummary",
    "FontCoverageOut",
    "MachineTextPage",
    "TextOrderDiff",
    "PreflightLayoutInput",
    "PreflightLayer",
    "PreflightMeasure",
    "PreflightOut",
    "PreflightRequest",
    "PreflightRequestLayer",
    "PreflightSeverity",
    "PreflightSnapshot",
]
