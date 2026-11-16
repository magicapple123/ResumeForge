# SPDX-License-Identifier: Apache-2.0
"""批次详情（RF-04）：条目查询下沉到服务层之后的行为与查询预算。

背景：``GET /api/apply/tasks/{id}`` 与 ``GET /api/collect/tasks/{id}`` 共用
``api/apply.py::_task_detail(data: Session, task_id)``，而它原先自己在路由层构造
``data.query(ApplyTaskItem)...``。那个 helper **没有被路由装饰器装饰**，接收者名字也不叫
``db``，于是 ``test_api_layer_rules.py`` 的两道口径都扫不到它——守卫全绿而 api 层在构造查询。

本文件钉住下沉之后**不能变**的四件事：

1. 两个入口都能用，且读到的是同一份详情（同一个 helper、同一份服务层查询）；
2. ``items`` 的排序口径 ``(sort_order, id)``——详情页进度条按下标推进，顺序变了进度会跳；
3. 批次不存在时仍是 404 且 detail 文案不变（走 ``_raise(exc)`` 的既有形状）；
4. 条目查询是**一次**，与条目数无关（原先也是一次，下沉不能把它变成 N+1）。

另外钉住"只有一份实现"：``apply_service.list_task_items`` 与 ``_tasks.list_task_items``
是同一个对象，``_task_detail`` 调的是它。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from app.models.apply import ApplyTask, ApplyTaskItem
from sqlalchemy import event

# 详情出口的固定预算：``get_task_detail`` 一次主键取 + ``list_task_items`` 一次条目查询。
MAX_DETAIL_SELECTS = 2

# ApplyTaskItemOut 的完整键集合（与 schemas/apply/tasks.py 逐项对应）。
# 任何键增删/改名都会让形状断言变红——前端按这些键直接渲染条目行。
ITEM_KEYS = (
    "id",
    "task_id",
    "job_id",
    "job_title",
    "company",
    "resume_id",
    "resume_title",
    "greeting",
    "status",
    "failure_category",
    "failure_detail",
    "attempt",
    "sort_order",
    "started_at",
    "finished_at",
    "created_at",
)


@contextmanager
def _count_statements() -> Iterator[list[str]]:
    """统计 with 块内测试库引擎上执行的 SQL（``before_cursor_execute`` 事件）。

    与 ``test_stats_query_budget.py`` 里同名上下文管理器同一套做法（各自持有一份，因为
    ``conftest`` 不承载这类单文件用的计数工具）。
    """
    from app import database

    statements: list[str] = []

    def _before_cursor_execute(_conn, _cursor, statement, _params, _context, _executemany):
        statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(database.engine, "before_cursor_execute", _before_cursor_execute)


def _selects(statements: list[str]) -> list[str]:
    return [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]


def _make_task(
    db_session, *, kind: str = "apply", sort_orders: tuple[int, ...] = (0, 1, 2)
) -> ApplyTask:
    """建一个批次 + 若干条目（``sort_order`` 按传入值，故意允许重复以覆盖并列口径）。"""
    task = ApplyTask(kind=kind, status="completed", total=len(sort_orders))
    db_session.add(task)
    db_session.flush()
    for index, sort_order in enumerate(sort_orders):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_title=f"岗位{index}",
                company=f"公司{index}",
                sort_order=sort_order,
                status="success",
            )
        )
    db_session.commit()
    return task


# ===== 行为：两个入口、顺序、404、字段 =====


def test_apply_router_returns_items_ordered_by_sort_order_then_id(client, db_session):
    """条目按 ``(sort_order, id)`` 排序：同序号按写入顺序兜底。"""
    # 故意乱序写入，且让前两条并列（sort_order 都是 0）。
    task = _make_task(db_session, sort_orders=(2, 0, 0))

    response = client.get(f"/api/apply/tasks/{task.id}")

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["sort_order"] for item in items] == [0, 0, 2]
    # 并列的两条按 id 升序（写入顺序），不是按插入顺序随机。
    assert [item["job_title"] for item in items] == ["岗位1", "岗位2", "岗位0"]


def test_collect_router_exposes_the_same_detail(client, db_session):
    """采集批次走另一个 router，但详情必须与投递批次逐字段一致（同一个 helper）。"""
    task = _make_task(db_session, kind="collect", sort_orders=(1, 0))

    apply_side = client.get(f"/api/apply/tasks/{task.id}")
    collect_side = client.get(f"/api/collect/tasks/{task.id}")

    assert apply_side.status_code == 200
    assert collect_side.status_code == 200
    assert apply_side.json() == collect_side.json()
    assert [item["id"] for item in collect_side.json()["items"]] == [
        item["id"] for item in apply_side.json()["items"]
    ]
    assert len(collect_side.json()["items"]) == 2


def test_missing_task_returns_404_with_the_existing_detail_text(client):
    """缺失任务仍是 404 + 既有文案（服务层异常经 ``_raise`` 的既有形状）。"""
    for url in ("/api/apply/tasks/99999", "/api/collect/tasks/99999"):
        response = client.get(url)
        assert response.status_code == 404, url
        assert response.json()["detail"] == "投递任务不存在或已被删除", url


def test_detail_item_keys_are_unchanged(client, db_session):
    """条目字段集合逐项不变（前端按这些键直接渲染）。"""
    task = _make_task(db_session, sort_orders=(0,))

    body = client.get(f"/api/apply/tasks/{task.id}").json()

    assert tuple(body["items"][0].keys()) == ITEM_KEYS
    assert body["kind"] == "apply"
    assert body["total"] == 1


def test_empty_task_has_no_items(client, db_session):
    """没有条目的批次返回空列表（不是 None、不报错）。"""
    task = _make_task(db_session, sort_orders=())

    body = client.get(f"/api/apply/tasks/{task.id}").json()

    assert body["items"] == []


# ===== 查询预算：与条目数无关 =====


@pytest.mark.parametrize("item_count", [1, 20])
def test_detail_select_count_is_constant(db_session, item_count):
    """详情出口固定 2 条 SELECT，与条目数无关（下沉不能把一次查询变成 N+1）。

    用**独立会话**调 ``_task_detail``（两个路由都只调它）：既避免 identity-map 让
    ``db.get`` 不发 SQL 而把预算测成 0，也避开 TestClient 启动期后台线程的语句噪声。
    """
    from app.api.apply import _task_detail
    from app.database import SessionLocal

    task = _make_task(db_session, sort_orders=tuple(range(item_count)))

    session = SessionLocal()
    try:
        with _count_statements() as statements:
            detail = _task_detail(session, task.id)
        selects = _selects(statements)
    finally:
        session.close()

    assert len(detail.items) == item_count
    assert len(selects) == MAX_DETAIL_SELECTS, (
        f"条目 {item_count} 条时执行了 {len(selects)} 条 SELECT"
        f"（预算 {MAX_DETAIL_SELECTS} 条）：\n" + "\n".join(selects)
    )


# ===== "只有一份实现" 的形状检查 =====


def test_task_items_query_lives_in_the_service_layer_only() -> None:
    """``_task_detail`` 必须调服务层，且服务层符号是同一个对象（不是第二份实现）。"""
    from app.api import apply as api_apply
    from app.services.apply import _tasks, apply_service

    assert apply_service.list_task_items is _tasks.list_task_items

    tree = ast.parse(Path(api_apply.__file__).read_text(encoding="utf-8"))
    helpers = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "_task_detail"
    ]
    assert len(helpers) == 1, "``_task_detail`` 应当只有一个定义"
    calls = {
        ast.unparse(node.func)
        for node in ast.walk(helpers[0])
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "apply_service.list_task_items" in calls, (
        f"``_task_detail`` 没有调用服务层条目查询，实际调用：{sorted(calls)}"
    )
