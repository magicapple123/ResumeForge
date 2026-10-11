"""0039：简历记录加「事实来源标注」一列。"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0038_user_files"
HEAD_REVISION = "0040_resume_delivery_records"
TABLE = "resume_record"


def _table_names(engine):
    return set(inspect(engine).get_table_names())


def test_upgrade_adds_fact_annotations_column_without_touching_other_tables(tmp_path):
    """只加列：升级前后**表集合不变**——这是"旧备份仍可导入"成立的前提。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'annotations.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    tables_before = _table_names(engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record (title, job_title, company, content, warnings, "
                "source, tone, model, enhancement_enabled, enhancement_level, page_limit, "
                "font_scale, parse_error, created_at) VALUES ('旧简历', '', '', '{}', '[]', "
                "'ai', 'standard', '', 0, 'balanced', 1, 'standard', '', '2026-10-11')"
            )
        )

    command.upgrade(config, HEAD_REVISION)
    # head（0040）会补出 resume_delivery_record 快照表；除此之外表集合必须不变。
    assert _table_names(engine) == tables_before | {"resume_delivery_record"}
    columns = {item["name"] for item in inspect(engine).get_columns(TABLE)}
    assert "fact_annotations" in columns
    # 旧行：fact_annotations 为 NULL，读取时按"没有标注"处理（``or []`` 兜底）。
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT fact_annotations FROM resume_record")
        ).one()
    assert row[0] is None


def test_upgrade_survives_a_missing_table(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：表不存在时跳过而不是报错。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    config2 = build_alembic_config(engine)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS resume_record"))

    command.upgrade(config2, HEAD_REVISION)  # 不该抛
    assert TABLE not in _table_names(engine)


def test_downgrade_removes_fact_annotations_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'annotations-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    columns = {item["name"] for item in inspect(engine).get_columns(TABLE)}
    assert "fact_annotations" not in columns
