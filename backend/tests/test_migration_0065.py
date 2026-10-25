# SPDX-License-Identifier: Apache-2.0
"""0065：清理使用快照里指向不存在父行的悬空逻辑引用（纯数据清理）。

边界（与迁移 docstring 同一口径）：
- **不改表结构**：表集合 / 列集合 / 行数 / 快照不可变字段全部不变，只把悬空的
  resume_id / task_id 置 NULL（有效引用原样保留）。
- **升级安全**：快照表、父表或**引用列**不存在时逐项跳过而不是报错（迁移链也会跑在只有
  部分业务表的历史库上；0064 对已存在的表不补列，所以可能出现只有 id 列的最小快照表）。
- **downgrade 是 no-op**：只退回版本号，已清理的引用不复原（父行已删除，复原只会重新
  制造悬空行与 UNIQUE 冲突）；downgrade 后可再次 upgrade。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import BASELINE_REVISION, build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0064_profile_groups"
MIGRATION_REVISION = "0065_snapshot_dangling_refs"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")

_RESUME_INSERT = (
    "INSERT INTO resume_record "
    "(title, job_title, company, content, warnings, source, model, tone, "
    " enhancement_enabled, enhancement_level, parse_error, created_at, revision, draft, "
    " document_mode) "
    "VALUES (:title, '', '', '{\"name\": \"张示例\"}', '[]', 'manual', '', "
    "'standard', 0, 'balanced', '', '2026-01-02 03:04:05', 0, 0, 'resume')"
)
_SNAPSHOT_INSERT = (
    "INSERT INTO profile_usage_snapshot "
    "(snapshot_id, task_id, resume_id, group_id, group_name, participating, "
    " section_order, definition_revision, data_revision, layout, created_at) "
    "VALUES (:snapshot_id, :task_id, :resume_id, 'g-legacy', '旧历史组', "
    '\'[{"key": "basic_info", "name": "基本信息"}]\', \'["basic_info"]\', 7, 11, '
    "'{\"group_id\": \"g-legacy\"}', '2026-01-03 04:05:06')"
)


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _at_previous(tmp_path, name: str):
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    return engine, config


def _insert(engine, sql: str, params: dict) -> None:
    with engine.begin() as connection:
        connection.execute(text(sql), params)


def _seed(engine) -> None:
    """一条有效简历 + 一条有效任务 + 五种快照引用形态。"""
    _insert(engine, _RESUME_INSERT, {"title": "保留的简历"})
    _insert(
        engine,
        "INSERT INTO resume_generate_task (created_at) VALUES ('2026-01-02 03:04:05')",
        {},
    )
    payloads = {
        "valid": {"task_id": 1, "resume_id": 1},
        "dangling_resume": {"task_id": None, "resume_id": 641},
        "dangling_task": {"task_id": 999, "resume_id": None},
        "dangling_both": {"task_id": 998, "resume_id": 642},
        "both_null": {"task_id": None, "resume_id": None},
    }
    for snapshot_id, refs in payloads.items():
        _insert(engine, _SNAPSHOT_INSERT, {"snapshot_id": snapshot_id, **refs})


def _snapshot_rows(engine) -> dict[str, tuple]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT snapshot_id, task_id, resume_id, group_id, group_name, "
                "participating, section_order, definition_revision, data_revision, "
                "layout, created_at FROM profile_usage_snapshot ORDER BY id"
            )
        ).all()
    return {row[0]: tuple(row) for row in rows}


def test_upgrade_detaches_only_dangling_refs_and_keeps_immutable_fields(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "dangling.db")
    _seed(engine)
    before_tables = _business_tables(engine)
    before_columns = {table: set(_columns(engine, table)) for table in before_tables}
    before_rows = _snapshot_rows(engine)
    assert len(before_rows) == 5

    command.upgrade(config, MIGRATION_REVISION)

    # 结构一个字节不变（纯数据清理），行数与不可变字段保留
    assert _business_tables(engine) == before_tables
    for table in before_tables:
        assert set(_columns(engine, table)) == before_columns[table], table
    after_rows = _snapshot_rows(engine)
    assert set(after_rows) == set(before_rows)
    frozen_indexes = (3, 4, 5, 6, 7, 8, 9, 10)  # group_id..created_at 不参与引用清理
    for snapshot_id, before in before_rows.items():
        after = after_rows[snapshot_id]
        assert after[0] == before[0]
        for index in frozen_indexes:
            assert after[index] == before[index], (snapshot_id, index)

    # 悬空引用被解除；有效引用原样保留；原本为空的不动
    assert after_rows["valid"][1:3] == (1, 1)
    assert after_rows["dangling_resume"][1:3] == (None, None)
    assert after_rows["dangling_task"][1:3] == (None, None)
    assert after_rows["dangling_both"][1:3] == (None, None)
    assert after_rows["both_null"][1:3] == (None, None)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_upgrade_skips_missing_tables_on_partial_database(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    # 只在版本号上处于 0064（不跑 0064 的建表）：0065 必须跳过而不是报错。
    command.stamp(config, PREVIOUS_REVISION)

    command.upgrade(config, MIGRATION_REVISION)

    assert "profile_usage_snapshot" not in _business_tables(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )
    # 降级同样不因缺表而失败。
    command.downgrade(config, PREVIOUS_REVISION)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PREVIOUS_REVISION
        )


def test_downgrade_is_noop_and_reappliable(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "downgrade.db")
    _seed(engine)

    command.upgrade(config, MIGRATION_REVISION)
    cleaned = _snapshot_rows(engine)
    command.downgrade(config, PREVIOUS_REVISION)

    # 只退版本号：清理后的数据保持原样（父行不存在，引用不应被"复原"）。
    assert _snapshot_rows(engine) == cleaned
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PREVIOUS_REVISION
        )

    command.upgrade(config, MIGRATION_REVISION)
    assert _snapshot_rows(engine) == cleaned  # 再升级幂等


def test_upgrade_is_idempotent_at_head(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "idempotent.db")
    _seed(engine)
    command.upgrade(config, MIGRATION_REVISION)
    first = _snapshot_rows(engine)
    command.upgrade(config, MIGRATION_REVISION)
    assert _snapshot_rows(engine) == first


def test_upgrade_skips_snapshot_table_without_reference_columns(tmp_path) -> None:
    """0064 对已存在的表只跳过、不补列：只有 id 列的最小快照表不能被 UPDATE 弄报错。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'minimal.db'}")
    config = build_alembic_config(engine)
    _insert(engine, "CREATE TABLE profile_usage_snapshot (id INTEGER PRIMARY KEY)", {})
    _insert(engine, "CREATE TABLE resume_record (id INTEGER PRIMARY KEY)", {})
    _insert(engine, "CREATE TABLE resume_generate_task (id INTEGER PRIMARY KEY)", {})
    _insert(engine, "INSERT INTO profile_usage_snapshot (id) VALUES (1)", {})
    command.stamp(config, PREVIOUS_REVISION)

    command.upgrade(config, MIGRATION_REVISION)

    assert set(_columns(engine, "profile_usage_snapshot")) == {"id"}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id FROM profile_usage_snapshot")).scalar_one() == 1
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )
    # 降级（no-op）同样不因缺列而失败。
    command.downgrade(config, PREVIOUS_REVISION)


def test_upgrade_on_unversioned_legacy_database_with_minimal_snapshot_table(tmp_path) -> None:
    """回归 test_database_migration_runner 的报错形态：未版本化库只有最小快照表时，
    升级到 head 不得抛 no such column，且原有行原样保留。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-minimal.db'}")
    config = build_alembic_config(engine)
    _insert(engine, "CREATE TABLE profile_usage_snapshot (id INTEGER PRIMARY KEY)", {})
    _insert(engine, "INSERT INTO profile_usage_snapshot (id) VALUES (7)", {})
    # 未版本化但已有应用表：迁移执行器会先 stamp 到基线再升级（与 runner 同一条路径）。
    command.stamp(config, BASELINE_REVISION)

    command.upgrade(config, MIGRATION_REVISION)

    assert set(_columns(engine, "profile_usage_snapshot")) == {"id"}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id FROM profile_usage_snapshot")).scalar_one() == 7
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )
