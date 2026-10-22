# SPDX-License-Identifier: Apache-2.0
"""0049：``resume_record.language`` —— 纸面固定文案的语言。

覆盖硬规则：**只加列**（表集合前后不变，"旧备份仍可导入"的前提）、旧行落到
``zh-CN``（升级前后输出逐字一致）、``NOT NULL`` + ``DEFAULT``、不加索引、
完整 downgrade、以及残缺库（没有 ``resume_record`` 表）跳过而不报错。

**本文件刻意不写死 revision 字面量**：一旦有新迁移排在 0049 之后，"head 的字面量"
就变成了"中间某个版本"，而这个用例关心的是"0049 这一步做了什么"，不是"head 是谁"
（head 由 ``test_database.py`` / ``test_apply_migration_qa.py`` 等处钉住）。
按前缀在迁移脚本目录里找 0049，既不会随新迁移失效，也不会在别处留下第二份
head 字面量。
"""

from __future__ import annotations

from alembic import command
from alembic.script import ScriptDirectory
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

_REVISION_PREFIX = "0049"
# 0044 / 0046 两代 FTS 派生索引（虚拟表及影子表）：不算业务 schema，表集合口径要排除。
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _revisions(config) -> tuple[str, str]:
    """取（父 revision, 本迁移 revision）。"""
    script = ScriptDirectory.from_config(config)
    for entry in script.walk_revisions():
        if entry.revision.startswith(_REVISION_PREFIX):
            previous = entry.down_revision
            assert isinstance(previous, str), "0049 的父 revision 应当是单个标识"
            return previous, entry.revision
    raise AssertionError(f"迁移脚本目录里找不到 {_REVISION_PREFIX} 开头的 revision")


def _upgrade_to_previous(config) -> str:
    """升到 0049 的父 revision（"升级前"的现场），返回 0049 的 revision。"""
    previous, head = _revisions(config)
    command.upgrade(config, previous)
    return head


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_a_non_null_column_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'language.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)
    before = _business_tables(engine)
    assert "language" not in _columns(engine, "resume_record")

    command.upgrade(config, head)

    # 只加列：表集合不变（旧备份导入依赖这一点）。
    assert _business_tables(engine) == before
    column = _columns(engine, "resume_record")["language"]
    assert column["nullable"] is False
    # 服务端默认值是"旧行自动落 zh-CN"的依据（SQLite 加列会用它填充已有行）。
    assert "zh-CN" in str(column["default"])
    # 语言不是查询条件：不建索引（与 font_scale / template 同一口径）。
    assert "ix_resume_record_language" not in {
        index["name"] for index in inspect(engine).get_indexes("resume_record")
    }


def test_existing_rows_default_to_zh_cn(tmp_path):
    """升级不能让旧简历的字变成英文：旧行一律落到 zh-CN（此前输出逐字不变）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record "
                "(title, job_title, company, content, warnings, source, model, tone, "
                " enhancement_enabled, enhancement_level, parse_error, created_at) "
                "VALUES ('旧简历', '', '', '{}', '[]', 'ai', '', 'standard', 0, 'balanced', '', "
                "'2026-01-02 03:04:05')"
            )
        )

    command.upgrade(config, head)

    with engine.connect() as connection:
        language = connection.execute(
            text("SELECT language FROM resume_record WHERE title = '旧简历'")
        ).scalar_one()
    assert language == "zh-CN"


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    previous, head = _revisions(config)
    command.upgrade(config, head)

    command.downgrade(config, previous)

    assert "language" not in _columns(engine, "resume_record")


def test_missing_table_is_skipped_instead_of_failing(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：缺表就跳过，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    head = _upgrade_to_previous(config)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, head)

    assert "resume_record" not in inspect(engine).get_table_names()
