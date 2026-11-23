# SPDX-License-Identifier: Apache-2.0
"""专用浏览器的 profile 身份（B2）：目录按浏览器身份分，旧共享目录一次性归属。

## 为什么必须按身份分目录

两个专用浏览器此前**共用**同一个 profile 目录（``browser-profile``），于是 Chrome 与
Edge 读写同一份 Chromium profile。profile 里带 ``shortcut_migration_version`` 门槛：
本机实测 Edge 158 打开过之后，装的是 157 的 Chrome 会以"配置文件来自更高版本"拒绝
使用，甚至重建一份空 profile——**登录态反而丢**。所以每个浏览器必须有自己的目录，
切换浏览器时用 :mod:`cookie_migration` 迁移 Cookie，而不是共用一份 profile。

## ``browser-id`` 的三个来源

- 显式选中 Chrome / Edge → ``chrome`` / ``edge``；
- 自定义路径 → ``custom-<sha1(normcase(path))[:8]>``（路径变了就是新身份）；
- ``auto`` → **必须先解析成实际浏览器**再取 id（解析结果由调用方传入：只有它知道
  ``_locate_browser`` 找到了哪个可执行文件）。

## 旧目录的归属

升级到本版本后第一次启动，数据目录里还躺着旧的 ``browser-profile`` /
``webform-browser-profile``（整个 profile 直接在根上，没有身份子目录）。必须把它的
**内容**移到当前身份的子目录里，否则用户升级后全部站点都要重登。移动是单向的：
目标已存在就**不动、只记日志、保留旧目录**——两个 profile 合并成一个只会互相踩踏。
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: 身份目录名（同时也是 ``browser_choice`` 的取值）。
BROWSER_ID_CHROME = "chrome"
BROWSER_ID_EDGE = "edge"
#: 自定义路径身份的前缀。路径哈希取前 8 位十六进制足够区分本机上的几个浏览器。
CUSTOM_ID_PREFIX = "custom-"
_CUSTOM_HASH_CHARS = 8

#: 旧 profile 归属的结果。写成常量而不是裸字符串：调用方要拿它做判断与日志。
ADOPT_ALREADY = "already-adopted"
ADOPT_MOVED = "moved"
ADOPT_TARGET_EXISTS = "target-exists"
ADOPT_NOTHING = "nothing-to-adopt"
ADOPT_FAILED = "failed"


class ProfileIdentityError(ValueError):
    """无法确定 profile 身份（``auto`` 还没解析出实际浏览器）。"""


def custom_browser_id(path: str | Path) -> str:
    """自定义浏览器路径 → 稳定身份 ``custom-<sha1[:8]>``。

    归一化用 ``os.path.normcase``（Windows 下小写 + 反斜杠、其它平台不变）：同一份
    可执行文件写成 ``C:\\X\\chrome.exe`` 与 ``c:/x/chrome.exe`` 是同一个身份，否则
    用户改一下路径写法就会被当成"换了浏览器"而触发一次无意义的迁移。
    """
    normalized = os.path.normcase(str(path or "").strip())
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
    return f"{CUSTOM_ID_PREFIX}{digest[:_CUSTOM_HASH_CHARS]}"


def browser_id_from_executable(executable: str | Path) -> str:
    """按可执行文件名判断身份（``auto`` 解析后用这个）。

    文件名既不是 chrome 也不是 edge（例如某个 Chromium 分支）时退回路径哈希：
    宁可多一个独立目录，也不要两个不同浏览器共用一个 profile。
    """
    name = Path(executable).name.lower()
    if "msedge" in name or "edge" in name:
        return BROWSER_ID_EDGE
    if "chrome" in name:
        return BROWSER_ID_CHROME
    return custom_browser_id(executable)


def browser_id_for_choice(choice: str, browser_path: str | Path | None = None) -> str | None:
    """按设置里的选择算身份；``auto`` 且尚未解析时返回 ``None``。

    显式给了 ``browser_path`` 一律按自定义路径算身份——这与 ``BrowserManager``
    定位可执行文件的优先级一致（给了路径就只用那个路径）。
    """
    explicit = str(browser_path or "").strip()
    if explicit:
        return custom_browser_id(explicit)
    if choice == BROWSER_ID_CHROME:
        return BROWSER_ID_CHROME
    if choice == BROWSER_ID_EDGE:
        return BROWSER_ID_EDGE
    return None


def profile_dir_for(root: str | Path, browser_id: str) -> Path:
    """某个身份的 profile 目录：``<root>/<browser-id>``。"""
    wanted = str(browser_id or "").strip()
    if not wanted:
        raise ProfileIdentityError("browser-id 不能为空")
    return Path(root) / wanted


def resolve_profile_dir(
    root: str | Path,
    *,
    choice: str,
    browser_path: str | Path | None = None,
    resolved_path: str | Path | None = None,
) -> Path:
    """解析 profile 目录；``auto`` 没有解析结果时大声失败。

    ``resolved_path`` 是 ``_locate_browser()`` 真正找到的可执行文件。``auto`` 必须
    先解析成实际浏览器再取 id，否则两台机器上 "auto" 会指向同一个目录——
    正是 B2 要消灭的那种共用。
    """
    browser_id = browser_id_for_choice(choice, browser_path)
    if browser_id is None and resolved_path:
        browser_id = browser_id_from_executable(resolved_path)
    if browser_id is None:
        raise ProfileIdentityError(
            "浏览器选择是 auto，但还没解析出实际浏览器，无法确定 profile 目录"
        )
    return profile_dir_for(root, browser_id)


@dataclass(frozen=True)
class ProfileAdoption:
    """旧 profile 归属的结果快照（可直接写进证据文件）。"""

    outcome: str
    legacy_root: str
    target: str
    moved_entries: int = 0
    detail: str = ""

    @property
    def changed_anything(self) -> bool:
        return self.outcome == ADOPT_MOVED

    def as_line(self) -> str:
        """一行可读结论（日志与证据共用同一份措辞）。"""
        return (
            f"{self.outcome} legacy={self.legacy_root} target={self.target} "
            f"moved={self.moved_entries} {self.detail}".strip()
        )


@dataclass(frozen=True)
class ProfileResolution:
    """一次 profile 目录解析的结果：最终目录 + 旧目录归属情况（没归属时为空）。"""

    path: Path
    adoption: ProfileAdoption | None = None


def prepare_profile_dir(
    root: str | Path,
    *,
    explicit: str | Path | None = None,
    choice: str = "",
    browser_path: str | Path | None = None,
    resolved_path: str | Path | None = None,
) -> ProfileResolution:
    """``BrowserManager.start()`` 用的唯一入口：解析目录 → 旧目录归属 → 建目录。

    ``explicit`` 给定时**完全跳过身份解析**：那是调用方显式指定的目录（离线测试、
    "把 profile 放在别处"的调试用法），不应该被自动分身份改掉位置。
    """
    if explicit is not None:
        path = Path(explicit)
        path.mkdir(parents=True, exist_ok=True)
        return ProfileResolution(path)
    target = resolve_profile_dir(
        root, choice=choice, browser_path=browser_path, resolved_path=resolved_path
    )
    adoption = adopt_legacy_profile(root, target)
    target.mkdir(parents=True, exist_ok=True)
    return ProfileResolution(target, adoption)


def profile_dir_or_root(
    root: str | Path,
    *,
    choice: str = "",
    browser_path: str | Path | None = None,
    resolved_path: str | Path | None = None,
) -> Path:
    """尽最大努力算出 profile 目录；``auto`` 还没解析时退回共享根目录。

    只给 ``status()`` 这类"绝不能抛异常"的展示路径用：状态接口每 1.5 秒被轮询一次，
    一次解析失败不该让整个接口 500。
    """
    try:
        return resolve_profile_dir(
            root, choice=choice, browser_path=browser_path, resolved_path=resolved_path
        )
    except ProfileIdentityError:
        return Path(root)


def _is_identity_dir(entry: Path) -> bool:
    """这个条目是不是"某个浏览器身份的 profile 目录"（chrome / edge / custom-xxx）。"""
    return entry.is_dir() and (
        entry.name in {BROWSER_ID_CHROME, BROWSER_ID_EDGE}
        or entry.name.startswith(CUSTOM_ID_PREFIX)
    )


def adopt_legacy_profile(legacy_root: str | Path, target: str | Path) -> ProfileAdoption:
    """把旧共享 profile 的**内容**移进当前身份的子目录。

    四种结果：

    - 旧目录不存在 → :data:`ADOPT_NOTHING`（全新安装，没什么可归属的）；
    - 目标目录已有内容、旧目录里还有别的东西 → :data:`ADOPT_TARGET_EXISTS`：
      **不动、只记 warning、两边都保留**。合并两份 profile 会让 Cookie / Preferences /
      Local State 互相覆盖，比"多留一个旧目录"坏得多；
    - 目标目录已存在且旧目录里只剩它自己 → :data:`ADOPT_ALREADY`（上次已经归属过，
      不再每次启动都刷一条 warning）；
    - 目标目录不存在 → 建目录并把旧目录的每个条目移进去（:data:`ADOPT_MOVED`）。

    移动用 ``shutil.move``：同一分区上是 rename（原子、瞬时），跨分区退化成复制+删除。
    单个条目失败只记日志并继续——部分迁移出去的 profile 仍能用，剩下那几个条目下次
    启动还会再试。
    """
    root = Path(legacy_root)
    dest = Path(target)
    if not root.is_dir():
        return ProfileAdoption(ADOPT_NOTHING, str(root), str(dest), detail="旧目录不存在")
    if dest.parent != root:
        # 结构安全阀：只接受 "<root>/<browser-id>" 这种目标，别的地方不是"归属"。
        return ProfileAdoption(ADOPT_FAILED, str(root), str(dest), detail="目标目录不在旧目录下")

    entries = [item for item in root.iterdir() if item != dest]
    # **只能搬"profile 内容"，绝不能搬另一个身份的子目录**：归属过一次之后根目录下就是
    # chrome/ edge/ custom-xxx/，此时若按"目标不存在就搬"的逻辑执行，换浏览器会把
    # 上一个浏览器的整个 profile 拖进新身份目录里（chrome/ → edge/chrome），登录态当场毁掉。
    movable = [item for item in entries if not _is_identity_dir(item)]
    if dest.exists():
        if not movable:
            return ProfileAdoption(ADOPT_ALREADY, str(root), str(dest), detail="已归属过")
        logger.warning(
            "旧 profile 目录 %s 与目标目录 %s 同时存在，保留旧目录、不做合并", root, dest
        )
        return ProfileAdoption(
            ADOPT_TARGET_EXISTS, str(root), str(dest), len(movable), detail="目标已存在"
        )

    if not movable:
        if entries:
            # 根目录下已经是按身份分的子目录：B2 之后的正常形态，没有"旧 profile"可归属。
            return ProfileAdoption(
                ADOPT_ALREADY, str(root), str(dest), detail="根目录已是身份子目录"
            )
        # 空壳目录：删掉，免得下次启动再判一次"要不要归属"。
        with contextlib.suppress(OSError):
            root.rmdir()
        return ProfileAdoption(ADOPT_NOTHING, str(root), str(dest), detail="旧目录为空")

    dest.mkdir(parents=True, exist_ok=True)
    moved = 0
    for item in movable:
        try:
            shutil.move(str(item), str(dest / item.name))
        except OSError as exc:
            logger.warning(
                "旧 profile 条目迁移失败 entry=%s error=%s", item.name, type(exc).__name__
            )
            continue
        moved += 1
    logger.info("旧 profile 已归属到 %s（%d 个条目）", dest, moved)
    return ProfileAdoption(ADOPT_MOVED, str(root), str(dest), moved)


__all__ = [
    "ADOPT_ALREADY",
    "ADOPT_FAILED",
    "ADOPT_MOVED",
    "ADOPT_NOTHING",
    "ADOPT_TARGET_EXISTS",
    "BROWSER_ID_CHROME",
    "BROWSER_ID_EDGE",
    "CUSTOM_ID_PREFIX",
    "ProfileAdoption",
    "ProfileIdentityError",
    "ProfileResolution",
    "adopt_legacy_profile",
    "browser_id_for_choice",
    "browser_id_from_executable",
    "custom_browser_id",
    "prepare_profile_dir",
    "profile_dir_for",
    "profile_dir_or_root",
    "resolve_profile_dir",
]
