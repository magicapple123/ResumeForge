# SPDX-License-Identifier: Apache-2.0
"""``ApplyRecordOut.track_id``：「更新进度」之后的去处（整改 #18）。

## 为什么列表要带这个字段

前端按钮的三态（「更新进度」/「查看进度 ↗」）**必须由数据驱动**，不能靠"这次点成功了"
这种内存状态：用户刷新一次页面，按钮就退回「更新进度」，于是会再点一次——后端查重兜住，
但体验是空转。``track_id`` 让"写没写过"成为记录行自己的事实。

## 钉住的五件事

1. 没写过 → ``track_id`` 为空；``POST /records/{id}/track`` 之后 → 等于那条进度 id；
2. **判定与 ``link_track`` 同源**：列表说写过之后，再点一次必须回 ``created=false``
   （否则就是"列表说没写过、点一下却说早就写过"的矛盾）；
3. 先 ``job_id``，``(company_key, title_key)`` 兜底——与 ``funnel._find_track`` 逐条一致；
4. 软删的进度不再算"已写过"（记录行不能深链到一条回收站里的条目）；
5. 反查是**批量**的：SELECT 次数不随记录条数增长（一页 20 条不能变成 20 次额外 SQL）。

另外钉住 ``GET /api/tracker/{id}`` 的 404 口径：前端 ``?track=N`` 靠它把 `job_id` 拿到，
记录已删时必须是 404（前端据此提示并清掉参数），不能 500 也不能返回空对象。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from app.models.apply import ApplyTask, ApplyTaskItem
from app.models.job import JOB_STATUS_OPEN, Job
from sqlalchemy import event

RECORD_BASE = {
    "job_title": "后端开发实习生",
    "company": "示例科技",
    "status": "success",
}

TRACK_BASE = {
    "company": "示例科技",
    "title": "后端开发实习生",
    "status": "applied",
    "applied_at": "2026-09-18",
}


@contextmanager
def _count_selects() -> Iterator[list[str]]:
    """统计 with 块内测试库引擎上执行的 SELECT（做法同 ``test_apply_task_detail_queries``）。"""
    from app import database

    statements: list[str] = []

    def _before_cursor_execute(_conn, _cursor, statement, _params, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(database.engine, "before_cursor_execute", _before_cursor_execute)


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发实习生",
        "company": "示例科技",
        "source": "手动添加",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _batch(db_session, count: int, *, job_id: int | None = None) -> ApplyTask:
    """建一个投递批次 + ``count`` 条成功记录（公司/岗位名与 ``TRACK_BASE`` 一致）。"""
    task = ApplyTask(kind="apply", status="completed", total=count)
    db_session.add(task)
    db_session.flush()
    for index in range(count):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_id=job_id,
                job_title=RECORD_BASE["job_title"],
                company=RECORD_BASE["company"],
                status=RECORD_BASE["status"],
                sort_order=index,
            )
        )
    db_session.commit()
    return task


def _records(client) -> list[dict]:
    response = client.get("/api/apply/records?page=1&page_size=100")
    assert response.status_code == 200
    return response.json()["items"]


def _record(client, record_id: int) -> dict:
    for row in _records(client):
        if row["id"] == record_id:
            return row
    raise AssertionError(f"列表里没有记录 {record_id}")


def _record_id(db_session, task: ApplyTask) -> int:
    db_session.rollback()
    row = (
        db_session.query(ApplyTaskItem)
        .filter(ApplyTaskItem.task_id == task.id)
        .order_by(ApplyTaskItem.id)
        .first()
    )
    assert row is not None
    return row.id


def test_track_id_is_empty_until_the_record_is_linked(client, db_session):
    task = _batch(db_session, 1)

    row = _record(client, _record_id(db_session, task))

    # 没写过：前端据此渲染「更新进度」。
    assert row["track_id"] is None


def test_linking_fills_track_id_and_agrees_with_a_second_click(client, db_session):
    """第 2 条口径：列表与 ``link_track`` 的判定必须同源。"""
    task = _batch(db_session, 1)
    record_id = _record_id(db_session, task)

    linked = client.post(f"/api/apply/records/{record_id}/track")
    assert linked.status_code == 200
    assert linked.json()["created"] is True
    track_id = linked.json()["track_id"]

    assert _record(client, record_id)["track_id"] == track_id

    # 再点一次：判定一致才会回 created=false；若两边查重键不同，这里会多出一条进度。
    again = client.post(f"/api/apply/records/{record_id}/track")
    assert again.status_code == 200
    assert again.json()["created"] is False
    assert again.json()["track_id"] == track_id
    assert _record(client, record_id)["track_id"] == track_id


def test_job_id_hit_is_preferred_over_the_key_fallback(client, db_session):
    """记录带 ``job_id`` 时以它为准（``_find_track`` 的第一段判据）。"""
    job = _job(db_session)
    task = _batch(db_session, 1, job_id=job.id)
    record_id = _record_id(db_session, task)

    # 先手工建一条**同公司同名**的进度（没有 job_id），再建一条挂了 job_id 的。
    client.post("/api/tracker", json=TRACK_BASE)
    with_job = client.post("/api/tracker", json={**TRACK_BASE, "job_id": job.id})
    assert with_job.status_code == 201

    row = _record(client, record_id)
    assert row["track_id"] == with_job.json()["id"]


def test_key_fallback_matches_manually_created_tracks(client, db_session):
    """记录没有 ``job_id``（岗位已删/历史数据）时按合并键兜底。"""
    task = _batch(db_session, 1)
    record_id = _record_id(db_session, task)
    created = client.post("/api/tracker", json=TRACK_BASE)
    assert created.status_code == 201

    assert _record(client, record_id)["track_id"] == created.json()["id"]


def test_soft_deleted_track_does_not_count_as_linked(client, db_session):
    """回收站里的进度不能被当成"已写过"：那条链接点进去是空的。"""
    task = _batch(db_session, 1)
    record_id = _record_id(db_session, task)
    track_id = client.post(f"/api/apply/records/{record_id}/track").json()["track_id"]
    assert _record(client, record_id)["track_id"] == track_id

    assert client.delete(f"/api/tracker/{track_id}").status_code == 204

    assert _record(client, record_id)["track_id"] is None
    # 已知的**既有**行为（不属 #18 范围，故意不钉状态码）：软删的行仍占着
    # ``(company_key, title_key)`` 唯一约束，而 ``funnel._find_track`` 只看存活行，
    # 于是"删掉进度再点更新进度"会走 409「写求职进度失败」。真要修要动 ``link_track``
    # 的找回逻辑（是否复活回收站那条），属于产品决策，这里只钉住"列表不会指向已删条目"。


def test_lookup_is_batched_not_per_record(client, db_session):
    """第 5 条口径：SELECT 次数与记录条数无关（否则一页 20 条 = N+1）。"""
    _batch(db_session, 3)
    with _count_selects() as few:
        _records(client)

    _batch(db_session, 3)
    with _count_selects() as many:
        rows = _records(client)

    assert len(rows) == 6
    assert len(many) == len(few)


def test_single_track_read_returns_404_when_missing_or_deleted(client):
    """``GET /api/tracker/{id}``：前端 ``?track=N`` 的定位依赖它，404 是正常分支不是异常。"""
    assert client.get("/api/tracker/999999").status_code == 404

    created = client.post("/api/tracker", json=TRACK_BASE)
    assert created.status_code == 201
    track_id = created.json()["id"]
    assert client.get(f"/api/tracker/{track_id}").json()["job_id"] is None

    assert client.delete(f"/api/tracker/{track_id}").status_code == 204
    assert client.get(f"/api/tracker/{track_id}").status_code == 404
