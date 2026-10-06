"""投递配置 schema（职责：配置覆盖写与回显）。"""

from pydantic import BaseModel, ConfigDict, Field

from .base import (
    BROWSER_PATH_MAX_CHARS,
    DEFAULT_BREAKER_THRESHOLD,
    DEFAULT_BROWSER_CHOICE,
    DEFAULT_BROWSER_PORT,
    DEFAULT_DAILY_LIMIT,
    DEFAULT_GREETING,
    DEFAULT_INTERVAL_JITTER_SECONDS,
    DEFAULT_INTERVAL_SECONDS,
    DEFAULT_PER_TASK_LIMIT,
    GREETING_INPUT_MAX_CHARS,
    BrowserChoice,
    default_site_key,
)

# ===== 投递配置 =====


class ApplyConfigIn(BaseModel):
    """投递配置（覆盖写）。范围校验不合法由 FastAPI 返回 422。"""

    model_config = ConfigDict(extra="forbid")

    interval_seconds: int = Field(default=DEFAULT_INTERVAL_SECONDS, ge=1, le=600)
    interval_jitter_seconds: int = Field(default=DEFAULT_INTERVAL_JITTER_SECONDS, ge=0, le=300)
    daily_limit: int = Field(default=DEFAULT_DAILY_LIMIT, ge=1, le=1000)
    per_task_limit: int = Field(default=DEFAULT_PER_TASK_LIMIT, ge=1, le=200)
    breaker_threshold: int = Field(default=DEFAULT_BREAKER_THRESHOLD, ge=1, le=20)
    default_greeting: str = Field(default=DEFAULT_GREETING, max_length=GREETING_INPUT_MAX_CHARS)
    skip_same_company: bool = True
    confirm_real_gap: bool = False
    browser_port: int = Field(default=DEFAULT_BROWSER_PORT, ge=1024, le=65535)
    # 用户可自由选择投递台使用的浏览器：auto（优先 Chrome）/ chrome / edge / custom（自定义路径）。
    browser_choice: BrowserChoice = DEFAULT_BROWSER_CHOICE
    # 自定义浏览器可执行文件的绝对路径；仅当 browser_choice == "custom" 时生效。
    browser_path: str = Field(default="", max_length=BROWSER_PATH_MAX_CHARS)
    # 当前对接的招聘网站（站点适配器 key）；默认取注册表里第一个站点。
    site_key: str = Field(default_factory=default_site_key, max_length=32)


class ApplyConfigOut(ApplyConfigIn):
    """当前生效的投递配置 + 出厂默认值回显。"""

    defaults: ApplyConfigIn = Field(default_factory=ApplyConfigIn)

