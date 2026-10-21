# SPDX-License-Identifier: Apache-2.0
"""导出兜底扫描：数据目录里**没进备份**的东西必须能被说出来（P3）。

数据库侧已经"结构上不可能漏"（整库快照 + 模型注册表 + fail-closed 导入），磁盘侧却
一直靠一份硬编码白名单：新功能把文件写到新目录时，导出既不带它、也不提示——用户要
等到换机器才发现丢了。这里把"没被任何规则收下"的顶层项逐个列进清单的 ``uncovered``
段，并在导出响应头里给出计数。

判定只有三条，**新目录天然落进第三条**，不需要谁记得来登记：

1. **已覆盖**：数据库文件与边车（``*.db`` / ``*.db-wal`` / …）、``ASSET_CATEGORIES``
   里的资产目录（跟数据集走）、全局资产目录 ``fonts/``（P2 起随包）；
2. **已知不覆盖**：``RUNTIME_ONLY``（可重建/敏感的运行产物）、``KNOWN_FILES``
   （数据集指针与全局设置）、``datasets/``（其余数据集，由「导出全部数据集」负责）、
   以及以 ``.`` 开头的隐藏/暂存项——这些不告警，否则每次导出都有一屏噪音；
3. 其余一律列入 ``uncovered``。

只 ``stat`` 不读内容：导出不该被大目录拖慢，而"有没有备份"只需要名字与字节数。
"""

from __future__ import annotations

import stat
from pathlib import Path
from typing import Any

from .asset_categories import ASSET_CATEGORIES

# 已知的运行产物：可重建 / 敏感 / 临时，明确不纳入备份，也**不告警**。
#
# ``runtime`` 是桌面壳与启动脚本落日志的目录；``pre-update`` 是更新前的程序备份；
# ``backups`` / ``auto-backups`` / ``restore`` / ``exports`` 是备份自己的产物——
# 把备份再备份一遍没有意义，还会让包体积翻倍。
RUNTIME_ONLY = frozenset(
    {
        "captures",
        "share_packages",
        "browser-profile",
        "webform-browser-profile",
        "logs",
        "runtime",
        "exports",
        "restore",
        "backups",
        "auto-backups",
        "pre-update",
        ".trash",
    }
)

# 跟数据集走的资产目录：唯一来源是 ``ASSET_CATEGORIES``（P1），这里只做投影，
# 不允许再手写一份名单——``test_asset_categories_and_coverage_agree`` 钉住这一点。
COVERED_DIRECTORIES = frozenset(ASSET_CATEGORIES)

# 跨数据集共用的全局资产目录（P2 起随包，走 ``global_assets`` 而非资产清单）。
GLOBAL_ASSET_DIRECTORIES = frozenset({"fonts"})

# 其余数据集：单份导出时它们确实不在包里，但那是用户显式选择的结果（「导出全部
# 数据集」是另一个入口），每次都提示只会训练用户忽略提示。
DATASETS_DIRNAME = "datasets"

# 数据目录里"不是用户资产"的已知文件：数据集指针与全局设置（LLM 配置经
# ``global_llm.json`` 随包，主题等偏好看 ``global_settings.py`` 的说明）。
KNOWN_FILES = frozenset({"active.json", "global_settings.json"})

# SQLite 主文件与边车：都在快照里，不必逐个登记。
_DATABASE_SUFFIXES = (".db", ".db-wal", ".db-shm", ".db-journal")

# 扫描上限（D3）：顶层 + 未知名目录递归至多 3 层、最多 5000 个文件，跳过符号链接。
MAX_DEPTH = 3
MAX_FILES = 5000


def data_root(bind: Any) -> Path | None:
    """数据目录的根：数据库所在目录；数据集库在 ``<root>/datasets/`` 时上溯一层。

    多份数据集共用同一个根（``user_files/``、``fonts/``、``backups/`` 都在根下），
    导出某一份导入数据集时只看它自己所在的 ``datasets/`` 会把整个数据目录看漏。
    """
    from .paths import BackupError, database_path

    try:
        parent = database_path(bind).parent
    except BackupError:
        return None
    return parent.parent if parent.name == DATASETS_DIRNAME else parent


def is_covered(name: str) -> bool:
    """这个顶层项是否属于"已覆盖/已知不覆盖"（True = 不告警）。"""
    if name in COVERED_DIRECTORIES or name in GLOBAL_ASSET_DIRECTORIES:
        return True
    if name in RUNTIME_ONLY or name in KNOWN_FILES or name == DATASETS_DIRNAME:
        return True
    # 隐藏项：``.rf-restore-*`` 之类的暂存、``.DS_Store``、用户自己的隐藏文件。
    if name.startswith("."):
        return True
    return name.endswith(_DATABASE_SUFFIXES)


def scan_uncovered(root: Path | None) -> dict[str, Any]:
    """扫描 ``root`` 顶层，返回 ``{"items", "count", "bytes", "truncated"}``。

    ``items`` 的每一项是 ``{"name", "kind", "bytes", "files"}``；``kind`` 只有
    ``dir`` / ``file`` 两种。目录只统计字节与文件数，不递归进**已知**目录。
    """
    empty: dict[str, Any] = {"items": [], "count": 0, "bytes": 0, "truncated": False}
    if root is None:
        return empty
    try:
        entries = sorted(root.iterdir(), key=lambda item: item.name)
    except OSError:
        return empty

    items: list[dict[str, Any]] = []
    budget = {"files": 0, "truncated": False}
    for entry in entries:
        if is_covered(entry.name):
            continue
        measured = _measure(entry, budget)
        if measured is None:
            continue
        items.append(measured)
        if budget["truncated"]:
            break
    return {
        "items": items,
        "count": len(items),
        "bytes": sum(item["bytes"] for item in items),
        "truncated": budget["truncated"],
    }


def _measure(entry: Path, budget: dict[str, Any]) -> dict[str, Any] | None:
    """只 stat 不读：文件取大小，目录按深度 ≤ ``MAX_DEPTH`` 汇总字节与文件数。"""
    try:
        info = entry.lstat()
    except OSError:
        return None
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(
        stat, "FILE_ATTRIBUTE_REPARSE_POINT", 1024
    ):
        # 符号链接/目录联接可能指向数据目录之外：既不能算进备份，也不该跟着统计。
        return None
    if not stat.S_ISDIR(info.st_mode):
        return {"name": entry.name, "kind": "file", "bytes": info.st_size, "files": 1}

    total_bytes = 0
    files = 0
    stack: list[tuple[Path, int]] = [(entry, 1)]
    while stack:
        directory, depth = stack.pop()
        try:
            children = list(directory.iterdir())
        except OSError:
            continue
        for child in children:
            if budget["truncated"]:
                break
            try:
                child_info = child.lstat()
            except OSError:
                continue
            if stat.S_ISLNK(child_info.st_mode):
                continue
            if stat.S_ISDIR(child_info.st_mode):
                if depth < MAX_DEPTH:
                    stack.append((child, depth + 1))
                continue
            files += 1
            budget["files"] += 1
            total_bytes += child_info.st_size
            if budget["files"] >= MAX_FILES:
                budget["truncated"] = True
        if budget["truncated"]:
            break
    return {"name": entry.name, "kind": "dir", "bytes": total_bytes, "files": files}


def uncovered_summary(manifest: dict[str, Any] | None) -> dict[str, Any]:
    """从清单里读回未覆盖摘要（响应头与界面共用同一口径）。"""
    summary = {"count": 0, "bytes": 0, "truncated": False}
    if not isinstance(manifest, dict):
        return summary
    items = manifest.get("uncovered")
    if not isinstance(items, list):
        return summary
    count = 0
    total = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        count += 1
        size = item.get("bytes")
        if type(size) is int and size > 0:
            total += size
    summary["count"] = count
    summary["bytes"] = total
    summary["truncated"] = manifest.get("uncovered_truncated") is True
    return summary


__all__ = [
    "COVERED_DIRECTORIES",
    "DATASETS_DIRNAME",
    "GLOBAL_ASSET_DIRECTORIES",
    "KNOWN_FILES",
    "MAX_DEPTH",
    "MAX_FILES",
    "RUNTIME_ONLY",
    "data_root",
    "is_covered",
    "scan_uncovered",
    "uncovered_summary",
]
