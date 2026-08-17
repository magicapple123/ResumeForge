"""SQLite 兼容升级测试。"""
from sqlalchemy import create_engine, inspect

from app.database import ensure_sqlite_columns


def test_ensure_sqlite_columns_preserves_legacy_rows(tmp_path):
    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy_engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE job (id INTEGER PRIMARY KEY, title VARCHAR(128) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO job (id, title) VALUES (1, '算法工程师')"
            )
            connection.exec_driver_sql(
                "CREATE TABLE user_profile (id INTEGER PRIMARY KEY, name VARCHAR(64) NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO user_profile (id, name) VALUES (1, '张三')"
            )

        required_columns = {
            "job": {
                "note": "TEXT NOT NULL DEFAULT ''",
                "favorite": "BOOLEAN NOT NULL DEFAULT 0",
            },
            "user_profile": {"photo": "TEXT NOT NULL DEFAULT ''"},
        }
        ensure_sqlite_columns(legacy_engine, required_columns)
        ensure_sqlite_columns(legacy_engine, required_columns)

        inspector = inspect(legacy_engine)
        assert "note" in {column["name"] for column in inspector.get_columns("job")}
        assert "photo" in {
            column["name"] for column in inspector.get_columns("user_profile")
        }
        with legacy_engine.connect() as connection:
            job = connection.exec_driver_sql(
                "SELECT title, note, favorite FROM job WHERE id = 1"
            ).mappings().one()
            profile = connection.exec_driver_sql(
                "SELECT name, photo FROM user_profile WHERE id = 1"
            ).mappings().one()
        assert dict(job) == {"title": "算法工程师", "note": "", "favorite": 0}
        assert dict(profile) == {"name": "张三", "photo": ""}
    finally:
        legacy_engine.dispose()
