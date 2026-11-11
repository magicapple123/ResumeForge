# SPDX-License-Identifier: Apache-2.0
"""屏蔽清单（14E）：三道闸门 + 匹配规则。

**三道闸门缺一处就会漏**，所以三道各有用例：

1. 采集入库（``Collector.run``）：命中即丢弃，只在采集账目里记 ``blocked``；
2. 入队（``POST /api/apply/queue``）：409，且 ``detail`` 里必须出现「屏蔽」与命中项；
3. 投递前（``run_apply``）：兜底跳过——黑名单很可能是**入队之后**才加的，
   只拦前两处的话历史队列会照旧把它投出去。

采集侧复用 ``test_collector`` 的 FakeCollectAdapter/_config/_FakeClock/_task；
投递侧复用 ``test_apply_runner_robustness_qa`` 的真运行器脚手架（不连浏览器）。
"""

from __future__ import annotations

from app.models.apply import (
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.material import CandidateJob
from app.schemas.apply import ApplyConfigIn
from app.services.apply.blocklist import (
    KEYWORD_STOPWORDS,
    build_blocklist,
    clean_keywords,
    load_blocklist,
    skip_if_blocked,
)
from app.services.apply.collector import Collector
from app.services.settings_service import save_apply_blocklist
from app.services.sites.base import SearchPage, SearchResult
from test_apply_runner_robustness_qa import (
    ScriptedAdapter,
    _runner,
    _setup_task,
    _wait,
)
from test_collector import FakeCollectAdapter, _config, _FakeClock, _task


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


# ===== 匹配规则 =====


def test_keywords_need_two_chars_and_skip_stopwords():
    """「北京」「外包」这类词写进去只会屏蔽整类岗位，必须在匹配层就被挡掉。"""
    assert "北京" in KEYWORD_STOPWORDS
    assert clean_keywords(["北京", "算", "外包", "区块链", "区块链", " Python "]) == [
        "区块链",
        "Python",
    ]


def test_company_hit_uses_the_normalized_key():
    """公司名按 ``company_key`` 归一化后比较：空格 / 大小写 / 全半角差异不该绕过屏蔽。"""
    blocklist = build_blocklist(["A公司"], [])

    assert blocklist.hit(" A公司 ", "后端开发") == "公司「A公司」"
    # 归一化后不相等就是另一家公司，不能被误伤。
    assert blocklist.hit("B公司", "后端开发") == ""


def test_keyword_hit_scans_company_and_title_case_insensitively():
    blocklist = build_blocklist([], ["区块链", "Python"])

    assert blocklist.hit("A公司", "区块链后端开发") == "关键词「区块链」"
    assert blocklist.hit("A公司", "后端开发（python）") == "关键词「Python」"
    assert blocklist.hit("A公司", "前端开发") == ""


def test_empty_blocklist_matches_nothing():
    blocklist = build_blocklist([], [])

    assert not blocklist
    assert blocklist.hit("A公司", "后端开发") == ""


def test_load_blocklist_reads_what_was_saved(db_session):
    save_apply_blocklist(db_session, ["A公司"], ["区块链"])

    blocklist = load_blocklist(db_session)

    assert blocklist.hit("A公司", "前端") == "公司「A公司」"


# ===== 闸门① 采集入库 =====


def test_collector_drops_blocked_jobs_and_reports_the_count(db_session):
    save_apply_blocklist(db_session, ["A公司"], [])
    adapter = FakeCollectAdapter(
        [
            SearchPage(
                results=[
                    SearchResult(title="后端开发", company="A公司", url="https://example.com/1"),
                    SearchResult(title="数据开发", company="B公司", url="https://example.com/2"),
                ],
                has_next=False,
            )
        ]
    )
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert report.collected == 1
    assert report.blocked == 1
    # 被屏蔽的岗位**不写暂存区**：出现在"本次采集结果"里会让用户以为屏蔽没生效。
    staged = db_session.query(CandidateJob).all()
    assert [item.company for item in staged] == ["B公司"]
    # 数量要落进任务配置，收尾文案才说得出来"另有 1 个命中屏蔽清单"。
    db_session.refresh(task)
    assert task.config["blocked"] == 1


def test_collector_keeps_everything_when_the_list_is_empty(db_session):
    adapter = FakeCollectAdapter(
        [
            SearchPage(
                results=[
                    SearchResult(title="后端开发", company="A公司", url="https://example.com/1"),
                ],
                has_next=False,
            )
        ]
    )
    task = _task(db_session)

    report = Collector().run(
        session=db_session,
        task=task,
        client=object(),
        adapter=adapter,
        config=_config(),
        checkpoint=lambda: None,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
    )

    assert (report.collected, report.blocked) == (1, 0)


# ===== 闸门② 入队 =====


def test_queue_add_is_rejected_with_the_hit_item(client, db_session):
    save_apply_blocklist(db_session, ["A公司"], [])
    job = _job(db_session)

    response = client.post(
        "/api/apply/queue", json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]}
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    # 「屏蔽」两个字必须在文案里：只说"不能加入"用户不知道去哪儿改。
    assert "屏蔽" in detail["message"]
    assert "A公司" in detail["message"]
    assert detail["blocked_by_blacklist"] is True
    assert detail["blocked_hit"] == "公司「A公司」"
    assert detail["job_id"] == job.id
    # 没有被"先加进去再拦"。
    assert client.get("/api/apply/queue").json()["items"] == []
    assert db_session.query(ApplyQueueItem).count() == 0


def test_queue_add_rejects_blocked_keyword(client, db_session):
    save_apply_blocklist(db_session, [], ["区块链"])
    job = _job(db_session, title="区块链后端开发", source_url="https://www.zhipin.com/job/9")

    response = client.post(
        "/api/apply/queue", json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]}
    )

    assert response.status_code == 409
    assert "关键词「区块链」" in response.json()["detail"]["message"]


def test_queue_add_accepts_jobs_that_only_look_similar(client, db_session):
    """屏蔽「A公司」不能顺手把「A公司（上海）」也拦掉——那是两家。"""
    save_apply_blocklist(db_session, ["A公司"], [])
    job = _job(db_session, company="A公司（上海）")

    response = client.post(
        "/api/apply/queue", json={"items": [{"job_id": job.id, "confirm_unanalyzed": True}]}
    )

    assert response.status_code == 200
    assert response.json()[0]["company"] == "A公司（上海）"


# ===== 闸门③ 投递前兜底 =====


def test_apply_skips_blocked_item_before_touching_the_browser(db_session):
    """黑名单是入队之后加的：队列里已经有了，投递时必须兜底跳过。"""
    save_apply_blocklist(db_session, ["公司1"], [])
    adapter = ScriptedAdapter([None])
    task = _setup_task(db_session, 2)
    runner = _runner(adapter)

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    items = (
        db_session.query(ApplyTaskItem)
        .filter_by(task_id=task.id)
        .order_by(ApplyTaskItem.sort_order)
        .all()
    )
    assert [item.status for item in items] == ["success", "skipped"]
    assert adapter.calls == 1, "被屏蔽的那条不该真的发出去"
    assert "屏蔽" in items[1].failure_detail
    stored = db_session.get(ApplyTask, task.id)
    assert (stored.succeeded, stored.skipped) == (1, 1)
    # 软跳过：不计失败、不触发熔断。
    assert stored.failed == 0


def test_skip_if_blocked_returns_false_when_nothing_matches(db_session):
    task = ApplyTask(kind="apply", status="running", total=1, config=ApplyConfigIn().model_dump())
    db_session.add(task)
    db_session.flush()
    item = ApplyTaskItem(
        task_id=task.id,
        job_title="后端开发",
        company="A公司",
        status="pending",
        sort_order=0,
    )
    db_session.add(item)
    db_session.commit()

    assert skip_if_blocked(db_session, task, item) is False
    assert item.status == "pending"
