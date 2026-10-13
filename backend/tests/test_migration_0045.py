"""0045：可信交付账本四列（source_content_sha256 / artifact_sha256 / request_params /
idempotency_key）——只加列、业务表集合不变、历史残缺库跳过、完整 downgrade。
"""

from pathlib import Path

import sqlalchemy as sa
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect

PREVIOUS_REVISION = "0044_search_fts5"
HEAD_REVISION = "0045_delivery_ledger"

TABLE = "resume_delivery_record"
NEW_COLUMNS = (
    "source_content_sha256",
    "artifact_sha256",
    "request_params",
    "idempotency_key",
)


def _upgrade(config, revision: str) -> None:
    command.upgrade(config, revision)


def _columns(engine) -> set[str]:
    return {item["name"] for item in inspect(engine).get_columns(TABLE)}


def test_upgrade_adds_ledger_columns_and_keeps_tables_untouched(tmp_path):
    """只加列：升级前后业务表集合不变，四列全部可空落在 resume_delivery_record 上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'ledger.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    tables_before = set(inspect(engine).get_table_names())

    _upgrade(config, HEAD_REVISION)
    assert set(inspect(engine).get_table_names()) == tables_before
    assert set(NEW_COLUMNS) <= _columns(engine)
    # 四列全可空：旧行/旧备份缺列语义 = "不可还原"，不允许 NOT NULL 挡导入。
    nullable = {item["name"]: item["nullable"] for item in inspect(engine).get_columns(TABLE)}
    for name in NEW_COLUMNS:
        assert nullable[name] is True, name


def test_upgrade_skips_when_delivery_table_missing(tmp_path):
    """历史残缺库（有迁移版本号但没有 resume_delivery_record）跑 0045 不能炸。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(sa.text("DROP TABLE resume_delivery_record"))

    _upgrade(config, HEAD_REVISION)  # 不抛即通过：跳过而非报错
    assert TABLE not in set(inspect(engine).get_table_names())


def test_upgrade_is_idempotent_and_downgrade_removes_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idem.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)
    # 再跑一遍不该抛（列/索引存在即跳过）。
    _upgrade(config, HEAD_REVISION)
    assert set(NEW_COLUMNS) <= _columns(engine)

    command.downgrade(config, PREVIOUS_REVISION)
    assert not (set(NEW_COLUMNS) & _columns(engine))

    # downgrade 之后再升回来仍然可用。
    _upgrade(config, HEAD_REVISION)
    assert set(NEW_COLUMNS) <= _columns(engine)


def test_legacy_rows_read_as_null(tmp_path):
    """0044 时代建表 + 插入的旧行升级后新列为 NULL——"不可还原"如实可读。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO resume_delivery_record "
                "(source, content, render_context, content_sha256, rendered_config_sha256, created_at) "
                "VALUES ('track', '{}', '{}', '"
                + "a" * 64
                + "', '"
                + "b" * 64
                + "', '2026-10-01 00:00:00')"
            )
        )
    _upgrade(config, HEAD_REVISION)
    with engine.connect() as connection:
        row = connection.execute(
            sa.text(
                f"SELECT source_content_sha256, artifact_sha256, request_params, "
                f"idempotency_key FROM {TABLE}"
            )
        ).fetchone()
    assert row == (None, None, None, None)


def _load_migration_module():
    """按文件路径加载 0045 迁移模块（alembic 也是这么加载的，versions 不是包）。"""
    import importlib.util

    path = (
        Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0045_delivery_ledger.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0045_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_helpers_tolerate_missing_table():
    """模块级帮助函数对缺失表/列返回 False，不抛（迁移链会跑在残缺库上）。"""
    migration = _load_migration_module()
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as connection:
        assert migration._table_exists(connection, TABLE) is False
        assert migration._column_exists(connection, TABLE, "id") is False
