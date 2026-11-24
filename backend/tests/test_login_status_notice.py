# SPDX-License-Identifier: Apache-2.0
"""T1「保持登录」的一次性说明：把 service 的函数接到接口上。

这份用例钉的是"说明会不会该出现时没出现 / 不该出现时乱出现"：

1. **没生效过就不该出现**：`read_notice` 为空时接口回 `days=0`，前端据此整条不渲染；
2. **生效过就报当前策略天数**：`days` 与 `read_policy().normalized_days()` 同源，
   不能是写死的 90（用户可能选的是 30 或 365）；
3. **`first_effective_at` 原样下发**（不做时区换算、不改格式）；
4. **ack 幂等**：第一次写、第二次不写也不报错，两次都回 200 且 `delivered=true`；
5. **ack 之后 GET 的 `delivered` 变 true**（一次性说明只给一次的前提）；
6. **开关关掉就不该出现**：`enabled=false` 时同样回 `days=0`——已经有"首次生效"记录
   不代表现在还在保，这时候说"我们已开始帮你保持登录"是假话。

**正文只在 i18n 里**（`applyUi.loginStatus.keepSessionNotice`），后端只给天数：
把中文模板从这里下发，英文界面就会漏中文，两份文案也迟早不同步。
"""

from __future__ import annotations

import pytest
from app.models.setting import AppSetting
from app.services.browser import session_cookie_keepalive


def _seed_first_effective(db, value: str) -> None:
    """造一条"功能首次真正生效"的记录（生产上由后台续期线程写）。"""
    db.add(AppSetting(key=session_cookie_keepalive.KEY_NOTICE_FIRST_EFFECTIVE, value=value))
    db.commit()


def test_notice_is_empty_before_first_effective(db_session, client):
    """从没生效过：`days=0` + 空时刻，前端据此不渲染（不是"天数默认 90"）。"""
    response = client.get("/api/login-status/notice")

    assert response.status_code == 200
    assert response.json() == {"days": 0, "first_effective_at": "", "delivered": False}


def test_notice_reports_policy_days_and_raw_timestamp(db_session, client):
    """生效过：`days` 跟着策略走（不是写死 90），时刻原样下发。"""
    _seed_first_effective(db_session, "2026-11-13T09:41:07")
    session_cookie_keepalive.write_policy(db_session, days=30)

    body = client.get("/api/login-status/notice").json()

    assert body["days"] == 30
    assert body["first_effective_at"] == "2026-11-13T09:41:07"
    assert body["delivered"] is False


def test_notice_days_follow_policy_not_a_hardcoded_default(db_session, client):
    """同一个"已生效"的记录，换策略天数接口就跟着变（两处不各算一份）。"""
    _seed_first_effective(db_session, "2026-11-13T09:41:07")

    for days in session_cookie_keepalive.ALLOWED_SESSION_COOKIE_DAYS:
        session_cookie_keepalive.write_policy(db_session, days=days)
        assert client.get("/api/login-status/notice").json()["days"] == days


def test_notice_is_hidden_when_keepalive_is_switched_off(db_session, client):
    """开关关掉 → `days=0`（前端整条不渲染），哪怕历史上有过"首次生效"记录。

    "曾经生效过"不等于"现在在保"：用户关掉开关后再看到"我们已开始帮你保持登录"
    会直接误导他以为自己还被保着。
    """
    _seed_first_effective(db_session, "2026-11-13T09:41:07")
    session_cookie_keepalive.write_policy(db_session, days=90, enabled=False)

    body = client.get("/api/login-status/notice").json()

    assert body["days"] == 0
    # 历史记录仍如实下发、也不擦掉：只影响"要不要展示"，不改写事实。
    assert body["first_effective_at"] == "2026-11-13T09:41:07"
    assert body["delivered"] is False

    # 再打开开关就回到正常天数（不是一次性把记录作废了）。
    session_cookie_keepalive.write_policy(db_session, enabled=True)
    assert client.get("/api/login-status/notice").json()["days"] == 90


def test_ack_marks_delivered_and_is_idempotent(db_session, client):
    """ack 幂等：两次都 200 + `delivered=true`，且 GET 从此看到 `delivered=true`。"""
    _seed_first_effective(db_session, "2026-11-13T09:41:07")

    first = client.post("/api/login-status/notice/ack")
    second = client.post("/api/login-status/notice/ack")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == {"delivered": True}
    assert second.json() == {"delivered": True}
    assert client.get("/api/login-status/notice").json()["delivered"] is True
    # 只写了一行 KV：重复 ack 不能再插一条（键是主键，重复插入会炸）。
    rows = db_session.query(AppSetting).filter_by(key=session_cookie_keepalive.KEY_NOTICE_DELIVERED)
    assert rows.count() == 1


def test_ack_before_first_effective_is_allowed(db_session, client):
    """没生效过也能 ack（客户端拿到 days=0 就不该调，但接口不必因此 409）。"""
    response = client.post("/api/login-status/notice/ack")

    assert response.status_code == 200
    assert client.get("/api/login-status/notice").json()["delivered"] is True


@pytest.mark.parametrize("path", ["/api/login-status/notice", "/api/login-status/notice/ack"])
def test_notice_routes_are_not_swallowed_by_source_path_params(client, path):
    """静态段不能被 `/{source}/...` 吃掉：打到未知来源会 404「未知的登录来源」。"""
    response = client.get(path) if path.endswith("/notice") else client.post(path)

    assert response.status_code in {200, 405}
    assert "未知的登录来源" not in response.text
