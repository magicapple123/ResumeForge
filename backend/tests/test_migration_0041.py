"""0041：application_track 加渠道列 + 新增状态变化事件表 application_track_event（RF-18）。"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0040_resume_delivery_records"
HEAD_REVISION = "0041_track_channel_and_events"
TABLE = "application_track_event"


def _table_names(engine):
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> set[str]:
    return {item["name"] for item in inspect(engine).get_columns(table)}


def test_upgrade_adds_channel_column_and_event_table(tmp_path):
    """升级前后**表集合差 = 新表**——旧备份仍可导入的前提；渠道列默认未知。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'events.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    tables_before = _table_names(engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO application_track (company, title, status, created_at, updated_at) "
                "VALUES ('示例科技', '后端开发', 'applied', '2026-10-11', '2026-10-11')"
            )
        )

    command.upgrade(config, HEAD_REVISION)
    assert _table_names(engine) == tables_before | {TABLE}
    assert "channel" in _columns(engine, "application_track")

    # 旧行读取兜底：渠道为「未知」（历史渠道未知，不推断），事件表为空（不回填历史）。
    with engine.connect() as connection:
        channel = connection.execute(
            text("SELECT channel FROM application_track")
        ).scalar_one()
        count = connection.execute(text(f"SELECT COUNT(*) FROM {TABLE}")).scalar_one()
    assert channel == "unknown"
    assert count == 0

    # 事件表外键是 CASCADE：进度记录被彻底删除时事件跟着删。
    inspector = inspect(engine)
    fks = {
        item["constrained_columns"][0]: (item["referred_table"], item["options"].get("ondelete"))
        for item in inspector.get_foreign_keys(TABLE)
    }
    assert fks["track_id"] == ("application_track", "CASCADE")


def test_downgrade_removes_the_table_and_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'events-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    assert TABLE not in _table_names(engine)
    assert "channel" not in _columns(engine, "application_track")


def test_upgrade_survives_missing_legacy_tables(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：加列跳过、加表照常。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS application_track"))

    config2 = build_alembic_config(engine)
    command.upgrade(config2, HEAD_REVISION)  # 不该抛
    # 事件表照常建（它不依赖 application_track 在这条链上存在）。
    assert TABLE in _table_names(engine)
