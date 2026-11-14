# SPDX-License-Identifier: Apache-2.0
"""Q12「登录状态」面板的纯逻辑契约。

这四条是"面板会不会骗人"的底线：
1. **没检测过 ≠ 正常**：必须落 `unchecked`，不能用 `ok` 冒充；
2. **拿不到登录特征 ≠ 已失效**：必须落 `unknown`，误报会逼用户反复重登；
3. **没配 Cookie ≠ 已失效**：`unchecked` + 原因；
4. **60 秒内不重复检测**：频繁探测有风控风险，且浏览器类会抢焦点。
"""

from __future__ import annotations

import pytest
from app.services import login_status, login_status_sites


@pytest.fixture(autouse=True)
def _reset_cooldown():
    login_status.reset_cooldowns()
    yield
    login_status.reset_cooldowns()


def test_unchecked_by_default_never_reports_ok(db_session):
    """从没检测过时不能报「正常」——那会让用户以为刚验过。"""
    row = login_status.read_status(db_session, "apply_browser")
    assert row["status"] == "unchecked"
    assert row["checked_at"] == ""


def test_status_roundtrip_and_listing(db_session):
    login_status._save_status(db_session, "apply_browser", "expired", "停在登录页")
    row = login_status.read_status(db_session, "apply_browser")
    assert row["status"] == "expired"
    assert row["detail"] == "停在登录页"
    items = {item["id"]: item for item in login_status.list_statuses(db_session)}
    assert set(items) == {"apply_browser", "webform_browser", "track_cookie"}
    assert items["apply_browser"]["status"] == "expired"
    assert items["webform_browser"]["status"] == "unchecked"


def test_unknown_is_preserved_not_downgraded_to_expired(db_session):
    """`unknown` 必须原样保留：它是"判断不了"，不是"已失效"。"""
    login_status._save_status(db_session, "track_cookie", "unknown", "网络不通")
    assert login_status.read_status(db_session, "track_cookie")["status"] == "unknown"


def test_broken_json_falls_back_to_unchecked(db_session):
    """历史数据被手改坏时回落 unchecked，不让整页 500。"""
    login_status._write_setting(db_session, login_status._status_key("track_cookie"), "{not json")
    db_session.commit()
    assert login_status.read_status(db_session, "track_cookie")["status"] == "unchecked"


def test_cookie_check_without_cookie_is_unchecked(db_session):
    """没配 Cookie 是「未检测」而不是「已失效」——两件事不能混。"""
    result = login_status.check(db_session, "track_cookie")
    assert result["status"] == "unchecked"
    assert "Cookie" in result["detail"]


def test_cookie_check_without_probe_url_is_unknown(db_session, monkeypatch):
    """有 Cookie 但没有探测地址：判断不了，落 unknown。"""
    monkeypatch.setattr(login_status, "probe_url", lambda db, source: "")
    from app.services.track_probe_settings import write_settings

    write_settings(db_session, cookie="a=1")
    login_status.reset_cooldowns()
    result = login_status.check(db_session, "track_cookie")
    assert result["status"] == "unknown"
    assert "探测地址" in result["detail"]


def test_second_check_within_cooldown_is_rejected(db_session):
    login_status.check(db_session, "track_cookie")
    with pytest.raises(login_status.LoginStatusBusy) as info:
        login_status.check(db_session, "track_cookie")
    assert info.value.remaining > 0


def test_unknown_source_is_rejected(db_session):
    with pytest.raises(KeyError):
        login_status.check(db_session, "nope")


def test_probe_url_prefers_configured_value(db_session):
    login_status.set_probe_url(db_session, "apply_browser", "https://example.test/jobs")
    assert login_status.probe_url(db_session, "apply_browser") == "https://example.test/jobs"


# ===== F07：网申站点清单与逐站点检测 =====


def _fill(db, url: str, title: str, *, minutes: int) -> None:
    from datetime import datetime, timedelta

    from app.models.web_form_record import WebFormFillRecord

    db.add(
        WebFormFillRecord(
            url=url,
            page_title=title,
            items=[],
            page_snapshot=[],
            filled=1,
            created_at=datetime(2026, 11, 13, 12, 0) - timedelta(minutes=minutes),
        )
    )
    db.commit()


def _visit(db, url: str, title: str, *, minutes: int) -> None:
    from datetime import datetime, timedelta

    from app.models.web_form_url_history import WebFormUrlHistory

    stamp = datetime(2026, 11, 13, 12, 0) - timedelta(minutes=minutes)
    db.add(WebFormUrlHistory(url=url, title=title, created_at=stamp, last_used_at=stamp))
    db.commit()


def test_webform_sites_merge_dedupe_and_sort(db_session):
    """两张表按 host 去重；排序按最近使用；显示名优先页面标题。"""
    _fill(db_session, "https://a.example.com/apply/1", "Moka 投递", minutes=30)
    _fill(db_session, "https://b.example.com/apply/2", "北森投递", minutes=20)
    _visit(db_session, "https://a.example.com/apply/1", "Moka", minutes=10)
    _visit(db_session, "https://c.example.com/jobs", "智联", minutes=5)

    sites = login_status_sites.webform_sites(db_session)

    assert [site["host"] for site in sites] == [
        "c.example.com",
        "a.example.com",
        "b.example.com",
    ]
    by_host = {site["host"]: site for site in sites}
    # 填充记录优先：a 的显示名与探测 URL 都来自"真的填过"的那一条。
    assert by_host["a.example.com"]["label"] == "Moka 投递"
    assert by_host["a.example.com"]["probe_url"] == "https://a.example.com/apply/1"
    assert by_host["c.example.com"]["label"] == "智联"


def test_webform_sites_cap_and_truncated_payload(db_session):
    for index in range(14):
        _visit(db_session, f"https://site{index}.example.com/jobs", f"站点{index}", minutes=index)

    payload = login_status_sites.webform_sites_payload(db_session)

    assert len(payload["items"]) == login_status_sites.MAX_WEBFORM_SITES
    assert payload["total"] == 14
    assert payload["truncated"] == 2


def test_check_site_rejects_host_outside_inventory(db_session):
    """前端只能传清单里的 host：任意 URL / 未知 host 一律拒绝。"""
    _visit(db_session, "https://known.example.com/jobs", "已知站", minutes=1)

    with pytest.raises(KeyError):
        login_status_sites.check_webform_site(db_session, "evil.example.com")


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ({"href": "https://x.example.com/passport/login?next=1", "text": "随便"}, "expired"),
        ({"href": "https://x.example.com/jobs", "text": "密码登录 扫码登录"}, "expired"),
        (
            {
                "href": "https://ats.example.com/apply",
                "text": "Sign in to continue. Password",
                "hasPassword": True,
            },
            "expired",
        ),
        ({"href": "https://x.example.com/jobs", "text": "岗位列表 " * 40}, "ok"),
        ({"href": "https://x.example.com/jobs", "text": ""}, "unknown"),
    ],
)
def test_judge_site_matrix(state, expected):
    assert login_status_sites._judge_site(state)[0] == expected


def test_check_site_writes_kv_and_respects_cooldown(db_session, monkeypatch):
    _visit(db_session, "https://known.example.com/jobs", "已知站", minutes=1)
    monkeypatch.setattr(login_status_sites, "_probe_webform_site", lambda db, url: ("ok", ""))

    row = login_status_sites.check_webform_site(db_session, "known.example.com")

    assert row["status"] == "ok"
    cached = login_status_sites._read_site_status(
        db_session, "known.example.com", "https://known.example.com/jobs"
    )
    assert cached["status"] == "ok" and cached["checked_at"]
    with pytest.raises(login_status.LoginStatusBusy):
        login_status_sites.check_webform_site(db_session, "known.example.com")


def test_webform_site_status_is_invalidated_when_probe_url_changes(db_session):
    _visit(db_session, "https://known.example.com/jobs", "已知站", minutes=1)
    login_status_sites._save_site_status(
        db_session, "known.example.com", "ok", "", "https://old.example.com/x"
    )

    row = login_status_sites._read_site_status(
        db_session, "known.example.com", "https://known.example.com/jobs"
    )

    assert row["status"] == "unchecked"
    assert "探测地址" in row["detail"]


def test_parent_row_aggregates_sites_and_stops_solo_probing(db_session, monkeypatch):
    """父行只汇总：任一站过期即 expired，detail 报「N 个站点 · M 正常」，且不再单独探测。"""
    _visit(db_session, "https://a.example.com/jobs", "A", minutes=2)
    _visit(db_session, "https://b.example.com/jobs", "B", minutes=1)
    login_status_sites._save_site_status(
        db_session, "a.example.com", "ok", "", "https://a.example.com/jobs"
    )
    login_status_sites._save_site_status(
        db_session, "b.example.com", "expired", "停在登录页", "https://b.example.com/jobs"
    )
    monkeypatch.setattr(login_status, "_probe_browser", lambda *args, **kwargs: ("ok", ""))

    row = next(
        item for item in login_status.list_statuses(db_session) if item["id"] == "webform_browser"
    )
    result = login_status.check(db_session, "webform_browser")

    assert row["status"] == "expired"
    assert row["detail"] == "2 个站点 · 1 正常"
    assert len(row["sites"]) == 2
    # 汇总行不探测：结果与 list_statuses 一致，且不占限流（连续两次都不会 429）。
    assert result["status"] == "expired"
    assert login_status.check(db_session, "webform_browser")["status"] == "expired"


def test_webform_site_routes_are_not_swallowed_by_source_route(client):
    """`/webform-sites` 必须排在 `/{source}/...` 之前，否则会被当成未知来源 404。"""
    response = client.get("/api/login-status/webform-sites")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "truncated": 0}


def test_check_site_api_rejects_unknown_host(client):
    response = client.post(
        "/api/login-status/webform-sites/check", json={"host": "nope.example.com"}
    )

    assert response.status_code == 404


def test_relogin_for_a_webform_site_opens_its_own_url(client, db_session, monkeypatch):
    """F12：网申「重新登录」打开的是网申站点，不是 BOSS 的投递入口。"""
    from app.api import login_status as api_module

    _visit(db_session, "https://moka.example.com/apply", "Moka", minutes=1)
    opened: list[str] = []
    monkeypatch.setattr(api_module.webform_browser, "open_url", lambda db, url: opened.append(url))

    response = client.post(
        "/api/login-status/webform-sites/relogin", json={"host": "moka.example.com"}
    )

    assert response.status_code == 200
    assert opened == ["https://moka.example.com/apply"]
    assert response.json()["url"] == "https://moka.example.com/apply"


# ===== F12：默认探测地址按来源分派 =====


def test_webform_default_probe_url_prefers_the_later_of_fill_and_history(db_session):
    _fill(db_session, "https://fill.example.com/apply", "填过", minutes=30)
    _visit(db_session, "https://visit.example.com/jobs", "打开过", minutes=5)

    assert login_status.probe_url(db_session, "webform_browser") == "https://visit.example.com/jobs"


def test_webform_default_probe_url_falls_back_to_the_only_side(db_session):
    from app.models.web_form_record import WebFormFillRecord

    _fill(db_session, "https://fill.example.com/apply", "填过", minutes=30)
    assert login_status.probe_url(db_session, "webform_browser") == "https://fill.example.com/apply"

    db_session.query(WebFormFillRecord).delete()
    db_session.commit()
    assert login_status.probe_url(db_session, "webform_browser") == ""


def test_track_cookie_default_probe_url_uses_the_configured_page(db_session):
    from app.services.track_probe_settings import write_settings

    write_settings(db_session, page_url="https://portal.example.com/my/records")

    assert (
        login_status.probe_url(db_session, "track_cookie")
        == "https://portal.example.com/my/records"
    )


def test_source_status_is_invalidated_when_the_probe_url_changes(db_session):
    login_status.set_probe_url(db_session, "track_cookie", "https://old.example.com/a")
    login_status._save_status(
        db_session, "track_cookie", "ok", "", probe="https://old.example.com/a"
    )

    login_status.set_probe_url(db_session, "track_cookie", "https://new.example.com/b")
    row = login_status.read_status(db_session, "track_cookie")

    assert row["status"] == "unchecked"
    assert "探测地址" in row["detail"]


def test_legacy_status_without_probe_url_resets_only_the_affected_sources(db_session):
    """老 JSON 没有 probe_url：网申 / Cookie 重置，投递浏览器不动（它的默认地址没变过）。"""
    import json

    legacy = json.dumps({"status": "ok", "checked_at": "2026-11-01T10:00:00", "detail": ""})
    for source in ("apply_browser", "webform_browser", "track_cookie"):
        login_status._write_setting(db_session, login_status._status_key(source), legacy)
    db_session.commit()

    assert login_status.read_status(db_session, "apply_browser")["status"] == "ok"
    assert login_status.read_status(db_session, "webform_browser")["status"] == "unchecked"
    assert login_status.read_status(db_session, "track_cookie")["status"] == "unchecked"
