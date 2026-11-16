# SPDX-License-Identifier: Apache-2.0
"""对话技能：校验与整体替换的**查询/写入预算**（RF-06b）。

钉的是"成本与启用数量解耦"：校验 1 条 SELECT（存在性与"待验证"同源），整体替换
1 条 INSERT（executemany），而不是按技能条数逐条发。

为什么独立成文件：`test_conversation_skills.py` 已经贴着 500 行预算，这些预算用例
与它的行为用例关注点也不同（那边验"生效/不生效"，这边验"发了几条 SQL"）。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event


def _count_statements() -> Iterator[list[str]]:
    """统计 with 块内测试库引擎上执行的 SQL（``before_cursor_execute`` 事件）。"""
    from app import database

    @contextmanager
    def _inner() -> Iterator[list[str]]:
        statements: list[str] = []

        def _before_cursor_execute(_conn, _cursor, statement, _params, _context, _executemany):
            statements.append(statement)

        event.listen(database.engine, "before_cursor_execute", _before_cursor_execute)
        try:
            yield statements
        finally:
            event.remove(database.engine, "before_cursor_execute", _before_cursor_execute)

    return _inner()


def _skill(db_session, name: str):
    from app.models.assistant import AssistantSkill

    skill = AssistantSkill(name=name, description="", prompt="正文", enabled=True)
    db_session.add(skill)
    db_session.commit()
    return skill


def test_validation_reads_skills_in_one_query(db_session):
    """8 个技能也只查一次：存在性与"待验证"同源，不该分两条查询扫描同一批行。"""
    from app.services.assistant.assistant_skills import validate_conversation_skill_ids

    ids = [int(_skill(db_session, f"技能{i}").id) for i in range(8)]

    with _count_statements() as statements:
        assert validate_conversation_skill_ids(db_session, ids) == ids

    selects = [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
    assert len(selects) == 1, f"技能校验应恰好 1 条 SELECT，实际 {len(selects)}：{selects}"


def test_replace_writes_all_rows_in_one_statement(db_session):
    """整体替换：N 行关联只发 1 条 INSERT（executemany），不再逐行 add。"""
    from app.models.assistant import ChatConversation
    from app.services.assistant.assistant_skills import replace_conversation_skills

    ids = [int(_skill(db_session, f"批量{i}").id) for i in range(8)]
    conversation = ChatConversation(title="批量", surface="page")
    db_session.add(conversation)
    db_session.commit()

    with _count_statements() as statements:
        replace_conversation_skills(db_session, int(conversation.id), ids)

    inserts = [sql for sql in statements if sql.lstrip().upper().startswith("INSERT")]
    assert len(inserts) == 1, f"8 行关联应只发 1 条 INSERT，实际 {len(inserts)}：{inserts}"
