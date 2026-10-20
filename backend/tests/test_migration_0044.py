# SPDX-License-Identifier: Apache-2.0
"""0044：知识库检索 FTS5（trigram）——``knowledge_fts`` 虚拟表 + 同步触发器。

覆盖四条硬规则：只加表（业务表集合前后不变）、历史残缺库可跳过、探测失败
（无 trigram）可跳过、完整 downgrade；另加检索侧两路行为：FTS 生效时与 LIKE
同语义（含防注入），探测不可用时回退 LIKE。
"""

from pathlib import Path

from alembic import command
from app.database_migrations import build_alembic_config
from app.models.knowledge_entry import KnowledgeEntry
from app.services import knowledge_service as ks
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0043_interview_auto_rounds"
HEAD_REVISION = "0044_search_fts5"


def _upgrade(config, revision: str) -> None:
    command.upgrade(config, revision)


def _business_tables(engine) -> set[str]:
    """业务表集合（不含 FTS 虚拟表及其影子表——派生索引结构，不算 schema 变更）。"""
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith("knowledge_fts")
    }


def test_upgrade_adds_fts_and_keeps_business_tables_untouched(tmp_path):
    """只加表：除 ``knowledge_fts`` 外，任何一张业务表都不该被 0044 动过。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'fts.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)

    _upgrade(config, HEAD_REVISION)
    assert "knowledge_fts" in set(inspect(engine).get_table_names())
    assert _business_tables(engine) == before

    with engine.connect() as connection:
        triggers = {
            name
            for (name,) in connection.execute(
                text(
                    "SELECT name FROM sqlite_master "
                    "WHERE type = 'trigger' AND name LIKE 'knowledge_fts%'"
                )
            )
        }
    assert triggers == {"knowledge_fts_ai", "knowledge_fts_ad", "knowledge_fts_au"}


def test_upgrade_skips_when_knowledge_entry_missing(tmp_path):
    """残缺库（有迁移版本号但没有 knowledge_entry）跑 0044 不能炸。

    真实场景是备份演练：alembic_version 已到 0043、个别业务表缺失的库。空库跑
    完整迁移链会由链上的迁移把 knowledge_entry 建出来，所以这里构造"已到 0043
    再删掉该表"的状态，而不是从空库升 head。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE knowledge_entry"))

    _upgrade(config, HEAD_REVISION)
    assert "knowledge_fts" not in set(inspect(engine).get_table_names())


def test_upgrade_skips_when_knowledge_entry_lacks_content_columns(tmp_path):
    """更极端的残缺形态：表在、但只有 id 列（迁移演练构造的裸表）也要跳过。

    run_database_migrations 对"未打版本号却有应用表"的库是先 stamp 基线再升链——
    knowledge_entry 因此不会经历 0019 的建列，0044 的 rebuild 与触发器引用的
    title/content 都不存在。列不齐时整体跳过：迁移照常完成（备份/导入路径不受
    阻），检索侧探测不到 fts 表自然走原 LIKE 路径。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'bare.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE knowledge_entry"))
        connection.execute(text("CREATE TABLE knowledge_entry (id INTEGER PRIMARY KEY)"))

    _upgrade(config, HEAD_REVISION)
    tables = set(inspect(engine).get_table_names())
    assert "knowledge_fts" not in tables
    # 触发器也不能残留：建在不完整表上的触发器本身就是坏状态。
    with engine.connect() as check:
        trigger_names = {
            row[0]
            for row in check.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='knowledge_entry'"
            ).fetchall()
        }
    assert not trigger_names


def _load_migration_module():
    """按文件路径加载 0044 迁移模块（alembic 也是这么加载的，versions 不是包）。"""
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0044_search_fts5.py"
    spec = importlib.util.spec_from_file_location("migration_0044_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_trigram_probe_reports_supported_engine():
    """探测函数在支持 FTS5 trigram 的引擎上返回 True（本仓库要求的 SQLite ≥ 3.34）。

    "探测失败 → 整体跳过"与 knowledge_entry 缺失共用同一条 return 路径，行为已由
    上面的残缺库测试覆盖；alembic 以文件路径动态加载迁移模块，无法对其副本做
    monkeypatch，因此探测的真值在这里做函数级验证。
    """
    migration = _load_migration_module()
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as connection:
        assert migration._trigram_available(connection) is True


def test_upgrade_is_idempotent_and_downgrade_removes(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idem.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)
    # 再跑一遍不该抛（虚拟表/触发器都带 IF NOT EXISTS，rebuild 幂等）。
    _upgrade(config, HEAD_REVISION)
    assert "knowledge_fts" in set(inspect(engine).get_table_names())

    command.downgrade(config, PREVIOUS_REVISION)
    assert "knowledge_fts" not in set(inspect(engine).get_table_names())
    with engine.connect() as connection:
        triggers = connection.execute(
            text(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'trigger' AND name LIKE 'knowledge_fts%'"
            )
        ).fetchall()
    assert triggers == []

    # downgrade 之后再升回来仍然可用（触发器重建、索引 rebuild）。
    _upgrade(config, HEAD_REVISION)
    assert "knowledge_fts" in set(inspect(engine).get_table_names())


def _seed_entries(session) -> None:
    session.add_all(
        [
            KnowledgeEntry(
                title="Python 面试技巧总结", content="准备八股文与算法", category="面试"
            ),
            KnowledgeEntry(title="前端面试", content="React hooks 要点", category="面试"),
            KnowledgeEntry(title="已归档", content="面试技巧 旧版", category="面试"),
        ]
    )
    session.commit()


def _soft_delete_archived(session) -> None:
    entry = session.query(KnowledgeEntry).filter(KnowledgeEntry.title == "已归档").one()
    entry.deleted_at = entry.updated_at
    session.commit()


def test_fts_query_matches_like_semantics(tmp_path):
    """FTS 生效时：中文子串命中、软删行不出现、短查询回退 LIKE、大小写折叠。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'query.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)

    from sqlalchemy.orm import Session

    with Session(engine) as session:
        _seed_entries(session)
        _soft_delete_archived(session)
        assert ks._fts_available(session) is True
        assert [e.title for e in ks.list_knowledge(session, q="面试技巧")] == [
            "Python 面试技巧总结"
        ]
        # 短于 3 字符：trigram 表达不了，回退 LIKE，语义不变。
        assert {e.title for e in ks.list_knowledge(session, q="面试")} == {
            "Python 面试技巧总结",
            "前端面试",
        }
        assert [e.title for e in ks.list_knowledge(session, q="python")] == ["Python 面试技巧总结"]
        # 分页端点与列表同口径。
        rows, total = ks.list_knowledge_page(session, q="面试技巧")
        assert total == 1 and rows[0].title == "Python 面试技巧总结"


def test_fts_falls_back_to_like_when_unavailable(tmp_path, monkeypatch):
    """即使表在，探测不可用也必须完整回退 LIKE（同库两路对比）。

    LIKE 是原语义：不做软删过滤构造，``已归档``（内容含"面试技巧 旧版"）理应命中。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'fallback.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)

    from sqlalchemy.orm import Session

    monkeypatch.setattr(ks, "_fts_available", lambda session: False)
    with Session(engine) as session:
        _seed_entries(session)
        assert {e.title for e in ks.list_knowledge(session, q="面试技巧")} == {
            "Python 面试技巧总结",
            "已归档",
        }


# ===== MATCH 表达式构造（防注入 / 语法安全）=====


def test_match_expression_quotes_and_escapes():
    assert ks._match_expression("面试技巧") == '"面试技巧"'
    assert ks._match_expression('hooks 要"点') == '"hooks 要""点"'
    # RR-07：前后空白是子串的一部分，表达式不再 strip（旧行为会命中 foo...）。
    assert ks._match_expression("  前后空格  ") == '"  前后空格  "'


def test_match_expression_rejects_short_or_blank():
    assert ks._match_expression("") is None
    assert ks._match_expression("   ") is None
    assert ks._match_expression("ab") is None


def test_injection_terms_match_as_literals(tmp_path):
    """FTS 关键词（NOT/OR/AND/NEAR）与 SQL 片段都按字面量处理，不炸也不越权。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'injection.db'}")
    config = build_alembic_config(engine)
    _upgrade(config, HEAD_REVISION)

    from sqlalchemy.orm import Session

    with Session(engine) as session:
        session.add(KnowledgeEntry(title="字面量说明", content='NOT OR AND 与 " 引号都是普通字符'))
        session.commit()
        hit = ks.list_knowledge(session, q="NOT OR AND")
        assert [e.title for e in hit] == ["字面量说明"]
        # 通配符/括号/引号混排不炸。
        assert ks.list_knowledge(session, q='(a OR b) "c" * ?') == []
