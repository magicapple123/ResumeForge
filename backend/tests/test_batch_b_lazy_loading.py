"""批次 B「按需加载」守卫测试：B4 投递记录分组明细 / B5 助手会话加载更早。

钉住的契约：

- B4：``GET /records/grouped?include_items=false`` 返回的批次 ``items=[]`` 且
  ``matched_count`` 正确（轻量分页不再每页搬全部明细）；默认（不传参）行为与旧版
  完全一致（明细照带、matched_count 一并填）；明细端点
  ``GET /records/batches/{task_id}/items`` 的过滤语义与 grouped 同源（关键词/结果/
  软删过滤），并支持分页。
- B5：``GET /conversations/{id}?message_limit=N`` 只下发最新 N 条（倒序取再正序返回），
  ``messages_total`` 如实给全量、``has_earlier`` 标记还有更早的；缺省 0 = 全量旧行为；
  ``GET /conversations/{id}/messages/earlier?before_id=&limit=`` 与详情窗口正确衔接
  （翻到头 has_earlier=False）；surface 不匹配时 404 语义与详情端点一致。

造数直接经 ORM（SessionLocal），HTTP 断言走 ``client`` 夹具（同库，插完 commit 即可见）。
"""

import pytest
from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SKIPPED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.assistant import ChatConversation, ChatMessage
from app.models.profile import utcnow

# ===== B4：投递记录分组明细 =====


@pytest.fixture
def apply_batches(db_session):
    """两个批次：A 批 3 条（成/败/跳），B 批 1 条（成）。"""
    task_a = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=3,
        processed=3,
        succeeded=1,
        failed=1,
        skipped=1,
        message="投递任务已完成",
    )
    task_b = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=1,
        processed=1,
        succeeded=1,
    )
    db_session.add_all([task_a, task_b])
    db_session.flush()

    def item(task, sort_order, status, title, company):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_id=None,
                job_title=title,
                company=company,
                status=status,
                sort_order=sort_order,
            )
        )

    item(task_a, 0, ITEM_STATUS_SUCCESS, "后端开发", "A公司")
    item(task_a, 1, ITEM_STATUS_FAILED, "全栈工程师", "B公司")
    item(task_a, 2, ITEM_STATUS_SKIPPED, "测试工程师", "C公司")
    item(task_b, 0, ITEM_STATUS_SUCCESS, "后端开发", "D公司")
    db_session.commit()
    return task_a, task_b


def test_grouped_include_items_false_returns_counts_only(client, apply_batches):
    task_a, task_b = apply_batches
    resp = client.get("/api/apply/records/grouped", params={"include_items": "false"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    by_id = {batch["id"]: batch for batch in body["items"]}
    # 新批次在前；明细不携带，命中数如实。
    assert [batch["id"] for batch in body["items"]] == [task_b.id, task_a.id]
    assert by_id[task_a.id]["items"] == []
    assert by_id[task_a.id]["matched_count"] == 3
    assert by_id[task_b.id]["items"] == []
    assert by_id[task_b.id]["matched_count"] == 1


def test_grouped_default_and_explicit_true_keep_old_behavior(client, apply_batches):
    task_a, task_b = apply_batches
    for params in ({}, {"include_items": "true"}):
        resp = client.get("/api/apply/records/grouped", params=params)
        assert resp.status_code == 200
        by_id = {batch["id"]: batch for batch in resp.json()["items"]}
        assert by_id[task_a.id]["matched_count"] == 3
        assert [item["job_title"] for item in by_id[task_a.id]["items"]] == [
            "后端开发",
            "全栈工程师",
            "测试工程师",
        ]
        assert by_id[task_b.id]["matched_count"] == 1
        assert [item["company"] for item in by_id[task_b.id]["items"]] == ["D公司"]


def test_grouped_matched_count_follows_filters(client, apply_batches):
    task_a, _ = apply_batches
    resp = client.get(
        "/api/apply/records/grouped", params={"include_items": "false", "result": "failed"}
    )
    assert resp.status_code == 200
    body = resp.json()
    # 只有 A 批有失败记录；matched_count 是命中筛选后的计数。
    assert body["total"] == 1
    assert body["items"][0]["id"] == task_a.id
    assert body["items"][0]["matched_count"] == 1
    assert body["items"][0]["items"] == []

    resp = client.get(
        "/api/apply/records/grouped", params={"include_items": "false", "keyword": "C公司"}
    )
    assert resp.status_code == 200
    assert resp.json()["items"][0]["matched_count"] == 1


def test_batch_items_endpoint_filters_and_paginates(client, db_session):
    """明细端点：过滤与 grouped 同源；分页按 sort_order, id 稳定排序。"""
    task = ApplyTask(kind=TASK_KIND_APPLY, status=TASK_STATUS_COMPLETED, total=5, processed=5)
    db_session.add(task)
    db_session.flush()
    titles = ["岗位一", "岗位二", "岗位三", "岗位四", "岗位五"]
    for sort_order, title in enumerate(titles):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_id=None,
                job_title=title,
                company="示例公司" if sort_order % 2 == 0 else "别家公司",
                status=ITEM_STATUS_SUCCESS,
                sort_order=sort_order,
            )
        )
    db_session.commit()

    # 全量（分页）。
    resp = client.get(f"/api/apply/records/batches/{task.id}/items")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert [item["job_title"] for item in body["items"]] == titles

    # 第二页：page_size=2 → 第 3、4 条。
    resp = client.get(
        f"/api/apply/records/batches/{task.id}/items", params={"page": 2, "page_size": 2}
    )
    body = resp.json()
    assert body["total"] == 5
    assert [item["job_title"] for item in body["items"]] == ["岗位三", "岗位四"]

    # 关键词过滤与 grouped 同源（命中公司或岗位名）。
    resp = client.get(f"/api/apply/records/batches/{task.id}/items", params={"keyword": "示例公司"})
    body = resp.json()
    assert body["total"] == 3
    assert [item["job_title"] for item in body["items"]] == ["岗位一", "岗位三", "岗位五"]

    # 结果过滤。
    resp = client.get(f"/api/apply/records/batches/{task.id}/items", params={"result": "failed"})
    assert resp.json() == {"items": [], "total": 0}

    # 软删一条后，明细（与 grouped 的口径一致）不再出现。
    target = db_session.query(ApplyTaskItem).filter(ApplyTaskItem.task_id == task.id).first()
    target.deleted_at = utcnow()
    db_session.commit()
    resp = client.get(f"/api/apply/records/batches/{task.id}/items")
    assert resp.json()["total"] == 4


def test_batch_items_endpoint_404_for_unknown_batch(client):
    resp = client.get("/api/apply/records/batches/999999/items")
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


# ===== B5：助手会话「加载更早」=====


@pytest.fixture
def conversation_with_messages(db_session):
    """一个 page 会话 + 5 条消息（id 递增 = 时间递增）。"""
    conversation = ChatConversation(title="长对话", surface="page")
    db_session.add(conversation)
    db_session.flush()
    for index in range(5):
        db_session.add(
            ChatMessage(
                conversation_id=conversation.id,
                role="user" if index % 2 == 0 else "assistant",
                content=f"消息{index + 1}",
                status="complete",
            )
        )
    floating = ChatConversation(title="浮窗会话", surface="floating")
    db_session.add(floating)
    db_session.commit()
    return conversation, floating


def test_read_conversation_message_limit_returns_latest_n(client, conversation_with_messages):
    conversation, _ = conversation_with_messages
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}", params={"message_limit": 3}
    )
    assert resp.status_code == 200
    body = resp.json()
    # 最新 3 条，且按时间正序返回。
    assert [message["content"] for message in body["messages"]] == ["消息3", "消息4", "消息5"]
    assert body["messages_total"] == 5
    assert body["has_earlier"] is True


def test_read_conversation_default_returns_all(client, conversation_with_messages):
    conversation, _ = conversation_with_messages
    resp = client.get(f"/api/assistant/conversations/{conversation.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert [message["content"] for message in body["messages"]] == [
        "消息1",
        "消息2",
        "消息3",
        "消息4",
        "消息5",
    ]
    assert body["messages_total"] == 5
    assert body["has_earlier"] is False


def test_read_conversation_limit_larger_than_total(client, conversation_with_messages):
    conversation, _ = conversation_with_messages
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}", params={"message_limit": 50}
    )
    body = resp.json()
    assert len(body["messages"]) == 5
    assert body["has_earlier"] is False
    assert body["messages_total"] == 5


def test_earlier_endpoint_walks_pages_until_exhausted(client, conversation_with_messages):
    conversation, _ = conversation_with_messages
    # 第一页：详情窗口给了最新 2 条（消息4、消息5）；窗口最旧的是消息4。
    detail = client.get(
        f"/api/assistant/conversations/{conversation.id}", params={"message_limit": 2}
    ).json()
    oldest_loaded = detail["messages"][0]
    assert oldest_loaded["content"] == "消息4"

    # 取窗口之前的最新 2 条 → 消息2、消息3（正序）。
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}/messages/earlier",
        params={"before_id": oldest_loaded["id"], "limit": 2},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [message["content"] for message in body["items"]] == ["消息2", "消息3"]
    assert body["has_earlier"] is True

    # 继续往前翻到底：只剩消息1，且 has_earlier=False。
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}/messages/earlier",
        params={"before_id": body["items"][0]["id"], "limit": 2},
    )
    body = resp.json()
    assert [message["content"] for message in body["items"]] == ["消息1"]
    assert body["has_earlier"] is False


def test_earlier_endpoint_surface_mismatch_is_404(client, conversation_with_messages):
    conversation, floating = conversation_with_messages
    # surface 校验与 read_conversation 一致：surface 不匹配 → 404（而不是把消息漏出去）。
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}/messages/earlier",
        params={"before_id": 1, "limit": 2, "surface": "floating"},
    )
    assert resp.status_code == 404
    resp = client.get(
        f"/api/assistant/conversations/{floating.id}/messages/earlier",
        params={"before_id": 1, "limit": 2, "surface": "floating"},
    )
    assert resp.status_code == 200

    # 详情端点的 limit 模式同样保持 surface 404 语义。
    resp = client.get(
        f"/api/assistant/conversations/{conversation.id}",
        params={"message_limit": 2, "surface": "floating"},
    )
    assert resp.status_code == 404


def test_read_conversation_missing_conversation_is_404(client):
    resp = client.get("/api/assistant/conversations/999999", params={"message_limit": 3})
    assert resp.status_code == 404
