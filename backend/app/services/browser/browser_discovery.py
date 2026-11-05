# SPDX-License-Identifier: Apache-2.0
"""浏览器探测：常见安装位置与人类可读的展示名。

从 ``browser_manager`` 拆出来的原因很直接：那个文件已顶到 500 行预算（CI 硬闸门），
而"去哪儿找 chrome.exe / msedge.exe"和"把路径翻译成界面上的浏览器名"这两件事跟
进程生命周期、调试端口健康检查没有耦合，是这里最独立的一块。

``browser_manager`` 仍然从本模块 import 并**再导出** ``browser_display_name``，所以
``from ..browser.browser_manager import browser_display_name`` 这类既有调用点不用改。
"""

from __future__ import annotations

from pathlib import Path

# 常见安装位置（按"优先 Chrome、其次 Edge"的顺序排列）。用环境变量拼，避免把某个
# 用户的绝对路径写死；Windows 之外的平台退回 PATH 查找。
_CHROME_RELATIVE = (
    ("PROGRAMFILES", r"Google\Chrome\Application\chrome.exe"),
    ("PROGRAMFILES(X86)", r"Google\Chrome\Application\chrome.exe"),
    ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
)
_EDGE_RELATIVE = (
    ("PROGRAMFILES(X86)", r"Microsoft\Edge\Application\msedge.exe"),
    ("PROGRAMFILES", r"Microsoft\Edge\Application\msedge.exe"),
    ("LOCALAPPDATA", r"Microsoft\Edge\Application\msedge.exe"),
)

# 中文名，供界面展示"实际用的是哪个浏览器"（别只给路径）。
_CHROME_NAME = "Google Chrome"
_EDGE_NAME = "Microsoft Edge"
_CUSTOM_NAME = "自定义浏览器"


def browser_display_name(path: str | Path | None) -> str:
    """由可执行文件路径推断人类可读的浏览器名。"""
    if not path:
        return ""
    name = Path(path).name.casefold()
    if "msedge" in name or "edge" in name:
        return _EDGE_NAME
    if "chrome" in name:
        return _CHROME_NAME
    return _CUSTOM_NAME
