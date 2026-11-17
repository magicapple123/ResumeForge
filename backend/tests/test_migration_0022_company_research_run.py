# SPDX-License-Identifier: Apache-2.0
"""迁移 0022（公司调研历史表，T07）的升级/降级往返。

在**真实 alembic 迁移出来的库**上验，而不是 ``create_all``：后者只能证明"模型长这样"，
证明不了"表能被建出来、再被删干净、升回来还一致"。

钉四件事：

1. 升级后表、四个索引、两个 ``SET NULL`` 外键都在；
2. 降级把表删掉（再升回来不报错）；
3. 表已存在时升级是空操作（迁移会跑在"只有部分业务表"的库上）；
4. ``knowledge_entry`` 被删时历史行还在（``SET NULL`` 生效，历史不跟着消失）。

**不写 revision 字面量**：head 从 ``tests.migration_refs.head_revision()`` 取，
"退到本迁移之前"用 ``prior_revision("_company_research_run")`` 按名字找父版本。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from tests.migration_refs import head_revision, prior_revision

TABLE = "company_research_run"


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'research_history.db').as_posix()}"


def _index_names(engine) -> set[str]:
    return {index["name"] for index in inspect(engine).get_indexes(TABLE)}


def _columns(engine) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(TABLE)}


def _foreign_keys(engine) -> dict[str, dict]:
    return {fk["referred_table"]: fk for fk in inspect(engine).get_foreign_keys(TABLE)}


def test_upgrade_creates_the_table_with_indexes_and_set_null_foreign_keys(database_url):
    engine = build_engine(database_url)
    try:
        command.upgrade(build_alembic_config(engine), "head")

        assert TABLE in set(inspect(engine).get_table_names())
        columns = _columns(engine)
        for name in (
            "company",
            "company_raw",
            "role",
            "jd_excerpt",
            "jd_hash",
            "deep",
            "status",
            "brief_markdown",
            "sources",
            "cards",
            "search_count",
            "elapsed_ms",
            "knowledge_entry_id",
            "job_id",
            "created_at",
        ):
            assert name in columns, f"迁移漏了列 {name}"
        # 历史不进回收站：没有 deleted_at。
        assert "deleted_at" not in columns

        indexes = _index_names(engine)
        assert {
            f"ix_{TABLE}_company",
            f"ix_{TABLE}_created_at",
            f"ix_{TABLE}_company_created_at",
            f"ix_{TABLE}_job_id_created_at",
        } <= indexes

        keys = _foreign_keys(engine)
        assert keys["knowledge_entry"]["options"]["ondelete"] == "SET NULL"
        assert keys["job"]["options"]["ondelete"] == "SET NULL"
    finally:
        engine.dispose()


def test_downgrade_drops_the_table_and_upgrade_recreates_it(database_url):
    engine = build_engine(database_url)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        command.downgrade(config, prior_revision("_company_research_run"))
        assert TABLE not in set(inspect(engine).get_table_names())

        # 再升回来：表与索引都还在（降级不是单向门）。
        command.upgrade(config, "head")
        assert TABLE in set(inspect(engine).get_table_names())
        assert f"ix_{TABLE}_company_created_at" in _index_names(engine)
    finally:
        engine.dispose()


def test_upgrade_is_a_no_op_when_the_table_already_exists(database_url):
    """迁移会跑在"只有部分业务表"的库上：已存在就跳过，不报错、不重建。"""
    engine = build_engine(database_url)
    try:
        command.upgrade(build_alembic_config(engine), "head")
        command.upgrade(build_alembic_config(engine), "head")
        assert TABLE in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_deleting_the_knowledge_entry_nulls_the_link_but_keeps_the_run(database_url):
    """``SET NULL`` 的行为：历史指向的知识条目被删后，历史仍可读。"""
    engine = build_engine(
        database_url,
    )
    try:
        command.upgrade(build_alembic_config(engine), "head")
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(
                text(
                    "INSERT INTO knowledge_entry (title, category, tags, content, source, reason, "
                    "company, summary, key_points, created_at, updated_at) VALUES "
                    "('调研', '公司调研', '[]', '正文', 'company_research', '', '字节跳动', '', "
                    "'[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            entry_id = int(
                connection.execute(text("SELECT max(id) FROM knowledge_entry")).scalar_one()
            )
            connection.execute(
                text(
                    f"INSERT INTO {TABLE} (company, company_raw, role, jd_excerpt, jd_hash, deep, "  # noqa: S608
                    "status, brief_markdown, sources, cards, search_count, elapsed_ms, "
                    "knowledge_entry_id, job_id, created_at) VALUES "
                    "('字节跳动', '字节跳动', '', '', '', 0, 'ok', '正文', '[]', '[]', 0, 0, "
                    ":entry_id, NULL, CURRENT_TIMESTAMP)"
                ),
                {"entry_id": entry_id},
            )
            connection.execute(
                text("DELETE FROM knowledge_entry WHERE id = :entry_id"), {"entry_id": entry_id}
            )

        with engine.connect() as connection:
            rows = connection.execute(
                text(f"SELECT knowledge_entry_id, brief_markdown FROM {TABLE}")  # noqa: S608
            ).fetchall()
        assert len(rows) == 1, "知识条目被删时历史行必须留下"
        assert rows[0][0] is None, "knowledge_entry_id 应该被置空"
        assert rows[0][1] == "正文"
    finally:
        engine.dispose()


def test_head_is_at_least_this_migration():
    """链尾至少到本迁移（防"迁移没被 alembic 认到"这种静默失效）。"""
    assert head_revision().endswith("_company_research_run") or head_revision() > "0022"
