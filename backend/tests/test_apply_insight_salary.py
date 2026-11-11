# SPDX-License-Identifier: Apache-2.0
"""15C 岗位体检：薪资偏离 / 同司多投 / 历史结果（纯本地统计，零迁移）。

钉住的是**门槛与口径**，不是"数字好看"：

- 样本 < 8 条时**不给结论**：``median`` / ``delta_percent`` / ``direction`` 全 ``null``，
  只报 ``sample``。这条一旦放宽，系统就会拿 3 条样本算出一个"你比市场低 23%"。
- 样本口径是**同城 + 同职位族**：换城市、换职位族都不计入；日薪也不计入
  （单位不同，混进月薪中位数会算出荒唐的偏离）。
- ``sample`` 不含本条岗位自己。
"""

from __future__ import annotations

from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    QUEUE_STATUS_PENDING,
    TASK_KIND_APPLY,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.tracker import STATUS_APPLIED, STATUS_INTERVIEW, ApplicationTrack, normalize_key
from app.schemas.apply.insights import ApplyJobInspectOut
from app.services.apply.inspect import inspect_queue_item, title_tokens


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "location": "北京",
        "salary": "20-30K",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _queue(db_session, job: Job, *, resume_id: int | None = None, order: int = 1) -> ApplyQueueItem:
    item = ApplyQueueItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        resume_id=resume_id,
        sort_order=order,
        status=QUEUE_STATUS_PENDING,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _salary_pool(db_session, count: int, *, salary: str = "10-20K", **overrides) -> list[Job]:
    """造 ``count`` 条"同城同族"的参照岗位（默认北京-后端，月薪中位 15000）。"""
    return [_job(db_session, salary=salary, **overrides) for _ in range(count)]


# ===== 职位族归一 =====


def test_title_tokens_strip_seniority_and_role_words():
    """去掉通用词后剩下的才是职位族：三个标题同族、一个不同族。"""
    assert title_tokens("高级后端开发工程师") == frozenset({"后端"})
    assert title_tokens("资深后端工程师") == frozenset({"后端"})
    assert title_tokens("后端") == frozenset({"后端"})
    assert title_tokens("前端开发") == frozenset({"前端"})
    assert title_tokens("前端开发") != title_tokens("后端开发")


def test_title_tokens_empty_when_title_is_all_generic():
    """整串都是通用词 → 空集合（判不出族，调用方按"比不了"处理，绝不退化成同族）。"""
    assert title_tokens("工程师") == frozenset()
    assert title_tokens("") == frozenset()


# ===== 薪资偏离 =====


def test_salary_high_deviation_against_same_city_family(db_session):
    """8 条同城同族样本（中位 15000）vs 本条 30000 → 高 100%，direction=high。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 8)
    item = _queue(db_session, job)

    report = inspect_queue_item(db_session, item.id)

    assert report.salary.status == "ok"
    assert report.salary.sample == 8
    assert report.salary.median == 15000
    assert report.salary.target == 30000
    assert report.salary.delta_percent == 100.0
    assert report.salary.direction == "high"


def test_salary_low_deviation_points_down(db_session):
    """本条 7000 vs 中位 15000 → -53.3%，direction=low。"""
    job = _job(db_session, salary="5-9K")
    _salary_pool(db_session, 8)
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.status == "ok"
    assert salary.median == 15000
    assert salary.delta_percent == -53.3
    assert salary.direction == "low"


def test_salary_within_ten_percent_is_same(db_session):
    """落在 ±10% 以内算持平（14-16K vs 中位 15000 → 0.0%）。"""
    job = _job(db_session, salary="14-16K")
    _salary_pool(db_session, 8)
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.direction == "same"
    assert salary.delta_percent == 0.0


def test_salary_insufficient_at_seven_samples(db_session):
    """**7 条样本不够**：只报 sample=7，中位数与百分比一律 null。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 7)
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.status == "insufficient"
    assert salary.sample == 7
    assert salary.median is None
    assert salary.delta_percent is None
    assert salary.direction is None
    # target 是本条岗位自己的事实，样本不足也要如实给出。
    assert salary.target == 30000


def test_salary_sample_excludes_self(db_session):
    """样本不含本条自己：7 条参照 + 自己 ≠ 8 条样本。"""
    job = _job(db_session, salary="10-20K")
    _salary_pool(db_session, 7)
    item = _queue(db_session, job)

    assert inspect_queue_item(db_session, item.id).salary.sample == 7


def test_salary_ignores_other_city_and_other_family(db_session):
    """同城不同族、同族不同城都不计入样本。"""
    job = _job(db_session, salary="25-35K")  # 北京-后端
    # 8 条上海的后端岗位：城市不同，一条都不算。
    _salary_pool(db_session, 8, location="上海")
    # 8 条北京的前端岗位：职位族不同，一条都不算。
    _salary_pool(db_session, 8, title="前端开发")
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.status == "insufficient"
    assert salary.sample == 0
    assert salary.median is None


def test_salary_ignores_daily_rate_samples(db_session):
    """日薪（几百元量级）不进月薪样本：单位不同就比不了。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 8, salary="500-800元/天")
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.status == "insufficient"
    assert salary.sample == 0


def test_salary_unparsable_target_stays_insufficient(db_session):
    """本条薪资读不出（面议）+ 有一堆样本 → 仍然没有可比的 target，不出结论。"""
    job = _job(db_session, salary="面议")
    _salary_pool(db_session, 10)
    item = _queue(db_session, job)

    salary = inspect_queue_item(db_session, item.id).salary

    assert salary.status == "insufficient"
    assert salary.target is None
    assert salary.delta_percent is None


# ===== 同司多投 + 历史结果 =====


def _record(db_session, task: ApplyTask, job: Job, **overrides) -> ApplyTaskItem:
    data = {
        "task_id": task.id,
        "job_id": job.id,
        "job_title": job.title,
        "company": job.company,
        "status": ITEM_STATUS_SUCCESS,
    }
    data.update(overrides)
    item = ApplyTaskItem(**data)
    db_session.add(item)
    db_session.commit()
    return item


def _task(db_session) -> ApplyTask:
    task = ApplyTask(kind=TASK_KIND_APPLY, status="completed", config={})
    db_session.add(task)
    db_session.commit()
    return task


def _track(db_session, job: Job, status: str) -> ApplicationTrack:
    track = ApplicationTrack(
        company=job.company,
        title=job.title,
        company_key=normalize_key(job.company),
        title_key=normalize_key(job.title),
        status=status,
        job_id=job.id,
    )
    db_session.add(track)
    db_session.commit()
    return track


def test_same_company_counts_queue_items_and_records(db_session):
    """同司多投：队列 2 条 + 已投 1 条 = 3，两个分量各自独立计数。"""
    target = _job(db_session, title="后端开发", company="字节跳动")
    # 尾随空格：normalize_key 归一后与「字节跳动」是同一家（与 analytics 同一套键）。
    sibling = _job(db_session, title="数据开发", company="字节跳动 ")
    other = _job(db_session, title="后端开发", company="B公司")
    item = _queue(db_session, target, order=3)
    _queue(db_session, sibling, order=2)
    _queue(db_session, other, order=1)
    task = _task(db_session)
    _record(db_session, task, sibling)
    _record(db_session, task, other, status=ITEM_STATUS_FAILED)

    report = inspect_queue_item(db_session, item.id)

    assert report.same_company.in_queue == 2
    assert report.same_company.applied == 1
    assert report.same_company.count == 3


def test_history_splits_success_failure_and_no_reply(db_session):
    """历史结果：成功 2 / 失败 1 / 无回音 1（进面试的那条不算无回音）。"""
    company = "C公司"
    interviewed = _job(db_session, title="后端开发", company=company)
    silent = _job(db_session, title="数据开发", company=company)
    failed_job = _job(db_session, title="运维", company=company)
    item = _queue(db_session, interviewed)
    task = _task(db_session)
    _record(db_session, task, interviewed)
    _record(db_session, task, silent)
    _record(db_session, task, failed_job, status=ITEM_STATUS_FAILED)
    _track(db_session, interviewed, STATUS_INTERVIEW)

    report = inspect_queue_item(db_session, item.id)

    assert report.history.applied == 3
    assert report.history.succeeded == 2
    assert report.history.failed == 1
    assert report.history.no_reply == 1  # silent 那条：没有进度 = 没回音


def test_history_no_progress_record_counts_as_no_reply(db_session):
    """投成功但完全没有进度记录 = 没回音（系统里没有任何后续，正是"没回音"的样子）。"""
    job = _job(db_session, company="D公司")
    item = _queue(db_session, job)
    _record(db_session, _task(db_session), job)

    report = inspect_queue_item(db_session, item.id)

    assert report.history.succeeded == 1
    assert report.history.no_reply == 1


def test_history_screening_still_counts_as_no_reply(db_session):
    """停在「已投递」也算没回音：只有 rank ≥ 面试才算有回音。"""
    job = _job(db_session, company="E公司")
    item = _queue(db_session, job)
    _record(db_session, _task(db_session), job)
    _track(db_session, job, STATUS_APPLIED)

    assert inspect_queue_item(db_session, item.id).history.no_reply == 1


# ===== 端点契约 =====


def test_inspect_endpoint_returns_agreed_shape(client, db_session):
    """GET /api/apply/queue/{id}/inspect 的字段名与取值方向（前端按这些名字取值）。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 8)
    item = _queue(db_session, job)

    response = client.get(f"/api/apply/queue/{item.id}/inspect")

    assert response.status_code == 200
    body = response.json()
    assert body["queue_id"] == item.id
    assert set(body) == {"queue_id", "salary", "same_company", "history"}
    assert set(body["salary"]) == {
        "status",
        "sample",
        "median",
        "target",
        "delta_percent",
        "direction",
    }
    assert set(body["same_company"]) == {"count", "in_queue", "applied"}
    assert set(body["history"]) == {"applied", "succeeded", "failed", "no_reply"}
    assert body["salary"]["status"] == "ok"
    assert body["salary"]["direction"] == "high"


def test_inspect_endpoint_insufficient_has_no_percentage(client, db_session):
    """样本不足时端点返回的 salary 里**没有任何百分比**（全是 null）。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 3)
    item = _queue(db_session, job)

    body = client.get(f"/api/apply/queue/{item.id}/inspect").json()

    assert body["salary"] == {
        "status": "insufficient",
        "sample": 3,
        "median": None,
        "target": 30000,
        "delta_percent": None,
        "direction": None,
    }


def test_inspect_endpoint_404_for_missing_queue_item(client):
    """队列条目不存在 → 404（不返回一份"什么都算不出来"的空报告）。"""
    response = client.get("/api/apply/queue/999999/inspect")

    assert response.status_code == 404
    assert "不存在" in response.json()["detail"]


def test_inspect_queue_item_is_read_only(db_session):
    """体检只读：跑两次，岗位/队列/记录行数都不变。"""
    job = _job(db_session, salary="25-35K")
    _salary_pool(db_session, 8)
    item = _queue(db_session, job)
    before = (
        db_session.query(Job).count(),
        db_session.query(ApplyQueueItem).count(),
        db_session.query(ApplyTaskItem).count(),
    )

    inspect_queue_item(db_session, item.id)
    inspect_queue_item(db_session, item.id)
    after = (
        db_session.query(Job).count(),
        db_session.query(ApplyQueueItem).count(),
        db_session.query(ApplyTaskItem).count(),
    )

    assert isinstance(inspect_queue_item(db_session, item.id), ApplyJobInspectOut)
    assert before == after
