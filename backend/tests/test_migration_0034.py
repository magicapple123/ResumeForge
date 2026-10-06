"""``0034_job_match_batches`` 迁移：保存岗位批量适配度分析快照。"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0033_web_form_profile_records"
HEAD_REVISION = "0034_job_match_batches"
TABLE = "job_match_batch"


def test_upgrade_creates_the_batch_snapshot_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'batch.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    assert TABLE not in inspect(engine).get_table_names()

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in inspect(engine).get_table_names()
    assert {column["name"] for column in inspect(engine).get_columns(TABLE)} == {
        "id",
        "requested_count",
        "completed_count",
        "failed_count",
        "items",
        "model",
        "created_at",
        "updated_at",
    }
    assert f"ix_{TABLE}_created_at" in {
        index["name"] for index in inspect(engine).get_indexes(TABLE)
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
                "(requested_count, completed_count, failed_count, items, model, created_at, updated_at) "
                "VALUES (1, 1, 0, '[]', '', '2026-09-29 00:00:00', '2026-09-29 00:00:00')"
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
                "id INTEGER PRIMARY KEY, requested_count INTEGER NOT NULL DEFAULT 0, "
                "completed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, "
                "items JSON NOT NULL, model VARCHAR(64) NOT NULL DEFAULT '', "
                "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in inspect(engine).get_table_names()
