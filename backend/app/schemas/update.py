# SPDX-License-Identifier: Apache-2.0
"""软件更新检查 Schema。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UpdateCheckResult(BaseModel):
    """检查结果。网络不可用时 ``message`` 给出原因，其余字段留空。"""

    current_version: str = ""
    latest_version: str = ""
    update_available: bool = False
    release_name: str = Field(default="", max_length=256)
    release_url: str = Field(default="", max_length=512)
    published_at: str = Field(default="", max_length=64)
    notes: str = Field(default="", max_length=4000)
    # Older clients consume the short preview. New clients select their locale
    # from the original Markdown before rendering the release.
    release_body: str = Field(default="", max_length=131072)
    message: str = Field(default="", max_length=1000)
    checked_at: datetime | None = None
    download_url: str = Field(default="", max_length=1024)
    download_size: int | None = Field(default=None, ge=0)
    asset_name: str = Field(default="", max_length=256)
    # 发布时旁边会放一份同名 `.sha256`。下载完拿它核对，能挡住"下载被截断/被中间环节
    # 改过"这类问题——发行包里是要覆盖到程序目录的代码，值得多这一步。
    checksum_url: str = Field(default="", max_length=1024)
    installable: bool = False
    # 这次结果是不是从缓存 / 节流层拿的（没有真的再问一次 GitHub）。
    # 界面用它决定要不要提示"这是刚才的结果"；用例用它断言节流真的生效了。
    cached: bool = False
    # 这次检查**没有得出「有没有新版本」的结论**（主路径被限流/被拦、备用探测也失败，
    # 或者根本连不上 GitHub）。它和 `cached` 是两件事：一个是"没问上游"，一个是
    # "问了没问出来"。
    #
    # 存在的理由：`latest_version` 为空既可能是"上游没给"，也可能是"这次没问到"，
    # 两者原本在界面上都渲染成「未提供」。桌面壳有自己的出网链路，同一时刻可能已经
    # 查到 2.3.0 并弹窗——于是设置页说「未提供」、弹窗说「发现新版本」，同一件事两个
    # 结论。有了这个标记，界面就能把"没问到"换成可解释的降级文案，不再冒充"上游没给"。
    # 默认 False 且只增不改，老客户端读到的字段一个都没动。
    degraded: bool = False


class UpdateDownloadRequest(BaseModel):
    """开始下载已检查到的版本。后台下载只影响程序临时目录。"""

    background: bool = False


class UpdateInstallRequest(BaseModel):
    """请求下载完成后安排覆盖安装并重启。"""

    restart: bool = True


class UpdateInstallResult(BaseModel):
    """上一次应用内更新的结果。

    由更新器写在 `runtime/update-status.json`，这里只做读取与归一——**成没成以"现在
    跑的是哪个版本"为准**，更新器的自述只用来解释失败原因。
    """

    state: Literal["success", "failed", "interrupted", "installing"] = "installing"
    from_version: str = ""
    target_version: str = ""
    message: str = Field(default="", max_length=1000)
    log: str = Field(default="", max_length=256)
    restart: bool = True


class UpdateStatus(BaseModel):
    """应用内更新任务的可轮询状态。"""

    state: Literal["idle", "downloading", "ready", "installing", "failed"] = "idle"
    current_version: str = ""
    target_version: str = ""
    progress: float = Field(default=0, ge=0, le=100)
    downloaded_bytes: int = Field(default=0, ge=0)
    total_bytes: int | None = Field(default=None, ge=0)
    background: bool = False
    installable: bool = False
    message: str = Field(default="", max_length=1000)
