# SPDX-License-Identifier: Apache-2.0
"""从 ``update_check`` 拆出：从 Release 的附件里挑出适用于本平台的安装包。

纯函数 + 平台词表：不做网络请求、不读时钟。**平台判定留在 ``update_check``**
（``_platform_tag`` 被测试在模块命名空间上 monkeypatch），因此由调用方把平台传进来。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_PLATFORM_TOKENS: dict[str, frozenset[str]] = {
    "windows": frozenset({"windows", "win", "win32", "win64"}),
    "macos": frozenset({"macos", "mac", "osx", "darwin"}),
    "linux": frozenset({"linux"}),
}
_PLATFORM_LABELS = {"windows": "Windows", "macos": "macOS", "linux": "Linux"}


@dataclass(frozen=True)
class _AssetChoice:
    """从 Release 的附件里挑出来的那个安装包。"""

    url: str
    name: str
    size: int | None
    checksum_url: str
    installable: bool
    reason: str


def _asset_platform(name: str) -> str | None:
    """附件名里的平台词 → 平台；没有平台词时 ``None``（通用包）。"""
    stem = name.lower()
    if stem.endswith(".zip"):
        stem = stem[: -len(".zip")]
    tokens = {token for token in re.split(r"[-_.]+", stem) if token}
    for key, aliases in _PLATFORM_TOKENS.items():
        if tokens & aliases:
            return key
    return None


def _checksum_url_for(assets: object, name: str) -> str:
    """同名的 ``.sha256`` 附件地址（发布脚本会一并生成）。"""
    if not isinstance(assets, list):
        return ""
    wanted = f"{name}.sha256"
    for item in assets:
        if not isinstance(item, dict) or str(item.get("name") or "") != wanted:
            continue
        url = str(item.get("browser_download_url") or "")
        if url.startswith("https://"):
            return url[:1024]
    return ""


def select_asset(data: dict, platform: str | None) -> _AssetChoice:
    """挑出**适用于当前平台**的安装包，不看附件列表的顺序。

    发行版挂的是 `ResumeForge-<版本>-windows.zip` 与 `…-macos.zip` 两个包（各带一份
    `.sha256`）。这里原先按文件名排序取第一个 `.zip`——`macos` < `windows`，于是
    Windows 用户永远下到 macOS 包，而那个包里只有 `start.command`、没有 `start.cmd`，
    校验必然失败：按钮摆在那里，一点就报错（2026-10-01 实测确认）。
    """
    wanted = _PLATFORM_TOKENS.get(platform or "", frozenset())
    assets = data.get("assets")

    best_rank = 0
    best_name = ""
    best_item: dict | None = None
    foreign: set[str] = set()

    if isinstance(assets, list):
        for item in assets:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            url = str(item.get("browser_download_url") or "")
            # `.zip.sha256` 不以 `.zip` 结尾，天然被排除。
            if not name.lower().endswith(".zip") or not url.startswith("https://"):
                continue
            asset_platform = _asset_platform(name)
            if asset_platform is not None and asset_platform in wanted:
                rank = 2
            elif asset_platform is None and name.lower().startswith("resumeforge"):
                # 不带平台词的通用包（以后若只挂一个包，走这条）。
                rank = 1
            else:
                if asset_platform is not None:
                    foreign.add(asset_platform)
                continue
            if rank > best_rank or (rank == best_rank and name < best_name):
                best_rank, best_item, best_name = rank, item, name

    if best_item is not None:
        size = best_item.get("size")
        return _AssetChoice(
            url=str(best_item.get("browser_download_url") or ""),
            name=best_name[:256],
            size=int(size) if isinstance(size, int) and size >= 0 else None,
            checksum_url=_checksum_url_for(assets, best_name),
            installable=True,
            reason="",
        )

    if foreign:
        labels = "、".join(sorted(_PLATFORM_LABELS.get(key, key) for key in foreign))
        reason = f"这个版本只上传了 {labels} 安装包，没有适用于当前系统的"
    else:
        reason = "这个版本没有上传安装包"

    # 最后一条出路：GitHub 给每个 tag 自带一份源码包，它同样含 `start.cmd` 与
    # `backend/app/main.py`，校验与安装都过得去。保留它是有意的——去掉它会让"维护者
    # 忘了传某个平台的包"从"照常更新"直接变成"更新按钮彻底不可用"。
    source_url = str(data.get("zipball_url") or "")
    if source_url.startswith("https://"):
        return _AssetChoice(
            url=source_url,
            name="GitHub 源码包.zip",
            size=None,
            checksum_url="",
            installable=True,
            reason=f"{reason}，这次用源码包更新" if foreign else "",
        )
    return _AssetChoice(
        url="", name="", size=None, checksum_url="", installable=False, reason=reason
    )
