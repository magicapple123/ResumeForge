# SPDX-License-Identifier: Apache-2.0
"""CR-25：通知中心 inbox —— 30 天窗口、清理、以及"任务完成"也落库。

覆盖任务书 §CR-25 里后端能测的部分：

1. 30 天归档按 ``created_at`` 判定，且"现在"可注入（不写死 ``utcnow()``）；
2. 清理只删本数据集、超过窗口的行，窗口边界正好 30 天的保留；
3. 后台任务 / 助手任务的完成事件能通过写入端点落库（``dedupe_key`` 幂等）；
4. 写入端点只接受"客户端可报"的事件类型，``reminder_due`` 这类服务端专属类型被拒。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.notification import (
    NOTIFICATION_TYPE_BACKGROUND_TASK,
    NOTIFICATION_TYPE_REMINDER_DUE,
    Notification,
)
from app.models.profile import utcnow
from app.services import notifications

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)


def _row(
    db,
    *,
    title: str,
    created_at: datetime,
    dedupe_key: str,
    dataset_key: str = "main",
    read: bool = False,
) -> Notification:
    """直接写行：``emit`` 会把 ``created_at`` 固定成当前时刻，测窗口边界必须自己造。"""
    row = Notification(
        type=NOTIFICATION_TYPE_REMINDER_DUE,
        severity="info",
        title=title,
        body="",
        deep_link="",
        dedupe_key=dedupe_key,
        read_at=created_at if read else None,
        created_at=created_at,
        expires_at=None,
        dataset_key=dataset_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _exists(db, row_id: int) -> bool:
    """行是否还在（绕开身份映射：另一个会话可能已经删掉它）。"""
    return db.query(Notification.id).filter(Notification.id == row_id).scalar() is not None


def test_retention_window_uses_created_at_with_injectable_now(client, db_session):
    """超过 30 天的已读通知不再出现；把"现在"往回拨到窗口内则能看到。"""
    old = _row(
        db_session,
        title="31 天前的已读通知",
        created_at=NOW - timedelta(days=31),
        dedupe_key="retention:old",
        read=True,
    )
    fresh = _row(
        db_session,
        title="29 天前的未读通知",
        created_at=NOW - timedelta(days=29),
        dedupe_key="retention:fresh",
    )

    kept = notifications.list_notifications(db_session, now=NOW)
    assert [int(row.id) for row in kept] == [int(fresh.id)]
    assert notifications.unread_count(db_session, now=NOW) == 1

    # 注入更早的"现在"：31 天前那条此刻还在窗口内（差 1 天到 30 天上限）。
    rewound = notifications.list_notifications(db_session, now=NOW - timedelta(days=1))
    assert {int(row.id) for row in rewound} == {int(old.id), int(fresh.id)}

    # HTTP 读侧与 service 同一口径：这里用"真实现在"造两行，窗外的不可见、窗内的可见
    # （不写死日期，避免用例随日历腐烂）。
    now_real = utcnow()
    _row(
        db_session,
        title="40 天前的行",
        created_at=now_real - timedelta(days=40),
        dedupe_key="retention:http-old",
        read=True,
    )
    _row(
        db_session,
        title="5 天前的行",
        created_at=now_real - timedelta(days=5),
        dedupe_key="retention:http-fresh",
    )
    assert [row["title"] for row in client.get("/api/notifications").json()] == [
        "5 天前的行",
        "29 天前的未读通知",
    ]
    assert client.get("/api/notifications/unread-count").json() == {"unread": 2}


def test_purge_expired_keeps_boundary_and_other_datasets(db_session):
    """清理：严格超过窗口才删；其它数据集的行一行都不许碰。"""
    expired = _row(
        db_session,
        title="窗外的行",
        created_at=NOW - timedelta(days=30, seconds=1),
        dedupe_key="purge:expired",
        read=True,
    )
    boundary = _row(
        db_session,
        title="正好 30 天",
        created_at=NOW - timedelta(days=30),
        dedupe_key="purge:boundary",
        read=True,
    )
    other_dataset = _row(
        db_session,
        title="别的数据集",
        created_at=NOW - timedelta(days=90),
        dedupe_key="purge:other",
        dataset_key="other",
        read=True,
    )

    removed = notifications.purge_expired(db_session, now=NOW)
    assert removed == 1

    remaining = {int(row.id) for row in db_session.query(Notification).all()}
    assert remaining == {int(boundary.id), int(other_dataset.id)}
    assert int(expired.id) not in remaining


def test_ingest_records_task_notification_idempotently(client, db_session):
    """后台任务完成/失败可以落 inbox；同 dedupe_key 连发两次只有 1 行。"""
    payload = {
        "type": NOTIFICATION_TYPE_BACKGROUND_TASK,
        "severity": "info",
        "title": "投递批次已完成",
        "body": "成功 8 · 失败 0 · 跳过 2",
        "deep_link": "/apply",
        "dedupe_key": "background:apply:12:completed",
    }
    first = client.post("/api/notifications/ingest", json=payload)
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/notifications/ingest",
        json={**payload, "title": "重复上报不该覆盖标题"},
    )
    assert second.status_code == 201, second.text
    assert first.json()["id"] == second.json()["id"]

    rows = client.get("/api/notifications").json()
    assert len(rows) == 1
    assert rows[0]["title"] == "投递批次已完成"
    assert rows[0]["type"] == NOTIFICATION_TYPE_BACKGROUND_TASK
    assert rows[0]["deep_link"] == "/apply"
    assert client.get("/api/notifications/unread-count").json() == {"unread": 1}

    # 失败事件是另一件事：自己的行，自己的类型/严重度。
    failed = client.post(
        "/api/notifications/ingest",
        json={
            "type": NOTIFICATION_TYPE_BACKGROUND_TASK,
            "severity": "warning",
            "title": "投递批次失败",
            "body": "网络中断",
            "deep_link": "/apply",
            "dedupe_key": "background:apply:12:failed",
        },
    )
    assert failed.status_code == 201, failed.text
    assert client.get("/api/notifications/unread-count").json() == {"unread": 2}


def test_list_endpoint_cleans_expired_rows_at_most_hourly(client, db_session, monkeypatch):
    """读侧惰性清理：打开列表顺手删窗口外的行，但一小时内只清一次（不每请求扫全表）。"""
    monkeypatch.setattr(notifications, "_last_cleanup_at", None)
    expired = _row(
        db_session,
        title="该被清掉的行",
        created_at=utcnow() - timedelta(days=31),
        dedupe_key="cleanup:expired",
        read=True,
    )
    assert client.get("/api/notifications").status_code == 200
    # 用列查询而不是 `get()`：身份映射里的对象已被另一个会话删掉，`get()` 会抛
    # ObjectDeletedError，那是"缓存过期"而不是"行还在"。
    assert _exists(db_session, expired.id) is False

    # 一小时内再来一条窗口外的行：读侧只过滤、不物理删（清理有间隔）。
    # 先脱离身份映射：上一行已被删除，SQLite 会把同一个 id 分给新行（复用 PK 的告警）。
    db_session.expunge_all()
    leftover = _row(
        db_session,
        title="留给下一轮清理",
        created_at=utcnow() - timedelta(days=31),
        dedupe_key="cleanup:leftover",
        read=True,
    )
    assert client.get("/api/notifications").status_code == 200
    assert _exists(db_session, leftover.id) is True
    # 读侧口径仍然不暴露它。
    assert client.get("/api/notifications").json() == []


def test_ingest_rejects_server_only_and_unknown_types(client):
    """``reminder_due`` 只能由后台事件产生；未知类型同样拒收（不落一行垃圾数据）。"""
    base = {
        "title": "伪造的系统通知",
        "body": "",
        "deep_link": "",
        "dedupe_key": "forged:1",
    }
    server_only = client.post(
        "/api/notifications/ingest", json={**base, "type": NOTIFICATION_TYPE_REMINDER_DUE}
    )
    assert server_only.status_code == 422, server_only.text
    unknown = client.post("/api/notifications/ingest", json={**base, "type": "made_up"})
    assert unknown.status_code == 422, unknown.text
    # 缺 dedupe_key：没有幂等键的写入会把 inbox 变成重复行仓库。
    missing_key = client.post(
        "/api/notifications/ingest",
        json={**base, "type": NOTIFICATION_TYPE_BACKGROUND_TASK, "dedupe_key": ""},
    )
    assert missing_key.status_code == 422, missing_key.text
    assert client.get("/api/notifications").json() == []
