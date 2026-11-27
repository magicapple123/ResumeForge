# SPDX-License-Identifier: Apache-2.0
"""岗位匹配的**文本级**口径（T34）：用外部简历的正文对 JD，单独口径、单独端点。

钉六件事（对应 T34 的三条验收 + 三条"不许静默失败"）：

1. **只吃正文**：命中判断只看 `external_resume.text`，与「我的资料」无关——清空资料不影响结果；
2. **别名双向**：`Postgres` 与 `PostgreSQL` 算同一个词（复用 ATS 那份别名表）；
3. **计数自洽**：`matched_count + len(missing_words) == target_count`，界面据此画覆盖条；
4. **不落库**：调完端点后 `job_match_analysis` 仍然是空的——文本级不该覆盖结构化结论；
5. **扫描件不静默**：没有正文的外部简历返回 400 + 中文原因（不是"匹配度 0"）；
6. **岗位没有 JD** 同样 400。顺带锁住"限流之外的边界"：简历被删 / 岗位不存在。
"""

from datetime import datetime

from app.models.external_resume import ExternalResume
from app.models.job import Job
from app.models.user_file import UserFile

#: 造数据用的固定旧时刻：任何"被刷新成现在"的写入都会让它变掉，断言因此不会飘。
_OLD = datetime(2024, 1, 1, 8, 0, 0)

_JD = {
    "title": "后端开发工程师",
    "company": "示例公司",
    "description": "负责后端服务开发，熟悉 Python 与 PostgreSQL，了解 Redis 缓存。",
    "requirements": "3 年以上后端经验；熟悉 FastAPI；具备 Kubernetes 实践经验。",
}

#: 正文里刻意用 `Postgres`（别名）而不是 `PostgreSQL`：验证别名双向计入。
_RESUME_TEXT = (
    "个人简介\n"
    "五年 Python 后端开发经验，主力框架 FastAPI。\n"
    "使用 Postgres 做订单库，Redis 做缓存层。\n"
    "带过三人小组，做过压测与容量规划。\n"
)


def _user_file(db_session, name: str) -> UserFile:
    row = UserFile(
        sha256=(name.encode("utf-8").hex() + "0" * 64)[:64],
        disk_name=f"{name}.bin",
        original_name=name,
        mime="application/pdf",
        source_type="external_resume",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _external(db_session, *, name: str, text: str) -> ExternalResume:
    file_row = _user_file(db_session, name)
    record = ExternalResume(
        file_id=file_row.id,
        original_file_id=file_row.id,
        name=name,
        text=text,
        text_chars=len(text),
        created_at=_OLD,
        updated_at=_OLD,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _job(db_session, **overrides) -> Job:
    payload = {**_JD, **overrides}
    job = Job(**payload)
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _run(client, job: Job, resume: ExternalResume):
    return client.post(
        f"/api/jobs/{job.id}/match-analysis-text-level",
        json={"external_resume_id": resume.id},
    )


def test_text_level_matches_jd_words_in_resume_text(client, db_session):
    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)

    response = _run(client, job, resume)
    assert response.status_code == 200, response.text
    body = response.json()

    # 口径标识必须存在：前端靠它显示「文本级」，不靠"用户刚点了哪个按钮"。
    assert body["method"] == "text_level"
    assert body["external_resume_id"] == resume.id
    assert body["resume_name"] == "cv.txt"
    assert body["text_chars"] == len(_RESUME_TEXT)
    # 别名双向：正文写 Postgres，JD 写 PostgreSQL。
    assert any(word.lower() == "postgresql" for word in body["matched_words"])
    assert "python" in [word.lower() for word in body["matched_words"]]
    # 结构化的四类结论**一个都不该出现**：本口径不产出准入判断。
    for forbidden in ("admission", "hard_gate", "hard_conditions", "core_abilities", "advice"):
        assert forbidden not in body


def test_text_level_counts_are_self_consistent_and_core_first(client, db_session):
    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    body = _run(client, job, resume).json()

    assert body["target_count"] == len(body["target_words"])
    assert body["matched_count"] == len(body["matched_words"])
    assert body["target_count"] == body["matched_count"] + len(body["missing_words"])
    # 核心词排在目标词表前面：读的人先看到硬要求。
    assert body["target_words"][: len(body["core_target"])] == body["core_target"]
    # 每个缺失词都不在命中清单里（小写口径比较）。
    matched_keys = {word.lower() for word in body["matched_words"]}
    assert not [word for word in body["missing_words"] if word.lower() in matched_keys]


def test_text_level_highlights_quote_the_resume_verbatim(client, db_session):
    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    body = _run(client, job, resume).json()

    assert body["highlights"], "命中词存在时必须给出正文摘录"
    for highlight in body["highlights"]:
        # 摘录必须是正文原句的子串：不许改写、不许摘要。
        assert highlight["text"] in _RESUME_TEXT
        assert highlight["words"], "摘录必须带上它命中的词"


def test_text_level_ignores_profile_and_internal_resume(client, db_session):
    """口径独立：资料清空 + 没有任何内部简历时，文本级照样给出结果。"""
    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    first = _run(client, job, resume).json()
    assert client.get("/api/resumes").json()["total"] == 0
    assert client.get("/api/profile").status_code == 200
    second = _run(client, job, resume).json()
    assert first["matched_words"] == second["matched_words"]
    assert first["target_words"] == second["target_words"]


def test_text_level_does_not_persist_a_structured_match(client, db_session):
    """不落库：文本级不能覆盖 / 污染结构化匹配的历史结论。"""
    from app.services.apply import apply_service

    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    assert _run(client, job, resume).status_code == 200
    assert apply_service.latest_match(db_session, job.id) is None


def test_text_level_missing_text_returns_actionable_error(client, db_session):
    """扫描件：必须说清"为什么不行 + 怎么办"，不许返回一个像 0 分的结果。"""
    job = _job(db_session)
    scanned = _external(db_session, name="scan.pdf", text="")

    response = _run(client, job, scanned)
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "正文" in detail
    assert "文本检查" in detail


def test_text_level_job_without_jd_returns_error(client, db_session):
    job = _job(db_session, description="", requirements="", additional_info="", company="")
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    response = _run(client, job, resume)
    assert response.status_code == 400
    assert "JD" in response.json()["detail"] or "正文" in response.json()["detail"]


def test_text_level_missing_resume_or_job_is_reported(client, db_session):
    job = _job(db_session)
    resume = _external(db_session, name="cv.txt", text=_RESUME_TEXT)
    missing = client.post(
        f"/api/jobs/{job.id}/match-analysis-text-level",
        json={"external_resume_id": resume.id + 999},
    )
    assert missing.status_code == 400
    assert "不存在" in missing.json()["detail"]
    assert (
        client.post(
            "/api/jobs/999999/match-analysis-text-level",
            json={"external_resume_id": resume.id},
        ).status_code
        == 404
    )
