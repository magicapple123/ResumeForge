"""简历 Schema：生成请求、LLM 输出结构、历史记录。"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profile import validate_photo_data_url

# 生成参数（版式常量 + ``GenerateOptions``/``GenerateRequest``）已迁至
# ``schemas/resume_generation.py`` 以满足单文件 500 行预算；这里 re-export，
# 保持 ``from app.schemas.resume import GenerateOptions`` 等既有导入路径不变。
from .resume_generation import (  # noqa: F401  (re-export：保持既有导入路径)
    MAX_CUSTOM_INSTRUCTION_CHARS,
    MAX_FORMAT_CONFIG_KEYS,
    MAX_RESUME_PAGES,
    MIN_CUSTOM_INSTRUCTION_CHARS,
    GenerateOptions,
    GenerateRequest,
    ResumeFontScale,
    _validate_format_config_shape,
)

MAX_RESUME_SECTION_ITEMS = 200
MAX_RESUME_LIST_ITEMS = 500
MAX_RESUME_TEXT_CHARS = 50_000
ResumeLine = Annotated[str, Field(max_length=20_000)]


# 简历备注的上限：列表默认可见（ellipsis + tooltip）、详情可编辑。
MAX_RESUME_NOTE_CHARS = 2000


# ===== 简历内容结构（LLM 输出的 JSON 必须符合此结构） =====
# 与个人资料的差异：多行文本拆成了数组，更利于模型逐条输出与后续渲染。
class ResumeEducation(BaseModel):
    school: str = Field(default="", max_length=128)
    major: str = Field(default="", max_length=128)
    degree: str = Field(default="", max_length=32)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    gpa: str = Field(default="", max_length=64)
    courses: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    achievements: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)


class ResumeExperience(BaseModel):
    company: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)


class ResumeCampusExperience(BaseModel):
    organization: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)


class ResumeProject(BaseModel):
    name: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    tech_stack: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    highlights: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)


class ResumeSkill(BaseModel):
    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)


class ResumeAward(BaseModel):
    name: str = Field(default="", max_length=256)
    date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=20_000)


class ResumeContent(BaseModel):
    name: str = Field(default="", max_length=128)
    photo: str = ""
    gender: str = Field(default="", max_length=64)
    birth_year: str = Field(default="", max_length=32)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=128)
    city: str = Field(default="", max_length=64)
    # 公开作品链接：与电话/邮箱不同，它们本来就是放简历用的（模型生成时会从资料
    # 里读到，修订时也允许按指令改写）；没有就是空串，模板渲染时跳过。
    personal_website: str = Field(default="", max_length=256)
    github: str = Field(default="", max_length=256)
    job_intent: str = Field(default="", max_length=128)
    summary: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    education: list[ResumeEducation] = Field(
        default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS
    )
    experience: list[ResumeExperience] = Field(
        default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS
    )
    campus_experience: list[ResumeCampusExperience] = Field(
        default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS
    )
    projects: list[ResumeProject] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    skills: list[ResumeSkill] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    awards: list[ResumeAward] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)

    @field_validator("photo")
    @classmethod
    def photo_must_be_safe_image(cls, value: str) -> str:
        return validate_photo_data_url(value)


class FactAnnotation(BaseModel):
    """一条内容的事实来源标注（RF-13）：这段内容是从哪条资料事实来的。

    ``origin`` 三类由 grounding 收集（纯映射、不调模型）：
    - ``grounded``：值级替换成功——模型选中的要点映射回了来源原文；
    - ``restored``：匹配失败，回填了来源原文（或代码重建的事实摘要）；
    - ``enhanced_kept``：美化模式下模型改写被保留（量化断言已过校验）。
    ``ai_rewrite`` / ``user_added`` 只出现在审阅预检的待审变更里。
    """

    path: str = Field(max_length=256)
    origin: Literal["grounded", "restored", "enhanced_kept", "ai_rewrite", "user_added"]
    # 台账回指：生成时无法可靠回指（无 DB 上下文），预检/编辑链路可填。
    claim_id: int | None = None
    source_subject: str | None = Field(default=None, max_length=256)
    source_fact: str | None = Field(default=None, max_length=20_000)
    responsibility: str | None = Field(default=None, max_length=64)
    boundary: str | None = Field(default=None, max_length=20_000)
    # AI 改写类标注绝不允许携带"已确认"——前端渲染层也有一道同样的防线。
    verification_status: str | None = Field(default=None, max_length=16)


class ManualResumeRequest(BaseModel):
    """用户手写简历的保存请求；内容仍使用统一的结构化格式。"""

    model_config = ConfigDict(extra="forbid")
    job_id: int | None = Field(default=None, ge=1)
    title: str = Field(default="", max_length=256)
    content: ResumeContent


class ResumeReviseRequest(BaseModel):
    """修订已有简历的请求：指令为空表示整体重新生成，非空表示只改提出的内容。"""

    model_config = ConfigDict(extra="forbid")
    instructions: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)


class ResumeBrief(BaseModel):
    """列表页不携带完整 content，避免大 JSON 反复传输。"""

    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    job_id: int | None = None
    job_title: str
    company: str
    source: Literal["ai", "manual"] = "ai"
    favorite: bool = False
    model: str
    enhancement_enabled: bool
    enhancement_level: Literal["light", "balanced", "strong"]
    # 用户给这份简历写的备注（列表默认可见，详情可编辑）。
    note: str = Field(default="", max_length=MAX_RESUME_NOTE_CHARS)
    # 生成/最近一次渲染时使用的版式参数，重新打开预览或导出时保持一致。
    template: str = "classic"
    format_name: str = ""
    # 只属于这份简历的版式覆盖（「自动一页」写在这里）。空字典表示没有覆盖。
    format_config: dict = Field(default_factory=dict)
    page_limit: int = 1
    font_scale: ResumeFontScale = "standard"
    created_at: datetime
    # 最近修改时间（R14-b）：列表新增「最近修改」列，与默认排序 ``updated_desc`` 同源。
    # 由 ``ResumeRecord.updated_at``（ORM ``onupdate``）经 ``from_attributes`` 直接读取；
    # 迁移 0047 已用 ``created_at`` 回填旧行，这里给默认值只是兼容只读投影缺该属性的场景。
    updated_at: datetime | None = None


class ResumeOut(ResumeBrief):
    content: ResumeContent
    warnings: list[str] = []
    parse_error: str = ""
    # 版本血缘（RF-17）：由哪份简历派生而来；NULL = 独立版本，不做推断。
    parent_revision_id: int | None = None
    # 生成说明与"没写进这份简历"的结构化清单：只对 AI 生成的记录有意义，
    # 手写/修订后的记录为空（修订后筛选状态已不再适用）。
    rationale: str = ""
    coverage_notes: list[dict] = []
    # 事实来源标注：只对 AI 生成的记录有意义；旧记录读取 `or []` 兜底。
    fact_annotations: list[FactAnnotation] = []


class DeliverySummary(BaseModel):
    """一条交付记录的摘要（RF-17）：回答"这一版投给了谁、什么时候、内容是什么"。

    刻意**不返回 ``content`` 全文**（含照片 base64，体积大）——列表只需要
    "有这份证据、指纹是多少"；要正文走导出/详情，不在列表里反复传输。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    source: str
    job_title: str = ""
    company: str = ""
    resume_title: str = ""
    export_format: str = ""
    filename: str = ""
    pages: int | None = None
    content_sha256: str = ""
    rendered_config_sha256: str = ""


class DeliveryDetail(DeliverySummary):
    """一条交付记录的**详情**（PR-09 可信交付账本）：独立访问入口的响应体。

    与摘要的分工：列表只回答"有这份证据、指纹是多少"；详情面向"原简历已删后
    仍要能回答这份证据是什么、能不能重放"的独立入口
    （``GET /api/resumes/deliveries/{id}``），因此带上渲染上下文与实际生效的
    请求参数。旧快照缺这些列时为 ``None``/空——前端据此标注「不可还原」，
    不编造数据。
    """

    # 实际生效的渲染上下文（模板/样式/版式）；旧快照为空 dict。
    render_context: dict = Field(default_factory=dict)
    # 实际生效的导出请求参数；None = 无导出请求（apply/track）或旧快照（不可还原）。
    request_params: dict | None = None
    # 双指纹拆分（PR-09）：导出前源内容哈希 / 导出产物字节哈希。旧行为 NULL。
    source_content_sha256: str | None = None
    artifact_sha256: str | None = None
    # 幂等键：代表哪一次真实投递动作；旧记录为 None（如实显示"未记录"）。
    idempotency_key: str | None = None
    # 该快照是否可从存档重放导出（有导出格式 + 有实际请求参数）。
    replayable: bool = False
    # 目的地快照是否完整：旧版本快照没有目的地字段（company/job_title 全空）时
    # 为 False——前端显示"目的地未记录"，不猜。
    destination_recorded: bool = True


class GenerateTaskOut(BaseModel):
    """简历生成后台任务的对外状态（前端按 1.5s 轮询）。

    ``status`` 取值与 ``models.resume`` 顶部的生成状态常量一致。``message`` 是后端
    最近一条 progress 文案，前端用它映射阶段条；``received_chars`` 只做字数计数、
    不做百分比（总长未知）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    resume_id: int | None = None
    error: str = ""
    message: str = ""
    received_chars: int = 0
    job_id: int | None = None
    title: str = ""
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ResumeFavoriteUpdate(BaseModel):
    """只更新收藏状态，避免切换收藏时覆盖整份简历内容。"""

    favorite: bool


class ResumeTitleUpdate(BaseModel):
    """只更新简历名称，避免重命名时覆盖整份简历内容。"""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=256)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("简历名称不能为空")
        return cleaned


class ResumeNoteUpdate(BaseModel):
    """只更新简历备注，避免改备注时覆盖整份简历内容。"""

    model_config = ConfigDict(extra="forbid")
    note: str = Field(default="", max_length=MAX_RESUME_NOTE_CHARS)


class ResumeSuggestion(BaseModel):
    """岗位化修改建议；每条建议都必须能回溯到简历或 JD 中的事实。"""

    priority: Literal["high", "medium", "low"] = "medium"
    section: str = Field(default="", max_length=128)
    issue: str = Field(default="", max_length=10_000)
    suggestion: str = Field(default="", max_length=10_000)
    evidence: list[Annotated[str, Field(max_length=2000)]] = Field(
        default_factory=list, max_length=20
    )


class ResumeSuggestionsOut(BaseModel):
    job_id: int
    job_title: str
    company: str
    suggestions: list[ResumeSuggestion] = Field(default_factory=list, max_length=20)


class ResumeRenderRequest(BaseModel):
    """生成完成后、未落库前的即时预览渲染；版式参数可选，缺省用默认单页标准字号。"""

    model_config = ConfigDict(extra="forbid")

    content: ResumeContent
    template: str = Field(default="classic", max_length=64)
    format_name: str = Field(default="", max_length=64)
    page_limit: int = Field(default=1, ge=1, le=MAX_RESUME_PAGES)
    font_scale: ResumeFontScale = "standard"
    # 这份内容的临时版式覆盖（叠加在 format_name 之上）。「自动一页」用它逐档试版式，
    # 试出来之前不落库——不落库的预览走的就是这条路。
    format_config: dict = Field(default_factory=dict)


class ResumeLayoutUpdate(BaseModel):
    """只调整已有记录的版式参数，不重新生成内容。"""

    model_config = ConfigDict(extra="forbid")

    template: str = Field(default="classic", max_length=64)
    format_name: str = Field(default="", max_length=64)
    page_limit: int = Field(default=1, ge=1, le=MAX_RESUME_PAGES)
    font_scale: ResumeFontScale = "standard"
    # 按简历的版式覆盖。「自动一页」把试出来的方案写在这里。
    # **None 表示不动它**（与空字典区分开）：空字典是"清掉覆盖"，None 是"这次不涉及"。
    format_config: dict | None = None


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
    """版面诊断请求：把浏览器量到的两个高度发过来，规则由后端算。"""

    model_config = ConfigDict(extra="forbid")

    measure: ResumeLayoutMeasure


class LayoutAnalyzeOut(BaseModel):
    diagnosis: LayoutDiagnosisOut
    # 逐档收紧的版式清单。内容本来就放得下时为空。
    fit_ladder: list[LayoutFitCandidateOut] = Field(default_factory=list)
    fit_room: LayoutFitRoomOut


# ===== 待审变更预检（RF-13）：编辑器里的 AI 改写/手填，先过三把既有闸门再落表单 =====

ReviewChangeOrigin = Literal["ai_rewrite", "user_added"]


class ReviewChangeIn(BaseModel):
    """一条待审变更：``path`` 是 data-resume-path 写法的字段路径。"""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=256)
    before: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    after: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    origin: ReviewChangeOrigin = "ai_rewrite"
    instruction: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)


class ReviewPrepareRequest(BaseModel):
    """预检请求：**不落库、不改 content**——纯审阅预检。"""

    model_config = ConfigDict(extra="forbid")

    changes: list[ReviewChangeIn] = Field(default_factory=list, max_length=50)


class ReviewChangeVerdictOut(BaseModel):
    """一条变更的预检结论：``ok`` / ``fact_check_needed`` / ``blocked`` + 原因。"""

    path: str
    verdict: Literal["ok", "fact_check_needed", "blocked"]
    reasons: list[str] = Field(default_factory=list)


class ReviewPrepareOut(BaseModel):
    results: list[ReviewChangeVerdictOut] = Field(default_factory=list)


class ResumeBatchRequest(BaseModel):
    """批量操作请求：与 ``schemas.job.JobBatchRequest`` 同款口径（去重 + 上限 5000）。"""

    resume_ids: list[int] = Field(max_length=5000)

    @field_validator("resume_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("请至少选择一份简历")
        unique_ids = list(dict.fromkeys(value))
        return unique_ids


class ResumeBatchDeleteResult(BaseModel):
    deleted: int
