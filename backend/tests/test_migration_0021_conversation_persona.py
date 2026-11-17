# SPDX-License-Identifier: Apache-2.0
"""迁移 0021（视角解耦到 `chat_conversation.persona_id`，T26）的往返与数据搬迁。

在**真实 alembic 迁移出来的库**上验，而不是 `create_all`：后者只能证明"模型长这样"，
证明不了"历史行被搬对了、关联行被删掉了、降级还能把视角写回去"。

钉三件事：

1. 列存在、`NOT NULL`、默认空串（存量会话升级后一律"通用视角"，行为不变）；
2. 数据搬迁：`视角 · X` 的对话技能行 → 会话列；关联行被删；`assistant_skill` 行保留；
3. 降级：列被删、视角写回关联行（不丢视角）；再升回来列与数据仍一致。

**不写 revision 字面量**：head 从 `tests.migration_refs.head_revision()` 取，
"退到本迁移之前"用 `prior_revision(CONVERSATION_PERSONA_REVISION)` 按名字找父版本。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from tests.migration_refs import (
    CONVERSATION_PERSONA_REVISION,
    prior_revision,
)

_TABLE = "chat_conversation"
_COLUMN = "persona_id"
_LINK = "assistant_conversation_skill"
_SKILL = "assistant_skill"


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'persona.db').as_posix()}"


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _seed_legacy_persona(engine) -> tuple[int, int]:
    """在 0021 之前的结构里造一条"视角挂在对话技能行上"的老会话。

    返回 (conversation_id, skill_id)。插入的是裸行：这里是**迁移测试**，
    走 ORM 会带上模型里的新列，验的就不是"老库长什么样"了。
    """
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {_TABLE} (title, surface, pinned, favorite, archived, group_name, "  # noqa: S608
                "memory_off, created_at, updated_at) VALUES ('老会话', 'page', 0, 0, 0, '', 0, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        conversation_id = int(
            connection.execute(text(f"SELECT max(id) FROM {_TABLE}")).scalar_one()  # noqa: S608
        )
        connection.execute(
            text(
                f"INSERT INTO {_SKILL} (name, description, prompt, enabled, source_name, "  # noqa: S608
                "when_to_use, steps, pitfalls, version, generated, validation_status, created_at, "
                "updated_at) VALUES ('视角 · HR 六秒扫描', '内置视角', '旧提示词', 1, '', '', '', "
                "'', 1, 0, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        skill_id = int(
            connection.execute(text(f"SELECT max(id) FROM {_SKILL}")).scalar_one()  # noqa: S608
        )
        connection.execute(
            text(
                f"INSERT INTO {_LINK} (conversation_id, skill_id, created_at) "  # noqa: S608
                "VALUES (:cid, :sid, CURRENT_TIMESTAMP)"
            ),
            {"cid": conversation_id, "sid": skill_id},
        )
    return conversation_id, skill_id


def test_upgrade_moves_legacy_persona_into_the_column(database_url):
    engine = build_engine(database_url)
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(CONVERSATION_PERSONA_REVISION))
        # 0021 之前：没有列，视角只能挂在关联行上。
        assert _COLUMN not in _columns(engine, _TABLE)
        conversation_id, skill_id = _seed_legacy_persona(engine)

        command.upgrade(build_alembic_config(engine), "head")

        column = _columns(engine, _TABLE)[_COLUMN]
        assert column["nullable"] is False
        with engine.connect() as connection:
            stored = connection.execute(
                text(f"SELECT {_COLUMN} FROM {_TABLE} WHERE id = :cid"),  # noqa: S608
                {"cid": conversation_id},
            ).scalar_one()
            assert stored == "hr_scan"
            # 关联行被删（否则回退读取会把用户切回的"通用"复活）。
            left = connection.execute(
                text(f"SELECT count(*) FROM {_LINK} WHERE conversation_id = :cid"),  # noqa: S608
                {"cid": conversation_id},
            ).scalar_one()
            assert int(left) == 0
            # 技能行保留：删了不可逆，界面靠前缀过滤而不是删行。
            kept = connection.execute(
                text(f"SELECT count(*) FROM {_SKILL} WHERE id = :sid"),  # noqa: S608
                {"sid": skill_id},
            ).scalar_one()
            assert int(kept) == 1
    finally:
        engine.dispose()


def test_downgrade_drops_column_and_restores_the_persona_link(database_url):
    engine = build_engine(database_url)
    try:
        command.upgrade(build_alembic_config(engine), "head")
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"INSERT INTO {_TABLE} (title, surface, pinned, favorite, archived, group_name, "  # noqa: S608
                    "memory_off, persona_id, created_at, updated_at) VALUES ('有视角', 'page', 0, 0, 0, "
                    "'', 0, 'interviewer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            conversation_id = int(
                connection.execute(text(f"SELECT max(id) FROM {_TABLE}")).scalar_one()  # noqa: S608
            )

        command.downgrade(
            build_alembic_config(engine), prior_revision(CONVERSATION_PERSONA_REVISION)
        )

        assert _COLUMN not in _columns(engine, _TABLE)
        with engine.connect() as connection:
            restored = connection.execute(
                text(
                    f"SELECT count(*) FROM {_LINK} AS csk JOIN {_SKILL} AS s "  # noqa: S608
                    "ON s.id = csk.skill_id WHERE csk.conversation_id = :cid "
                    "AND s.name = '视角 · 面试官追问'"
                ),
                {"cid": conversation_id},
            ).scalar_one()
            assert int(restored) == 1, "降级必须把视角写回关联行（否则视角静默丢失）"

        # 再升回来：列回来、视角仍在（数据搬迁把关联行又搬回列）。
        command.upgrade(build_alembic_config(engine), "head")
        with engine.connect() as connection:
            stored = connection.execute(
                text(f"SELECT {_COLUMN} FROM {_TABLE} WHERE id = :cid"),  # noqa: S608
                {"cid": conversation_id},
            ).scalar_one()
            assert stored == "interviewer"
    finally:
        engine.dispose()


def test_head_is_at_least_this_migration():
    """链尾至少到 0021（防"迁移没被 alembic 认到"这种静默失效）。"""
    assert prior_revision(CONVERSATION_PERSONA_REVISION)
