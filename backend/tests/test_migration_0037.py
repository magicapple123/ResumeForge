"""0037：简历记录加「生成说明」与「未收录清单」两列。"""

from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.database_migrations import build_alembic_config

PREVIOUS_REVISION = "0036_chat_conversation_surface"
HEAD_REVISION = "0037_resume_generation_notes"
TABLE = "resume_record"


def _table_names(engine):
    return set(inspect(engine).get_table_names())


def test_upgrade_adds_notes_columns_without_touching_other_tables(tmp_path):
    """只加列：升级前后**表集合不变**——这是"旧备份仍可导入"成立的前提。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'notes.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    tables_before = _table_names(engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record (title, job_title, company, content, warnings, "
                "source, tone, model, enhancement_enabled, enhancement_level, page_limit, "
                "font_scale, parse_error, created_at) VALUES ('旧简历', '', '', '{}', '[]', "
                "'ai', 'standard', '', 0, 'balanced', 1, 'standard', '', '2026-10-01')"
            )
        )

    command.upgrade(config, HEAD_REVISION)
    assert _table_names(engine) == tables_before
    columns = {item["name"] for item in inspect(engine).get_columns(TABLE)}
    assert {"coverage_notes", "rationale"} <= columns
    # 旧行：coverage_notes 为 NULL / rationale 为空串，读取时按"没有说明"处理。
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT coverage_notes, rationale FROM resume_record")
        ).one()
    assert row[0] is None
    assert row[1] == ""


def test_downgrade_removes_notes_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'notes-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    columns = {item["name"] for item in inspect(engine).get_columns(TABLE)}
    assert "coverage_notes" not in columns
    assert "rationale" not in columns
