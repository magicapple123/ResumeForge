"""存储体积统计（RF-25，PR-16 统一作用域）：分项体积、只 stat 不读内容。

只 ``stat`` 不读内容：目录可能很大（``browser-profile`` 是 Chromium 用户目录，
``user_files`` 是附件磁盘副本），任何"读进来再算"的实现都会把一次统计变成一次
全量 IO。文件内容本身**永远不出现在响应里**——这里只有路径标签、字节数与文件数。

## 作用域（PR-16）

每个分项标注四类作用域之一，扫描根固定为**配置的数据目录**（``DATABASE_URL``
所在目录），不再随"当前激活库的父目录"漂移：

- ``dataset``：随当前数据集走（数据库文件本身、``user_files``、``referral_images``）；
- ``shared``：全部数据集共享（``datasets/`` 目录，含回收站）；
- ``backup``：备份与暂存（手动/自动备份、导出包、导入暂存）；
- ``application``：应用级目录，不随数据集切换移动（浏览器用户目录、采集样例、
  日志、升级前快照等——它们在代码里锚定 ``DATA_DIR``，统计口径保持一致）。

## 口径保证

- **单次扫描、按路径归类**：整棵数据目录只走一遍，每个文件按"相对根的首段目录名"
  归入唯一分项，因此**总计恒等于分项之和**（旧实现分项各自 walk + 总计再全量 walk，
  激活导入库时会双重计数）；不属于任何已知分项的文件进"未分类"兜底项；
- **数据库文件不硬编码**：按当前连接的真实库文件（含 ``-wal/-shm/-journal`` 边车）
  统计，自定义库名不再被统计成默认库；库文件+边车单独 stat，不进目录扫描；
- **不跟随符号链接**：目录链接不深入（防逃逸出数据目录），文件链接按 lstat 计；
- **扫描有预算**：文件数/深度超限即停并计入告警；权限失败计入 ``warnings``
  （响应里显式可见），不崩溃也不静默；
- **短 TTL 缓存**：同一口径 60 秒内复用结果，避免设置页反复打开就反复全量扫描；
  测试可用 :func:`reset_storage_cache` 立即失效。
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from ..config import DATA_DIR
from ..dataset_registry import DATASETS_DIRNAME
from .data_backup.auto_backup import AUTO_BACKUP_DIRNAME
from .data_backup.paths import BACKUP_TRASH_DIRNAME, database_path
from .user_files import USER_FILES_DIRNAME

logger = logging.getLogger(__name__)

# SQLite 的边车文件：与主库同名的 -wal / -shm / -journal，属于主库体积的一部分。
_DB_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")

# 手动备份目录：迁移前的自动备份（database_migrations.backup_sqlite_database 的默认去处），
# 目前没有轮转也没有界面，RF-25 起在这里可见、可逐份清理。
BACKUPS_DIRNAME = "backups"

# ---- 作用域常量（PR-16） ----
SCOPE_DATASET = "dataset"
SCOPE_SHARED = "shared"
SCOPE_BACKUP = "backup"
SCOPE_APPLICATION = "application"
SCOPE_UNCLASSIFIED = "unclassified"

# 扫描预算：单次统计最多走的文件数与目录深度。预算是防失控的安全网（比如用户把
# 几十 GB 的浏览器缓存指进来），不是精确承诺；触顶时计入 warnings 如实告知。
_MAX_FILES = 200_000
_MAX_DEPTH = 24
# 告警条数上限：权限失败可能一大片，响应里截断到可读的量。
_MAX_WARNINGS = 20

# 缓存 TTL（秒）：设置页短时间内反复打开不重复扫描。
_CACHE_TTL_SECONDS = 60.0

_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}

# 数据目录下首段目录名 → 分项 key。同一张表也用于 datasets/ 之内
# （多份数据集的附件/备份目录嵌在那里，归类规则一致，天然不与 datasets/ 分项重叠）。
_DIR_KEY: dict[str, str] = {
    "user_files": "user_files",
    "referral_images": "referral_images",
    "backups": "backups",
    AUTO_BACKUP_DIRNAME: "auto_backups",
    "exports": "exports",
    "restore": "restore",
    "captures": "captures",
    "share_packages": "share_packages",
    "logs": "logs",
    "browser-profile": "browser_profile",
    "webform-browser-profile": "webform_browser_profile",
    "pre-update": "pre_update",
}


@dataclass(frozen=True)
class _ItemSpec:
    key: str
    label: str
    scope: str


_ITEM_SPECS: tuple[_ItemSpec, ...] = (
    _ItemSpec("database", "数据库（含 WAL 边车）", SCOPE_DATASET),
    _ItemSpec("datasets", "数据集（含回收站）", SCOPE_SHARED),
    _ItemSpec("backups", "手动备份", SCOPE_BACKUP),
    _ItemSpec("auto_backups", "自动备份快照", SCOPE_BACKUP),
    _ItemSpec("user_files", "附件磁盘副本", SCOPE_DATASET),
    _ItemSpec("exports", "导出备份包", SCOPE_BACKUP),
    _ItemSpec("captures", "站点采集样例", SCOPE_APPLICATION),
    _ItemSpec("share_packages", "分享页面包", SCOPE_APPLICATION),
    _ItemSpec("referral_images", "内推备注图片", SCOPE_DATASET),
    _ItemSpec("logs", "日志", SCOPE_APPLICATION),
    _ItemSpec("browser_profile", "投递浏览器用户目录", SCOPE_APPLICATION),
    _ItemSpec("webform_browser_profile", "网申浏览器用户目录", SCOPE_APPLICATION),
    _ItemSpec("restore", "导入暂存", SCOPE_BACKUP),
    _ItemSpec("pre_update", "升级前快照", SCOPE_APPLICATION),
)
_UNCLASSIFIED_SPEC = _ItemSpec("uncategorized", "未分类（其他文件）", SCOPE_UNCLASSIFIED)


def _data_root() -> Path:
    """统计根：配置的数据目录（``DATABASE_URL`` 所在目录）。

    刻意**不**用当前激活库的父目录：那会随数据集切换漂移（激活导入库时变成
    ``datasets/`` 子目录），让应用级目录的口径跟着晃。内存库等极端情况回退
    ``DATA_DIR``。
    """
    from ..dataset_registry import data_directory

    try:
        return data_directory()
    except Exception:  # noqa: BLE001 - 非 SQLite 配置时退回默认数据目录
        return DATA_DIR


def _active_database_path(bind: Engine | None) -> Path | None:
    """当前连接的真实库文件；内存库等无文件情况返回 None（不硬编码默认库名）。"""
    if bind is None:
        return None
    try:
        return database_path(bind)
    except Exception:  # noqa: BLE001 - 内存库/非 SQLite：没有可统计的库文件
        return None


def _is_database_file(path: Path, db_path: Path) -> bool:
    """主库文件本体或它的边车（``-wal/-shm/-journal``）。"""
    if path == db_path:
        return True
    return (
        path.name.startswith(db_path.name)
        and path.name[len(db_path.name) :] in _DB_SIDECAR_SUFFIXES
    )


def _classify(rel_parts: tuple[str, ...], datasets_dirname: str) -> str:
    """按"相对统计根的路径段"把一个文件归入唯一分项。"""
    first = rel_parts[0]
    if first == datasets_dirname:
        # datasets/ 之内：嵌套的附件/备份目录归各自分项，其余（.db、.json、.trash）
        # 都算"数据集"分项——它们是各份数据集的本体与回收站。
        rest = rel_parts[1:]
        if rest and rest[0] in _DIR_KEY:
            return _DIR_KEY[rest[0]]
        return "datasets"
    if first in _DIR_KEY:
        return _DIR_KEY[first]
    return "uncategorized"


def _scan_tree(
    root: Path,
    datasets_dirname: str,
    db_path: Path | None,
    warnings: list[str],
) -> dict[str, tuple[int, int]]:
    """单遍扫描整棵数据目录，返回 分项 → (字节数, 文件数)。

    库文件与边车**不在这里统计**（调用方单独 stat）：这样"数据库"分项与目录扫描
    天然不重叠，库文件在统计根之外（极端配置）也能被算到。
    """
    counts: dict[str, list[int]] = {}
    visited_files = 0

    def _add(key: str, size: int) -> None:
        bucket = counts.setdefault(key, [0, 0])
        bucket[0] += size
        bucket[1] += 1

    stack: list[tuple[Path, tuple[str, ...]]] = [(root, ())]
    while stack:
        directory, rel = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError as exc:
            if len(warnings) < _MAX_WARNINGS:
                warnings.append(f"无法读取目录 {directory.name}：{exc.strerror or exc}")
            continue
        for entry in entries:
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                is_link = entry.is_symlink()
            except OSError as exc:
                if len(warnings) < _MAX_WARNINGS:
                    warnings.append(f"无法读取 {entry.name}：{exc.strerror or exc}")
                continue
            rel_parts = rel + (entry.name,)
            if is_dir:
                if is_link:
                    # 目录符号链接不深入：统计口径不允许顺着链接跑出数据目录。
                    if len(warnings) < _MAX_WARNINGS:
                        warnings.append(f"跳过符号链接目录 {entry.name}")
                    continue
                if len(rel_parts) >= _MAX_DEPTH:
                    if len(warnings) < _MAX_WARNINGS:
                        warnings.append(f"目录层级超过预算，已跳过 {entry.name}")
                    continue
                stack.append((Path(entry.path), rel_parts))
                continue
            visited_files += 1
            if visited_files > _MAX_FILES:
                if len(warnings) < _MAX_WARNINGS:
                    warnings.append(f"文件数超过扫描预算（{_MAX_FILES}），统计可能不完整")
                return {key: (size, count) for key, (size, count) in counts.items()}
            if db_path is not None and _is_database_file(Path(entry.path), db_path):
                continue  # 库文件/边车由调用方单独统计，避免重复计入
            try:
                size = entry.stat(follow_symlinks=False).st_size
            except OSError as exc:
                if len(warnings) < _MAX_WARNINGS:
                    warnings.append(f"无法读取 {entry.name}：{exc.strerror or exc}")
                continue
            _add(_classify(rel_parts, datasets_dirname), size)
    return {key: (size, count) for key, (size, count) in counts.items()}


def _database_entry(db_path: Path) -> dict[str, Any]:
    """主库文件 + 边车文件合并为一项：用户关心的是"数据库占多大"，不是几个文件。"""
    total = 0
    count = 0
    for suffix in ("", *_DB_SIDECAR_SUFFIXES):
        candidate = Path(f"{db_path}{suffix}")
        try:
            total += candidate.stat().st_size
            count += 1
        except OSError:  # pragma: no cover - 文件被占用的瞬时态/边车不存在
            continue
    return {
        "key": "database",
        "label": "数据库（含 WAL 边车）",
        "scope": SCOPE_DATASET,
        "size_bytes": total,
        "file_count": count,
    }


def reset_storage_cache() -> None:
    """立即失效统计缓存（测试与"用户刚做完大动作想立刻看数字"的入口可用）。"""
    _CACHE.clear()


def storage_overview(bind: Engine | None = None, *, now: float | None = None) -> dict:
    """各项存储占用汇总。顺序按"用户能对它做什么"排：库、数据集、备份、副本、环境。

    结果带 60 秒短缓存（口径 = 统计根 + 当前库文件）；各项标注作用域，总计恒等于
    分项之和，扫描中的权限失败/预算触顶进 ``warnings``。
    """
    root = _data_root()
    db_path = _active_database_path(bind)
    cache_key = (str(root), str(db_path))
    current = time.time() if now is None else now
    cached = _CACHE.get(cache_key)
    if cached is not None and current - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    warnings: list[str] = []
    counts = _scan_tree(root, DATASETS_DIRNAME, db_path, warnings)

    items: list[dict[str, Any]] = []
    if db_path is not None:
        items.append(_database_entry(db_path))
    for spec in _ITEM_SPECS:
        if spec.key == "database":
            continue
        size, count = counts.get(spec.key, (0, 0))
        items.append(
            {
                "key": spec.key,
                "label": spec.label,
                "scope": spec.scope,
                "size_bytes": size,
                "file_count": count,
            }
        )
    size, count = counts.get(_UNCLASSIFIED_SPEC.key, (0, 0))
    items.append(
        {
            "key": _UNCLASSIFIED_SPEC.key,
            "label": _UNCLASSIFIED_SPEC.label,
            "scope": _UNCLASSIFIED_SPEC.scope,
            "size_bytes": size,
            "file_count": count,
        }
    )
    payload: dict[str, Any] = {
        "data_dir": str(root),
        "items": items,
        "total_bytes": sum(item["size_bytes"] for item in items),
        "total_file_count": sum(item["file_count"] for item in items),
        "warnings": warnings,
    }
    _CACHE[cache_key] = (current, payload)
    return payload


__all__ = [
    "AUTO_BACKUP_DIRNAME",
    "BACKUPS_DIRNAME",
    "BACKUP_TRASH_DIRNAME",
    "SCOPE_APPLICATION",
    "SCOPE_BACKUP",
    "SCOPE_DATASET",
    "SCOPE_SHARED",
    "SCOPE_UNCLASSIFIED",
    "USER_FILES_DIRNAME",
    "reset_storage_cache",
    "storage_overview",
]
