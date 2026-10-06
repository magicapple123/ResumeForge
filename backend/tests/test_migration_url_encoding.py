"""数据库迁移链在"带百分号/空格的库路径"上的守卫。

SQLAlchemy 2.1 的 ``render_as_string`` 会把路径百分号编码（空格 -> %20、% -> %25），
而 alembic 的 configparser 读回 ``sqlalchemy.url`` 时会做 % 插值——不转义就抛
InterpolationSyntaxError。2026-10 升级 sqlalchemy 2.1 时发现，这份守卫钉住转义。
"""

import sqlite3
from pathlib import Path

from alembic.migration import MigrationContext
from app.database_migrations import run_database_migrations
from sqlalchemy import create_engine


def test_migrations_run_on_database_path_with_percent_and_space(tmp_path: Path):
    database_dir = tmp_path / "a dir 100% 副本"
    database_dir.mkdir()
    database = database_dir / "resume_forge.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        run_database_migrations(engine)
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_revision()
        assert current is not None
        # 库文件真的落在那个带 % 与空格的目录里，且迁移表可读。
        assert database.exists() and database.stat().st_size > 0
        check = sqlite3.connect(database)
        try:
            tables = {
                row[0]
                for row in check.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        finally:
            check.close()
        assert "alembic_version" in tables
    finally:
        engine.dispose()
