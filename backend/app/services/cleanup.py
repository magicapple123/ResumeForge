# SPDX-License-Identifier: Apache-2.0
"""存储清理（R19）：把"旧到没用了"的文件列出来，经用户确认后移入回收目录。

**永不硬删**：清理 = 移动到 ``<数据目录>/.cleanup-trash/<时间戳>/<原相对路径>``。
删掉的备份可能正是用户明天要找的那一份，而磁盘空间通常还能再撑一阵——用"能不能撤销"
换"省下几百 MB"是值得的。真正释放空间由用户自己在文件管理器里完成。

清理对象（只碰这五类，且只按**修改时间**判断；不扫数据库、不扫附件）：

- ``backups/``：迁移前的自动备份与手动备份。**最近 3 份永不入选**（``KEEP_RECENT_BACKUPS``）：
  清掉"最新那份"等于把"出事了能回滚"降级成"只能回滚到很久以前"，而这恰恰是最不该
  被清理误伤的东西。只扫这一层文件——``.trash`` 归下一类管，递归会让同一个文件被列两次
  （旧实现就是这样：先按 backups 列一遍，再按 backups/.trash 列一遍，执行时第二次移动失败）；
- ``backups/.trash``：备份自己的回收目录，同样按天数老化，**不做保留**——里面本来就是
  用户已经决定要扔的东西；
- ``auto-backups/``：每 6 小时堆积的自动快照（``services/data_backup/auto_backup.py``）。
  与 ``.trash`` 一样不做保留：它是滚动产物，数量会自己长起来；
- ``logs/``：滚动日志（``backend.log`` 与它的 ``.1``…``.4`` 轮转，当前那一个按"最近
  写入"天然不会入选）。**只有这一个日志目录**：它曾经被拆成"运行日志（
  ``runtime/logs``）"与"旧日志（``logs``）"两类，而 ``runtime/logs`` 从来没有人写
  （全后端不存在 ``DATA_DIR / "runtime"`` 的写入点），于是界面上多了一个永远清不到
  东西的选项，真正在长的 ``logs/`` 反被标成"旧日志"。

"当前在用的文件"必须排除：数据库文件、附件目录、``datasets/`` 一律不在扫描范围内。

按类别清理（``categories``）：``None`` = 全部类别，空集合 = 什么都不清。未知类别抛
``ValueError``（接口层翻成 400 并列出合法值）——静默忽略会让"我只清日志"变成"清了我
没点的那些"。
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ..config import DATA_DIR
from .data_backup.auto_backup import AUTO_BACKUP_DIRNAME
from .data_backup.paths import BACKUP_TRASH_DIRNAME
from .storage_stats import BACKUPS_DIRNAME

TRASH_DIRNAME = ".cleanup-trash"
DEFAULT_RETENTION_DAYS = 30

# 手动/迁移备份的保留份数：最近这几份永不入选，哪怕它们已经很旧。
KEEP_RECENT_BACKUPS = 3

# 类别 key 是接口参数（``?categories=logs``）与前端分组的选择值，改动即破坏兼容。
CATEGORY_BACKUPS = "backups"
CATEGORY_BACKUP_TRASH = "backup-trash"
CATEGORY_AUTO_BACKUPS = "auto-backups"
CATEGORY_LOGS = "logs"


@dataclass(frozen=True)
class CleanupCategory:
    """一类清理对象：稳定 key + 展示名 + 相对数据目录的路径 + 是否保留最近几份。"""

    key: str
    label: str
    relative: str
    # 保留策略：最近 N 份不入选；0 表示这一类不做保留。
    keep_recent: int = 0
    # 是否递归子目录。``backups`` 只扫本层（``.trash`` 单独归 backup-trash），
    # ``auto-backups/<库文件名>/`` 与 ``logs`` 需要递归。
    recursive: bool = True


# 顺序即界面展示顺序。
CATEGORIES: tuple[CleanupCategory, ...] = (
    CleanupCategory(
        CATEGORY_BACKUPS, "手动与迁移备份", BACKUPS_DIRNAME, KEEP_RECENT_BACKUPS, recursive=False
    ),
    CleanupCategory(
        CATEGORY_BACKUP_TRASH, "备份回收目录", f"{BACKUPS_DIRNAME}/{BACKUP_TRASH_DIRNAME}"
    ),
    CleanupCategory(CATEGORY_AUTO_BACKUPS, "自动备份", AUTO_BACKUP_DIRNAME),
    # 日志只有一类：``logs``。曾经还有一个指向 ``runtime/logs`` 的 "old-logs"——
    # 那个目录没有任何写入者，等于给用户一个永远清不到东西的选项，已合并删除
    # （传 ``old-logs`` 现在会被 resolve_categories 当未知类别拒绝）。
    CleanupCategory(CATEGORY_LOGS, "运行日志", "logs"),
)
CATEGORY_KEYS: tuple[str, ...] = tuple(category.key for category in CATEGORIES)


@dataclass(frozen=True)
class CleanupCandidate:
    category: str
    label: str
    path: Path
    size: int
    modified: datetime

    def to_dict(self, root: Path) -> dict[str, Any]:
        return {
            "category": self.category,
            "label": self.label,
            # 只回传**相对**路径：绝对路径会暴露用户目录结构，而这个值只用于展示。
            # 统一用 POSIX 分隔符：这是给界面展示的标识，不该随操作系统变形。
            "path": self.path.relative_to(root).as_posix(),
            "size": self.size,
            "modified": self.modified.astimezone().isoformat(timespec="seconds"),
        }


def _data_root() -> Path:
    return Path(DATA_DIR)


def _stat(path: Path) -> os.stat_result | None:
    try:
        return path.stat()
    except OSError:
        return None


def _mtime(path: Path) -> float:
    """取 mtime；stat 失败（并发删除/无权限）当"最旧"，排序不会因此抛异常。"""
    stat = _stat(path)
    return stat.st_mtime if stat else float("-inf")


def _iter_files(directory: Path, *, recursive: bool = True) -> list[Path]:
    if not directory.is_dir():
        return []
    files: list[Path] = []
    for item in directory.iterdir():
        if item.is_symlink():
            # 不跟随链接：清理一个链接指到数据目录之外的东西不是"清理"。
            continue
        if item.is_file():
            files.append(item)
        elif recursive and item.is_dir():
            files.extend(
                child for child in item.rglob("*") if child.is_file() and not child.is_symlink()
            )
    return files


def resolve_categories(categories: Iterable[str] | None) -> set[str]:
    """把请求里的类别折叠成合法集合。

    - ``None``（没传）= 全部类别；
    - 空集合（显式传了空的）= 什么都不清，代表用户取消全选；
    - 未知类别抛 ``ValueError``，消息里带合法值清单。
    """
    if categories is None:
        return set(CATEGORY_KEYS)
    selected = {str(value).strip() for value in categories if str(value).strip()}
    unknown = sorted(selected - set(CATEGORY_KEYS))
    if unknown:
        raise ValueError(
            f"未知的清理类别：{'、'.join(unknown)}；可选值：{'、'.join(CATEGORY_KEYS)}"
        )
    return selected


def _protected_backups(
    root: Path, category: CleanupCategory, files: list[Path]
) -> tuple[set[Path], list[dict[str, Any]]]:
    """按 mtime 倒序取最近 N 份进 ``skipped``，返回（受保护集合, skipped 条目）。"""
    if category.keep_recent <= 0:
        return set(), []
    # 同一 mtime 的极端情况按文件名兜底，保证"哪三份被保留"是可复现的。
    newest_first = sorted(files, key=lambda path: (_mtime(path), path.name), reverse=True)
    protected: set[Path] = set()
    skipped: list[dict[str, Any]] = []
    for path in newest_first[: category.keep_recent]:
        stat = _stat(path)
        if stat is None:
            continue
        protected.add(path)
        skipped.append(
            {
                "category": category.key,
                "label": category.label,
                "path": path.relative_to(root).as_posix(),
                "reason": f"最近 {category.keep_recent} 份备份",
                "size": stat.st_size,
            }
        )
    return protected, skipped


def plan_cleanup(
    *,
    older_than_days: int = DEFAULT_RETENTION_DAYS,
    categories: set[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """列出超过保留期的文件。只 stat，不读内容，不动任何文件。

    返回结构（``totals`` / ``candidates`` 与旧版保持一致，前端不因本批改动炸掉）::

        {
          "older_than_days": 30,
          "totals": {"files": n, "bytes": m},             # 仅本次选中类别的候选
          "candidates": [{category, label, path, size, modified}],
          "skipped": [{category, label, path, reason, size}],
          "by_category": {"backups": {"label": ..., "files": n, "bytes": m}, ...},
          "categories": [{"key": "backups", "label": "手动与迁移备份"}, ...],
        }

    ``by_category`` **总是统计全部类别**（不受 ``categories`` 影响）：弹窗里用户取消
    勾选某类后，那一类的文件数/体积仍要显示出来，否则取消一次就再也看不到它有多少东西了。
    """
    root = _data_root()
    selected = resolve_categories(categories)
    window = max(1, older_than_days)
    cutoff = (now or datetime.now()) - timedelta(days=window)

    per_category: dict[str, list[CleanupCandidate]] = {category.key: [] for category in CATEGORIES}
    by_category: dict[str, dict[str, Any]] = {
        category.key: {"label": category.label, "files": 0, "bytes": 0} for category in CATEGORIES
    }
    skipped: list[dict[str, Any]] = []

    for category in CATEGORIES:
        files = _iter_files(root / category.relative, recursive=category.recursive)
        protected, protected_entries = _protected_backups(root, category, files)
        skipped.extend(protected_entries)
        for path in files:
            if path in protected:
                continue
            stat = _stat(path)
            if stat is None:
                continue
            modified = datetime.fromtimestamp(stat.st_mtime)
            if modified >= cutoff:
                continue
            per_category[category.key].append(
                CleanupCandidate(category.key, category.label, path, stat.st_size, modified)
            )
            by_category[category.key]["files"] += 1
            by_category[category.key]["bytes"] += stat.st_size

    candidates = [item for key in CATEGORY_KEYS if key in selected for item in per_category[key]]
    # 最老的排前面：用户先看到"最该清的那几个"。
    candidates.sort(key=lambda item: (item.modified, item.path.as_posix()))
    return {
        "older_than_days": window,
        "totals": {
            "files": len(candidates),
            "bytes": sum(item.size for item in candidates),
        },
        "candidates": [item.to_dict(root) for item in candidates],
        "skipped": skipped,
        "by_category": by_category,
        "categories": [{"key": item.key, "label": item.label} for item in CATEGORIES],
    }


def run_cleanup(
    *,
    older_than_days: int = DEFAULT_RETENTION_DAYS,
    categories: set[str] | None = None,
    paths: set[str] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """把候选文件移入 ``.cleanup-trash/<时间戳>/``，返回移动结果。

    与预览**同一份 plan**（直接复用 ``plan_cleanup``）——"预览说 3 个、执行移走 3 个"
    不能靠两处代码各自算一遍来保证。``skipped`` 原样带回，界面据此说明"最近几份备份
    这次没动"。

    移动失败（占用、权限）逐个记录并继续：清掉 9 个、留下 1 个，比整体失败更接近用户的
    预期，也不会让"点了一次清理"变成什么都没发生。
    """
    root = _data_root()
    plan = plan_cleanup(older_than_days=older_than_days, categories=categories, now=now)
    candidates = plan["candidates"]
    # 逐文件勾选：只处理用户点名的路径。``None`` = 不按文件过滤（整类清理）；
    # 空集合 = 一个都不选，不能当成"全部"。
    if paths is not None:
        candidates = [entry for entry in candidates if entry["path"] in paths]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    trash_dir = root / TRASH_DIRNAME / stamp
    moved = 0
    freed = 0
    failed: list[str] = []
    for entry in candidates:
        source = root / entry["path"]
        target = trash_dir / entry["path"]
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
        except OSError:
            failed.append(entry["path"])
            continue
        moved += 1
        freed += int(entry["size"])
    return {
        "moved": moved,
        "freed_bytes": freed,
        "failed": failed,
        # 回收目录本身也要让用户知道，否则"清理了但磁盘没变"会显得像骗人。
        "trash_dir": trash_dir.relative_to(root).as_posix() if moved else "",
        # 本次没动的"最近 N 份备份"：原样带回，别让界面猜。
        "skipped": plan["skipped"],
        "by_category": plan["by_category"],
        "older_than_days": plan["older_than_days"],
    }


__all__ = [
    "CATEGORIES",
    "CATEGORY_KEYS",
    "DEFAULT_RETENTION_DAYS",
    "KEEP_RECENT_BACKUPS",
    "TRASH_DIRNAME",
    "plan_cleanup",
    "resolve_categories",
    "run_cleanup",
]
