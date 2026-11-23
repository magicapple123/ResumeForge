# SPDX-License-Identifier: Apache-2.0
"""浏览器探测：常见安装位置与人类可读的展示名。

从 ``browser_manager`` 拆出来的原因很直接：那个文件已顶到 500 行预算（CI 硬闸门），
而"去哪儿找 chrome.exe / msedge.exe"和"把路径翻译成界面上的浏览器名"这两件事跟
进程生命周期、调试端口健康检查没有耦合，是这里最独立的一块。

``browser_manager`` 仍然从本模块 import 并**再导出** ``browser_display_name``，所以
``from ..browser.browser_manager import browser_display_name`` 这类既有调用点不用改。
"""

from __future__ import annotations

from collections.abc import Mapping
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


def existing_env_paths(
    env: Mapping[str, str], candidates: tuple[tuple[str, str], ...]
) -> list[Path]:
    """按"环境变量 + 相对安装路径"找已存在的可执行文件（不存在的不返回）。"""
    found: list[Path] = []
    for env_name, relative in candidates:
        base = env.get(env_name)
        if not base:
            continue
        # `relative` 用 Windows 反斜杠写（如 r"Google\Chrome\Application\chrome.exe"），
        # 而 Linux/macOS 上反斜杠只是普通字符、不是路径分隔符——直接 `Path(base) / relative`
        # 会得到一个带反斜杠的单段文件名，永远找不到。所以按 `\\` 拆开再逐段拼接。
        candidate = Path(base).joinpath(*relative.split("\\"))
        if candidate.is_file():
            found.append(candidate)
    return found


def find_browser(
    env: Mapping[str, str], candidates: tuple[tuple[str, str], ...], names: tuple[str, ...]
) -> Path | None:
    """在给定安装位置与 PATH 里找一个浏览器；找不到返回 ``None``。

    ``shutil`` 在函数内导入：测试用 ``monkeypatch.setattr("shutil.which", ...)``
    换掉 PATH 查找，patch 的是模块属性，函数内导入同样生效。
    """
    import shutil

    for path in existing_env_paths(env, candidates):
        return path
    for name in names:
        located = shutil.which(name)
        if located:
            return Path(located)
    return None
