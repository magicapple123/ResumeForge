# SPDX-License-Identifier: Apache-2.0
"""投递专用浏览器的双语登录提示。

为什么单独一个模块：``browser_manager.py`` 顶在 500 行生产代码预算上
（``tests/test_file_size_budget.py``），而这两句是**纯文案**，与"定位 / 拉起 / 健康检查 /
只关自己拉起的进程"那套管理逻辑无关。拆出来之后 ``browser_manager`` 只 re-export
``login_hint``，``services/apply/_site_browser.py`` 的导入路径与调用点一个字都不用改。

中文是原文（日志、测试、中文界面都引用它），英文只在 ``locale`` 为 ``en-US`` 时使用。
它由后端随浏览器状态下发、前端直接展示，所以必须在后端就给出英文——拆成前端 i18n key
要同时改 schema 与前端，而这条文案本身与数据无关。
"""

from __future__ import annotations

LOGIN_HINT = "首次使用请在弹出的浏览器窗口里扫码登录一次；登录态会保存在专用目录里，下次自动沿用。"

LOGIN_HINT_EN = (
    "Sign in once in the browser window that just opened (scan the QR code if asked). "
    "The session is kept in a dedicated profile and reused next time."
)


def login_hint(locale: str | None) -> str:
    """按界面语言给登录提示；未设置或中文一律用中文原文。"""
    return LOGIN_HINT_EN if locale == "en-US" else LOGIN_HINT
