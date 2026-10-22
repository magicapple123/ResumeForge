# SPDX-License-Identifier: Apache-2.0
"""0046：全局搜索 FTS5（trigram）——七张 ``search_fts_*`` 虚拟表 + 同步触发器。

覆盖硬规则：只加表（业务表集合前后不变）、迁移 spec 与检索侧 spec 一致、
历史残缺库逐表跳过（一个域缺失不拖累其它域）、探测失败（无 trigram）整体
跳过、完整 downgrade、触发器同步（增/改/删都能反映到索引）。
"""

from pathlib import Path

from alembic import command
from app.database_migrations import build_alembic_config
from app.services import search_fts
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0045_delivery_ledger"
HEAD_REVISION = "0049_resume_language"

# 0044 也建 FTS 派生索引（knowledge_fts）：升到 0045 时它已经在库里，
# "业务表集合"的口径必须把两代派生索引都排除。
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _upgrade(config, revision: str) -> None:
    command.upgrade(config, revision)


def _business_tables(engine) -> set[str]:
    """业务表集合（不含 FTS 虚拟表及其影子表——派生索引结构，不算 schema 变更）。"""
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _fts_tables(engine) -> set[str]:
    return {name for name in inspect(engine).get_table_names() if name.startswith("search_fts")}


def _triggers(engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return {
            name
            for (name,) in connection.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE :pattern",
                ),
                {"pattern": f"{table}%"},
            )
        }


def test_upgrade_adds_fts_tables_and_keeps_business_tables_untouched(tmp_path):
    """只加表：除七张 ``search_fts_*`` 外，任何一张业务表都不该被 0046 动过。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'fts.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)

    _upgrade(config, HEAD_REVISION)
    expected = {search_fts.fts_table_name(base) for base in search_fts.SEARCH_FTS_SPECS}
    assert expected <= _fts_tables(engine)
    assert _business_tables(engine) == before
    # 每张 FTS 表三个同步触发器（INSERT/UPDATE/DELETE），影子表随虚拟表自动建。
    for base in search_fts.SEARCH_FTS_SPECS:
        table = search_fts.fts_table_name(base)
        assert _triggers(engine, table) == {f"{table}_ai", f"{table}_ad", f"{table}_au"}


def test_migration_spec_matches_service_spec():
    """迁移里内联的列清单必须与检索侧 ``SEARCH_FTS_SPECS`` 完全一致。

    迁移文件刻意不 import 应用代码（迁移链要能独立跑在残缺库上），两边各写
    一份就有一份失联的风险——这条测试就是失联警报。
    """
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0046_search_fts.py"
    spec = importlib.util.spec_from_file_location("migration_0046_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.SEARCH_FTS_SPECS == search_fts.SEARCH_FTS_SPECS


def test_upgrade_skips_only_the_missing_domain(tmp_path):
    """残缺库（缺 ``claim_record``）跑 0046：只跳过该域，其余六域照常建。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE claim_record"))

    _upgrade(config, HEAD_REVISION)
    tables = _fts_tables(engine)
    assert search_fts.fts_table_name("claim_record") not in tables
    assert search_fts.fts_table_name("job") in tables
    # 跳过的域不能留下半个坏触发器。
    assert _triggers(engine, "search_fts_claim_record") == set()


def test_upgrade_skips_when_table_lacks_search_columns(tmp_path):
    """更极端的残缺形态：表在、但只有 id 列（迁移演练构造的裸表）也要跳过该域。

    rebuild 与触发器引用登记的检索列，列不齐时建出来的索引本身就是坏状态。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'bare.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE reminder"))
        connection.execute(text("CREATE TABLE reminder (id INTEGER PRIMARY KEY)"))

    _upgrade(config, HEAD_REVISION)
    assert search_fts.fts_table_name("reminder") not in _fts_tables(engine)
    assert search_fts.fts_table_name("job") in _fts_tables(engine)
    assert _triggers(engine, "reminder") == set()


def test_trigram_probe_reports_supported_engine():
    """探测函数在支持 FTS5 trigram 的引擎上返回 True（本仓库要求的 SQLite ≥ 3.34）。"""
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0046_search_fts.py"
    spec = importlib.util.spec_from_file_location("migration_0046_probe_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as connection:
        assert module._trigram_available(connection) is True


def test_upgrade_is_idempotent_and_downgrade_removes(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idem.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)
    # 再跑一遍不该抛（虚拟表/触发器都带 IF NOT EXISTS，rebuild 幂等）。
    _upgrade(config, HEAD_REVISION)
    # 每张虚拟表 + 四张影子表（_data/_idx/_docsize/_config）。
    assert {search_fts.fts_table_name(base) for base in search_fts.SEARCH_FTS_SPECS} <= _fts_tables(
        engine
    )
    assert len(_fts_tables(engine)) == 5 * len(search_fts.SEARCH_FTS_SPECS)

    command.downgrade(config, PREVIOUS_REVISION)
    assert _fts_tables(engine) == set()
    with engine.connect() as connection:
        remaining = connection.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'search_fts%'"
            )
        ).fetchall()
    assert remaining == []

    # downgrade 之后再升回来仍然可用（触发器重建、索引 rebuild；影子表随虚拟表重建）。
    _upgrade(config, HEAD_REVISION)
    assert len(_fts_tables(engine)) == 5 * len(search_fts.SEARCH_FTS_SPECS)


def test_triggers_keep_index_in_sync(tmp_path):
    """INSERT / UPDATE / DELETE 都同步进 FTS 索引（rebuild 不是唯一入索引途径）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'sync.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)

    from app.models.job import Job
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        session.add(Job(title="Python 后端工程师", company="示例公司"))
        session.commit()
        job = session.query(Job).one()
        job_id = job.id

        def match(expression: str) -> list[int]:
            return [
                row[0]
                for row in session.execute(
                    text("SELECT rowid FROM search_fts_job WHERE search_fts_job MATCH :expr"),
                    {"expr": expression},
                ).fetchall()
            ]

        # INSERT 已入索引。
        assert match('"Python 后端"') == [job_id]
        # UPDATE：改标题后旧词不再命中、新词命中（软删除同理是 UPDATE，索引同步）。
        job.title = "Go 后端工程师"
        session.commit()
        assert match('"Python 后端"') == []
        assert match('"Go 后端"') == [job_id]
        # DELETE 后索引里不应再有这一行。
        session.delete(job)
        session.commit()
        assert match('"Go 后端"') == []
