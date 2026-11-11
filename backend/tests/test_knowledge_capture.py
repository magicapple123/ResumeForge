# SPDX-License-Identifier: Apache-2.0
"""#29B 知识回流：三个入口共用 create_from_source，服务端取源数据。

验收判据（工单任务 3）：
- 面试复盘 → 条目：公司/岗位/轮次/问题清单齐全，分类「面经」、来源「面试复盘」；
- 投递失败 → 条目：分类「求职策略」、正文带失败分类/诊断、来源「投递复盘」；
- 简历诊断 → 条目：分类「求职策略」、正文是诊断结论，来源「简历诊断」；
- 重复点击不产生重复条目（created=False），业务态不满足时 409；
- 既有知识库 CRUD 不退化（本文件不写库也能证明新端点只走同一 create_knowledge）。
"""

from __future__ import annotations

from app.models.apply import ApplyTask, ApplyTaskItem
from app.models.interview import (
    INTERVIEW_STATUS_ACTIVE,
    INTERVIEW_STATUS_FINISHED,
    InterviewMessage,
    InterviewSession,
)
from app.models.knowledge_entry import KnowledgeEntry
from app.models.profile import utcnow
from app.models.resume import ResumeRecord


def _interview(db_session, *, status: str = INTERVIEW_STATUS_FINISHED) -> InterviewSession:
    session = InterviewSession(
        title="后端一面",
        company="字节跳动",
        job_title="后端开发",
        interview_type="技术面",
        difficulty="中级",
        status=status,
        rounds=2,
        report={
            "score": 78,
            "summary": "基础扎实，项目细节需要更具体。",
            "strengths": ["表达清楚"],
            "improvements": ["补数据"],
        },
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    db_session.add_all(
        [
            InterviewMessage(
                session_id=session.id,
                role="interviewer",
                content="介绍一下你的项目",
                status="complete",
            ),
            InterviewMessage(
                session_id=session.id,
                role="user",
                content="我做过一个数据平台。",
                status="complete",
            ),
            InterviewMessage(
                session_id=session.id,
                role="interviewer",
                content="项目里最难的点是什么",
                status="complete",
            ),
        ]
    )
    db_session.commit()
    return session


def _apply_item(db_session, *, status: str = "failed") -> ApplyTaskItem:
    parent = ApplyTask(kind="apply", status="completed", total=1, config={})
    db_session.add(parent)
    db_session.flush()
    item = ApplyTaskItem(
        task_id=parent.id,
        job_title="后端开发",
        company="示例公司",
        status=status,
        failure_category="selector_invalid",
        failure_detail="没找到「立即沟通」按钮，页面结构可能变了",
        failure_step="send",
        failure_target="chat-button",
        failure_reason="selector",
        attempt=2,
        finished_at=utcnow(),
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


def _resume(db_session) -> ResumeRecord:
    record = ResumeRecord(
        title="后端简历",
        company="示例公司",
        content={"name": "张三", "summary": "精通后端开发"},
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_interview_report_becomes_knowledge_entry(client, db_session):
    session = _interview(db_session)

    response = client.post(
        "/api/knowledge/from-source",
        json={"source": "interview_report", "source_id": session.id},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["created"] is True
    assert body["category"] == "面经"
    assert body["source"] == "面试复盘"
    assert "字节跳动" in body["title"]
    detail = client.get(f"/api/knowledge/{body['id']}").json()
    assert detail["company"] == "字节跳动"
    assert detail["job_id"] == session.job_id
    assert "## 问答记录" in detail["content"]
    assert "## 问题清单" in detail["content"]
    assert "介绍一下你的项目" in detail["content"]
    assert detail["reason"]
    assert detail["summary"] == "基础扎实，项目细节需要更具体。"


def test_repeated_capture_is_idempotent(client, db_session):
    session = _interview(db_session)

    first = client.post(
        "/api/knowledge/from-source",
        json={"source": "interview_report", "source_id": session.id},
    ).json()
    second = client.post(
        "/api/knowledge/from-source",
        json={"source": "interview_report", "source_id": session.id},
    ).json()

    assert second["created"] is False
    assert second["id"] == first["id"]
    assert db_session.query(KnowledgeEntry).count() == 1


def test_active_interview_is_rejected(client, db_session):
    session = _interview(db_session, status=INTERVIEW_STATUS_ACTIVE)

    response = client.post(
        "/api/knowledge/from-source",
        json={"source": "interview_report", "source_id": session.id},
    )

    assert response.status_code == 409
    assert "结束" in response.json()["detail"]


def test_apply_failure_becomes_experience(client, db_session):
    item = _apply_item(db_session)

    response = client.post(
        "/api/knowledge/from-source",
        json={"source": "apply_failure", "source_id": item.id},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["category"] == "求职策略"
    assert body["source"] == "投递复盘"
    detail = client.get(f"/api/knowledge/{body['id']}").json()
    assert "selector_invalid" in detail["content"]
    assert "没找到「立即沟通」按钮" in detail["content"]
    assert detail["company"] == "示例公司"
    assert detail["job_id"] is None


def test_successful_apply_cannot_be_captured(client, db_session):
    item = _apply_item(db_session, status="success")

    response = client.post(
        "/api/knowledge/from-source",
        json={"source": "apply_failure", "source_id": item.id},
    )

    assert response.status_code == 409


def test_resume_diagnosis_becomes_experience(client, db_session):
    record = _resume(db_session)

    response = client.post(
        "/api/knowledge/from-source",
        json={"source": "resume_diagnosis", "source_id": record.id},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["created"] is True
    assert body["category"] == "求职策略"
    assert body["source"] == "简历诊断"
    assert body["title"].startswith("简历诊断")
    detail = client.get(f"/api/knowledge/{body['id']}").json()
    assert "命中风险点" in detail["content"]
    # F2（交叉复核 P3）：正文不写分钟级诊断时间，否则跨分钟重复点击会多一条。
    assert "诊断时间" not in detail["content"]
    assert detail["reason"]
    # 重复沉淀同一份简历 → 不新增。
    again = client.post(
        "/api/knowledge/from-source",
        json={"source": "resume_diagnosis", "source_id": record.id},
    ).json()
    assert again["created"] is False


def test_resume_diagnosis_dedupe_ignores_legacy_diagnosis_time_line(client, db_session):
    """F2：跨分钟重复点击不新建一条（含修复前写入的带诊断时间旧条目）。"""
    record = _resume(db_session)
    first = client.post(
        "/api/knowledge/from-source",
        json={"source": "resume_diagnosis", "source_id": record.id},
    ).json()
    assert first["created"] is True

    # 模拟"修复前沉淀的条目"：正文里带一行分钟级诊断时间（不同分钟）。
    entry = db_session.get(KnowledgeEntry, first["id"])
    entry.content = entry.content.replace(
        "- 命中风险点", "- 诊断时间：2099-01-01 00:00\n- 命中风险点", 1
    )
    db_session.commit()

    again = client.post(
        "/api/knowledge/from-source",
        json={"source": "resume_diagnosis", "source_id": record.id},
    ).json()

    assert again["created"] is False, "跨分钟/旧格式的时间行不应让它变成一条新条目"
    assert again["id"] == first["id"]
    assert db_session.query(KnowledgeEntry).count() == 1


def test_missing_sources_are_404_and_unknown_source_422(client):
    assert (
        client.post(
            "/api/knowledge/from-source",
            json={"source": "interview_report", "source_id": 999999},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/knowledge/from-source",
            json={"source": "apply_failure", "source_id": 999999},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/knowledge/from-source",
            json={"source": "resume_diagnosis", "source_id": 999999},
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/knowledge/from-source",
            json={"source": "not-a-source", "source_id": 1},
        ).status_code
        == 422
    )
