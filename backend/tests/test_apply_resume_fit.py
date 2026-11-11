# SPDX-License-Identifier: Apache-2.0
"""15D 简历指派：``Job.keywords`` × 简历文本的**关键词覆盖率** + 贪心分配。

钉住的是四件事：

1. **覆盖率算法**：命中标签数 / 标签总数，0–100 整数；岗位没有关键词时分母为 0 →
   ``null`` + ``reason="岗位没有关键词"``，**不假装 0%**。
2. **贪心不超过 K**：一份简历最多服务 ``RESUME_CAP=6`` 条，超出的条目不会被硬塞。
3. **没有收益就不推荐**：``current == recommended`` 时 ``gain=0``。
4. **命名**：字段叫 ``*_coverage``（关键词覆盖），不叫匹配度/参考分。
"""

from __future__ import annotations

from app.models.apply import QUEUE_STATUS_PENDING, ApplyQueueItem
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.resume import ResumeRecord
from app.services.apply.resume_fit import (
    NO_KEYWORDS_REASON,
    RESUME_CAP,
    coverage_percent,
    keyword_names,
    resume_fit,
    resume_text,
)


def _job(db_session, *, keywords: list[dict] | None = None, title: str = "后端开发") -> Job:
    job = Job(
        title=title,
        company="A公司",
        location="北京",
        salary="20-30K",
        status=JOB_STATUS_OPEN,
        keywords=keywords if keywords is not None else [{"name": "Python", "category": "语言"}],
    )
    db_session.add(job)
    db_session.commit()
    return job


def _resume(db_session, content: dict, *, title: str = "简历", draft: bool = False):
    record = ResumeRecord(title=title, content=content, draft=draft)
    db_session.add(record)
    db_session.commit()
    return record


def _queue(db_session, job: Job, *, resume_id: int | None = None, order: int = 1):
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


# ===== 覆盖率算法 =====


def test_coverage_counts_hit_tags_over_total_tags():
    """命中 2 个标签 / 共 4 个 = 50%。"""
    names = ["Python", "Django", "Redis", "MySQL"]
    text = "熟悉 python 与 django 开发".casefold()

    assert coverage_percent(names, text) == 50


def test_coverage_is_none_when_no_keywords():
    """岗位没有关键词：分母为 0，返回 None（不给百分比）。"""
    assert coverage_percent([], "任意文本") is None


def test_coverage_is_case_insensitive():
    names = ["Python"]
    assert coverage_percent(names, resume_text({"skills": "PYTHON"})) == 100


def test_keyword_names_dedupes_and_keeps_order():
    """同一标签重复出现不能让分母虚增（否则覆盖率被凭空压低）。"""
    names = keyword_names(
        [{"name": "Python"}, {"name": "python"}, {"name": "Redis"}, {"name": "  "}]
    )

    assert names == ["Python", "Redis"]


def test_keyword_names_accepts_plain_strings():
    """历史数据里 keywords 也可能直接是字符串数组。"""
    assert keyword_names(["Python", "Redis"]) == ["Python", "Redis"]


def test_resume_text_flattens_string_leaves_only():
    """只收字符串叶子，不收 JSON 的键：否则「skills」这种键名会让标签无条件命中。"""
    text = resume_text(
        {
            "name": "张三",
            "skills": ["Python", "Redis"],
            "experience": [{"company": "A公司", "detail": "做过订单系统"}],
            "years": 3,
        }
    )

    assert "张三" in text
    assert "python" in text
    assert "redis" in text
    assert "做过订单系统" in text
    # 键名不进文本。
    assert "skills" not in text
    assert "experience" not in text


# ===== 指派：覆盖率与 reason =====


def test_resume_fit_reports_current_and_recommended_coverage(db_session):
    """当前简历覆盖 0%，另一份覆盖 100% → 推荐换，gain=100。"""
    job = _job(db_session, keywords=[{"name": "Python"}, {"name": "Redis"}])
    weak = _resume(db_session, {"summary": "三年后端经验"}, title="通用版")
    strong = _resume(db_session, {"skills": "Python / Redis / MySQL"}, title="后端版")
    item = _queue(db_session, job, resume_id=weak.id)

    result = resume_fit(db_session, [item.id])

    assert len(result.items) == 1
    entry = result.items[0]
    assert entry.queue_id == item.id
    assert entry.job_id == job.id
    assert entry.current_resume_id == weak.id
    assert entry.current_coverage == 0
    assert entry.recommended_resume_id == strong.id
    assert entry.recommended_coverage == 100
    assert entry.gain == 100
    assert "关键词覆盖" in entry.reason
    assert "0% → 100%" in entry.reason


def test_resume_fit_no_keywords_reports_null_coverage(db_session):
    """岗位没有关键词：coverage 全 null、gain=0，reason 逐字是「岗位没有关键词」。"""
    job = _job(db_session, keywords=[])
    resume = _resume(db_session, {"skills": "Python"})
    item = _queue(db_session, job, resume_id=resume.id)

    entry = resume_fit(db_session, [item.id]).items[0]

    assert entry.current_coverage is None
    assert entry.recommended_coverage is None
    assert entry.recommended_resume_id is None
    assert entry.gain == 0
    assert entry.reason == NO_KEYWORDS_REASON


def test_resume_fit_keeps_current_when_already_best(db_session):
    """当前简历已是最优 → 不推荐换，gain=0（不给用户制造无意义的改动）。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    best = _resume(db_session, {"skills": "Python"}, title="后端版")
    _resume(db_session, {"summary": "通用"}, title="通用版")
    item = _queue(db_session, job, resume_id=best.id)

    entry = resume_fit(db_session, [item.id]).items[0]

    assert entry.current_coverage == 100
    assert entry.recommended_resume_id == best.id
    assert entry.recommended_coverage == 100
    assert entry.gain == 0
    assert "不必更换" in entry.reason


def test_resume_fit_without_current_resume_recommends_best(db_session):
    """队列没指定简历：current_coverage=None，推荐覆盖最高的那份，gain 按 0 起算。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    strong = _resume(db_session, {"skills": "Python"}, title="后端版")
    item = _queue(db_session, job, resume_id=None)

    entry = resume_fit(db_session, [item.id]).items[0]

    assert entry.current_resume_id is None
    assert entry.current_coverage is None
    assert entry.recommended_resume_id == strong.id
    assert entry.recommended_coverage == 100
    assert entry.gain == 100
    assert "未指定简历" in entry.reason


def test_resume_fit_ignores_draft_resumes(db_session):
    """草稿简历不参与指派：用户还没认可的内容不能当"该用这份"的建议。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    saved = _resume(db_session, {"summary": "通用"}, title="已保存版")
    _resume(db_session, {"skills": "Python"}, title="草稿版", draft=True)
    item = _queue(db_session, job, resume_id=saved.id)

    entry = resume_fit(db_session, [item.id]).items[0]

    assert entry.recommended_resume_id == saved.id
    assert entry.recommended_coverage == 0
    assert entry.gain == 0


def test_resume_fit_without_any_resume_points_at_saving_one(db_session):
    """一份可用简历都没有：reason 说"还没有简历"，不要拿"已达上限"误导用户。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    _resume(db_session, {"skills": "Python"}, title="草稿版", draft=True)
    item = _queue(db_session, job, resume_id=None)

    entry = resume_fit(db_session, [item.id]).items[0]

    assert entry.recommended_resume_id is None
    assert entry.recommended_coverage is None
    assert entry.gain == 0
    assert "还没有可用的已保存简历" in entry.reason


# ===== 贪心：每份简历最多服务 K 条 =====


def test_resume_fit_caps_each_resume_at_k(db_session):
    """7 条岗位抢 1 份 100% 的简历：只有 6 条拿到它，第 7 条留在原地（不硬塞）。

    一条队列条目对应一个岗位（``apply_queue_item.job_id`` 唯一），所以这里造 7 个岗位。
    """
    weak = _resume(db_session, {"summary": "通用"}, title="通用版")
    strong = _resume(db_session, {"skills": "Python"}, title="后端版")
    items = []
    for index in range(7):
        job = _job(db_session, keywords=[{"name": "Python"}], title=f"后端开发{index}")
        items.append(_queue(db_session, job, resume_id=weak.id, order=index + 1))

    result = resume_fit(db_session, [item.id for item in items])

    assigned = [entry.recommended_resume_id for entry in result.items]
    assert len(assigned) == 7
    assert assigned.count(strong.id) == RESUME_CAP
    assert assigned.count(weak.id) == 7 - RESUME_CAP
    # 没拿到强简历的那条：不动（gain=0），不是被硬塞了一份超额推荐。
    leftover = [entry for entry in result.items if entry.recommended_resume_id == weak.id]
    assert all(entry.gain == 0 for entry in leftover)


def test_resume_fit_spreads_items_across_resumes(db_session):
    """贪心的目的：别 20 条全推同一份——两份简历各擅长一半，就各拿一半。"""
    python_job = _job(db_session, keywords=[{"name": "Python"}], title="后端开发")
    design_job = _job(db_session, keywords=[{"name": "Figma"}], title="视觉设计")
    backend = _resume(db_session, {"skills": "Python"}, title="后端版")
    designer = _resume(db_session, {"skills": "Figma"}, title="设计版")
    backend_item = _queue(db_session, python_job, resume_id=None, order=2)
    design_item = _queue(db_session, design_job, resume_id=None, order=1)

    result = resume_fit(db_session, [backend_item.id, design_item.id])

    by_queue = {entry.queue_id: entry for entry in result.items}
    assert by_queue[backend_item.id].recommended_resume_id == backend.id
    assert by_queue[design_item.id].recommended_resume_id == designer.id


# ===== 端点契约 =====


def test_resume_fit_endpoint_returns_agreed_shape(client, db_session):
    """GET /api/apply/queue/resume-fit?ids=… 的字段名（前端按这些名字取值）。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    other_job = _job(db_session, keywords=[{"name": "Python"}], title="服务端开发")
    weak = _resume(db_session, {"summary": "通用"})
    _resume(db_session, {"skills": "Python"}, title="后端版")
    first = _queue(db_session, job, resume_id=weak.id, order=2)
    second = _queue(db_session, other_job, resume_id=weak.id, order=1)

    response = client.get(f"/api/apply/queue/resume-fit?ids={first.id},{second.id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items"}
    assert len(body["items"]) == 2
    assert set(body["items"][0]) == {
        "queue_id",
        "job_id",
        "current_resume_id",
        "current_coverage",
        "recommended_resume_id",
        "recommended_coverage",
        "gain",
        "reason",
    }
    assert {item["queue_id"] for item in body["items"]} == {first.id, second.id}


def test_resume_fit_endpoint_without_ids_covers_whole_queue(client, db_session):
    """``ids`` 省略 = 整个队列。"""
    job = _job(db_session, keywords=[{"name": "Python"}])
    _resume(db_session, {"skills": "Python"})
    _queue(db_session, job, order=1)

    body = client.get("/api/apply/queue/resume-fit").json()

    assert len(body["items"]) == 1


def test_resume_fit_endpoint_rejects_malformed_ids(client):
    """``ids=1,abc`` 明确 422——静默只算第一条会让用户以为三条都算过了。"""
    response = client.get("/api/apply/queue/resume-fit?ids=1,abc")

    assert response.status_code == 422
    assert "ids" in response.json()["detail"]


def test_resume_fit_endpoint_rejects_non_positive_id(client):
    """id 必须是正整数。"""
    response = client.get("/api/apply/queue/resume-fit?ids=0")

    assert response.status_code == 422
