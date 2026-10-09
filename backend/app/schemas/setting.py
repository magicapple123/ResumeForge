"""设置 Schema：当前大模型配置、配置记录与联网搜索设置。"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# max_tokens 取该值时表示“不限制”：请求体里省略该字段，由服务商/模型决定上限。
# 发送 0 或 -1 在部分服务商上会被当作非法参数拒绝，所以用省略而非哨兵数值。
UNLIMITED_MAX_TOKENS = 0
MIN_MAX_TOKENS = 256

# 接口协议：openai = Chat Completions 兼容（默认），anthropic = Claude Messages 原生。
API_STYLES = ("openai", "anthropic")

# 思考参数的形态（=请求体里"开启思考"长什么样）。上游没有统一标准，所以由能力表按
# 服务商/模型推断，必要时用户可手工指定：
# - auto             按 api_style 推断（openai→reasoning_effort，anthropic→budget）
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
# 完全不由设置页的思考设置管"（求职助手、测试连接用它）。它**不在 THINKING_STYLES 里**，
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
    # 接口协议。Claude 既能用官方的 OpenAI 兼容层（选 openai），也能走原生 Messages
    # 协议（选 anthropic，支持扩展思考与独立的 system 字段）。
    api_style: Literal["openai", "anthropic"] = "openai"
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

        给"不该受「思考模式」影响"的两处调用用：
        - **求职助手**：它有自己的单次请求级「思考强度」，两者必须分开——否则用户在
          设置页开一次开关，会连助手的对话一起改掉（连老字段预算一起剥，助手才是
          完全由自己的选择决定）；
        - **测试连接**：只测连通性，不该因为思考参数写错而"连不上"。

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


class LLMTestRequest(LLMConfig):
    """测试连接使用表单当前值，不一定先保存。"""


class LLMTestResult(BaseModel):
    ok: bool
    latency_ms: int | None = None
    message: str = Field(default="", max_length=1000)


class LLMApiKeyRevealResult(BaseModel):
    """仅响应用户显式查看动作；普通配置读取仍返回脱敏引用。"""

    api_key: str = Field(default="", max_length=8192)


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
    用户填自己的实例地址（公共实例经常限流，所以不预置默认值）。
    """

    sources: list[Literal["bing", "duckduckgo", "searxng"]] = Field(
        default_factory=lambda: ["bing", "duckduckgo"], min_length=1, max_length=3
    )
    # 自建 SearXNG 实例根地址，例如 http://localhost:8080
    searxng_url: str = Field(default="", max_length=512)
    # 抓取前 N 条结果的正文（0 = 只取摘要）。正文抓取更慢，也可能被站点拒绝。
    fetch_pages: int = Field(default=0, ge=0, le=3)
    # 每次搜索最多返回多少条
    max_results: int = Field(default=8, ge=1, le=15)

    @field_validator("sources")
    @classmethod
    def sources_must_be_unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

    @field_validator("searxng_url")
    @classmethod
    def searxng_url_must_be_http(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value:
            return ""
        if not value.startswith(("http://", "https://")):
            raise ValueError("SearXNG 地址必须以 http:// 或 https:// 开头")
        return value


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


class ExportSaveLocationIn(BaseModel):
    """导出产物的额外落盘位置。空串 = 恢复默认（仅浏览器下载）。"""

    path: str = Field(default="", max_length=1024)


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
