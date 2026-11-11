# SPDX-License-Identifier: Apache-2.0
"""15A 忽略僵尸提示（本批唯一的**写**端点）的端到端契约。

端点：``PUT /api/apply/queue/{queue_id}/ghost-ignore``，body ``{"ignored": bool}``，
响应 ``{"queue_id", "ignored"}``。

这个东西只写 ``Job.ghost_ignored`` **一个布尔位**，本文件因此钉住它"没写什么"：

- **采样不删**（``job_seen`` 行数不变）：忽略是"别再念这一句"，不是"抹掉历史"；
- **分数不改**（队列行上的 ``ghost_score`` 照旧下发）：分数是派生值，改它等于伪造历史；
- **忽略 → 14A 体检不再报 ``ghost_job``；恢复 → 重新报**——两条方向都验，否则"忽略"
  很容易写成一个单向开关（点了一次就再也回不来）；
- 两种失败必须报错而不是静默成功：队列条目不存在 → 404；岗位已被删除（``job_id``
  为空）→ 409（"没有岗位可写"不是"状态没变"）。

时间锚点用真实 ``utcnow()``：体检链路内部按"现在"算分，所以只断言分档（75 分）与
"哪几项证据"，不断言"首见第几天"——天数那种精确值归纯函数用例（``test_apply_ghost.py``）。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from app.models.apply import QUEUE_STATUS_PENDING, ApplyQueueItem
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.job_seen import JobSeen
from app.models.profile import utcnow
from app.services.apply._base import ApplyConflict, ApplyNotFound
from app.services.apply._queue import list_queue
from app.services.apply.lifecycle import set_ghost_ignored
from app.services.apply.preflight import CODE_GHOST_JOB, check_item, preflight

GOOD_GREETING = "您好，我有三年 Python 后端经验，做过高并发订单系统，想聊聊这个岗位。"


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
        # 首见 ≥60 天：单独就值 40 分，配合复采与薪资未变凑到 75（>70 才进体检）。
        "created_at": utcnow() - timedelta(days=75, hours=2),
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _seen(db_session, job: Job, *, days_ago: int, salary: str = "20-30K") -> JobSeen:
    row = JobSeen(
        job_id=job.id,
        title=job.title,
        company=job.company,
        source_url=job.source_url,
        seen_at=utcnow() - timedelta(days=days_ago),
        salary_text=salary,
    )
    db_session.add(row)
    db_session.commit()
    return row


def _queue_item(db_session, job: Job | None) -> ApplyQueueItem:
    item = ApplyQueueItem(
        job_id=job.id if job is not None else None,
        job_title="后端开发",
        company="A公司",
        greeting=GOOD_GREETING,
        sort_order=1,
        status=QUEUE_STATUS_PENDING,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _ghost_item(db_session) -> tuple[Job, ApplyQueueItem]:
    """一条 75 分的僵尸岗 + 它的队列条目（体检里会报 ``ghost_job`` 的最小配置）。"""
    job = _job(db_session)
    for days_ago in (30, 10, 1):
        _seen(db_session, job, days_ago=days_ago)
    return job, _queue_item(db_session, job)


def _ghost_codes(db_session, item: ApplyQueueItem) -> list[str]:
    return [issue.code for issue in check_item(db_session, item) if issue.code == CODE_GHOST_JOB]


# ===== 服务层：只有这一位被写 =====


def test_service_sets_the_flag_and_leaves_history_untouched(db_session):
    """置真：``ghost_ignored=True``，采样条数不变，分数仍算得出来（只是不再提示）。"""
    job, item = _ghost_item(db_session)

    result = set_ghost_ignored(db_session, item.id, True)

    assert result == {"queue_id": item.id, "ignored": True}
    db_session.refresh(job)
    assert job.ghost_ignored is True
    assert db_session.query(JobSeen).filter(JobSeen.job_id == job.id).count() == 3


def test_service_reports_404_for_missing_queue_item(db_session):
    """队列条目不存在 → ``ApplyNotFound``（路由翻 404），不静默成功。"""
    with pytest.raises(ApplyNotFound):
        set_ghost_ignored(db_session, 999999, True)


def test_service_reports_409_when_the_job_is_gone(db_session):
    """岗位已被删除（``job_id`` 为空）→ ``ApplyConflict``（路由翻 409）。

    这里不是"状态没变"：没有岗位可写，连"恢复提示"都无从谈起。
    """
    item = _queue_item(db_session, None)

    with pytest.raises(ApplyConflict):
        set_ghost_ignored(db_session, item.id, True)


# ===== 体检联动：忽略即静默，恢复即重新报 =====


def test_ignore_silences_the_preflight_warning(db_session):
    """忽略之后 14A 体检不再报 ``ghost_job``（用户已经看过这条提示并选择仍然要投）。"""
    _job_row, item = _ghost_item(db_session)
    assert _ghost_codes(db_session, item) == [CODE_GHOST_JOB]  # 忽略前确实报

    set_ghost_ignored(db_session, item.id, True)

    assert _ghost_codes(db_session, item) == []


def test_restore_brings_the_warning_back(db_session):
    """``ignored=false`` 恢复 → 体检重新报（否则忽略会变成单向的"再也回不来"）。"""
    _job_row, item = _ghost_item(db_session)
    set_ghost_ignored(db_session, item.id, True)
    assert _ghost_codes(db_session, item) == []

    assert set_ghost_ignored(db_session, item.id, False) == {"queue_id": item.id, "ignored": False}

    assert _ghost_codes(db_session, item) == [CODE_GHOST_JOB]


def test_preflight_end_to_end_respects_the_flag(db_session):
    """整轮体检（不是单条调用）同样尊重这个开关——前端拿到的就是这份结果。"""
    _job_row, item = _ghost_item(db_session)
    set_ghost_ignored(db_session, item.id, True)

    result = preflight(db_session)

    codes = {issue.code for row in result.items if row.queue_id == item.id for issue in row.issues}
    assert CODE_GHOST_JOB not in codes


def test_queue_row_carries_the_flag_and_still_carries_the_score(db_session):
    """队列行：``ghost_ignored=True`` 的同时 ``ghost_score`` 仍是 75。

    分数不改是刻意的——忽略是"别提醒我"，不是"这条岗位没问题"。把分数清零会让用户
    以为忽略改变了对岗位的判断。
    """
    _job_row, item = _ghost_item(db_session)
    set_ghost_ignored(db_session, item.id, True)

    (row,) = list_queue(db_session)

    assert row.id == item.id
    assert row.ghost_ignored is True
    assert row.ghost_score == 75
    assert row.ghost_evidence


def test_queue_row_defaults_to_not_ignored(db_session):
    """没忽略过的队列行 → ``ghost_ignored=False``（前端据此显示「忽略」而不是「恢复」）。"""
    _job_row, item = _ghost_item(db_session)

    (row,) = list_queue(db_session)

    assert row.id == item.id
    assert row.ghost_ignored is False


# ===== 端点：路由已注册、形状、404 / 409 / 422 =====


def test_endpoint_ignores_and_echoes_the_state(client, db_session):
    """``PUT /queue/{id}/ghost-ignore`` → ``{queue_id, ignored}``，且库里确实置真。"""
    job, item = _ghost_item(db_session)

    response = client.put(f"/api/apply/queue/{item.id}/ghost-ignore", json={"ignored": True})

    assert response.status_code == 200
    assert response.json() == {"queue_id": item.id, "ignored": True}
    db_session.refresh(job)
    assert job.ghost_ignored is True


def test_endpoint_restore_round_trip(client, db_session):
    """同一端点置假即恢复（不需要第二个端点）。"""
    job, item = _ghost_item(db_session)
    client.put(f"/api/apply/queue/{item.id}/ghost-ignore", json={"ignored": True})

    response = client.put(f"/api/apply/queue/{item.id}/ghost-ignore", json={"ignored": False})

    assert response.status_code == 200
    assert response.json() == {"queue_id": item.id, "ignored": False}
    db_session.refresh(job)
    assert job.ghost_ignored is False


def test_endpoint_404_for_missing_queue_item(client):
    """队列条目不存在 → 404（前端据此提示"这条已被移除"，而不是当成忽略成功）。"""
    response = client.put("/api/apply/queue/999999/ghost-ignore", json={"ignored": True})

    assert response.status_code == 404


def test_endpoint_409_when_the_job_is_gone(client, db_session):
    """岗位已删除 → 409（"没有岗位可写"与"条目不存在"必须分开报）。"""
    item = _queue_item(db_session, None)

    response = client.put(f"/api/apply/queue/{item.id}/ghost-ignore", json={"ignored": True})

    assert response.status_code == 409


def test_endpoint_rejects_unknown_fields(client, db_session):
    """多带派生字段（如 ``ghost_score``）→ 422：请求体只有 ``{ignored}`` 一位契约。"""
    _job_row, item = _ghost_item(db_session)

    response = client.put(
        f"/api/apply/queue/{item.id}/ghost-ignore",
        json={"ignored": True, "ghost_score": 0},
    )

    assert response.status_code == 422


def test_sibling_insight_routes_stay_registered(client, db_session):
    """同模块的 GET 路由没被这次改动挤掉：``jd-change`` 200 / 不存在时 404。

    新挂一个 ``PUT`` 在同一段路径下，最典型的回归是路由顺序把 ``/queue/{id}/...`` 系列
    整体带偏，所以这里顺手钉一下邻居。
    """
    _job_row, item = _ghost_item(db_session)

    assert client.get(f"/api/apply/queue/{item.id}/jd-change").status_code == 200
    assert client.get(f"/api/apply/queue/{item.id}/inspect").status_code == 200
    assert client.get("/api/apply/queue/999999/jd-change").status_code == 404
