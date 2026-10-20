# SPDX-License-Identifier: Apache-2.0
"""批次 A（大数据量体检修复）的后端用例：A2/A3/A4/A5/A6/A7。

对应审计 ``stress-static-audit-2026-10-12.md`` 的 P0-2 / P1-6 / P1-2 / P2-1 /
P2-4 / P2-2；A1 是纯前端改动（远程搜索选择器），由前端共置测试覆盖。
"""

import pytest
from app.models.apply import ApplyQueueItem
from app.models.resume import ResumeRecord
from app.services.apply import apply_service
from app.services.referral_service import referral_out, referrals_out

pytestmark = pytest.mark.usefixtures("client")


# ===== A2（P0-2）：会话列表 keyword 过滤 + limit 解封 =====
def _create_conversation(client, title: str) -> int:
    response = client.post("/api/assistant/conversations", json={"title": title})
    assert response.status_code == 201
    return response.json()["id"]


def test_conversation_list_keyword_matches_title(client):
    hit = _create_conversation(client, "数据分析师面试准备")
    miss = _create_conversation(client, "周末买菜清单")
    found = client.get("/api/assistant/conversations", params={"keyword": "面试"}).json()
    assert hit in [item["id"] for item in found]
    assert miss not in [item["id"] for item in found]


def _add_first_message(db_session, conversation_id: int, content: str) -> None:
    from app.models.assistant import ChatMessage

    db_session.add(ChatMessage(conversation_id=conversation_id, role="user", content=content))
    db_session.commit()


def test_conversation_list_keyword_matches_first_message(client, db_session):
    hit = _create_conversation(client, "新对话")
    miss = _create_conversation(client, "另一段对话")
    _add_first_message(db_session, hit, "STAR 法则怎么用在项目深挖里")
    _add_first_message(db_session, miss, "今天天气不错")
    found = client.get("/api/assistant/conversations", params={"keyword": "STAR"}).json()
    assert hit in [item["id"] for item in found]
    assert miss not in [item["id"] for item in found]


def test_conversation_list_keyword_ignores_later_messages(client, db_session):
    """只搜**首条消息**：正文检索是搜索页的职责，会话搜索不越界。"""
    conversation = _create_conversation(client, "新对话")
    later = _create_conversation(client, "安静对话")
    _add_first_message(db_session, conversation, "开场只是打招呼")
    _add_first_message(db_session, conversation, "后面提到了量化口径")
    _add_first_message(db_session, later, "安静的开场")
    found = client.get("/api/assistant/conversations", params={"keyword": "量化口径"}).json()
    assert conversation not in [item["id"] for item in found]
    found = client.get("/api/assistant/conversations", params={"keyword": "安静"}).json()
    # 「安静对话」命中标题；第一条会话只命中后文，不计入。
    assert later in [item["id"] for item in found]
    assert conversation not in [item["id"] for item in found]


def test_conversation_list_limit_up_to_500(client):
    response = client.get("/api/assistant/conversations", params={"limit": 500})
    assert response.status_code == 200
    assert client.get("/api/assistant/conversations", params={"limit": 501}).status_code == 422


# ===== A3（P1-6）：知识库旧全量列表只带摘要 =====
VALID_KNOWLEDGE = {"title": "压力测试条目", "category": "面试问答", "content": "长" * 500}


def test_knowledge_list_returns_summary_without_full_content(client):
    created = client.post("/api/knowledge", json=VALID_KNOWLEDGE)
    assert created.status_code == 201
    listing = client.get("/api/knowledge").json()
    item = next(entry for entry in listing if entry["id"] == created.json()["id"])
    assert "content" not in item
    assert item["content_excerpt"] == "长" * 200
    # 全文只在详情端点。
    detail = client.get(f"/api/knowledge/{created.json()['id']}").json()
    assert detail["content"] == "长" * 500


# ===== A4（P1-2）：tracker 统计独立端点 =====
def test_tracker_stats_endpoint_matches_list_summary(client):
    created = client.post(
        "/api/tracker",
        json={"company": "示例公司", "title": "数据分析师", "status": "applied"},
    )
    assert created.status_code == 201
    stats = client.get("/api/tracker/stats").json()
    listed = client.get("/api/tracker").json()
    assert "items" not in stats
    assert stats["total"] == listed["total"]
    assert stats["status_counts"] == listed["status_counts"]
    assert stats["active_count"] == listed["active_count"]
    assert stats["month_count"] == listed["month_count"]


def test_tracker_stats_endpoint_rejects_unknown_status(client):
    assert client.get("/api/tracker/stats", params={"status": "不存在的状态"}).status_code == 422


# ===== A5（P2-1）：内推批量 converted 派生与逐行口径一致 =====
def test_referrals_out_matches_single_row_conversion(client, db_session):
    from app.models.referral import Referral
    from app.models.tracker import ApplicationTrack, normalize_key

    interview_track = ApplicationTrack(
        company="示例公司",
        title="数据分析师",
        company_key=normalize_key("示例公司"),
        title_key=normalize_key("数据分析师"),
        status="interview",
    )
    applied_track = ApplicationTrack(
        company="另一家",
        title="数据分析师",
        company_key=normalize_key("另一家"),
        title_key=normalize_key("数据分析师"),
        status="applied",
    )
    db_session.add_all([interview_track, applied_track])
    db_session.commit()
    db_session.refresh(interview_track)
    db_session.refresh(applied_track)
    rows = [
        Referral(company="甲", position="数据分析", track_id=interview_track.id),
        Referral(company="乙", position="数据分析", track_id=None),
        Referral(company="丙", position="数据分析", track_id=applied_track.id),
    ]
    for row in rows:
        db_session.add(row)
    db_session.commit()
    for row in rows:
        db_session.refresh(row)
    batched = {out.id: out.converted for out in referrals_out(db_session, rows)}
    for row in rows:
        assert batched[row.id] == referral_out(db_session, row).converted


# ===== A6（P2-4）：简历批量软删除 =====
def _create_resume(db_session, title: str) -> int:
    record = ResumeRecord(title=title, job_title="", company="", content={}, source="manual")
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record.id


def test_resume_batch_delete_soft_deletes(client, db_session):
    first = _create_resume(db_session, "批量删除一")
    second = _create_resume(db_session, "批量删除二")
    response = client.post("/api/resumes/batch-delete", json={"resume_ids": [first, second]})
    assert response.status_code == 200
    assert response.json() == {"deleted": 2}
    listing = client.get("/api/resumes").json()
    listed_ids = [item["id"] for item in listing["items"]]
    assert first not in listed_ids and second not in listed_ids
    trash = client.get("/api/trash", params={"type": "resume"}).json()
    assert {first, second} <= {item["id"] for item in trash["items"]}


def test_resume_batch_delete_rejects_unknown_id_without_partial_delete(client, db_session):
    keep = _create_resume(db_session, "不能被误删")
    response = client.post("/api/resumes/batch-delete", json={"resume_ids": [keep, keep + 999999]})
    assert response.status_code == 404
    assert "不存在或已被删除" in response.json()["detail"]
    listing = client.get("/api/resumes").json()
    assert keep in [item["id"] for item in listing["items"]]


def test_resume_batch_delete_rejects_empty_ids(client):
    assert client.post("/api/resumes/batch-delete", json={"resume_ids": []}).status_code == 422
    too_many = client.post("/api/resumes/batch-delete", json={"resume_ids": list(range(1, 5002))})
    assert too_many.status_code == 422


# ===== A7（P2-2）：投递队列上限与 total/truncated =====
def test_list_queue_respects_limit_and_count(db_session):
    items = [
        ApplyQueueItem(job_id=None, job_title=f"岗位 {index}", company="示例公司", sort_order=index)
        for index in range(4)
    ]
    for item in items:
        db_session.add(item)
    db_session.commit()
    try:
        capped = apply_service.list_queue(db_session, limit=2)
        assert len(capped) == 2
        # sort_order 大的是新条目，倒序取：上限内保留最新的。
        assert [item.job_title for item in capped] == ["岗位 3", "岗位 2"]
        assert apply_service.count_queue(db_session) == 4
    finally:
        for item in items:
            db_session.delete(item)
        db_session.commit()


def test_queue_endpoint_returns_total_and_truncated(client, db_session):
    items = [
        ApplyQueueItem(
            job_id=None, job_title=f"端点岗位 {index}", company="示例公司", sort_order=index
        )
        for index in range(2)
    ]
    for item in items:
        db_session.add(item)
    db_session.commit()
    try:
        response = client.get("/api/apply/queue")
        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"items", "total", "truncated"}
        assert payload["total"] == 2
        assert payload["truncated"] is False
    finally:
        for item in items:
            db_session.delete(item)
        db_session.commit()
