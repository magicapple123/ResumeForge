# SPDX-License-Identifier: Apache-2.0
"""2.0 数据库版本闸门：只读判定一个 SQLite 库属于哪一态。

判定依据只有两样东西：单行表 app_schema_epoch 与 alembic_version 是否落在
当前迁移链上。绝不能用 revision 字符串比较或“等不等于 head”判新旧——alembic
revision 是无序字符串（0001_baseline_v2 与 0075_... 之间没有可比大小），
只有“在不在链上”是有意义的判据；拿字符串比大小会在 2.0 基线之后的下一个版本
第一次改 revision 编号时判错方向。

纯只读：所有连接都以 mode=ro 打开；库文件不存在时返回 None 且不创建文件。
判定（本模块）与执行（startup_gate）分成两个模块，是因为前者必须能在“零写入”
的前提下跑在任何库上（包括磁盘只读、库太新、revision 不可识别等场景），后者才
允许归档、移动与建库。

五个判定分支（顺序写死在 decide() 里，改顺序前先读它的注释）：

- FRESH：库文件不存在或空库（没有任何业务表），直接走正常迁移；
- UPGRADE：app_schema_epoch.epoch == 2 且 revision 在当前链上；
- ARCHIVE_AND_RESET：没有 app_schema_epoch 表但库里有业务表 = pre-2.0 库，
  整包归档后建空库，永不原地迁移；
- REFUSE_TOO_NEW：epoch > 2 = 库由更新版本的 ResumeForge 创建，拒绝启动、零写入；
- REFUSE_UNKNOWN：epoch == 2 但 revision 不在链上（或版本标记缺失/不可读），
  拒绝启动、零写入。
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from enum import Enum
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from ..config import BACKEND_DIR, DATA_DIR
from ..dataset_registry import DatasetError, configured_database_file

# 2.0 基线的 epoch 值。只有由基线迁移创建的表里的这一行才是“这个库确实是 2.0 形态”的
# 凭据：模型注册表里声明 AppSchemaEpoch 只保证代码认识这张表，不保证库里真跑过基线。
SCHEMA_EPOCH = 2
EPOCH_TABLE = "app_schema_epoch"
ALEMBIC_TABLE = "alembic_version"

# 启动失败的提示里必须给出日志位置：用户拿到“拒绝启动”时唯一能自救的线索。
LOG_FILE = DATA_DIR / "logs" / "backend.log"


class EpochDecision(Enum):
    """decide() 的五种返回值；字符串值只用于日志，不参与判定。"""

    FRESH = "fresh"
    UPGRADE = "upgrade"
    ARCHIVE_AND_RESET = "archive_and_reset"
    REFUSE_TOO_NEW = "refuse_too_new"
    REFUSE_UNKNOWN = "refuse_unknown"


class StartupGateError(RuntimeError):
    """闸门拒绝放行。消息面向用户，必须含原因、库路径与日志路径。"""


def current_database_file() -> Path | None:
    """当前配置的主数据库文件；内存库/非 SQLite 返回 None。

    刻意用 configured_database_file()（DATABASE_URL 指向的那份）而不是
    database.engine.url.database：数据集切换会把引擎绑到 datasets/<id>.db，
    但“这个资料库是不是 pre-2.0”问的是整个数据目录的主库；归档动作也按数据目录
    整体执行。测试里的内存库返回 None，调用方跳过闸门。
    """
    try:
        return configured_database_file()
    except DatasetError:
        return None


def _connect_readonly(database: Path) -> sqlite3.Connection:
    """只读连接。调用方必须先确认文件存在：mode=ro 对不存在的路径会直接报错，
    但这个报错不能与“库损坏”混为一谈，所以文件存在性判断留在外面。"""
    return sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)


def _read_snapshot(database: Path) -> tuple[bool, int | None, str | None, frozenset[str]]:
    """一次只读连接读出判定需要的全部事实。

    返回 (epoch_table_present, epoch, revision, table_names)：

    - epoch_table_present 与 epoch 必须分开：表在但没行是未知状态（正常基线迁移在
      同一事务里建表并播种，不存在这种中间态），不能当成 pre-2.0 去归档；
    - 读写失败（权限、损坏、非 SQLite 文件）抛 sqlite3.Error，由 decide() 转成
      REFUSE_UNKNOWN——不能退回 FRESH，否则会去迁移一份读不懂的库。
    """
    with closing(_connect_readonly(database)) as connection:
        connection.execute("PRAGMA query_only = ON")
        table_names = frozenset(
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        )
        epoch: int | None = None
        if EPOCH_TABLE in table_names:
            row = connection.execute(f'SELECT epoch FROM "{EPOCH_TABLE}" LIMIT 1').fetchone()
            if row is not None and row[0] is not None:
                epoch = int(row[0])
        revision: str | None = None
        if ALEMBIC_TABLE in table_names:
            row = connection.execute(
                f'SELECT version_num FROM "{ALEMBIC_TABLE}" LIMIT 1'
            ).fetchone()
            if row is not None and row[0] is not None:
                revision = str(row[0])
        return EPOCH_TABLE in table_names, epoch, revision, table_names


def read_epoch(database: Path) -> int | None:
    """读 app_schema_epoch.epoch；表/文件不存在或不可读返回 None（绝不建文件）。"""
    database = Path(database)
    if not database.is_file():
        return None
    try:
        present, epoch, _revision, _tables = _read_snapshot(database)
    except sqlite3.Error:
        return None
    return epoch if present else None


def read_revision(database: Path) -> str | None:
    """读 alembic_version.version_num；表/文件不存在或不可读返回 None。"""
    database = Path(database)
    if not database.is_file():
        return None
    try:
        _present, _epoch, revision, _tables = _read_snapshot(database)
    except sqlite3.Error:
        return None
    return revision


def known_revisions() -> frozenset[str]:
    """当前迁移链上的全部 revision（单基线 2.0 只有一个）。

    从 Alembic 实际读取，不写死字符串：基线改名或将来加迁移时判定自动跟随。
    """
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    return frozenset(script.revision for script in scripts.walk_revisions())


def _business_table_names() -> frozenset[str]:
    """当前代码认识的业务表（从模型注册表推导，不手写清单）。"""
    from ..database_migrations import application_tables

    return frozenset(application_tables())


def _has_business_tables(table_names: frozenset[str]) -> bool:
    return bool(table_names.intersection(_business_table_names()))


def decide(database: Path) -> EpochDecision:
    """判定一个库文件该怎么处理。纯只读、零写入、不创建文件。

    判定顺序（与 plan §T03 的①–⑤逐条对应，改顺序前先想清楚后果）：

    ① 先读 alembic_version 与 app_schema_epoch（一次只读快照）；
    ② 没有 app_schema_epoch 表：有业务表 -> ARCHIVE_AND_RESET；没有业务表且
       没有 alembic_version -> FRESH；没有业务表却有 alembic_version -> 无法
       识别（半降级/残缺库，迁移会失败，零写入比冒险强）；
    ③ epoch > 2 -> REFUSE_TOO_NEW（库来自更新版本，零写入）；
    ④ epoch == 2 且 revision 在链上 -> UPGRADE；
    ⑤ epoch == 2 但 revision 不在链上（含 revision 缺失）-> REFUSE_UNKNOWN。
       epoch < 2 的表不属于任何已发布 2.0 形态，按非 2.0 库归档（路线一）。
    """
    database = Path(database)
    if not database.is_file():
        return EpochDecision.FRESH
    try:
        epoch_present, epoch, revision, table_names = _read_snapshot(database)
    except sqlite3.Error:
        # 读不出来的库不能猜成 FRESH：猜错会往一份损坏/不可读的库上跑迁移。
        return EpochDecision.REFUSE_UNKNOWN

    if not epoch_present:
        if _has_business_tables(table_names):
            return EpochDecision.ARCHIVE_AND_RESET
        if revision is not None:
            return EpochDecision.REFUSE_UNKNOWN
        return EpochDecision.FRESH

    if epoch is None:
        # 表在但没行：基线迁移在同一事务里建表并 INSERT，正常不会出现；当未知处理，
        # 不归档（可能是 2.0 库被外部工具改坏）也不迁移（写下去只会更糟）。
        return EpochDecision.REFUSE_UNKNOWN
    if epoch > SCHEMA_EPOCH:
        return EpochDecision.REFUSE_TOO_NEW
    if epoch < SCHEMA_EPOCH:
        return EpochDecision.ARCHIVE_AND_RESET

    if revision is None or revision not in known_revisions():
        return EpochDecision.REFUSE_UNKNOWN
    return EpochDecision.UPGRADE


_REFUSAL_REASONS = {
    EpochDecision.REFUSE_TOO_NEW: (
        "当前资料库由更新版本的 ResumeForge 创建，旧版本不能读写它，已拒绝启动。"
        "请安装最新版本的 ResumeForge 后再打开。"
    ),
    EpochDecision.REFUSE_UNKNOWN: (
        "无法识别当前资料库的版本标记（版本号缺失或不在当前迁移链上），"
        "为避免损坏数据已拒绝启动。若刚升级过应用，请确认数据目录没有被其它程序改动；"
        "需要回退时请从备份恢复。"
    ),
}


def dataset_switch_refusal(database: Path) -> str | None:
    """数据集切换前的只读预检：返回中文拒绝原因；允许切换时返回 None。

    数据集列表里可能出现 1.x 时代的 datasets/<id>.db。切过去等于原地升级，正是
    "非 2.0 库一律归档 + 建空库"路线禁止的事，所以复用 decide() 的同一套判定，
    在预检阶段就拒绝，数据一个字节都不动。
    """
    decision = decide(database)
    if decision is EpochDecision.ARCHIVE_AND_RESET:
        return (
            "这个数据集来自 ResumeForge 1.x，2.0 不支持原地升级；"
            "请用 ResumeForge 1.0.2 打开它，或在 2.0 中重新导入备份包。"
        )
    if decision in (EpochDecision.REFUSE_TOO_NEW, EpochDecision.REFUSE_UNKNOWN):
        return f"目标数据集无法识别（{refusal_error(decision, database)}）"
    return None


def require_dataset_switchable(database: Path) -> None:
    """数据集切换前置校验：不允许切换时抛 DatasetError（数据集 API 的错误类型）。"""
    reason = dataset_switch_refusal(database)
    if reason is not None:
        raise DatasetError(reason, status_code=409)


def refusal_error(decision: EpochDecision, database: Path) -> StartupGateError:
    """把拒绝分支转成可直接展示给用户的错误（原因 + 库路径 + 日志路径）。"""
    reason = _REFUSAL_REASONS.get(decision)
    if reason is None:
        raise ValueError(f"{decision} 不是拒绝放行的判定")
    return StartupGateError(f"{reason}\n资料库：{database}\n日志：{LOG_FILE}")


__all__ = [
    "ALEMBIC_TABLE",
    "EPOCH_TABLE",
    "EpochDecision",
    "LOG_FILE",
    "SCHEMA_EPOCH",
    "StartupGateError",
    "current_database_file",
    "dataset_switch_refusal",
    "decide",
    "known_revisions",
    "read_epoch",
    "read_revision",
    "refusal_error",
    "require_dataset_switchable",
]
