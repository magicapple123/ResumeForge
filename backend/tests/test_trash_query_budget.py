# SPDX-License-Identifier: Apache-2.0
"""回收站角标计数的**查询预算**（RF-06c）。

`counts()` 是每个页面都会拉的轻请求。按类型各发一条 `COUNT(*)` 会随回收站支持的
类型数线性增长（现在 10 类 = 10 条），这里钉住"合成一条 UNION ALL 之后仍是 1 条，
且结果形状不因合并而变"。

为什么独立成文件：`test_trash.py` 贴着 500 行预算，且那边验的是"删掉之后到处都
看不到"这类行为，与"发了几条 SQL"是两件事。
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


def test_counts_costs_one_statement_regardless_of_type_count(db_session):
    """角标计数只发 **1** 条 SQL：类型数从 3 涨到 10 时仍是 1 条。

    这条钉的不是"现在快"，而是"类型变多不会把角标拖成 10 条查询"——新增回收站类型
    只需要往 ``TRASH_SPECS`` 加一行，不该顺带让每个页面的角标多一条 COUNT。
    """
    from app.models.job import Job
    from app.models.profile import utcnow
    from app.services import trash

    db_session.add(Job(title="在回收站里的岗位", company="A", deleted_at=utcnow()))
    db_session.commit()

    with _count_statements() as statements:
        totals = trash.counts(db_session)

    selects = [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
    assert len(selects) == 1, f"counts() 应恰好 1 条 SELECT，实际 {len(selects)}"
    assert totals["job"] == 1
    # 结果形状不因合并而变：每种类型都有键（哪怕是 0）。
    assert set(totals) == {spec.key for spec in trash.TRASH_SPECS}
