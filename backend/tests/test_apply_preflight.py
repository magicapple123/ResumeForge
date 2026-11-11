# SPDX-License-Identifier: Apache-2.0
"""投递前体检（14A）：五条规则各一例 + 组合 + 空队列。

规则表（``services/apply/preflight.py``）：

==========================  ==========  ==================================================
code                        严重度       判据
==========================  ==========  ==================================================
``source_unsupported``      blocking    来源落不到已注册站点
``resume_missing``          blocking    没简历 / 简历正文为空
``match_missing``           warning     读不出可用准入结论（未分析）
``match_weak``              warning     参考分 < 60
``greeting_weak``           warning     招呼语为空 / < 15 字 / 与上一条完全相同
``ghost_job``               warning     僵尸分 **>70** 且岗位未被忽略（15A，见
                                        ``tests/test_apply_ghost.py``）
==========================  ==========  ==================================================

**这套体检不是第二套准入**：它只回答"这一条现在投出去会不会白投"，且全程只读。
"""

from __future__ import annotations

from app.models.apply import (
    QUEUE_STATUS_PENDING,
    ApplyQueueItem,
    JobMatchAnalysis,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.resume import ResumeRecord
from app.schemas.job_match import JobMatchResult, MatchCondition
from app.services.apply import apply_service
from app.services.apply.preflight import preflight as run_preflight
from app.services.apply.signals import reference_score
from app.services.job.job_match import finalize_match_result

# 一条"够长"的招呼语（≥15 字），用来把 greeting_weak 隔离掉。
GOOD_GREETING = "您好，我有三年 Python 后端经验，做过高并发订单系统，想聊聊这个岗位。"


def _job(db_session, **overrides) -> Job:
    """默认是"采集进来的 BOSS 岗位"（投递台支持的那一类）。"""
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


def _manual_job(db_session, **overrides) -> Job:
    """手动录入、来源与链接都指不到任何站点——投不出去。"""
    data = {"title": "朋友介绍的岗位", "source": "手动添加", "source_url": ""}
    data.update(overrides)
    return _job(db_session, **data)


def _resume(db_session, job: Job, *, content: dict | None = None) -> ResumeRecord:
    record = ResumeRecord(
        title=f"{job.title}-投递版",
        job_title=job.title,
        job_id=job.id,
        content={"name": "张三", "summary": "三年后端"} if content is None else content,
    )
    db_session.add(record)
    db_session.commit()
    return record


def _queue_item(db_session, job: Job, *, order: int = 1, **overrides) -> ApplyQueueItem:
    data = {
        "job_id": job.id,
        "job_title": job.title,
        "company": job.company,
        "sort_order": order,
        "status": QUEUE_STATUS_PENDING,
        "greeting": GOOD_GREETING,
    }
    data.update(overrides)
    item = ApplyQueueItem(**data)
    db_session.add(item)
    db_session.commit()
    return item


def _gap_match(db_session, job: Job) -> None:
    """真实缺口 → 准入 block，参考分 22（低于 60），用来触发 match_weak。"""
    result = finalize_match_result(
        JobMatchResult(
            hard_conditions=[
                MatchCondition(label="硕士及以上", status="real_gap", evidence="资料中未提供")
            ]
        )
    )
    apply_service.persist_match(db_session, db_session.get(Job, job.id), result)


def _codes(issues) -> list[str]:
    return [issue.code for issue in issues]


def _codes_without_match(issues) -> list[str]:
    """去掉 match_* 之后的码序。

    ``match_weak`` 几乎总会跟着出现（一条"未分析/有真实缺口"的岗位参考分必然低），
    所以非 match 规则的用例只看自己那一类；match 两条由各自的用例单独断言。
    """
    return [issue.code for issue in issues if not issue.code.startswith("match_")]


# ===== ① source_unsupported（blocking）=====


def test_unsupported_source_is_blocking_and_says_to_remove(db_session):
    job = _manual_job(db_session)
    item = _queue_item(db_session, job)

    result = run_preflight(db_session)

    assert [entry.queue_id for entry in result.items] == [item.id]
    issue = result.items[0].issues[0]
    assert issue.code == "source_unsupported"
    assert issue.severity == "blocking"
    assert "移出队列" in issue.fix
    assert result.summary.blocking == 1


# ===== ② resume_missing（blocking）=====


def test_missing_resume_is_blocking(db_session):
    job = _job(db_session)
    _gap_match(db_session, job)  # 准入结论非空，隔离掉 match_missing
    _queue_item(db_session, job)

    result = run_preflight(db_session)

    assert _codes_without_match(result.items[0].issues) == ["resume_missing"]
    assert result.items[0].issues[0].code == "resume_missing"
    assert result.items[0].issues[0].severity == "blocking"
    assert result.summary.blocking == 1


def test_blank_resume_body_is_treated_as_missing(db_session):
    """有简历行但正文为空，等于没简历——投递会在填写阶段被跳过。"""
    job = _job(db_session)
    _gap_match(db_session, job)
    resume = _resume(db_session, job, content={})
    _queue_item(db_session, job, resume_id=resume.id)

    result = run_preflight(db_session)

    assert _codes_without_match(result.items[0].issues) == ["resume_missing"]


def test_present_resume_does_not_raise_issue(db_session):
    job = _job(db_session)
    _gap_match(db_session, job)
    resume = _resume(db_session, job)
    _queue_item(db_session, job, resume_id=resume.id)

    result = run_preflight(db_session)

    # 只剩参考分偏低那一条（不是简历问题）。
    assert _codes(result.items[0].issues) == ["match_weak"]


# ===== ③ match_missing（warning）=====


def test_unanalyzed_job_is_a_warning(db_session):
    job = _job(db_session)
    resume = _resume(db_session, job)
    # 直接落一条"读不出可用结论"的脏行：admission 缺失 → 体检判"未分析"。
    db_session.add(
        JobMatchAnalysis(job_id=job.id, result={}, hard_gate="unknown", requires_confirm=False)
    )
    db_session.commit()
    _queue_item(db_session, job, resume_id=resume.id)

    result = run_preflight(db_session)

    assert _codes(result.items[0].issues) == ["match_missing"]
    assert result.items[0].issues[0].severity == "warning"
    assert result.summary.blocking == 0
    assert result.summary.warnings == 1


# ===== ④ match_weak（warning）=====


def test_weak_reference_score_is_a_warning_with_the_number(db_session):
    job = _job(db_session)
    resume = _resume(db_session, job)
    _gap_match(db_session, job)
    _queue_item(db_session, job, resume_id=resume.id)

    result = run_preflight(db_session)

    issue = result.items[0].issues[0]
    assert issue.code == "match_weak"
    assert issue.severity == "warning"
    # 分数要出现在文案里：只说"偏低"用户不知道差多少。数值必须与队列列上的参考分同源
    # （14A 与 14B 共用 ``signals.reference_score``），所以这里按算出来的分比对，不写死。
    score = reference_score(db_session, job)
    assert score is not None and score < 60
    assert f"参考分只有 {score} 分" in issue.message
    assert "仍要投" in issue.fix


# ===== ⑤ greeting_weak（warning，三种形态）=====


def test_empty_greeting_is_a_warning(db_session):
    job = _job(db_session)
    resume = _resume(db_session, job)
    _gap_match(db_session, job)
    _queue_item(db_session, job, resume_id=resume.id, greeting="   ")

    result = run_preflight(db_session)

    assert _codes_without_match(result.items[0].issues) == ["greeting_weak"]
    greeting_issue = next(item for item in result.items[0].issues if item.code == "greeting_weak")
    assert "没有自己的招呼语" in greeting_issue.message


def test_short_greeting_is_a_warning(db_session):
    job = _job(db_session)
    resume = _resume(db_session, job)
    _gap_match(db_session, job)
    _queue_item(db_session, job, resume_id=resume.id, greeting="你好，我想投这个岗位")

    result = run_preflight(db_session)

    assert _codes_without_match(result.items[0].issues) == ["greeting_weak"]
    greeting_issue = next(item for item in result.items[0].issues if item.code == "greeting_weak")
    assert "太短" in greeting_issue.message


def test_greeting_identical_to_the_previous_item_is_a_warning(db_session):
    """界面顺序里**排在后面**的那条被判重复（"上一条"= 它上面那条）。"""
    older_job = _job(db_session)
    newer_job = _job(db_session, title="后端开发（二）", source_url="https://www.zhipin.com/job/2")
    older_resume = _resume(db_session, older_job)
    newer_resume = _resume(db_session, newer_job)
    _gap_match(db_session, older_job)
    _gap_match(db_session, newer_job)
    older = _queue_item(db_session, older_job, order=1, resume_id=older_resume.id)
    newer = _queue_item(db_session, newer_job, order=2, resume_id=newer_resume.id)
    # sort_order 大的排在前面（与 list_queue 的界面顺序配对）：newer 在前，older 在后。

    result = run_preflight(db_session)

    by_id = {entry.queue_id: entry for entry in result.items}
    assert _codes(by_id[newer.id].issues) == ["match_weak"], "第一条没有上一条可比"
    assert _codes(by_id[older.id].issues) == ["match_weak", "greeting_weak"]
    assert "完全相同" in by_id[older.id].issues[1].message


def test_different_greeting_on_neighbour_is_fine(db_session):
    first_job = _job(db_session)
    second_job = _job(db_session, title="后端开发（二）", source_url="https://www.zhipin.com/job/3")
    first_resume = _resume(db_session, first_job)
    second_resume = _resume(db_session, second_job)
    _gap_match(db_session, first_job)
    _gap_match(db_session, second_job)
    _queue_item(db_session, first_job, order=1, resume_id=first_resume.id)
    second = _queue_item(
        db_session,
        second_job,
        order=2,
        resume_id=second_resume.id,
        greeting="您好，我做过支付对账系统，和贵司这个岗位的职责高度重合，想详细聊聊。",
    )

    result = run_preflight(db_session)

    by_id = {entry.queue_id: entry for entry in result.items}
    assert _codes(by_id[second.id].issues) == ["match_weak"]


# ===== 组合 + 计数口径 =====


def test_summary_counts_items_not_issues(db_session):
    """summary 是按**条目**计数：一条同时命中两条 warning 也只算 1 条。"""
    supported = _job(db_session)
    _gap_match(db_session, supported)  # match_weak，但没简历 → 变 blocking
    _queue_item(db_session, supported, greeting="你好")  # 同时 greeting_weak

    result = run_preflight(db_session)

    issues = _codes(result.items[0].issues)
    assert issues == ["resume_missing", "match_weak", "greeting_weak"]
    assert result.summary.blocking == 1
    assert result.summary.warnings == 1


def test_preflight_is_read_only(db_session):
    job = _job(db_session)
    item = _queue_item(db_session, job, greeting="你好")
    before = (item.status, item.greeting, item.updated_at)

    run_preflight(db_session)

    db_session.expire_all()
    stored = db_session.get(ApplyQueueItem, item.id)
    assert (stored.status, stored.greeting, stored.updated_at) == before
    # 队列条数也不变（体检绝不会顺手删掉"来源不支持"的那条）。
    assert db_session.query(ApplyQueueItem).count() == 1


def test_empty_queue_returns_empty_items_and_zero_summary(db_session):
    result = run_preflight(db_session)

    assert result.items == []
    assert result.summary.blocking == 0
    assert result.summary.warnings == 0


# ===== 端点契约 =====


def test_preflight_endpoint_returns_the_agreed_shape(client, db_session):
    job = _manual_job(db_session)
    item = _queue_item(db_session, job)

    response = client.post("/api/apply/queue/preflight", json={})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items", "summary"}
    assert body["items"][0]["queue_id"] == item.id
    assert set(body["items"][0]["issues"][0]) == {"code", "severity", "message", "fix"}
    assert set(body["summary"]) == {"blocking", "warnings"}


def test_preflight_endpoint_accepts_a_subset_of_queue_ids(client, db_session):
    first_job = _manual_job(db_session)
    second_job = _manual_job(db_session, title="另一个朋友的岗位")
    first = _queue_item(db_session, first_job, order=1)
    _queue_item(db_session, second_job, order=2)

    response = client.post("/api/apply/queue/preflight", json={"queue_ids": [first.id]})

    assert response.status_code == 200
    assert [entry["queue_id"] for entry in response.json()["items"]] == [first.id]
