# SPDX-License-Identifier: Apache-2.0
"""0043：模拟面试「自动轮数」列 ``interview_session.rounds_min``。

NULL = 固定轮数（历史行为，不回填）；非空 = 自动收尾模式的下限。
"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0042_job_origin_source"
HEAD_REVISION = "0043_interview_auto_rounds"
COLUMN = "rounds_min"


def _columns(engine, table: str) -> set[str]:
    return {item["name"] for item in inspect(engine).get_columns(table)}


def _seed_session(connection) -> None:
    connection.execute(
        text(
            "INSERT INTO interview_session (title, interview_type, difficulty, "
            "interviewer_style, rounds, persona, focus, status, report, model, "
            "created_at, updated_at) VALUES ('后端 模拟面试', '技术面', '中级', "
            "'严谨专业', 6, '', '', 'active', '{}', 'm', '2026-10-12', '2026-10-12')"
        )
    )


def test_upgrade_adds_nullable_rounds_min(tmp_path):
    """历史会话的 rounds_min 为 NULL（固定轮数语义），新列不加 NOT NULL 约束。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'auto.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        _seed_session(connection)

    command.upgrade(config, HEAD_REVISION)
    assert COLUMN in _columns(engine, "interview_session")

    with engine.connect() as connection:
        value = connection.execute(
            text(f"SELECT {COLUMN} FROM interview_session LIMIT 1")
        ).scalar_one()
    assert value is None


def test_upgrade_skips_when_table_missing(tmp_path):
    """残缺库（没有 interview_session）跑迁移链不能炸。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)


def test_upgrade_is_idempotent_and_downgrade_drops(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idem.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    # 列已存在再跑一遍不该抛。
    command.upgrade(config, HEAD_REVISION)
    assert COLUMN in _columns(engine, "interview_session")

    command.downgrade(config, PREVIOUS_REVISION)
    assert COLUMN not in _columns(engine, "interview_session")
