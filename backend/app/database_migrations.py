# SPDX-License-Identifier: Apache-2.0
"""Database migration orchestration and safe SQLite backups."""

from __future__ import annotations

import logging
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect, text

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"


def application_tables() -> tuple[str, ...]:
    """当前代码认识的全部业务表。

    从 ``Base.metadata`` 推导而不是手写清单：手写清单只要漏掉一张新表，
    **自己导出的备份就会因为"缺少数据表"被拒收**，而这类故障只有用户真去恢复
    数据时才会暴露。改成由模型注册表生成后，加表这件事自动生效。
    """
    from . import models  # noqa: F401 - 导入以注册全部模型
    from .database import Base

    return tuple(sorted(Base.metadata.tables))


_APPLICATION_TABLES = application_tables()
# 版本标记表不是用户数据：全新空库迁移完成后 app_schema_epoch 恰好有一行（epoch=2），
# 若把它算进来，每次首次迁移都会白做一份"迁移前快照"（之后没有任何东西引用它）。
# 排除只影响"要不要备份"，不影响备份包/表覆盖清单（那份仍由 _APPLICATION_TABLES 推导）。
_USER_DATA_TABLES = tuple(name for name in _APPLICATION_TABLES if name != "app_schema_epoch")


def build_alembic_config(bind: Engine) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logger"] = False
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    # SQLAlchemy 2.1 起 render_as_string 会把路径百分号编码（空格 -> %20、% -> %25），
    # 而 alembic 的 configparser 读回时会做 % 插值——不把 % 转义成 %% 就会直接抛
    # InterpolationSyntaxError。转义后 get_main_option 拿回的是还原过的原串，两条
    # 消费路径（attributes["connection"] 与 engine_from_config）都安全。
    url_string = str(bind.url.render_as_string(hide_password=False))
    config.set_main_option("sqlalchemy.url", url_string.replace("%", "%%"))
    return config


def _database_has_user_data(bind: Engine) -> bool:
    tables = set(inspect(bind).get_table_names())
    with bind.connect() as connection:
        for table_name in _USER_DATA_TABLES:
            if table_name not in tables:
                continue
            quoted = bind.dialect.identifier_preparer.quote(table_name)
            if connection.execute(text(f"SELECT 1 FROM {quoted} LIMIT 1")).first() is not None:
                return True
    return False


def _database_has_application_tables(bind: Engine) -> bool:
    """库是否已经包含当前模型认识的业务表（用于拒绝未版本化的库）。"""
    return bool(set(inspect(bind).get_table_names()).intersection(_APPLICATION_TABLES))


def snapshot_sqlite_file(source: Path, destination: Path) -> None:
    """把一个 SQLite 文件按 ``sqlite3.backup`` 复制成一致快照。

    导出活动数据集、导出其余数据集、迁移前备份都走这一份实现：三处各写一遍的下场是
    某一处忘了关闭连接，备份文件在 Windows 上一直被占着，调用方既删不掉也替换不了。
    """
    # sqlite3 连接的上下文管理器只提交事务、不关闭连接；这里必须显式关闭。
    with (
        closing(sqlite3.connect(source)) as source_db,
        closing(sqlite3.connect(destination)) as target_db,
    ):
        source_db.backup(target_db)
        target_db.commit()


def _strip_optimizer_stat_tables(path: Path) -> None:
    """从快照里删掉 SQLite 优化器统计表（``sqlite_stat1`` 等）。

    ``PRAGMA optimize``/ANALYZE 会在库里维护 ``sqlite_stat*`` 统计表：它们是引擎
    内部状态而不是用户数据，但留在快照里会被**旧版本**的导入白名单当成"不认识的
    表"拒收，备份因此失去跨版本兼容。统计信息在恢复后的库里由 optimize 重建，
    备份里不需要带着。DROP 在 SQLite 里对 stat 表是合法操作。
    """
    with closing(sqlite3.connect(path)) as connection:
        names = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        stat_tables = sorted(name for name in names if name.startswith("sqlite_stat"))
        for name in stat_tables:
            connection.execute(f'DROP TABLE "{name}"')
        if stat_tables:
            connection.commit()


def backup_sqlite_database(bind: Engine, output_dir: Path | None = None) -> Path | None:
    """Create a consistent SQLite backup and return its path.

    Non-SQLite databases are expected to use their platform backup tooling.
    """
    if bind.dialect.name != "sqlite" or not bind.url.database:
        return None
    source = Path(bind.url.database).resolve()
    if not source.exists():
        return None
    destination_dir = output_dir or source.parent / "backups"
    destination_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    destination = destination_dir / f"{source.stem}-{timestamp}{source.suffix or '.db'}"
    snapshot_sqlite_file(source, destination)
    _strip_optimizer_stat_tables(destination)
    logger.info("SQLite 备份已创建 path=%s", destination)
    return destination

def run_database_migrations(bind: Engine, *, backup: bool = True) -> Path | None:
    """把当前库升级到 Alembic head；迁移前如有用户数据先做一次 SQLite 快照。

    职责只有两件：迁移前快照 + ``upgrade head``。它不判定库的版本、不归档 pre-2.0
    库、不建空库、不兼容建表——那些都属于启动闸门（``schema_epoch.decide()`` 与
    ``startup_gate.enforce()``）。启动顺序（不能调换）：判定 →（必要时）归档并建空库
    → 本函数 → SQLite 例行维护。

    ``backup=False`` is for migrating a throwaway copy of somebody else's data:
    the archive validation path in ``services/data_backup`` extracts a candidate
    and migrates it only to see whether the archive is importable. Backing that
    up would drop a full copy of the user's database into a staging directory
    that nothing ever prunes.
    """
    config = build_alembic_config(bind)
    scripts = ScriptDirectory.from_config(config)
    head_revision = scripts.get_current_head()
    with bind.connect() as connection:
        current_revision = MigrationContext.configure(connection).get_current_revision()
    if current_revision == head_revision:
        return None
    if current_revision is None and _database_has_application_tables(bind):
        # 走到这里说明启动闸门的顺序错了：pre-2.0 库本应在 schema_epoch.decide() 里
        # 判成 ARCHIVE_AND_RESET、由 startup_gate 整包归档后建空库，再进迁移。2.0 不再
        # 兼容建表、也不再给旧库 stamp 基线——大声失败比把一份读不懂的库硬升成半新半旧
        # 安全（原始库此时一个字节都没被改）。
        raise RuntimeError(
            "数据库已有业务表但没有版本号：启动闸门未先归档旧库，已拒绝迁移。"
            "这属于启动顺序错误，请报告维护者；原始库未被修改。"
        )
    backup_path = (
        backup_sqlite_database(bind) if backup and _database_has_user_data(bind) else None
    )
    # Reuse the application's connection so sqlite:///:memory: is migrated in
    # place instead of creating and discarding a second in-memory database.
    with bind.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    logger.info("数据库迁移完成 revision=%s", head_revision)
    return backup_path
