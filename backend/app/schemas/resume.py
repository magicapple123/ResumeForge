# SPDX-License-Identifier: Apache-2.0
"""简历 Schema：生成请求、LLM 输出结构、历史记录。"""

from datetime import datetime
from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profile import validate_photo_data_url

# 版面诊断（「自动一页」）那一组模型已迁至 ``schemas/resume_analysis.py`` 以满足单文件
# 500 行预算；这里 re-export，保持
# ``from app.schemas.resume import LayoutAnalyzeRequest`` 等既有导入路径不变。
from .resume_analysis import (  # noqa: F401  (re-export：保持既有导入路径)
    LayoutAnalyzeOut,
    LayoutAnalyzeRequest,
    LayoutDiagnosisOut,
    LayoutFitCandidateOut,
    LayoutFitRoomOut,
    LayoutPageOut,
    LayoutSuggestionOut,
    ResumeLayoutMeasure,
)
from .resume_creation import ProfileContextIn

# 六类旧条目模型与正文常量已迁至 `schemas/resume_entries.py`：A4 给项目/经历补可选
# 字段（public_url / artifact_type / experience_kind）后本文件到了 500 行硬预算。
# 这里 re-export，保持 `from app.schemas.resume import ResumeProject` 等既有导入路径不变。
from .resume_credentials import ResumeCredential

# C2/R-79 自建分区结构已迁至 `schemas/resume_custom_sections.py`（resume.py 贴着 500 行
# 硬预算）；这里 re-export，保持 `from app.schemas.resume import ResumeCustomSection` 等
# 既有导入路径不变。
from .resume_custom_sections import (  # noqa: F401  (re-export：保持既有导入路径)
    ResumeCustomEntry,
    ResumeCustomLine,
    ResumeCustomSection,
)
from .resume_entries import (  # noqa: F401  (re-export：保持既有导入路径)
    EXPERIENCE_KINDS,
    MAX_RESUME_LIST_ITEMS,
    MAX_RESUME_SECTION_ITEMS,
    MAX_RESUME_TEXT_CHARS,
    ResumeAward,
    ResumeCampusExperience,
    ResumeEducation,
    ResumeExperience,
    ResumeLine,
    ResumeProject,
    ResumeSkill,
)

# 生成参数（版式常量 + ``GenerateOptions``/``GenerateRequest``）已迁至
# ``schemas/resume_generation.py`` 以满足单文件 500 行预算；这里 re-export，
# 保持 ``from app.schemas.resume import GenerateOptions`` 等既有导入路径不变。
from .resume_generation import (  # noqa: F401  (re-export：保持既有导入路径)
    LONG_CV_DEFAULT_PAGE_LIMIT,
    LONG_CV_MAX_PAGES,
    MAX_CUSTOM_INSTRUCTION_CHARS,
    MAX_FORMAT_CONFIG_KEYS,
    MAX_RESUME_PAGES,
    MIN_CUSTOM_INSTRUCTION_CHARS,
    MODE_PAGE_LIMITS,
    RESUME_MODES,
    GenerateOptions,
    GenerateRequest,
    ResumeFontScale,
    ResumeLanguage,
    ResumeMode,
    _validate_format_config_shape,
    mode_page_limit,
)
from .resume_identity import OptionalEmptyListMixin, OptionalIdentityMixin
from .resume_profile_usage import ProfileUsageOut
from .resume_research import ResumePatent, ResumePublication, ResumeResearchProject

# 简历备注的上限：列表默认可见（ellipsis + tooltip）、详情可编辑。
MAX_RESUME_NOTE_CHARS = 2000


class ResumeContent(OptionalEmptyListMixin, BaseModel):
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
    # W14 科研三栏目：空列表不序列化（旧记录内容指纹逐字节不变，D11；见 OptionalEmptyListMixin）。
    publications: list[ResumePublication] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    research_projects: list[ResumeResearchProject] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    patents: list[ResumePatent] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    # A4 资格证照（零新表：存在 content JSON 内）。**没有 credential_number**：证号默认
    # 不进模型/纸面/导出（见 schemas/resume_credentials.py）。空列表不序列化 → 旧指纹不变。
    credentials: list[ResumeCredential] = Field(default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS)
    # C2/R-79 自建大字段独立成栏：顺序由投影层冻结（13 个系统分区之后、资料页全局顺序），
    # 渲染端不再排序。两个硬边界：①空列表不序列化 → 没有自建分区的旧内容指纹/字节不变；
    # ②它只是「纸面要画什么」，title/lines 已在 schema 侧校验，模板不猜业务。
    custom_sections: list[ResumeCustomSection] = Field(
        default_factory=list, max_length=MAX_RESUME_SECTION_ITEMS
    )
    _optional_empty_list_fields: ClassVar[tuple[str, ...]] = (
        "publications",
        "research_projects",
        "patents",
        "credentials",
        "custom_sections",
    )

    @field_validator("photo")
    @classmethod
    def photo_must_be_safe_image(cls, value: str) -> str:
        return validate_photo_data_url(value)


class FactAnnotation(OptionalIdentityMixin, BaseModel):
    """一条内容的事实来源标注（RF-13）：这段内容是从哪条资料事实来的。

    ``origin`` 三类由 grounding 收集（纯映射、不调模型）：
    - ``grounded``：值级替换成功——模型选中的要点映射回了来源原文；
    - ``restored``：匹配失败，回填了来源原文（或代码重建的事实摘要）；
    - ``enhanced_kept``：美化模式下模型改写被保留（量化断言已过校验）。
    ``ai_rewrite`` / ``user_added`` 只出现在审阅预检的待审变更里。
    """

    _optional_identity_fields: ClassVar[tuple[str, ...]] = ("object_id", "point_id")

    path: str = Field(max_length=256)
    # W01：稳定的对象定位。有 ``object_id`` 时路径按当前下标现算，排序后自动跟着走；
    # 只有 ``path`` 的旧标注允许错位——这是明确的退化，界面要能看见（不猜测、不迁移）。
    object_id: str | None = Field(default=None, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)
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
    # 建**草稿**（见 ``models.resume`` 的 ``draft`` 说明）：只有「前往简历制作台」传 true，
    # 缺省 false 让手写保存与通用简历的调用方逐字不变；草稿在制作台里保存过才进列表。
    draft: bool = Field(default=False)
    language: ResumeLanguage = "zh-CN"
    # 这份简历自己的版式覆盖（P0-5）：缺省时后端用「我的资料」的顺序物化一次
    # （``default_section_order_config``）。**缺省是"不涉及"而不是"清空"**：请求体里没有这个
    # 字段的既有调用方（手写保存、通用简历）行为逐字不变，只是多得到一份默认板块顺序。
    format_config: dict | None = None
    # F4：创建态资料快照（可选）。缺省 = 旧客户端，不写 profile_usage_snapshot。
    profile_context: ProfileContextIn | None = None


class ResumeReviseRequest(BaseModel):
    """修订已有简历的请求：指令为空表示整体重新生成，非空表示只改提出的内容。"""

    model_config = ConfigDict(extra="forbid")
    instructions: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)
    # 发起修订时的那一版（W02）：模型跑完回来用它做条件写。期间若别的窗口保存过，
    # 落库会 409，这次模型结果直接丢弃——不覆盖别人刚写的内容。
    base_revision: int | None = Field(default=None, ge=0)


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
    # 纸面固定文案的语言（小节标题 / 字段前缀）。旧后端或旧缓存缺这个字段时按 "zh-CN" 兜。
    language: ResumeLanguage = "zh-CN"
    created_at: datetime
    # 最近修改时间（R14-b）：与默认排序 ``updated_desc`` 同源，由 ``ResumeRecord.updated_at``
    # （ORM ``onupdate``）经 ``from_attributes`` 读取；迁移 0047 已回填旧行，默认值只兼容缺属性。
    updated_at: datetime | None = None
    # 保存次数（0052）：列表页要它才能做乐观更新——用户从列表点进制作台时记下的是这一版，
    # 保存时把它当 ``expected_revision`` 发回去。旧后端没有这个字段，默认 0 不改变任何行为。
    revision: int = 0
    # 文档模式（W14/0054）：普通简历 1–3 页 / 长 CV 1–10 页。旧行 server_default 读作 resume。
    document_mode: ResumeMode = "resume"


class ResumeOut(ResumeBrief):
    content: ResumeContent
    warnings: list[str] = []
    parse_error: str = ""
    # 版本血缘（RF-17）：由哪份简历派生而来；NULL = 独立版本，不做推断。
    parent_revision_id: int | None = None
    # 生成说明与"没写进这份简历"的结构化清单：只对 AI 生成记录有意义，手写/修订后为空。
    rationale: str = ""
    coverage_notes: list[dict] = []
    # 事实来源标注：只对 AI 生成的记录有意义；旧记录读取 `or []` 兜底。
    fact_annotations: list[FactAnnotation] = []
    # 制作台草稿（0051）：还没保存过，所以不进任何列表；必须回传给详情接口，否则制作台
    # 顶部没有「保存」可点，草稿永远进不了简历中心。
    draft: bool = False
    # 本次生成的职业场景上下文快照（0061）：server-owned 只读元数据；NULL = 未记录
    # （旧简历/手写简历）。**不参与内容哈希、不自动印到纸面**；前端只做"这份简历当时
    # 采用了什么场景"的只读说明，不得据此回填或改写任何内容。
    context_snapshot: dict | None = None
    # 「本次使用」追溯快照（R-33）：生成/新建时冻结的组名与参与大字段；NULL = 旧简历或
    # 未带来源信息的手写简历。**只由详情端点填充**（列表不带它，也不需要多一次快照查询）。
    profile_usage: ProfileUsageOut | None = None


class ResumeContentSave(BaseModel):
    """内容保存的**条件写**请求（W02）：正文 + "我是基于哪一版改的"。

    为什么把版本号放进 body 而不是 header：① 正文与版本必须同源同事务——同一次校验里
    既认"要写什么"也认"基于哪版"，``extra="forbid"`` 保证版本号不会被静默忽略；
    ② 冲突的业务码已经走响应体（``client.ts`` 的 ``extractError`` 读顶层 ``code``），
    版本号再走 header 会分裂成两套错误契约；③ 旧端点 ``PUT /{id}`` 的 body 形状
    一个字节都不改，旧客户端不受影响。

    ``expected_revision=None`` 表示"不做版本比较"（等价旧行为：无条件写并推进一版）。
    """

    model_config = ConfigDict(extra="forbid")

    content: ResumeContent
    expected_revision: int | None = Field(default=None, ge=0)


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
    # W14：无记录的即时预览也要知道文档模式，否则长 CV 草稿的 10 页请求会被 422。
    document_mode: ResumeMode = "resume"
    page_limit: int = Field(default=1, ge=1)  # 路由按模式夹紧（W14）
    font_scale: ResumeFontScale = "standard"
    # 版式语言：只影响小节标题与字段前缀。None = 这次不涉及（用记录里的值）。
    # **必须收下这个字段**：本 schema 是 extra="forbid"，漏了它前端草稿渲染会直接 422。
    language: ResumeLanguage | None = None
    # 这份内容的临时版式覆盖（叠加在 format_name 之上）。「自动一页」用它逐档试版式，
    # 试出来之前不落库——不落库的预览走的就是这条路。
    format_config: dict = Field(default_factory=dict)


class ResumeLayoutUpdate(BaseModel):
    """只调整已有记录的版式参数，不重新生成内容。"""

    model_config = ConfigDict(extra="forbid")

    template: str = Field(default="classic", max_length=64)
    format_name: str = Field(default="", max_length=64)
    # W14：页数上限随文档模式变化；真正的夹紧在路由里用 mode_page_limit(value, mode)。
    document_mode: ResumeMode | None = None
    page_limit: int = Field(default=1, ge=1)  # 路由按模式夹紧（W14：4→3、11→10）
    font_scale: ResumeFontScale = "standard"
    # 语言：**None = 这次不涉及**，绝不能给 "zh-CN" 默认值——本接口是整体替换，
    # 带默认值就等于"拖动一次字号滑杆"静默把英文简历改回中文，而用户看不出发生了什么。
    language: ResumeLanguage | None = None
    # 按简历的版式覆盖。「自动一页」把试出来的方案写在这里。
    # **None 表示不动它**（与空字典区分开）：空字典是"清掉覆盖"，None 是"这次不涉及"。
    format_config: dict | None = None
    # 打开制作台时那一版（W02）：带上就条件写，不带就无条件写并推进一版（旧行为）。
    # 版式与正文共用一个 ``revision``：拖动滑杆也是"改了这份简历"，两个窗口各自存一半
    # 版式同样会互相覆盖，所以版式保存也要参与版本判定。
    expected_revision: int | None = Field(default=None, ge=0)


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
