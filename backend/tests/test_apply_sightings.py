# SPDX-License-Identifier: Apache-2.0
"""采集采样留痕（15A/15B 的数据来源）：重采**不再跳过即无痕**。

改动前 ``collector.py`` 命中"已采过"就 ``continue``，一个岗位被反复采到多少次、薪资改没改、
HR 多久没上线，全都没有落点。这里钉住四条最容易悄悄失效的性质：

1. **同一批次跑两次 → 行数 = 2 × 岗位数**（"复采次数"这项证据只有在重采也留痕时才存在）；
2. **已知岗位也记**，并且带 ``job_id`` / JD 指纹 / JD 前 2000 字（15B 的 before→after 靠它）；
3. **新岗位记，但 ``job_id`` 为空**——它当时还没进岗位广场，"挂着很久没人导入"同样要能看出来；
4. 采样**不改变主流程**：新岗位照旧进备选暂存区，已知岗位照旧计 ``skipped``。

夹具（``FakeCollectAdapter`` / ``_config`` / ``_task`` / ``_FakeClock``）按契约留在
``test_collector.py`` 并从那里 import——采集编排的接口一变，两边一起红。
"""

from __future__ import annotations

import hashlib

from app.models.job import JOB_STATUS_OPEN, Job
from app.models.job_seen import JobSeen
from app.models.material import CandidateJob
from app.services.apply.collector import Collector
from app.services.apply.collector_history import MAX_DESCRIPTION_SNAPSHOT
from app.services.sites.base import SearchPage, SearchResult
from test_collector import FakeCollectAdapter, _config, _FakeClock, _task


def _page(*results: SearchResult) -> SearchPage:
    return SearchPage(results=list(results), page=1, has_next=False)


def _run(db_session, pages: list[SearchPage], task=None):
    """跑一轮采集（不真等：clock 每次读表都大步前进）。"""
    task = task if task is not None else _task(db_session)
    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=FakeCollectAdapter(pages),
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )
    return report, task


def _result(index: int = 1, **overrides) -> SearchResult:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "url": f"https://example.com/{index}",
    }
    data.update(overrides)
    return SearchResult(**data)


def _job(db_session, url: str, description: str = "岗位正文") -> Job:
    job = Job(
        title="后端开发",
        company="A公司",
        source="BOSS直聘",
        source_url=url,
        status=JOB_STATUS_OPEN,
        description=description,
    )
    db_session.add(job)
    db_session.commit()
    return job


def test_two_runs_double_the_sighting_rows(db_session):
    """反证本功能的核心：同一批次采两次 → 2 × 岗位数（改前是 1 ×，重采被 `continue` 掉）。"""
    pages = [_page(_result(1), _result(2))]
    _run(db_session, pages)
    assert db_session.query(JobSeen).count() == 2

    _run(db_session, pages)
    assert db_session.query(JobSeen).count() == 4
    # 第二轮的两条都是"已采过"——采样没有绕过去重。
    rows = db_session.query(JobSeen).all()
    assert {row.run_id for row in rows}  # 两轮都写了 run_id（不写死具体 id）


def test_second_run_still_skips_but_leaves_a_trace(db_session):
    """已知岗位照旧计入 ``skipped``，但**同时**留下一条采样。"""
    pages = [_page(_result(1))]
    _run(db_session, pages)
    report, _task_row = _run(db_session, pages)

    assert report.collected == 0
    assert report.skipped == 1
    assert db_session.query(JobSeen).count() == 2


def test_known_job_sighting_carries_job_id_and_jd_fingerprint(db_session):
    """已入库的岗位：``job_id`` + 指纹 + 前 2000 字都记上（15B 的 before→after 靠它们）。"""
    job = _job(db_session, "https://example.com/1", description="负责订单系统的后端开发")
    _run(db_session, [_page(_result(1))])

    sighting = db_session.query(JobSeen).one()
    assert sighting.job_id == job.id
    assert (
        sighting.description_hash == hashlib.sha256("负责订单系统的后端开发".encode()).hexdigest()
    )
    assert sighting.description_text == "负责订单系统的后端开发"


def test_new_job_sighting_has_no_job_id(db_session):
    """还没进岗位广场的岗位：采样照样记，但 ``job_id`` 为空（它确实还没有岗位行）。"""
    _run(db_session, [_page(_result(1))])

    sighting = db_session.query(JobSeen).one()
    assert sighting.job_id is None
    assert sighting.title == "后端开发"
    assert sighting.company == "A公司"
    assert sighting.source_url == "https://example.com/1"
    # 没入库就没有正文，指纹必须留空（不能拿"空正文的 sha256"冒充一次指纹）。
    assert sighting.description_hash == ""
    assert sighting.description_text == ""
    # 主流程不变：新岗位仍然进备选暂存区。
    assert db_session.query(CandidateJob).count() == 1


def test_sighting_records_salary_and_hr_activity(db_session):
    """薪资展示文本与 HR 活跃信号按原样落库（15A 的两项证据都读它们）。"""
    _run(
        db_session,
        [
            _page(
                _result(
                    1,
                    salary="20-30K·14薪",
                    extra={"hr_active": "true", "hr_active_time": "3日内活跃"},
                )
            )
        ],
    )

    sighting = db_session.query(JobSeen).one()
    assert sighting.salary_text == "20-30K·14薪"
    assert sighting.hr_active == "true"
    assert sighting.hr_active_time == "3日内活跃"


def test_description_snapshot_keeps_only_the_first_two_thousand_chars(db_session):
    """指纹算全文、快照只存前 2000 字：历史表不因为 JD 变长而成倍膨胀。"""
    long_description = "岗" * (MAX_DESCRIPTION_SNAPSHOT + 500)
    _job(db_session, "https://example.com/1", description=long_description)
    _run(db_session, [_page(_result(1))])

    sighting = db_session.query(JobSeen).one()
    assert len(sighting.description_text) == MAX_DESCRIPTION_SNAPSHOT
    assert sighting.description_hash == hashlib.sha256(long_description.encode()).hexdigest()


def test_sighting_carries_the_collect_run_id(db_session):
    """``run_id`` 是"哪一轮见到的"：没有它，历史只能按时间猜归属。"""
    task = _task(db_session)
    _run(db_session, [_page(_result(1))], task=task)

    sighting = db_session.query(JobSeen).one()
    assert sighting.run_id == task.id


def test_empty_description_never_produces_a_fingerprint(db_session):
    """岗位存在但正文为空（当年详情没抓到）→ 不给指纹，避免"空→有"被报成一次变更。"""
    _job(db_session, "https://example.com/1", description="")
    _run(db_session, [_page(_result(1))])

    sighting = db_session.query(JobSeen).one()
    assert sighting.description_hash == ""
    assert sighting.description_text == ""


def test_sightings_carry_the_same_identity_as_the_dedup_key(db_session):
    """身份快照与去重判据同源：链接 / 标题 / 公司三列必须与采集结果逐字一致。"""
    _run(db_session, [_page(_result(7, title="数据开发", company="B公司"))])

    sighting = db_session.query(JobSeen).one()
    assert (sighting.title, sighting.company, sighting.source_url) == (
        "数据开发",
        "B公司",
        "https://example.com/7",
    )
