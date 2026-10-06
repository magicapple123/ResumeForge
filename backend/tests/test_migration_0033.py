"""``0033_web_form_profile_records`` 迁移：支持多条网申资料补充记录。"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0032_web_form_url_history"
HEAD_REVISION = "0033_web_form_profile_records"
TABLE = "web_form_profile_record"


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_upgrade_creates_the_repeated_profile_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'records.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    assert TABLE not in inspect(engine).get_table_names()

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in inspect(engine).get_table_names()
    assert _columns(engine, TABLE) == {
        "id",
        "group_key",
        "sort_order",
        "payload",
        "created_at",
        "updated_at",
    }


def test_upgrade_is_idempotent_and_downgrade_removes_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {TABLE} "
                "(group_key, sort_order, payload, created_at, updated_at) "
                "VALUES ('education', 0, '{\"education_class_rank\":\"3\"}', "
                "'2026-09-29 00:00:00', '2026-09-29 00:00:00')"
            )
        )

    command.downgrade(config, PREVIOUS_REVISION)

    assert TABLE not in inspect(engine).get_table_names()


def test_upgrade_skips_a_preexisting_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TABLE {TABLE} ("
                "id INTEGER PRIMARY KEY, group_key VARCHAR(32) NOT NULL, "
                "sort_order INTEGER NOT NULL DEFAULT 0, payload JSON NOT NULL, "
                "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in inspect(engine).get_table_names()
