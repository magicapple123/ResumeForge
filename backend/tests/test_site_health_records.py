"""站点健康度：读库归因与 API 端点（从 test_site_health.py 拆出）。

``_task`` helper 定义在本文件，被 test_site_health_detail.py 复用；
纯判据与 ``_summary`` 留在主文件。
"""
from __future__ import annotations

import pytest
from app.models.apply import FAILURE_SELECTOR_INVALID, TASK_KIND_COLLECT, ApplyTask
from app.services.site_health import (
    STATUS_DEGRADED,
    STATUS_OK,
    recent_collect_summaries,
    site_health_overview,
)

# ===== 读库：按站点归因 =====


def _task(
    db_session,
    *,
    site_key: str | None = "boss",
    status: str = "completed",
    succeeded: int = 0,
    detail_missing: int = 0,
    failure_category: str = "",
    backfill: bool = False,
) -> ApplyTask:
    config: dict = {}
    if site_key is not None:
        config["site_key"] = site_key
    if detail_missing:
        config["detail_missing"] = detail_missing
    if failure_category:
        config["failure_category"] = failure_category
    if backfill:
        config["backfill_job_ids"] = [1]
    task = ApplyTask(kind=TASK_KIND_COLLECT, status=status, succeeded=succeeded, config=config)
    db_session.add(task)
    db_session.commit()
    return task


def test_recent_summaries_only_include_the_requested_site(db_session):
    _task(db_session, site_key="boss", succeeded=3)
    _task(db_session, site_key="other", succeeded=9)

    summaries = recent_collect_summaries(db_session, "boss")

    assert len(summaries) == 1
    assert summaries[0]["succeeded"] == 3


def test_recent_summaries_exclude_backfill_and_unfinished_runs(db_session):
    """补详情任务是用户点名的一次性修补，账目不同，不进健康度；未结束的任务也不进。"""
    _task(db_session, site_key="boss", succeeded=1)
    _task(db_session, site_key="boss", backfill=True)
    _task(db_session, site_key="boss", status="running")

    summaries = recent_collect_summaries(db_session, "boss")

    assert len(summaries) == 1


def test_recent_summaries_exclude_legacy_tasks_without_a_site_key(db_session):
    """旧任务没有 site_key（本功能之前采集的），不应被误算到任何站点。"""
    _task(db_session, site_key=None, succeeded=5)

    assert recent_collect_summaries(db_session, "boss") == []


def test_overview_reports_each_registered_site(db_session):
    """默认注册表里 BOSS 是唯一站点；没有样本时是 ok。"""
    overview = site_health_overview(db_session)

    assert [item.site_key for item in overview] == ["boss"]
    assert overview[0].display_name == "BOSS直聘"
    assert overview[0].status == STATUS_OK


def test_overview_becomes_degraded_from_recorded_failures(db_session):
    """端到端：记录层写下的 failure_category 能被读库层正确归因成 degraded。"""
    _task(db_session, site_key="boss", status="completed", succeeded=2)
    _task(
        db_session,
        site_key="boss",
        status="failed",
        failure_category=FAILURE_SELECTOR_INVALID,
    )

    overview = site_health_overview(db_session)

    assert overview[0].status == STATUS_DEGRADED
    assert overview[0].selector_failures == 1


# ===== API 端点 =====


def test_site_health_endpoint_returns_the_overview(client, db_session):
    _task(db_session, site_key="boss", status="completed", succeeded=1)
    _task(
        db_session,
        site_key="boss",
        status="failed",
        failure_category=FAILURE_SELECTOR_INVALID,
    )

    response = client.get("/api/collect/site-health")

    assert response.status_code == 200
    body = response.json()
    assert [site["site_key"] for site in body["sites"]] == ["boss"]
    site = body["sites"][0]
    assert site["status"] == STATUS_DEGRADED
    assert site["display_name"] == "BOSS直聘"
    assert site["reasons"]  # 原因来自后端，前端只展示
    assert site["recent"]  # 最近几次的统计明细


def test_site_health_route_is_registered():
    """把路由名与对外路径绑死：改名会让前端静默打到 404。"""
    from app.application import create_app

    assert "/api/collect/site-health" in set(create_app().openapi()["paths"])


def test_site_health_endpoint_is_ok_and_not_an_error_on_a_fresh_database(client):
    """全新库（一条采集任务都没有）：必须 200 且不报 degraded——绝不能 500。

    首次启动的用户点开投递台就会打到这个接口，"没有数据"是正常状态、不是错误。
    """
    response = client.get("/api/collect/site-health")

    assert response.status_code == 200
    body = response.json()
    assert [site["site_key"] for site in body["sites"]] == ["boss"]
    site = body["sites"][0]
    assert site["status"] == STATUS_OK
    assert site["sampled"] == 0
    assert site["reasons"] == []


def test_site_health_endpoint_reports_ok_without_reasons(client, db_session):
    """ok 态的返回形状：状态为 ok、原因为空、样本数如实——前端据此不渲染告警。"""
    _task(db_session, site_key="boss", status="completed", succeeded=5)
    _task(db_session, site_key="boss", status="completed", succeeded=3)

    site = client.get("/api/collect/site-health").json()["sites"][0]

    assert site["status"] == STATUS_OK
    assert site["reasons"] == []
    assert site["sampled"] == 2


# ===== 读库层：脏数据的健壮性（一个脏批次不该让整个投递台崩）=====


@pytest.mark.parametrize("bad_config", [["列表"], "字符串", 123], ids=["列表", "字符串", "整数"])
def test_read_layer_tolerates_a_corrupted_non_dict_config(db_session, bad_config):
    """``task.config`` 是从库里读出来的 JSON，可能是脏的（不是 dict）。

    不能因为一条脏批次就让 ``GET /api/collect/site-health`` 抛 500——那会把"看不见漂移"直接
    变成"整个投递台报错"。按"读不出来就算它不属于任何站点"处理：跳过这一条，其余照常统计。
    """
    _task(db_session, site_key="boss", succeeded=3)  # 一条正常记录：证明其余仍能被读到
    broken = ApplyTask(kind=TASK_KIND_COLLECT, status="completed", succeeded=1, config=bad_config)
    db_session.add(broken)
    db_session.commit()

    summaries = recent_collect_summaries(db_session, "boss")
    overview = site_health_overview(db_session)

    assert len(summaries) == 1  # 脏的那条被跳过，正常的仍在
    assert overview[0].status == STATUS_OK
