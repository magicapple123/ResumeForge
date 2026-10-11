"""自动备份：按间隔滚动保留最近 N 份数据库快照，失败按短档退避重试。

用户数据只有 SQLite 一处（见包 docstring），而"记得手动备份"是最不可靠的一环：
后台调度（``scheduler.py``）周期性调用 ``run_auto_backup_if_due``，到期就用与手动
导出一致的 ``backup_sqlite_database`` 快照一份，并按份数轮转删除最旧的。

设计要点（RF-05：从"尝试过"升级为"确认被保护"）：

- **绝不抛异常**：自动备份是保险，失败只记日志、按短档退避重试（1h/6h/24h），
  不再让一次失败把有效保护推迟一个完整成功间隔（旧语义，测试已钉住新行为）；
- **成功才算成功**：新快照要能打开、``quick_check`` 通过、alembic revision 与
  源库一致，才计为成功并触发轮转——损坏快照不会淘汰有效旧快照；
- **标记与轮转按数据集隔离**：快照与标记放在 ``auto-backups/<库文件名>/`` 子目录，
  同目录的 A/B 两个数据集各保各的份数、各算各的节奏；历史版本留在旧布局
  （``auto-backups/`` 根）里的快照**只读不删**——迁移期不清空用户既有备份；
- 与手动导出互不影响：不进 ``exports/`` 与 ``restore/``，启动清理不会碰它。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from ...config import Settings, get_settings
from ...database_migrations import backup_sqlite_database
from .paths import database_path

logger = logging.getLogger(__name__)

AUTO_BACKUP_DIRNAME = "auto-backups"
_MARKER_FILENAME = ".last-run.json"

# 失败重试的退避档位（秒）：第 1 次失败 1 小时后重试，连续失败拉长到 6h/24h，
# 不再无限增长——24h 是"失败状态下仍有一天一次"的底线。
FAILURE_BACKOFF_STEPS = (3600, 21600, 86400)


def auto_backup_directory(bind: Engine) -> Path:
    """自动备份快照的根目录：与手动导出、恢复暂存目录互不重叠。"""
    return database_path(bind).parent / AUTO_BACKUP_DIRNAME


def dataset_scope_directory(bind: Engine) -> Path:
    """当前数据集自己的备份子目录：按库文件名隔离（主库 resume_forge / 数据集 id）。"""
    return auto_backup_directory(bind) / database_path(bind).stem


def _marker_path(bind: Engine) -> Path:
    return dataset_scope_directory(bind) / _MARKER_FILENAME


def _read_marker(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_marker(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        # 标记写不进去只意味着下次会再做一次备份，不值得为它打断谁。
        logger.warning("自动备份标记写入失败 path=%s", path, exc_info=True)


def failure_backoff_seconds(consecutive_failures: int) -> int:
    """连续失败 N 次后应等待的秒数（1h → 6h → 24h 封顶）。"""
    index = min(max(consecutive_failures - 1, 0), len(FAILURE_BACKOFF_STEPS) - 1)
    return FAILURE_BACKOFF_STEPS[index]


def _is_due(marker: dict[str, Any], now: float, interval_seconds: int) -> bool:
    """到期判定：成功节奏与失败退避分开算（RF-05 核心语义）。"""
    last_attempt = float(marker.get("last_attempt", 0) or 0)
    last_success = marker.get("last_success")
    failures = int(marker.get("consecutive_failures", 0) or 0)
    if not last_attempt:
        return True
    if failures > 0:
        # 最近一次是失败：按退避档重试，不等完整成功间隔。
        return now - last_attempt >= failure_backoff_seconds(failures)
    if last_success is None:
        return True
    return now - float(last_success) >= interval_seconds


def snapshot_is_valid(path: Path, source: Engine) -> bool:
    """快照有效性：能打开 + quick_check 干净 + alembic revision 与源库一致。"""
    try:
        source_revision = None
        with source.connect() as connection:
            row = connection.exec_driver_sql(
                "SELECT version_num FROM alembic_version LIMIT 1"
            ).fetchone()
            source_revision = row[0] if row else None
    except Exception:  # noqa: BLE001 - 源库读不到 revision 时只做基本校验
        source_revision = None
    try:
        connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
        try:
            quick = connection.execute("PRAGMA quick_check").fetchone()
            if not quick or quick[0] != "ok":
                logger.warning("自动备份快照 quick_check 未通过 path=%s", path)
                return False
            try:
                row = connection.execute(
                    "SELECT version_num FROM alembic_version LIMIT 1"
                ).fetchone()
                snapshot_revision = row[0] if row else None
            except sqlite3.Error:
                # 快照本身没有版本表（如未版本化的早期库）：视为与源库一致（上面
                # 源库也读不到时 source_revision 为 None，比较会被跳过）。
                snapshot_revision = None
        finally:
            connection.close()
    except sqlite3.Error:
        logger.warning("自动备份快照无法打开 path=%s", path, exc_info=True)
        return False
    if source_revision is not None and snapshot_revision != source_revision:
        logger.warning(
            "自动备份快照 revision 不一致 snapshot=%s source=%s path=%s",
            snapshot_revision,
            source_revision,
            path,
        )
        return False
    return True


def _rotate(directory: Path, keep: int) -> None:
    """按修改时间只保留最新 ``keep`` 份快照；失败不抛（下轮还会再轮转）。

    只清理**本数据集子目录**：旧布局（根目录）里的历史快照只读不删。
    """
    try:
        snapshots = sorted(
            (item for item in directory.glob("*.db") if item.is_file()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        logger.warning("自动备份轮转失败：目录不可读 dir=%s", directory, exc_info=True)
        return
    for stale in snapshots[max(0, keep):]:
        try:
            stale.unlink()
            logger.info("自动备份轮转删除最旧快照 path=%s", stale)
        except OSError:
            logger.warning("自动备份轮转删除失败 path=%s", stale, exc_info=True)


def run_auto_backup_if_due(
    bind: Engine,
    *,
    now: float | None = None,
    settings: Settings | None = None,
) -> Path | None:
    """距上次自动备份已到间隔（或失败退避到期）时快照一份并轮转；否则返回 None。

    ``settings`` 仅供测试注入；生产路径一律读全局配置。任何失败都只记日志——
    调用方（后台调度线程）不指望它有返回值，更不该让它把服务拖垮。
    """
    config = settings or get_settings()
    if not config.auto_backup_enabled:
        return None
    current = time.time() if now is None else now
    try:
        directory = dataset_scope_directory(bind)
        directory.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001 - 内存库/不可写目录都只是"备份不了"，不是故障
        logger.warning("自动备份目录不可用，本轮跳过", exc_info=True)
        return None

    marker = _read_marker(_marker_path(bind))
    interval_seconds = max(1, config.auto_backup_interval_days) * 86400
    if not _is_due(marker, current, interval_seconds):
        return None

    snapshot: Path | None = None
    error_text = ""
    try:
        candidate = backup_sqlite_database(bind, output_dir=directory)
        # 验证通过才算成功（RF-05）：损坏快照不计成功、不触发轮转、不淘汰旧快照。
        if candidate is not None and snapshot_is_valid(candidate, bind):
            snapshot = candidate
        elif candidate is not None:
            error_text = "快照校验未通过"
            try:
                candidate.unlink()
            except OSError:
                logger.warning("无效快照删除失败 path=%s", candidate, exc_info=True)
    except Exception:  # noqa: BLE001 - 自动备份绝不打断服务
        logger.warning("自动备份失败", exc_info=True)
        error_text = "备份失败"

    failures = int(marker.get("consecutive_failures", 0) or 0)
    if snapshot is None:
        _write_marker(
            _marker_path(bind),
            {
                "last_attempt": current,
                "last_success": marker.get("last_success"),
                "consecutive_failures": failures + 1,
                "last_error": error_text or "备份失败",
            },
        )
        return None
    _write_marker(
        _marker_path(bind),
        {
            "last_attempt": current,
            "last_success": current,
            "consecutive_failures": 0,
            "last_error": "",
        },
    )
    _rotate(directory, max(1, config.auto_backup_keep))
    logger.info("自动备份完成 path=%s", snapshot)
    return snapshot


__all__ = [
    "AUTO_BACKUP_DIRNAME",
    "auto_backup_directory",
    "dataset_scope_directory",
    "failure_backoff_seconds",
    "run_auto_backup_if_due",
    "snapshot_is_valid",
]
