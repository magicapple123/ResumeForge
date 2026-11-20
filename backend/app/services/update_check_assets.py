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

#: 桌面安装包的文件名形状（发布脚本固定这么生成）：`ResumeForge-Setup-<版本>.exe`。
#: 只认这个前缀是有意的——Release 里挂着任何 `.exe` 都能被选中的话，一个同名工具
#: 附件就能把"安装包"顶掉。
_INSTALLER_PREFIX = "resumeforge-setup-"
_INSTALLER_SUFFIX = ".exe"
_ZIP_SUFFIX = ".zip"


@dataclass(frozen=True)
class _AssetChoice:
    """从 Release 的附件里挑出来的那个安装包。"""

    url: str
    name: str
    size: int | None
    checksum_url: str
    installable: bool
    reason: str


def _asset_kind(name: str) -> str | None:
    """附件属于哪种包：``installer``（Setup.exe）/ ``zip``（便携包）/ ``None``（无关文件）。"""
    lowered = name.lower()
    if lowered.startswith(_INSTALLER_PREFIX) and lowered.endswith(_INSTALLER_SUFFIX):
        return "installer"
    if lowered.endswith(_ZIP_SUFFIX):
        return "zip"
    return None


def _asset_platform(name: str) -> str | None:
    """附件名里的平台词 → 平台；没有平台词时 ``None``（通用包）。

    ``.exe`` 单独判一次：`ResumeForge-Setup-2.1.0.exe` 名字里没有平台词，但 exe 只可能是
    Windows 安装器——把它当"通用包"会让 macOS/Linux 也认领它。
    """
    lowered = name.lower()
    suffix = ""
    for candidate in (_ZIP_SUFFIX, _INSTALLER_SUFFIX):
        if lowered.endswith(candidate):
            suffix = candidate
            lowered = lowered[: -len(candidate)]
            break
    tokens = {token for token in re.split(r"[-_.]+", lowered) if token}
    for key, aliases in _PLATFORM_TOKENS.items():
        if tokens & aliases:
            return key
    if suffix == _INSTALLER_SUFFIX:
        return "windows"
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


def select_asset(data: dict, platform: str | None, prefer: str = "zip") -> _AssetChoice:
    """挑出**适用于当前平台与形态**的安装包，不看附件列表的顺序。

    发行版挂的是 `ResumeForge-<版本>-windows.zip` 与 `…-macos.zip` 两个包（各带一份
    `.sha256`）。这里原先按文件名排序取第一个 `.zip`——`macos` < `windows`，于是
    Windows 用户永远下到 macOS 包，而那个包里只有 `start.command`、没有 `start.cmd`，
    校验必然失败：按钮摆在那里，一点就报错（2026-10-01 实测确认）。

    ``prefer`` 决定**形态**（2026-11-20 补）：``"installer"`` 认
    `ResumeForge-Setup-<版本>.exe`（桌面壳那条链路要的是它），``"zip"`` 认便携包。
    v2.1.0 两种资产同时挂，只按扩展名筛就永远命中 zip——桌面用户因此拿不到安装器
    直链，只能打开 releases 页面自己找。

    退让是**单向**的：要安装器而没有时退到 zip（源码包连 `.sha256` 都没有，应用内安装
    本来就拒绝它，§12.5 #4），退让的代价写进 ``reason``；要 zip 时**绝不**选 exe——
    exe 装不上（`update_download` 的覆盖安装读的是压缩包），选中它等于摆一个点了必失败
    的按钮。两种资产都没有时才回落 ``zipball_url``。
    """
    wanted = _PLATFORM_TOKENS.get(platform or "", frozenset())
    wanted_kind = "installer" if prefer == "installer" else "zip"
    assets = data.get("assets")

    # 显式标成 tuple[int, int]：不标注的话 pyright 会把 (0, 0) 推成
    # tuple[Literal[0], Literal[0]]，而 `rank` 是 tuple[Literal[2, 1], Literal[2]]，
    # 两个 Literal 元组的 `>` 会被判成"不支持该运算符"（Python 运行时其实合法）。
    best_rank: tuple[int, int] = (0, 0)
    best_name = ""
    best_item: dict | None = None
    foreign: set[str] = set()

    if isinstance(assets, list):
        for item in assets:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            url = str(item.get("browser_download_url") or "")
            kind = _asset_kind(name)
            # `.zip.sha256` / `.exe.sha256` 都不是包，`_asset_kind` 天然把它们排除。
            if kind is None or not url.startswith("https://"):
                continue
            if kind != wanted_kind and wanted_kind != "installer":
                continue
            # 第一优先级是形态，第二是平台：宁可拿本平台的便携包，也不拿异构平台的安装器。
            kind_rank = 2 if kind == wanted_kind else 1
            asset_platform = _asset_platform(name)
            if asset_platform is not None and asset_platform in wanted:
                rank: tuple[int, int] = (kind_rank, 2)
            elif asset_platform is None and name.lower().startswith("resumeforge"):
                # 不带平台词的通用包（以后若只挂一个包，走这条）。
                rank = (kind_rank, 1)
            else:
                if asset_platform is not None:
                    foreign.add(asset_platform)
                continue
            # 逐元素比，不整元组比：pyright 用流敏感窄化类型检查运算符，
            # tuple[Literal[2, 1], Literal[2]] > tuple[Literal[0], Literal[0]]
            # 会被判成 reportOperatorIssue（Python 运行时其实合法）。
            rank_beats = rank[0] > best_rank[0] or (
                rank[0] == best_rank[0] and rank[1] > best_rank[1]
            )
            if rank_beats or (rank == best_rank and name < best_name):
                best_rank, best_item, best_name = rank, item, name

    if best_item is not None:
        size = best_item.get("size")
        # 形态与首选不一致时把"为什么给的不是安装器"带出去，上层拼进 message。
        fallback_reason = (
            "这个版本没有上传桌面安装包（ResumeForge-Setup-*.exe），只有便携包"
            if wanted_kind == "installer" and _asset_kind(best_name) != wanted_kind
            else ""
        )
        return _AssetChoice(
            url=str(best_item.get("browser_download_url") or ""),
            name=best_name[:256],
            size=int(size) if isinstance(size, int) and size >= 0 else None,
            checksum_url=_checksum_url_for(assets, best_name),
            installable=True,
            reason=fallback_reason,
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
