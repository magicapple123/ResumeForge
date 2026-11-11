# SPDX-License-Identifier: Apache-2.0
"""AI 求职助手请求、会话和消息结构。"""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .assistant_compaction import ContextCompactionStateOut
from .material import MAX_MATERIAL_TITLE_CHARS

MAX_ASSISTANT_MESSAGE_CHARS = 20_000
MAX_ATTACHMENT_DATA_CHARS = 7_100_000
ConversationSurface = Literal["page", "floating"]


class AssistantAttachmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(default="", max_length=100)
    data: str = Field(min_length=1, max_length=MAX_ATTACHMENT_DATA_CHARS)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("附件名称无效")
        return value


# 思考强度的**常见取值**（不含"不发送"的空串）：`none`=明确关闭、low/medium/high=档位，
# `minimal`/`xhigh`/`max` 见各家的推理模型文档。**它只是建议，不是白名单**——各家的档位
# 词汇不一样，所以界面上允许自定义，这里只约束格式。
REASONING_EFFORT_SUGGESTIONS = ("none", "low", "medium", "high")

# 自定义档位的格式：ASCII 标识符风格，长度 ≤32。放行的是"服务商自创的词"（xhigh、max…），
# 挡住的是空白、中文、超长串这类一定发不出去的值。
REASONING_EFFORT_PATTERN = r"^[A-Za-z0-9._-]*$"
MAX_REASONING_EFFORT_CHARS = 32


def normalize_reasoning_effort(value: str) -> str:
    """校验并归一化思考强度；空串表示"不发送该参数"（沿用服务商默认）。"""
    effort = str(value or "").strip()
    if not effort:
        return ""
    if len(effort) > MAX_REASONING_EFFORT_CHARS:
        raise ValueError(f"思考强度不能超过 {MAX_REASONING_EFFORT_CHARS} 个字符")
    if not re.fullmatch(REASONING_EFFORT_PATTERN, effort):
        raise ValueError("思考强度只能包含字母、数字、点、下划线和连字符")
    return effort


#: T25 界面上下文里 selected.type 的白名单（与后端重查表一一对应）。
CLIENT_SELECTION_TYPES = (
    "job",
    "resume",
    "material",
    "claim",
    "knowledge",
    "tracker",
    "reminder",
    "interview_experience",
)


class AssistantClientSelection(BaseModel):
    """用户选中对象的**结构化标识**：只收 type+id，不收标题/正文（T25）。"""

    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "job",
        "resume",
        "material",
        "claim",
        "knowledge",
        "tracker",
        "reminder",
        "interview_experience",
    ]
    id: int = Field(ge=1)


class AssistantClientContext(BaseModel):
    """当前界面上下文（T25）：route/view 也只是线索，标题一律由服务端重查。"""

    model_config = ConfigDict(extra="forbid")

    route: str = Field(default="", max_length=160)
    view: str = Field(default="", max_length=64)
    selected: AssistantClientSelection | None = None


class AssistantMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(default="", max_length=MAX_ASSISTANT_MESSAGE_CHARS)
    job_id: int | None = Field(default=None, ge=1)
    resume_id: int | None = Field(default=None, ge=1)
    # 保留字段是为了兼容旧版客户端，但现在助手默认读取本地完整个人资料，前端不再提供
    # 关闭开关。无论旧客户端传 false 还是新客户端省略，都在校验后归一为 True。
    include_profile: bool = True
    web_search: bool = False
    # 写入授权（RF-01）：用户对**本次请求**显式同意助手写库的唯一通道，默认 False
    # （只读问答，行为与历史版本一致）。True 时写工具直接执行；False 时写工具转为
    # 待确认提案（REST 端点批准后才执行）。模型文本声称"用户已确认"改变不了它。
    allow_write: bool = False
    # T11 数据权限的「读」轴请求级覆盖：None = 沿用全局设置（旧客户端零改动），
    # True/False = 本次请求覆盖。流式路径每轮工具循环必须认这个覆盖，否则覆盖会被静默忽略。
    relaxed_mode: bool | None = None
    # 有思考模式的大模型可以在这里调整推理强度；不支持该参数的服务商会被忽略。
    # 取值可以自定义（各家档位词汇不同），格式见 `normalize_reasoning_effort`。
    reasoning_effort: str = Field(default="", max_length=MAX_REASONING_EFFORT_CHARS)

    @field_validator("reasoning_effort")
    @classmethod
    def check_reasoning_effort(cls, value: str) -> str:
        return normalize_reasoning_effort(value)

    # 「引用某条消息追问」：指向同一会话里的某条消息，模型会在引用上下文中作答。
    quoted_message_id: int | None = Field(default=None, ge=1)
    attachments: list[AssistantAttachmentInput] = Field(default_factory=list, max_length=4)
    # 本次请求的界面语言（`zh-CN` / `en-US` 这类 BCP 47 标记）。**前端可选传**：
    # 不传就是空串，旧客户端零改动。它不是简历输出语言，只服务 #35 数据边界审计的
    # `language` 一列；权威值仍是用户显式保存的界面语言（`PUT /api/settings/locale`），
    # 这里只是"用户还没保存过界面语言"时的一次补充。
    locale: str = Field(default="", max_length=16)
    # T25 共享应用状态：用户在哪一页、选中了哪条记录。**前端输入不可信**——后端会按
    # 当前数据集重查对象并取服务端标题（见 api/assistant_client_context.py）。
    client_context: AssistantClientContext | None = None

    @field_validator("locale")
    @classmethod
    def strip_locale(cls, value: str) -> str:
        # 审计日志按 `language=<值>` 直接 grep，前后的空白会破坏这个契约。
        return (value or "").strip()

    @model_validator(mode="after")
    def require_content_or_attachment(self):
        self.content = self.content.strip()
        self.include_profile = True
        if not self.content and not self.attachments:
            raise ValueError("请输入问题或添加附件")
        return self


AssistantPermissionLevel = Literal["read_only", "read_full", "write_confirm", "write_full"]


class AssistantPermissionSetting(BaseModel):
    """求职助手数据权限档位（T11）：一档同时决定读、写两轴。

    默认「仅查看」，与旧版 assistant_relaxed_mode=False 等价；写新键时同步写旧键，
    仍在读旧键的路径不会与四档分叉。四档 → 两轴的映射在 services/settings_service.py。
    """

    model_config = ConfigDict(extra="forbid")

    permission: AssistantPermissionLevel = "read_only"


class ChatConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=120)
    surface: ConversationSurface = "page"
    # 为真时自动附上一条引导消息（介绍助手功能与用法），用于首次进入创建默认会话。
    welcome: bool = False
    # T14：新建对话时一次事务写入要启用的技能（空态先勾技能、发第一条消息时带上）。
    # 上限由服务层校验（>8 → 422 中文提示，见 services/assistant/assistant_skills.py）。
    # 这里只留一个防滥用的硬上限（200 远大于 8，路由仍会给出中文错误）。
    skill_ids: list[int] = Field(default_factory=list, max_length=200)


class ChatConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=120)
    pinned: bool | None = None
    favorite: bool | None = None
    archived: bool | None = None
    # 分组名（"移动到项目"）；空串表示移出分组。
    group_name: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def require_update(self):
        if all(
            value is None
            for value in (self.title, self.pinned, self.favorite, self.archived, self.group_name)
        ):
            raise ValueError("至少提供一个要修改的会话字段")
        return self

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if not value:
            raise ValueError("会话标题不能为空")
        return value

    @field_validator("group_name")
    @classmethod
    def group_name_must_be_clean(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split())[:64]


class ConversationSkillOut(BaseModel):
    """对话里已启用的一项技能（菜单一次拿全：名称 + 一句话适用场景）。"""

    id: int
    name: str
    description: str = ""


class ConversationSkillLoadOut(BaseModel):
    """单个技能在本对话里的加载明细（R05）：完整块多长、实际拼进去多长。

    ``loaded_chars == requested_chars`` 未截断；``0 < loaded < requested`` 被截断；
    ``loaded_chars == 0`` 整块因预算跳过。前端只用它显示，不自己重算预算。
    """

    skill_id: int
    requested_chars: int = 0
    loaded_chars: int = 0


class ConversationSkillBudgetOut(BaseModel):
    """本对话的技能注入预算（前端菜单右侧显示"X / 12,000 字"并给截断 chip 标黄）。"""

    used_chars: int = 0
    loaded_chars: int = 0
    limit_chars: int = 12_000
    # 提示词被截断、或因预算整块未加载的技能 id：界面上两者都算"没完整加载"。
    truncated_skill_ids: list[int] = Field(default_factory=list)
    # 逐技能明细（R05）；默认空列表——不含该字段的旧响应照样能通过校验。
    per_skill: list[ConversationSkillLoadOut] = Field(default_factory=list)


class ConversationSkillsOut(BaseModel):
    """`GET/PUT /api/assistant/conversations/{id}/skills` 的统一载荷。"""

    skill_ids: list[int] = Field(default_factory=list)
    skills: list[ConversationSkillOut] = Field(default_factory=list)
    budget: ConversationSkillBudgetOut = Field(default_factory=ConversationSkillBudgetOut)


class ConversationSkillsUpdate(BaseModel):
    """整体替换一个对话启用的技能。上限（8 个）在服务层校验，以便返回中文提示。"""

    model_config = ConfigDict(extra="forbid")

    skill_ids: list[int] = Field(default_factory=list, max_length=200)


class ChatConversationForkRequest(BaseModel):
    """「在新对话中继续」：把原会话最近若干条消息复制成一段新会话。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=120)
    message_limit: int = Field(default=10, ge=1, le=40)


class ChatMessageDeleteRequest(BaseModel):
    """批量删除消息（一次最多 200 条）。"""

    model_config = ConfigDict(extra="forbid")

    message_ids: list[int] = Field(min_length=1, max_length=200)

    @field_validator("message_ids")
    @classmethod
    def ids_must_be_unique(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class ChatMessageDeleteResult(BaseModel):
    deleted: int


class ConversationToMaterialRequest(BaseModel):
    """把一段对话存进资料箱（内容用导出的 Markdown，助手之后能直接读它）。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=MAX_MATERIAL_TITLE_CHARS)
    category: str = Field(default="", max_length=64)
    note: str = Field(default="", max_length=1000)


class ChatAttachmentOut(BaseModel):
    name: str
    mime_type: str
    # document：PDF/DOCX 等文档，文字已在本地提取进 ``text``，原始文件不外发。
    kind: Literal["text", "image", "document"]
    size_bytes: int
    text: str = ""
    data_url: str = ""
    # 提取过程中的说明（例如内容过长只取了前一部分）；目前只有文档会产生。
    notes: list[str] = Field(default_factory=list)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    role: Literal["user", "assistant"]
    content: str
    # 引用的消息 id（被引用消息删除后为 None，但 context.quoted 里仍有快照）。
    quoted_message_id: int | None = None
    attachments: list[ChatAttachmentOut] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    # superseded（#13A）：被「重新生成」取代的旧回答。DB 保留、供审计/导出回看，
    # 但会话消息列表与模型历史都会过滤它，所以正常响应里不会出现这个值。
    status: Literal["pending", "complete", "error", "cancelled", "superseded"]
    error: str = ""
    model: str = ""
    # 消息类别（T01）：normal = 普通对话；proposal_result = 写操作终态的派生回写。
    # 回写消息只是历史记录，状态以 assistant_write_proposal 表为准（见系统提示的状态块）。
    kind: Literal["normal", "proposal_result"] = "normal"
    # 派生回写关联的提案 id（普通消息为 None）。
    proposal_id: str | None = None
    created_at: datetime


class ChatConversationBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    surface: ConversationSurface = "page"
    pinned: bool
    favorite: bool
    archived: bool = False
    group_name: str = ""
    # 列表里展示条数与最后活动时间，方便区分同名会话。
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class ChatConversationDetail(ChatConversationBrief):
    """会话详情。

    ``message_limit``（B5 按需加载）：>0 时 ``messages`` 只含最新 N 条，``messages_total``
    如实给全量条数、``has_earlier`` 标记是否还有更早的消息；=0 时全量下发（旧行为），
    ``has_earlier`` 恒为 False。更早的消息走
    ``GET /conversations/{id}/messages/earlier`` 分页补齐。
    """

    messages: list[ChatMessageOut] = Field(default_factory=list)
    messages_total: int = 0
    has_earlier: bool = False


class ChatEarlierMessagesOut(BaseModel):
    """「加载更早」分页：``before_id`` 之前（更旧）的一批消息，按时间正序返回。"""

    items: list[ChatMessageOut] = Field(default_factory=list)
    has_earlier: bool = False


class AssistantToolOut(BaseModel):
    """一个可调用工具的对外声明（**只读元数据**：名称、说明、参数 schema）。

    说明文案直接来自工具注册表（就是发给模型的那份），不在这里另写一份人话版本——
    两处文案一旦分叉，"界面上说能做的事"与"模型实际能做的事"就会不一致。

    ``parameters`` 是 OpenAI 的 JSON Schema，**原样透出**（前端据此渲染参数说明）；
    它只描述入参形状，不含任何密钥、提示词或用户数据。
    """

    name: str
    description: str = ""
    # 写工具会改动数据（新建/修改简历、台账等）；界面据此标注「会改动数据」。
    writes: bool = False
    parameters: dict[str, Any] = Field(default_factory=dict)


class AssistantToolListOut(BaseModel):
    """``GET /api/assistant/tools`` 的载荷：当前配置下可见的工具清单。"""

    items: list[AssistantToolOut] = Field(default_factory=list)
    count: int = 0


class ContextUsageBucket(BaseModel):
    """上下文用量的一个桶（需求 #6）。

    ``key`` 是固定枚举（system / tools / conversation / connectors / skills），**不翻译**：
    它是前后端共用的协议值，中文显示名在前端语言包里按 key 映射。
    """

    key: str
    # 估算 token（``services/llm/token_estimate``）。**不是**服务商口径，禁止用于计费。
    tokens: int = 0
    # 该桶占上下文窗口的百分比；窗口未设置（0）时是 null 而不是 0——没有分母就不猜。
    percent: float | None = None


class ContextUsageOut(BaseModel):
    """``GET /api/assistant/conversations/{id}/context-usage`` 的载荷。

    字段与流式事件 ``context_usage`` 的 ``usage`` 完全一致，前端一套类型两处复用。
    ``usage_actual`` 是上一轮服务商**实测**的输入 token；估算（``total``）/实测两者
    不合并、不换算。
    """

    buckets: list[ContextUsageBucket] = Field(default_factory=list)
    # 五桶之和（估算）。
    total: int = 0
    # 百分比分母（当前模型的 context_window_tokens）；0 = 未设置。
    window: int = 0
    percent: float | None = None
    # true = 旧消息没有落过用量，这里只有 system / conversation 两桶是估算出来的。
    partial: bool = False
    usage_actual: int | None = None
    # 压缩状态（#10）：null = 这个会话从来没压缩过。
    compaction: ContextCompactionStateOut | None = None
