# SPDX-License-Identifier: Apache-2.0
"""设置 Schema：当前大模型配置、配置记录与联网搜索设置。"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 搜索深度三档（P4-08）：摘要 / 标准 / 深入。**唯一真值是 `depth`**，旧的
# `fetch_pages` 只保留"读得懂、认得回"的兼容映射，见 `SearchConfig`。
SEARCH_DEPTHS = ("snippet", "standard", "deep")
# `depth` → 旧 `fetch_pages` 的等价档位（方向一：回显与旧前端兼容）。
DEPTH_TO_FETCH_PAGES = {"snippet": 0, "standard": 2, "deep": 3}
# 旧 `fetch_pages` → `depth`（方向二：0 → 摘要；1–2 → 标准；3 → 深入）。
FETCH_PAGES_TO_DEPTH = {0: "snippet", 1: "standard", 2: "standard", 3: "deep"}

# max_tokens 取该值时表示“不限制”：请求体里省略该字段，由服务商/模型决定上限。
# 发送 0 或 -1 在部分服务商上会被当作非法参数拒绝，所以用省略而非哨兵数值。
UNLIMITED_MAX_TOKENS = 0
MIN_MAX_TOKENS = 256

# 接口协议：openai = Chat Completions 兼容（**默认**），anthropic = Claude Messages 原生，
# responses = OpenAI Responses（实验性；不改变任何默认值，只有用户主动选择才走）。
# "responses" 共 9 个字符，数据库列是 String(16)，不需要迁移。
API_STYLES = ("openai", "anthropic", "responses")

# 思考参数的形态（=请求体里"开启思考"长什么样）。上游没有统一标准，所以由能力表按
# 服务商/模型推断，必要时用户可手工指定：
# - auto             按 api_style 推断（openai→reasoning_effort，anthropic→budget，
#                    responses→reasoning.effort）
# - reasoning_effort 顶层 `reasoning_effort`（OpenAI o/gpt-5、xAI、Groq、OpenRouter）
# - thinking_object  `thinking:{type:"enabled"}`（智谱 GLM-4.5+、部分 Claude 网关）
# - enable_thinking  `enable_thinking:true`（通义 qwen3 走 dashscope 兼容模式）
# - budget           Anthropic 原生 `thinking:{budget_tokens:N}`（按档位换算预算）
THINKING_STYLES = (
    "auto",
    "reasoning_effort",
    "thinking_object",
    "enable_thinking",
    "budget",
)

# **不参与思考配置**的标记：`without_thinking()` 把它写进 `thinking_style`，表示"这次调用
# 完全不由设置页的思考设置管"（求职助手用它）。它**不在 THINKING_STYLES 里**，
# 用户存不进来；有它才能让"默认就思考的模型要显式关掉"那条规则不误伤助手。
THINKING_STYLE_UNMANAGED = "unmanaged"

# 这些键由 provider 自己填写，用户不该通过 extra_body 覆盖它们。
RESERVED_EXTRA_BODY_KEYS = frozenset(
    {"model", "messages", "stream", "tools", "tool_choice", "system"}
)


class LLMConfig(BaseModel):
    """兼容 OpenAI Chat Completions 协议的模型配置（DeepSeek/豆包/Kimi/Ollama 等）。"""

    provider: str = Field(default="custom", max_length=32)  # 预设标识，仅用于前端展示
    base_url: str = Field(default="", max_length=512)
    api_key: str = Field(default="", max_length=8192)
    model: str = Field(default="", max_length=128)
    # 简历生成更看重事实稳定性；用户仍可按需调高创意度。
    temperature: float = Field(default=0.1, ge=0, le=2)
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    # 默认「不限制」：新用户不调参也能用服务商/模型的默认上限，而不是被一个手写的
    # 4096 悄悄截断。这只影响**默认值**——已保存过 max_tokens 的配置原样保留，
    # 不会因为一次升级就被改写（改动存量等于替用户改他未必想改的东西）。
    max_tokens: int = Field(default=UNLIMITED_MAX_TOKENS, ge=UNLIMITED_MAX_TOKENS, le=65536)
    # 上下文窗口（#5 的 5.3 / #6 的百分比分母）。0 = 未知：助手不做累计限制、面板不显示百分比。
    # 不做联网探测（`/models` 不返回窗口长度，手填是唯一可靠来源，填错比不填更糟）；存设置 JSON，无迁移。
    context_window_tokens: int = Field(default=0, ge=0, le=2_000_000)
    # 接口协议。Claude 既能用官方的 OpenAI 兼容层（选 openai），也能走原生 Messages
    # 协议（选 anthropic，支持扩展思考与独立的 system 字段）；responses 是实验性的
    # OpenAI Responses 协议（input items + 语义事件流），**默认仍是 openai**——
    # 已保存配置一行不改（D13），只有用户主动切过去才走新链路。
    api_style: Literal["openai", "anthropic", "responses"] = "openai"
    # 高级调整（可选）：None 表示请求体里不发送该字段，沿用服务商默认值。
    # 这些参数各家支持度不一，所以默认全部关闭，由用户在设置页显式开启。
    top_p: float | None = Field(default=None, ge=0, le=1)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    top_k: int | None = Field(default=None, ge=0, le=1000)
    repetition_penalty: float | None = Field(default=None, ge=0, le=2)
    # 停止词：命中即让模型停下（最多 4 条，避免服务商直接拒绝整次请求）。
    stop: list[str] = Field(default_factory=list, max_length=4)
    # Anthropic 扩展思考预算（tokens）；0 表示明确关闭，None 表示不发送该字段。
    thinking_budget: int | None = Field(default=None, ge=0, le=100_000)
    # —— 思考模式（作用于**除求职助手以外**的 AI 调用）——
    #
    # 助手页的「思考强度」是**单次请求**参数、存在浏览器本地，两者刻意分开：助手想随时
    # 试档位，而这里改一次就影响简历生成、岗位解析等所有其它 AI 功能，混在一起会让
    # "我只是想换个档位试试"变成一次全局改动。
    #
    # 默认关闭：不发送任何思考参数，服务商看到的东西与加这个功能之前完全一致。
    thinking_enabled: bool = False
    # 强度档位。**各家划分不同**（OpenAI 系 minimal/low/medium/high、Claude 原生按预算
    # 映射、智谱与通义只有开关没有档位），所以这里是自由字符串，取值由能力表按当前服务商
    # 与模型给出；空串 = 不指定档位（只开开关）。
    thinking_effort: str = Field(default="", max_length=32)
    # 思考参数的**形态**：auto = 按 api_style 推断（OpenAI 兼容 → reasoning_effort，
    # 原生 Messages → thinking 预算）；其余取值由能力表/探测结果给出，让用中转站或
    # 自建网关的用户能手工改对。
    thinking_style: str = Field(default="auto", max_length=32)

    @field_validator("thinking_style")
    @classmethod
    def thinking_style_must_be_known(cls, value: str) -> str:
        # 形态决定**请求体长什么样**，拼错不是"没效果"而是每次都 400，所以在入口就挡住。
        style = (value or "auto").strip()
        if style not in THINKING_STYLES:
            raise ValueError(f"思考参数形态只能是：{'、'.join(THINKING_STYLES)}")
        return style

    # 额外的请求体字段：长尾参数的出口（各家自创参数太多，逐个加字段不现实）。
    extra_body: dict[str, Any] = Field(default_factory=dict)

    @field_validator("stop")
    @classmethod
    def stop_must_be_short_strings(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = str(item).strip()
            if not text:
                continue
            if len(text) > 64:
                raise ValueError("停止词不能超过 64 个字符")
            cleaned.append(text)
        return cleaned

    @field_validator("extra_body")
    @classmethod
    def extra_body_must_not_override_protocol(cls, value: dict[str, Any]) -> dict[str, Any]:
        reserved = sorted(set(value) & RESERVED_EXTRA_BODY_KEYS)
        if reserved:
            raise ValueError(f"额外请求体不能覆盖这些字段：{'、'.join(reserved)}")
        if len(value) > 20:
            raise ValueError("额外请求体最多 20 个字段")
        return value

    @field_validator("max_tokens")
    @classmethod
    def max_tokens_must_be_unlimited_or_usable(cls, value: int) -> int:
        # ge=UNLIMITED_MAX_TOKENS 会顺带放行 1..255，这里把下界补回来。
        if value != UNLIMITED_MAX_TOKENS and value < MIN_MAX_TOKENS:
            raise ValueError(
                f"最大输出 Token 需为 {UNLIMITED_MAX_TOKENS}（不限制）或至少 {MIN_MAX_TOKENS}"
            )
        return value

    @property
    def uses_unlimited_output(self) -> bool:
        """是否不限制输出长度；为真时发往模型的请求体不含 max_tokens。"""
        return self.max_tokens == UNLIMITED_MAX_TOKENS

    def without_thinking(self) -> "LLMConfig":
        """剥掉全部思考设置（开关、档位、老字段预算），并标记为**不参与思考配置**。

        给"不该受设置页「思考模式」影响"的调用用：
        - **求职助手**：它有自己的单次请求级「思考强度」，两者必须分开——否则用户在
          设置页开一次开关，会连助手的对话一起改掉（连老字段预算一起剥，助手才是
          完全由自己的选择决定）；
        测试连接另外通过 connection_probe_config 按能力表关闭默认思考。

        `thinking_style` 置成 `THINKING_STYLE_UNMANAGED` 而不是默认的 auto：有些模型
        **不指定就思考**（DeepSeek V4、通义 Qwen3.5+），那种模型要靠显式发关闭参数才能
        真的关掉——助手不该被那条规则顺手关掉思考。
        """
        return self.model_copy(
            update={
                "thinking_enabled": False,
                "thinking_effort": "",
                "thinking_budget": None,
                "thinking_style": THINKING_STYLE_UNMANAGED,
            }
        )


class LLMConfigRecordCreate(LLMConfig):
    """命名保存的配置；同名记录会被更新。"""

    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("配置名称不能为空")
        return value


class LLMConfigRecordOut(LLMConfigRecordCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class LLMConfigOut(LLMConfig):
    """当前**生效**配置 + 来源（C）。

    `scope="global"`：来自 `global_settings.json` 的某条记录（所有数据集共用）；
    `scope="dataset"`：还在用数据集里的旧配置（升级后、全局尚未迁移时的回退态）。
    前端据此显示"使用中"的记录名，以及"保存后升级为全局"的提示。
    """

    scope: Literal["global", "dataset"] = "dataset"
    record_id: str | None = None
    record_name: str = ""


class LLMGlobalRecordOut(LLMConfig):
    """一条全局模型配置记录；`api_key` 是 `********:profile:<id>` 引用，绝不是密钥本体。"""

    id: str
    name: str
    """
    这条记录是否还在用**内置默认名**（用户没改过）。

    前端据此把默认名翻成当前界面语言；改过名之后名字是用户数据，原样显示。
    """
    name_is_default: bool = False
    models: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    is_active: bool = False


class LLMTestRequest(LLMConfig):
    """测试连接使用表单当前值，不一定先保存。"""


class LLMTestResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str = Field(default="", max_length=1000)


class LLMApiKeyRevealResult(BaseModel):
    """仅响应用户显式查看动作；普通配置读取仍返回脱敏引用。"""

    api_key: str = Field(default="", max_length=8192)


class LLMSessionKeyIn(BaseModel):
    """「仅本会话使用」的临时密钥：只进内存，不落库、不进备份。"""

    api_key: str = Field(min_length=1, max_length=8192)


class LLMSessionKeyOut(BaseModel):
    """会话密钥状态；密钥本体永不回传。"""

    configured: bool


class LLMModelsRequest(LLMConfig):
    """按表单当前值查询服务商可用的模型列表。

    ``api_key`` 留空时后端回退到已保存的密钥，避免用户为了看模型列表先保存一遍。
    """


class LLMModelsResult(BaseModel):
    models: list[str] = Field(default_factory=list, max_length=1000)
    message: str = Field(default="", max_length=1000)


class LLMThinkingRequest(LLMConfig):
    """查"这个模型支持哪种思考形态与哪些强度档位"。

    上游没有标准的能力发现接口（``/v1/models`` 只给模型名），所以分两步：
    ``probe=False`` 只读仓库里的能力表（零上游调用）；``probe=True`` 再实发一次最小请求，
    用来区分"真的生效 / 服务接受了但没输出思考 / 上游明确拒绝"。
    """

    probe: bool = False


class LLMThinkingResult(BaseModel):
    """能力表推断 + （可选）实测的结果。

    ``note`` 是能力表给的解释（始终有，给用户当背景）；``message`` 是实测结论
    （``probed=True`` 才有）。``accepted``/``reasoning_seen`` 没探测时是 ``None``/``False``。
    """

    style: str = Field(default="auto", max_length=32)
    efforts: list[str] = Field(default_factory=list, max_length=16)
    supported: bool = True
    note: str = Field(default="", max_length=1000)
    probed: bool = False
    accepted: bool | None = None
    reasoning_seen: bool = False
    message: str = Field(default="", max_length=1000)


class SearchConfig(BaseModel):
    """联网搜索设置。

    多个来源会并发查询后合并去重：Bing RSS 与 DuckDuckGo 开箱可用，SearXNG 需要
    用户填自己的实例地址（公共实例经常限流，所以不预置默认值）。DeepSeek / Tavily /
    Jina 需要单独的 API Key，**默认不启用**——没配 key 时它不参与并发，不会"假装搜索成功"。

    ## 搜索深度（P4-08）

    ``depth`` 是**唯一真值**：``snippet`` 不抓正文、``standard`` 抓 2 页各 2 段、
    ``deep`` 抓 5 页各 3 段。旧字段 ``fetch_pages`` 保留为**只读兼容**——存量的
    「抓取正文的条数」读出来按 ``0→snippet / 1–2→standard / 3→deep`` 折算成档位，
    保存时只写 ``depth``（见 ``services.web_search_settings``），所以两套值不会各说一套。
    """

    sources: list[Literal["bing", "duckduckgo", "searxng", "deepseek", "tavily", "jina"]] = Field(
        default_factory=lambda: ["bing", "duckduckgo"], min_length=1, max_length=6
    )
    # 自建 SearXNG 实例根地址，例如 http://localhost:8080
    searxng_url: str = Field(default="", max_length=512)
    # 搜索深度。默认「标准」：只给摘要的搜索回答不了"这个岗位具体做什么"。
    depth: Literal["snippet", "standard", "deep"] = "standard"
    # **已弃用**：只读兼容旧配置与旧前端；写入端只认 `depth`。
    fetch_pages: int = Field(default=0, ge=0, le=3)
    # 每次搜索**最多**返回多少条（上限，不是精确值：模型可用 limit 要更少；
    # 实际条数还受单个来源的取数上限与去重/相关性过滤限制）。
    max_results: int = Field(default=8, ge=1, le=50)
    # DeepSeek Search / Fetch 的密钥。**这里永远不应出现明文**：读取时是掩码
    # （``********``）或空串，真实密钥由 settings_service 加密后单独存储。
    deepseek_api_key: str = Field(default="", max_length=200)
    # Tavily / Jina 的密钥（同上：读取时只可能是掩码或空串）。
    tavily_api_key: str = Field(default="", max_length=200)
    jina_api_key: str = Field(default="", max_length=200)

    @model_validator(mode="before")
    @classmethod
    def depth_from_legacy_fetch_pages(cls, data: Any) -> Any:
        """旧配置只有 `fetch_pages` 时把它折算成 `depth`（显式给了 `depth` 就以它为准）。"""
        if not isinstance(data, dict) or "depth" in data:
            return data
        raw_pages = data.get("fetch_pages")
        if raw_pages is None:  # 没配或显式 null 都按「没有旧配置」处理
            return data
        try:
            legacy = int(raw_pages)
        except (TypeError, ValueError):
            return data
        return {**data, "depth": FETCH_PAGES_TO_DEPTH.get(legacy, "standard")}

    @model_validator(mode="after")
    def fill_legacy_fetch_pages(self) -> "SearchConfig":
        """调用方没给 `fetch_pages` 时按 `depth` 折算，让旧前端读到的值也是对的。

        旧前端只认 `fetch_pages`（0~3）；不折算的话它会把"标准档"显示成"只取摘要"，
        用户改了别的字段一保存就把深度降回摘要。
        """
        if "fetch_pages" not in self.model_fields_set:
            # `depth` 已确定（显式或由旧值折算），回填等价的旧取值。
            # 模型没有开 `validate_assignment`，这里直接赋值不会再次触发校验。
            self.fetch_pages = DEPTH_TO_FETCH_PAGES.get(self.depth, 2)
        return self

    @field_validator("sources")
    @classmethod
    def sources_must_be_unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

    @field_validator("deepseek_api_key", "tavily_api_key", "jina_api_key")
    @classmethod
    def api_key_must_be_stripped(cls, value: str) -> str:
        # 粘贴时带的首尾空白/换行不能进密文，否则鉴权必然失败。
        return value.strip()

    @field_validator("searxng_url")
    @classmethod
    def searxng_url_must_be_http(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value:
            return ""
        if not value.startswith(("http://", "https://")):
            raise ValueError("SearXNG 地址必须以 http:// 或 https:// 开头")
        return value

    @property
    def page_budget(self) -> int:
        """本档位要抓几页正文（0 = 只取摘要）。"""
        return {"snippet": 0, "standard": 2, "deep": 5}[self.depth]

    def configured_sources(self) -> list[str]:
        """真正会参与并发的来源：需要 Key / 地址而没配的不入列。

        **这不是白名单**——只是"没凭据就跑不起来"的诚实过滤：没配 Key 的 Tavily
        若出现在可用列表里，用户会以为在用它。
        """
        available: list[str] = []
        for source in dict.fromkeys(self.sources or ["bing"]):
            if source == "searxng" and not self.searxng_url:
                continue
            if source == "deepseek" and not self.deepseek_api_key:
                continue
            if source == "tavily" and not self.tavily_api_key:
                continue
            if source == "jina" and not self.jina_api_key:
                continue
            available.append(source)
        return available


class ReminderPopupSetting(BaseModel):
    """应用打开时是否弹出近期提醒（默认开）。"""

    enabled: bool = True


class WebFormRelaxedModeSetting(BaseModel):
    """网申填表「放宽模式」开关（默认关）。

    开启后程序会尝试代点下拉/弹层选项并代勾用户逐条确认过的声明项；日期选择器与
    文件上传仍不代做。边界描述见 ``engine.core.relaxed_kind``。
    """

    enabled: bool = False


class AssistantRelaxedModeSetting(BaseModel):
    """求职助手「放宽模式」开关（默认关）。

    开启后助手可读取完整资料：姓名、电话等敏感身份字段，网申填表的真实填写值，
    以及历史对话。提前告知的边界（前端卡片与系统提示都会写明）：**API 密钥等
    凭据与全局配置无论如何都不会发送给模型**，简历照片的二进制内容也不发送。
    """

    enabled: bool = False


class AssistantOrbSetting(BaseModel):
    """「投投」悬浮球的用户设置（入口默认开，提示标语默认弹）。"""

    enabled: bool = True
    # 是否弹出悬浮球的轮换提示标语。**默认开以兼容老数据**：存量库存的是裸 bool，读回时
    # 会被补成 `tips_enabled=True`，老用户的体验与升级前一致。
    tips_enabled: bool = True


class AutoBackupIntervalSetting(BaseModel):
    """自动备份间隔（天）。用户可在设置页调整，保存进 KV 后下次调度检查即生效。"""

    interval_days: int = Field(default=7, ge=1, le=365)


class AssistantLimitSetting(BaseModel):
    """求职助手的两条运行上限：工具轮次上限与整链时间预算。

    默认值与 ``services/assistant_limits`` 逐项一致（30 轮 / 1800 秒），由单测钉住。
    两者都能随时改：轮次上限**下一轮**即刻生效，预算**下一次请求**生效。越界直接由
    这里拒绝（422），不静默夹到边界——用户以为设成了 5 而实际被夹成 1 更糟。
    """

    max_tool_rounds: int = Field(default=30, ge=1, le=100)
    stream_budget_seconds: int = Field(default=1800, ge=1, le=86400)


class ExportSaveLocationIn(BaseModel):
    """导出产物保存位置的控制请求；目录只能由本机原生选择器提供。"""

    clear: bool = False


class ExportSaveLocationOut(BaseModel):
    """当前生效的导出落盘位置（空串 = 默认浏览器下载目录）。"""

    path: str = ""


NAVIGATION_CORE_KEYS = frozenset({"/", "/jobs", "/resumes", "/profile", "/apply", "/settings"})
NAVIGATION_OPTIONAL_KEYS = frozenset(
    {
        "/webform",
        "/tracker",
        "/analytics",
        "/favorites",
        "/assistant",
        "/materials",
        "/knowledge",
        "/skills",
        "/interview",
        "/claims",
        "/trash",
    }
)


class NavigationVisibility(BaseModel):
    """用户隐藏的导航模块；隐藏只影响入口，不删除数据或路由。"""

    hidden: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("hidden")
    @classmethod
    def hidden_must_be_unique_and_safe(cls, value: list[str]) -> list[str]:
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return list(dict.fromkeys(cleaned))
