"""0040：新增投递快照表 resume_delivery_record 与两条血缘/快照列。"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0039_resume_fact_annotations"
HEAD_REVISION = "0040_resume_delivery_records"
TABLE = "resume_delivery_record"


def _table_names(engine):
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> set[str]:
    return {item["name"] for item in inspect(engine).get_columns(table)}


def test_upgrade_creates_the_delivery_table_and_two_columns(tmp_path):
    """加表迁移：升级前后**表集合差 = 新表**——旧备份仍可导入的前提。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'delivery.db'}")
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
        connection.execute(
            text(
                "INSERT INTO application_track (company, title, status, created_at, updated_at) "
                "VALUES ('示例科技', '后端开发', 'applied', '2026-10-11', '2026-10-11')"
            )
        )

    command.upgrade(config, HEAD_REVISION)
    assert _table_names(engine) == tables_before | {TABLE}
    assert {
        "resume_id",
        "job_id",
        "track_id",
        "source",
        "resume_title",
        "job_title",
        "company",
        "content",
        "render_context",
        "content_sha256",
        "rendered_config_sha256",
        "export_format",
        "filename",
        "pages",
        "model",
        "created_at",
    } <= _columns(engine, TABLE)
    assert "parent_revision_id" in _columns(engine, "resume_record")
    assert "resume_title" in _columns(engine, "application_track")

    # 旧行读取兜底：血缘为 NULL（独立版本）、简历标题快照为空串（历史关联未知）。
    with engine.connect() as connection:
        parent = connection.execute(
            text("SELECT parent_revision_id FROM resume_record")
        ).scalar_one()
        track_title = connection.execute(
            text("SELECT resume_title FROM application_track")
        ).scalar_one()
    assert parent is None
    assert track_title == ""

    # 新表的三条外键都是 SET NULL：被引用行删除后快照仍可读。
    inspector = inspect(engine)
    fks = {
        item["constrained_columns"][0]: (item["referred_table"], item["options"].get("ondelete"))
        for item in inspector.get_foreign_keys(TABLE)
    }
    assert fks["resume_id"] == ("resume_record", "SET NULL")
    assert fks["job_id"] == ("job", "SET NULL")
    assert fks["track_id"] == ("application_track", "SET NULL")


def test_downgrade_removes_the_table_and_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'delivery-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    assert TABLE not in _table_names(engine)
    assert "parent_revision_id" not in _columns(engine, "resume_record")
    assert "resume_title" not in _columns(engine, "application_track")


def test_upgrade_survives_missing_legacy_tables(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：加列跳过、加表照常。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS application_track"))

    config2 = build_alembic_config(engine)
    command.upgrade(config2, HEAD_REVISION)  # 不该抛
    # 快照表本身照常建（它不依赖任何既有表存在）。
    assert TABLE in _table_names(engine)
    # resume_record 在这条链上存在，血缘列已补。
    assert "parent_revision_id" in _columns(engine, "resume_record")
