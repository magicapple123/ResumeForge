# SPDX-License-Identifier: Apache-2.0
"""浏览器桥接层：CDP 客户端 + 投递专用浏览器管理器 + 登录态保持。

业务层只依赖本层暴露的抽象（``CdpClient`` / ``BrowserManager``），不直接接触
HTTP / WebSocket 细节，因此整条对外链路可以用假传输层离线测试。

T1 之后本层多了三块能力，都挂在 ``BrowserManager`` 的生命周期上：

- ``SessionCookieKeepalive``（L1）：运行期每 60 秒扫一次会话 Cookie 并续期，
  关闭前再续最后一次；
- ``BossKeepalive``（K2）：投递浏览器运行期间每天后台访问一次 BOSS 首页保活；
- ``profile_identity`` / ``cookie_migration``（B2）：profile 按浏览器身份分目录，
  切换浏览器时把 Cookie 迁过去。
"""
from .boss_keepalive import BossKeepalive, BossKeepaliveState
from .browser_hooks import BrowserLifecycleHook, notify_running, notify_stopping
from .browser_manager import BrowserError, BrowserManager, BrowserStatus, default_profile_dir
from .cdp_client import CdpClient, CdpError, WebsocketCdpClient
from .cookie_migration import MigrationOutcome, migrate_cookies_to_new_manager
from .profile_identity import ProfileAdoption, prepare_profile_dir, resolve_profile_dir
from .session_cookie_keepalive import (
    SessionCookieKeepalive,
    SessionCookiePolicy,
    promote_session_cookies,
)

__all__ = [
    "BossKeepalive",
    "BossKeepaliveState",
    "BrowserError",
    "BrowserLifecycleHook",
    "BrowserManager",
    "BrowserStatus",
    "CdpClient",
    "CdpError",
    "MigrationOutcome",
    "ProfileAdoption",
    "SessionCookieKeepalive",
    "SessionCookiePolicy",
    "WebsocketCdpClient",
    "default_profile_dir",
    "migrate_cookies_to_new_manager",
    "notify_running",
    "notify_stopping",
    "prepare_profile_dir",
    "promote_session_cookies",
    "resolve_profile_dir",
]
