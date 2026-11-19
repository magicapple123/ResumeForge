# SPDX-License-Identifier: Apache-2.0
"""设置 Schema：当前大模型配置、配置记录与联网搜索设置。"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# LLM 配置与探测相关的常量/模型已迁至 ``schemas/setting_llm.py``；这里 re-export，
# 保持 ``from app.schemas.setting import LLMConfig`` 等既有导入路径不变。
from .setting_llm import (  # noqa: F401  (re-export：保持既有导入路径)
    API_STYLES,
    MIN_MAX_TOKENS,
    RESERVED_EXTRA_BODY_KEYS,
    THINKING_STYLE_UNMANAGED,
    THINKING_STYLES,
    UNLIMITED_MAX_TOKENS,
    LLMApiKeyRevealResult,
    LLMConfig,
    LLMConfigOut,
    LLMConfigRecordCreate,
    LLMConfigRecordOut,
    LLMGlobalRecordOut,
    LLMModelsRequest,
    LLMModelsResult,
    LLMSessionKeyIn,
    LLMSessionKeyOut,
    LLMTestRequest,
    LLMTestResult,
    LLMThinkingRequest,
    LLMThinkingResult,
)

# 搜索深度三档（P4-08）：摘要 / 标准 / 深入。**唯一真值是 `depth`**，旧的
# `fetch_pages` 只保留"读得懂、认得回"的兼容映射，见 `SearchConfig`。
SEARCH_DEPTHS = ("snippet", "standard", "deep")
# `depth` → 旧 `fetch_pages` 的等价档位（方向一：回显与旧前端兼容）。
DEPTH_TO_FETCH_PAGES = {"snippet": 0, "standard": 2, "deep": 3}
# 旧 `fetch_pages` → `depth`（方向二：0 → 摘要；1–2 → 标准；3 → 深入）。
FETCH_PAGES_TO_DEPTH = {0: "snippet", 1: "standard", 2: "standard", 3: "deep"}


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


class InlineFormatPreviewSetting(BaseModel):
    """制作台：未编辑时按真实行内样式预览（含字号，默认关）。"""

    enabled: bool = False


class TrayIconFollowSystemSetting(BaseModel):
    """桌面版：托盘图标是否跟随系统主题（默认关，应用内主题优先）。"""

    enabled: bool = False


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
    """「投投」悬浮球的用户设置（入口默认开，提示标语与划词浮条默认也开）。"""

    enabled: bool = True
    # 两个子开关都默认开以兼容老数据：存量裸 bool（与缺该字段的旧对象）读回时补 True。
    tips_enabled: bool = True
    selection_enabled: bool = True  # 选中文字后浮出动作条（Q9）。


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

class AgentTaskEventsSetting(BaseModel):
    """提醒到期自动生成任务卡开关（默认关；只建卡、不执行任何写操作）。"""

    enabled: bool = False
