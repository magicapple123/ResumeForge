"""共享常量、Literal 类型别名与校验辅助（``schemas/apply`` 各子模块的公共底座）。

从 ``schemas/apply.py`` 拆出：出厂默认常量、状态字符串（与 ``models/apply`` 逐字一致）、
``default_site_key``（延迟导入注册表解环，原样保留）与失败分类校验。
"""
from typing import Literal

from ...config import DEFAULT_BROWSER_PORT as DEFAULT_BROWSER_PORT
from ...models.apply import FAILURE_CATEGORIES

# ===== 配置默认值（出厂默认，键与 app_setting 一致）=====
DEFAULT_INTERVAL_SECONDS = 25
DEFAULT_INTERVAL_JITTER_SECONDS = 8
DEFAULT_DAILY_LIMIT = 60
DEFAULT_PER_TASK_LIMIT = 20
DEFAULT_BREAKER_THRESHOLD = 3
DEFAULT_GREETING = "您好，我对该岗位很感兴趣，期待进一步沟通。"

DEFAULT_COLLECT_KEYWORDS: list[str] = []
DEFAULT_COLLECT_PER_TASK_LIMIT = 20
DEFAULT_COLLECT_INTERVAL_SECONDS = 6
DEFAULT_COLLECT_INTERVAL_JITTER_SECONDS = 3

# 投递专用浏览器的选择方式与自定义路径长度上限。
DEFAULT_BROWSER_CHOICE = "auto"
BROWSER_PATH_MAX_CHARS = 512


def default_site_key() -> str:
    """当前站点的出厂默认值：注册表里第一个站点的标识。

    延迟导入注册表，避免"schemas ← services.sites ← ..."在导入期形成不必要的耦合；
    注册表本身缓存且轻量，这里按需取即可。取不到（注册表为空）时返回空串，由业务层兜底。
    """
    from ...services.sites.registry import get_registry

    try:
        return get_registry().default_key()
    except Exception:  # noqa: BLE001 - 默认值计算失败不该让配置模型无法实例化
        return ""

# 招呼语落库时的截断上限：记用户写给 HR 的全文，但不让单条无限增长。
GREETING_RECORD_MAX_CHARS = 500
GREETING_INPUT_MAX_CHARS = 1000

MAX_QUEUE_BATCH = 200
MAX_TASK_TARGETS = 500
MAX_COLLECT_KEYWORDS = 10
# 站点侧筛选项的规模上限。选项是站点提供的、数量有限（BOSS 一共 7 组），给一个宽松但
# 明确的上界挡住畸形请求体即可；真正"这个编码能不能用"由适配器在采集前逐个校验。
MAX_COLLECT_FILTERS = 16
COLLECT_FILTER_KEY_MAX_CHARS = 32
COLLECT_FILTER_CODE_MAX_CHARS = 32

# 「补齐详情」的单批上限。补详情要逐个打开岗位页面（详情页是整个采集里最慢的一步），几百条一批
# 会让一次任务跑很久、也更容易被风控盯上，所以超过就让用户分批。这个上限由**业务层**给出可操作的
# 中文说明；schema 这层只用一个更大的硬上限挡住明显异常的请求体——阈值若设成一样，友好提示会被
# 校验挡在外面，用户只会拿到一条 Pydantic 报错，看不到"要分批"的理由。
MAX_BACKFILL_JOBS = 200
MAX_BACKFILL_REQUEST_ITEMS = 1000

BrowserState = Literal["stopped", "starting", "running", "unknown"]
# 浏览器选择：auto=自动（优先 Chrome，未装回退 Edge）/ chrome / edge / custom=自定义路径。
BrowserChoice = Literal["auto", "chrome", "edge", "custom"]
QueueStatus = Literal["pending", "skipped", "done"]
TaskStatus = Literal[
    "pending",
    "running",
    "paused",
    "breaker_paused",
    "completed",
    "stopped",
    "failed",
]
TaskKind = Literal["collect", "apply"]
TaskItemStatus = Literal["pending", "running", "success", "failed", "skipped"]
FailureCategory = Literal[
    "selector_invalid",
    "login_required",
    "captcha_required",
    "greeting_missing",
    "network_timeout",
    "file_upload_failed",
    "unknown",
]


def _check_failure_category(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned and cleaned not in FAILURE_CATEGORIES:
        raise ValueError(f"无效的失败分类，可选值：{'、'.join(FAILURE_CATEGORIES)}")
    return cleaned

