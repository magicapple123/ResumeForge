"""0036：助手会话作用域迁移。"""

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0035_llm_thinking"
HEAD_REVISION = "0037_resume_generation_notes"
TABLE = "chat_conversation"


def test_upgrade_adds_surface_with_page_default_and_index(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'surface.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO chat_conversation (title, created_at, updated_at) "
                "VALUES ('旧会话', '2026-10-01', '2026-10-01')"
            )
        )

    command.upgrade(config, HEAD_REVISION)
    columns = {item["name"]: item for item in inspect(engine).get_columns(TABLE)}
    indexes = {item["name"] for item in inspect(engine).get_indexes(TABLE)}
    assert columns["surface"]["default"] == "'page'"
    assert "ix_chat_conversation_surface" in indexes
    with engine.connect() as connection:
        assert connection.execute(text("SELECT surface FROM chat_conversation")).scalar_one() == "page"


def test_downgrade_removes_surface(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'surface-down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    assert "surface" not in {item["name"] for item in inspect(engine).get_columns(TABLE)}

