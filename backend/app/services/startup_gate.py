# SPDX-License-Identifier: Apache-2.0
"""启动闸门的执行层：判定 → 归档 → 校验 → 移走旧库 → 重开空库。

职责切割（写死在这里，改之前先想清楚谁该做什么）：

| 谁 | 负责什么 | 绝不做什么 |
| --- | --- | --- |
| schema_epoch.decide() | 只读判定库形态 | 不建目录、不建库、不备份 |
| startup_gate.enforce()（本模块） | ARCHIVE_AND_RESET 时调 legacy_archive 归档、校验、移走旧文件、database.rebind() 到同一路径重开空库 | 不跑迁移 |
| run_database_migrations() | 迁移前快照 + upgrade head | 不判定、不归档、不建空库 |

调用顺序（lifespan 里固定）：enforce() → run_database_migrations() → 维护。
enforce() 失败直接抛 StartupGateError，后面几步一个都不执行。

为什么不能反过来（先建空库再归档）：resume_forge.db 是数据目录里的唯一主库路径，
先建空库会把它覆盖，之后任何归档动作读到的都是空库；"先归档再建库"的最坏结果是
"归档成功但没建库"——原始数据仍在归档目录里，可逆。所以本模块把顺序写死，不做
"失败重试时跳过归档"之类的优化。
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy.engine import Engine

from .. import database
from . import schema_epoch
from .data_backup.legacy_archive import (
    ARCHIVE_DIRNAME,
    archive_pre_2_0_library,
    archive_zip_path,
    move_library_aside,
    restore_library,
    verify_archive,
)

logger = logging.getLogger(__name__)


def _unique_stamp(data_dir: Path, stamp: str | None) -> str:
    """归档目录名：默认时间戳；同一秒内重跑时追加 -1/-2，绝不覆盖已有归档。"""
    base = stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
    root = data_dir / ARCHIVE_DIRNAME
    candidate = base
    index = 1
    while (root / candidate).exists():
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def _try_restore(archive_root: Path, data_dir: Path) -> bool:
    try:
        restore_library(archive_root, data_dir)
        return True
    except OSError:
        logger.exception("回滚归档移动失败，原库文件仍在归档目录 path=%s", archive_root / "files")
        return False


def enforce(bind: Engine, *, stamp: str | None = None) -> schema_epoch.EpochDecision:
    """执行版本闸门；ARCHIVE_AND_RESET 时完成归档并经校验后才动旧文件。

    返回最终应交给迁移执行器的判定（FRESH 或 UPGRADE）。REFUSE_* 抛
    StartupGateError；归档或校验失败也抛 StartupGateError，且此时**没有移动任何文件**。
    """
    database_file = schema_epoch.current_database_file()
    if database_file is None:
        # 内存库等非文件形态（只出现在测试）：没有可归档/可重开的文件路径。
        return schema_epoch.EpochDecision.FRESH

    decision = schema_epoch.decide(database_file)
    if decision in (schema_epoch.EpochDecision.FRESH, schema_epoch.EpochDecision.UPGRADE):
        return decision
    if decision in (
        schema_epoch.EpochDecision.REFUSE_TOO_NEW,
        schema_epoch.EpochDecision.REFUSE_UNKNOWN,
    ):
        raise schema_epoch.refusal_error(decision, database_file)

    data_dir = database_file.parent
    archive_root = data_dir / ARCHIVE_DIRNAME / _unique_stamp(data_dir, stamp)
    try:
        archive_root = archive_pre_2_0_library(bind, data_dir, archive_root.name)
        zip_path = archive_zip_path(archive_root)
        verify_archive(zip_path)
    except Exception as exc:  # noqa: BLE001 - 全部转成面向用户的启动错误
        raise schema_epoch.StartupGateError(
            "无法为旧版本资料库建立归档，应用未启动；资料库与数据目录均未改动。"
            f"归档路径：{archive_root}；日志：{schema_epoch.LOG_FILE}；原因：{exc}"
        ) from exc

    logger.info("旧版本资料库已归档并通过校验 path=%s", archive_root)
    try:
        bind.dispose()
        move_library_aside(data_dir, archive_root, database_file=database_file)
        database.rebind(database_file)
    except Exception as exc:  # noqa: BLE001 - 移动到一半失败要尽量恢复原状
        restored = _try_restore(archive_root, data_dir)
        raise schema_epoch.StartupGateError(
            "旧版本资料库已归档，但切换到空库失败，应用未启动。"
            f"归档包：{archive_root}；日志：{schema_epoch.LOG_FILE}；原因：{exc}；"
            f"原库文件{'已搬回数据目录' if restored else '仍在归档目录 files/ 下（未自动搬回）'}。"
        ) from exc

    logger.info("已移走旧资料库文件并在同一路径重开空库 path=%s", database_file)
    return schema_epoch.EpochDecision.FRESH


__all__ = ["ARCHIVE_DIRNAME", "enforce"]
