# SPDX-License-Identifier: Apache-2.0
"""PR-17：知识库检索 FTS/LIKE 语义一致性测试（真实临时库 + Alembic head）。

审计 C-4 指出：FTS 的 literal MATCH 与未转义 LIKE 对 ``%``/``_`` 行为不同
（``q=%py`` 时 LIKE 命中 ``python`` 而 MATCH 不命中）——"语义完全一致"必须
限定输入。这组测试在真实迁移链建出的库上逐项钉住：

- 短词（< 3 字符）回退 LIKE；
- 中文子串（≥ 3 字符）MATCH 与 LIKE 同语义；
- ASCII 大小写折叠一致；
- 含 ``%`` / ``_`` 的查询**两路同语义**（RR-07：LIKE 侧显式 ESCAPE，字面子串），
  以前"FTS 按字面量、LIKE 按通配符"的差异被钉在这里，现在改钉"两路一致"；
- FTS 索引在插入后立即可搜到（触发器同步，无需 rebuild）；
- 搜索计划真的走 ``knowledge_fts``（EXPLAIN QUERY PLAN）。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.migration import MigrationContext
from app.database_migrations import build_alembic_config
from app.models.knowledge_entry import KnowledgeEntry
from app.services import knowledge_service as ks
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker


def _build_head_db(db_path: Path):
    """用真实迁移链建一套临时库（``alembic upgrade head``）。"""
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    config = build_alembic_config(engine)
    command.upgrade(config, "head")
    with engine.connect() as conn:
        revision = MigrationContext.configure(conn).get_current_revision()
    assert revision, "临时库必须带 alembic 版本戳"
    return engine


def _seed(session, rows: list[tuple[str, str]]) -> None:
    for title, content in rows:
        session.add(KnowledgeEntry(title=title, content=content, category="技术笔记"))
    session.commit()


def _ids(entries: list[KnowledgeEntry]) -> set[int]:
    return {entry.id for entry in entries}


@pytest.fixture()
def fts_db(tmp_path):
    """带 FTS 的 head 库 + 两条基础数据；返回 (engine, session)。"""
    engine = _build_head_db(tmp_path / "fts-semantics.db")
    tables = set(inspect(engine).get_table_names())
    assert "knowledge_fts" in tables, (
        "当前 SQLite 不支持 FTS5 trigram（迁移 0044 被跳过），无法验证 FTS 语义"
    )
    session = sessionmaker(bind=engine)()
    _seed(
        session,
        [
            ("Python 后端开发", "面试技巧与复盘：如何在 45 分钟内展示 python 工程能力。"),
            ("前端构建优化", "Vite 构建提速的实践笔记，与后端无关。"),
        ],
    )
    try:
        yield engine, session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def like_db(tmp_path):
    """迁移 0044 之前的形态：head 库但 FTS 表/触发器已移除（测试模拟）。

    用于验证"FTS 不可用时回退 LIKE"的老路径语义——正是与 MATCH 产生
    ``%``/``_`` 行为差异的那条路径。
    """
    engine = _build_head_db(tmp_path / "like-semantics.db")
    with engine.begin() as conn:
        for suffix in ("au", "ad", "ai"):
            conn.execute(text(f"DROP TRIGGER IF EXISTS knowledge_fts_{suffix}"))
        conn.execute(text("DROP TABLE IF EXISTS knowledge_fts"))
    session = sessionmaker(bind=engine)()
    _seed(
        session,
        [
            ("Python 后端开发", "面试技巧与复盘：如何在 45 分钟内展示 python 工程能力。"),
            ("前端构建优化", "Vite 构建提速的实践笔记，与后端无关。"),
        ],
    )
    try:
        yield engine, session
    finally:
        session.close()
        engine.dispose()


def test_short_query_falls_back_to_like(fts_db):
    """``q=py``（2 字符 < 3）：trigram 表达不了，服务层回退 LIKE 仍要命中。"""
    _engine, session = fts_db
    hits = ks.list_knowledge(session, q="py")
    assert _ids(hits) >= _ids(
        session.query(KnowledgeEntry).filter(KnowledgeEntry.title == "Python 后端开发").all()
    )
    assert any(entry.title == "Python 后端开发" for entry in hits)


def test_chinese_substring_matches_like_semantics(fts_db):
    """中文子串（≥3 字符）：MATCH 命中集合必须与手工 LIKE 完全一致。"""
    _engine, session = fts_db
    hits = ks.list_knowledge(session, q="面试技巧")
    like_expected = {
        row.id
        for row in session.query(KnowledgeEntry)
        .filter(KnowledgeEntry.content.like("%面试技巧%"))
        .all()
    }
    assert like_expected, "测试数据本身必须命中 LIKE（防测试失效）"
    assert _ids(hits) == like_expected


def test_ascii_case_folding_matches_like(fts_db):
    """大小写：``q=PYTHON`` 命中 ``python``/``Python``（trigram 折叠与 LIKE 相同）。"""
    _engine, session = fts_db
    hits = ks.list_knowledge(session, q="PYTHON")
    titles = {entry.title for entry in hits}
    assert "Python 后端开发" in titles


def test_percent_query_is_literal_in_both_paths(fts_db, like_db):
    """RR-07：``q=%py`` 两路都按**字面子串**——LIKE 侧显式转义后不再命中 python。

    修复前：FTS 按字面量不命中，LIKE 把用户输入的 ``%`` 当通配符 → 命中 python，
    同一次搜索在升级前后（迁移跑没跑）给出不同结果。
    """
    _fts_engine, fts_session = fts_db
    _like_engine, like_session = like_db

    fts_hits = ks.list_knowledge(fts_session, q="%py")
    like_hits = ks.list_knowledge(like_session, q="%py")

    assert fts_hits == [], "文本里没有 % 字符就不该命中"
    assert like_hits == [], "LIKE 回退路径同样按字面量（% 不是通配符）"


def test_underscore_query_is_literal_in_both_paths(fts_db, like_db):
    """``q=py_``：``_`` 是字面量（旧 LIKE 把它当单字通配符，会命中 python）。"""
    _fts_engine, fts_session = fts_db
    _like_engine, like_session = like_db

    assert ks.list_knowledge(fts_session, q="py_") == []
    assert ks.list_knowledge(like_session, q="py_") == []


def test_literal_special_characters_match_when_text_contains_them(fts_db, like_db):
    """文本里真的含 ``%`` / ``_`` 时，两路都能按字面命中（转义不能把功能转没）。"""
    _fts_engine, fts_session = fts_db
    _like_engine, like_session = like_db
    for session in (fts_session, like_session):
        session.add(
            KnowledgeEntry(
                title="覆盖率笔记",
                content="压测达到 100% 覆盖，命名用 snake_case 风格。",
                category="技术笔记",
            )
        )
        session.commit()

    for session in (fts_session, like_session):
        # 逐条断言（不用 or 兜底）：`%` 是字面量，两种查询都应命中这条、且只命中这条。
        assert [entry.title for entry in ks.list_knowledge(session, q="100%")] == ["覆盖率笔记"]
        assert [entry.title for entry in ks.list_knowledge(session, q="100% 覆盖")] == [
            "覆盖率笔记"
        ]
        assert [entry.title for entry in ks.list_knowledge(session, q="snake_case")] == [
            "覆盖率笔记"
        ]
        # 没有 % 字符的文本不该被通配符解释命中。
        assert ks.list_knowledge(session, q="100 覆盖") == []


def test_diacritic_query_falls_back_to_like(fts_db, like_db):
    """带变音符号的查询不走 FTS：trigram 默认折叠变音符号，会与 LIKE 不一致。"""
    _fts_engine, fts_session = fts_db
    _like_engine, like_session = like_db
    for session in (fts_session, like_session):
        session.add(
            KnowledgeEntry(title="语言笔记", content="拿铁 café 的检索笔记。", category="技术笔记")
        )
        session.commit()

    assert ks._match_expression("café") is None, "带变音符号的查询必须回退 LIKE"
    for session in (fts_session, like_session):
        assert [entry.title for entry in ks.list_knowledge(session, q="café")] == ["语言笔记"]
        # 不带变音符号的写法不命中带变音符号的文本（两路口径一致）。
        assert ks.list_knowledge(session, q="cafe") == []


def test_fts_index_synced_after_insert(fts_db):
    """插入后立即检索：触发器同步，无需手动 rebuild。"""
    _engine, session = fts_db
    session.add(
        KnowledgeEntry(
            title="全新词条",
            content="这里有一个非常独特的标记词组：量子纠缠咖啡机。",
            category="面经",
        )
    )
    session.commit()
    hits = ks.list_knowledge(session, q="量子纠缠咖啡机")
    assert [entry.title for entry in hits] == ["全新词条"]


def test_search_query_plan_uses_knowledge_fts(fts_db):
    """搜索计划走 FTS：EXPLAIN QUERY PLAN 必须包含 knowledge_fts。"""
    engine, session = fts_db
    plan_rows = (
        session.connection()
        .execute(
            text(
                "EXPLAIN QUERY PLAN SELECT knowledge_entry.id FROM knowledge_entry "
                "WHERE knowledge_entry.deleted_at IS NULL "
                "AND knowledge_entry.id IN ("
                "SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH '\"面试技巧\"')"
            )
        )
        .all()
    )
    details = [row[3] for row in plan_rows]
    assert any("knowledge_fts" in detail for detail in details), details


def test_quoted_and_boolean_input_treated_literally(fts_db):
    """FTS 语法字符（引号/AND/OR/括号）按字面量参与匹配：无语法错误、无注入面。"""
    _engine, session = fts_db
    session.add(
        KnowledgeEntry(
            title="带引号的笔记",
            content='原文包含字面量 x"y OR (1=1) 以及 AND NOT 的纯文本。',
            category="技术笔记",
        )
    )
    session.commit()
    hits = ks.list_knowledge(session, q='x"y OR (1=1)')
    assert [entry.title for entry in hits] == ["带引号的笔记"]
    # 布尔语法不得把别的行"或"进来。
    assert all(entry.title == "带引号的笔记" for entry in hits)


def test_match_expression_guard_rails():
    """_match_expression 的边界：<3 字符/空串回退 None；引号翻倍转义。"""
    assert ks._match_expression("") is None
    assert ks._match_expression("  ") is None
    assert ks._match_expression("py") is None
    # 注意中文字符按"字符数"计数：「面试」是 2 字符，不足 trigram 滑窗下限。
    assert ks._match_expression("面试") is None
    assert ks._match_expression("面试技巧") == '"面试技巧"'
    assert ks._match_expression('a"b') == '"a""b"'
    # 前后空白是子串的一部分：不再 strip（" foo " 与 LIKE '% foo %' 同语义）。
    assert ks._match_expression("  foo  ") == '"  foo  "'
    # 带变音符号一律回退 LIKE（trigram 会折叠变音符号，与 LIKE 不一致）。
    assert ks._match_expression("café") is None


def test_non_ascii_case_folding_falls_back_to_like(fts_db, like_db):
    """非 ASCII 大小写折叠：trigram 会折叠西里尔/希腊/拉丁扩展，LIKE 只折 ASCII。

    靠"两路结果必须逐条相等"的承诺兜底：这类查询直接回退 LIKE（慢但不撒谎）。
    """
    _fts_engine, fts_session = fts_db
    _like_engine, like_session = like_db
    for session in (fts_session, like_session):
        session.add(
            KnowledgeEntry(title="俄语笔记", content="Привет Технологии 记录", category="技术笔记")
        )
        session.commit()

    assert ks._match_expression("привет") is None, "非 ASCII 大小写字母必须回退 LIKE"
    for session in (fts_session, like_session):
        # 两路一致：小写查询不命中大写写法（LIKE 的 ASCII-only 折叠口径）。
        assert ks.list_knowledge(session, q="привет") == []
        assert [entry.title for entry in ks.list_knowledge(session, q="Привет")] == ["俄语笔记"]
    # 中文不受影响：仍然走 FTS 快路径。
    assert ks._match_expression("俄语笔记") is not None
