"""投递专用浏览器状态与站点适配器/站点健康度 schema。"""

from typing import Literal

from pydantic import BaseModel, Field

from .base import DEFAULT_BROWSER_PORT, BrowserState


# ===== 投递专用浏览器 =====


class BrowserStatusOut(BaseModel):
    """投递专用浏览器的状态。"""

    state: BrowserState = "stopped"
    port: int = DEFAULT_BROWSER_PORT
    profile_dir: str = ""
    browser_path: str = ""
    # 人类可读的浏览器名（Google Chrome / Microsoft Edge / 自定义浏览器），别只给路径。
    browser_name: str = ""
    # 启动浏览器时要打开的站点入口地址，同时用于界面上的"打开招聘网站"按钮。
    entry_url: str = ""
    # 给用户看的登录提示（例如"请在弹出的窗口里扫码登录一次"），不读取也不解析登录态。
    logged_in_hint: str = ""
    # 这个浏览器是不是**本次运行**启动的。为 False 表示它是上一次运行时打开的窗口：
    # state 照样是 running（调试端口在答，采集投递都能用），但「关闭浏览器」关不掉它——
    # 进程句柄随后端重启丢了，而应用只关自己拉起的进程，绝不按 PID 去猜。
    owned: bool = False


# ===== 招聘网站（站点适配器）=====


class SiteOptionOut(BaseModel):
    """一个已注册的招聘网站（供界面展示当前站点、也为将来加站点预留）。"""

    key: str
    display_name: str
    host: str = ""
    entry_url: str = ""
    supports_collect: bool = True
    supports_apply: bool = True


class SiteListOut(BaseModel):
    """已注册站点列表 + 当前选中项。

    前端**只**从这里读取站点清单与名称，绝不把站点名写死在组件里——这样以后新增一个
    招聘网站，只要在后端注册表里 ``register`` 一行，界面自动跟着变。
    """

    current: str = ""
    sites: list[SiteOptionOut] = Field(default_factory=list)


# ===== ⑪ 站点健康度（把"采集悄悄抓不到东西"变成看得见的 degraded 标记）=====


class CollectRunSummaryOut(BaseModel):
    """一次采集运行的摘要——站点健康度判据的输入之一。"""

    status: str = ""
    failure_category: str = ""
    succeeded: int = 0
    detail_missing: int = 0
    created_at: str = ""


class SiteHealthOut(BaseModel):
    """一个招聘网站的采集健康度：``ok``（正常）或 ``degraded``（疑似改版）。"""

    site_key: str = ""
    display_name: str = ""
    status: Literal["ok", "degraded"] = "ok"
    # 人类可读、可操作的中文原因。前端**只展示**，绝不自行再判一次（判断的权威只有后端一处）。
    reasons: list[str] = Field(default_factory=list)
    # 统计明细：样本数、结构失败次数、详情漂移次数，供界面 / 诊断核对。
    sampled: int = 0
    selector_failures: int = 0
    detail_drift_runs: int = 0
    # 最近几次运行的摘要（与判据同一份输入），便于用户对照「采集记录」。
    recent: list[CollectRunSummaryOut] = Field(default_factory=list)


class SiteHealthListOut(BaseModel):
    """所有已注册站点的健康度。前端据 ``site_key`` 找到当前站点的状态。"""

    sites: list[SiteHealthOut] = Field(default_factory=list)

