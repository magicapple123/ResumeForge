# SPDX-License-Identifier: Apache-2.0
"""0066：模拟面试的**信息边界**——面试官只读「关联简历 + 关联岗位」。

真实面试里面试官手里只有候选人提交的那份简历 + 他招聘的岗位 JD，越界的信息（个人资料、
学校排名、前公司内部数据）本来就不该看到。所以这里钉住四件事：

1. ``_resume_text`` 只读**这场面试关联的那份简历**，个人资料一个字都不进去；
2. 喂给模型的 payload 只有四块（简历 / 岗位 / 进度 / 对话），没有"个人资料"；
3. 开场接口缺 ``job_id`` / ``resume_id`` → 422；指向不存在或已软删的记录 → 404；
4. 关联简历的候选范围（本岗位 + 通用）由 ``/api/resumes?include_general=true`` 提供，
   见 ``test_resumes_list_include_general.py``。

（自 ``test_interview.py`` 拆出：那个文件已到 500 行预算，而这一组用例是同一个契约。）
"""

from __future__ import annotations

import json

import pytest
from app.models.interview import InterviewSession
from app.models.job import Job
from app.schemas.interview import InterviewCreate
from app.services.interview.interview import build_interview_messages
from tests.interview_target_support import targets
from tests.test_interview import _configure, _configure_provider, _session, _turn_jsons


def test_resume_text_reads_only_the_linked_resume(client, db_session, monkeypatch):
    """面试官的材料只有「关联简历 + 关联岗位」：个人资料一个字都不该进去。

    这条刻意**不**打桩 ``_ask_next_question``——它覆盖的正是读取那段代码，
    打桩等于把要测的东西删掉。
    """
    from app.api.interview import _resume_text
    from app.database import SessionLocal

    _configure_provider(monkeypatch, _turn_jsons(3))
    # 个人资料里写一个明显不同的名字：它绝不能出现在面试官看到的材料里。
    client.put(
        "/api/profile",
        json={"name": "资料里的名字", "phone": "13800000000", "city": "上海"},
    )
    created = client.post("/api/interview", json=targets(db_session))
    assert created.status_code == 201, created.text
    assert created.json()["resume_title"] == "后端版简历"

    with SessionLocal() as db:
        row = db.get(InterviewSession, created.json()["id"])
        text = _resume_text(db, row)
    assert "高并发订单系统" in text
    assert "资料里的名字" not in text


def test_messages_have_no_profile_section():
    """payload 里只有简历与岗位两块：多喂资料会让面试官问出两份材料之外的东西。"""
    messages = build_interview_messages(
        _session(), index=1, resume_text="简历正文", job_text="岗位 JD"
    )
    user = messages[1]["content"]
    raw = user.split("<INTERVIEW_DATA>\n", 1)[1].split("\n</INTERVIEW_DATA>", 1)[0]
    data = json.loads(raw)
    assert set(data) == {
        "候选人的简历",
        "目标岗位的招聘信息",
        "面试进度",
        "此前的对话",
    }


# ===== 关联岗位 + 关联简历必填（0066）=====


def test_create_requires_job_and_resume(client, db_session, monkeypatch):
    """两项都必填：少一项就是 422，而不是开一场"看不到材料"的面试。"""
    from pydantic import ValidationError

    prepared = targets(db_session)
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])

    missing_resume = client.post("/api/interview", json={"job_id": prepared["job_id"]})
    assert missing_resume.status_code == 422
    missing_job = client.post("/api/interview", json={"resume_id": prepared["resume_id"]})
    assert missing_job.status_code == 422
    with pytest.raises(ValidationError):
        InterviewCreate()
    # 两项齐备才是合法请求。
    assert InterviewCreate(**prepared).resume_id == prepared["resume_id"]


def test_create_rejects_deleted_job_or_resume(client, db_session, monkeypatch):
    """指向不存在的岗位/简历：404 + 可读原因，别让它开出一场空面试。"""
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    prepared = targets(db_session)

    missing_resume = client.post(
        "/api/interview", json={"job_id": prepared["job_id"], "resume_id": 999_999}
    )
    assert missing_resume.status_code == 404
    assert "简历" in missing_resume.json()["detail"]

    missing_job = client.post(
        "/api/interview", json={"job_id": 999_999, "resume_id": prepared["resume_id"]}
    )
    assert missing_job.status_code == 404
    assert "岗位" in missing_job.json()["detail"]


def test_create_rejects_soft_deleted_job(client, db_session, monkeypatch):
    """回收站里的岗位同样不可用：列表里看不到的东西不该还能开面试。"""
    from app.database import SessionLocal
    from app.models.profile import utcnow

    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    prepared = targets(db_session)

    with SessionLocal() as db:
        job = db.get(Job, prepared["job_id"])
        job.deleted_at = utcnow()
        db.commit()

    soft_deleted = client.post("/api/interview", json=prepared)
    assert soft_deleted.status_code == 404
    assert "岗位" in soft_deleted.json()["detail"]


def test_start_interview_snapshots_job_and_resume(client, db_session, monkeypatch):
    """开场把岗位/简历**快照**进会话：之后简历被删，历史记录仍说得清面的是哪份。"""
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    prepared = targets(db_session)

    created = client.post("/api/interview", json={**prepared, "rounds": 3})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["job_id"] == prepared["job_id"]
    assert body["resume_id"] == prepared["resume_id"]
    assert body["resume_title"] == "后端版简历"
    assert body["job_title"] == "后端开发工程师"
    assert body["company"] == "示例公司"
