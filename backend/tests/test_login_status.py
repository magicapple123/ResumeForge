# SPDX-License-Identifier: Apache-2.0
"""Q12「登录状态」面板的纯逻辑契约。

这四条是"面板会不会骗人"的底线：
1. **没检测过 ≠ 正常**：必须落 `unchecked`，不能用 `ok` 冒充；
2. **拿不到登录特征 ≠ 已失效**：必须落 `unknown`，误报会逼用户反复重登；
3. **没配 Cookie ≠ 已失效**：`unchecked` + 原因；
4. **60 秒内不重复检测**：频繁探测有风控风险，且浏览器类会抢焦点。

网申逐站点（F07 / I-29）在 `test_login_status_sites.py`，账号备注（原条目 8 A1）在
`test_login_account_note.py`——按 500 行预算拆开，共享脚手架在 `login_status_fixtures.py`。
"""

from __future__ import annotations

import pytest
from app.services import login_status, login_status_sites
from tests.login_status_fixtures import _fill, _stub_state, _visit


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
    # 门户 Cookie 那一行随「申请状态回读」整条移除：只剩两个浏览器 profile。
    assert set(items) == {"apply_browser", "webform_browser"}
    assert items["apply_browser"]["status"] == "expired"
    assert items["webform_browser"]["status"] == "unchecked"


def test_unknown_is_preserved_not_downgraded_to_expired(db_session):
    """`unknown` 必须原样保留：它是"判断不了"，不是"已失效"。"""
    login_status._save_status(db_session, "apply_browser", "unknown", "网络不通")
    assert login_status.read_status(db_session, "apply_browser")["status"] == "unknown"


def test_logged_out_survives_the_roundtrip(db_session):
    """I-29：新状态必须同时在写与读的白名单里，否则会被**静默**读成 `unchecked`。"""
    login_status._save_status(db_session, "apply_browser", "logged-out", "页面显示登录入口")
    assert login_status.read_status(db_session, "apply_browser")["status"] == "logged-out"

    login_status_sites._save_site_status(
        db_session, "a.example.com", "logged-out", "停在登录页", "https://a.example.com/jobs"
    )
    site = login_status_sites._read_site_status(
        db_session, "a.example.com", "https://a.example.com/jobs"
    )
    assert site["status"] == "logged-out"


def test_legacy_expired_is_still_read_as_expired(db_session):
    """旧数据里的 `expired` 仍显示「已失效」，不被读成「未检测」。"""
    login_status._save_status(db_session, "apply_browser", "expired", "停在登录页")
    assert login_status.read_status(db_session, "apply_browser")["status"] == "expired"


def test_broken_json_falls_back_to_unchecked(db_session):
    """历史数据被手改坏时回落 unchecked，不让整页 500。"""
    login_status._write_setting(db_session, login_status._status_key("apply_browser"), "{not json")
    db_session.commit()
    assert login_status.read_status(db_session, "apply_browser")["status"] == "unchecked"


def test_second_check_within_cooldown_is_rejected(db_session, monkeypatch):
    monkeypatch.setattr(login_status, "_probe_browser", lambda *args, **kwargs: ("ok", ""))
    login_status.check(db_session, "apply_browser")
    with pytest.raises(login_status.LoginStatusBusy) as info:
        login_status.check(db_session, "apply_browser")
    assert info.value.remaining > 0


def test_unknown_source_is_rejected(db_session):
    with pytest.raises(KeyError):
        login_status.check(db_session, "nope")


def test_probe_url_prefers_configured_value(db_session):
    login_status.set_probe_url(db_session, "apply_browser", "https://example.test/jobs")
    assert login_status.probe_url(db_session, "apply_browser") == "https://example.test/jobs"


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


def test_source_status_is_invalidated_when_the_probe_url_changes(db_session):
    login_status.set_probe_url(db_session, "webform_browser", "https://old.example.com/a")
    login_status._save_status(
        db_session, "webform_browser", "ok", "", probe="https://old.example.com/a"
    )

    login_status.set_probe_url(db_session, "webform_browser", "https://new.example.com/b")
    row = login_status.read_status(db_session, "webform_browser")

    assert row["status"] == "unchecked"
    assert "探测地址" in row["detail"]


def test_legacy_status_without_probe_url_resets_only_the_affected_sources(db_session):
    """老 JSON 没有 probe_url：网申重置，投递浏览器不动（它的默认地址没变过）。"""
    import json

    legacy = json.dumps({"status": "ok", "checked_at": "2026-11-01T10:00:00", "detail": ""})
    for source in ("apply_browser", "webform_browser"):
        login_status._write_setting(db_session, login_status._status_key(source), legacy)
    db_session.commit()

    assert login_status.read_status(db_session, "apply_browser")["status"] == "ok"
    assert login_status.read_status(db_session, "webform_browser")["status"] == "unchecked"


# ===== 门户 Cookie 来源已整条移除（原条目 4）=====


def test_the_cookie_source_is_gone_from_the_panel_and_the_api(db_session, client):
    """回读没了，门户 Cookie 也就没有配置入口：来源清单与写接口都必须消失。

    留着来源会让面板永远多一行无法消除的「未检测」；留着 ``PUT /track_cookie``
    则是一条写不进任何读者的死接口（凭据只增不减，是纯粹的隐私负担）。
    """
    assert "track_cookie" not in login_status.source_ids()
    assert "track_cookie" not in {row["id"] for row in login_status.list_statuses(db_session)}

    response = client.put("/api/login-status/track_cookie", json={"cookie": "a=1"})
    assert response.status_code in (404, 405), "写 Cookie 的接口必须已移除"


def test_browser_source_still_recognises_a_login_page():
    """搬家后的活口：``looks_like_login_page`` 从 ``track_portal`` 搬到 ``login_page``。

    这条断言的是**浏览器来源**的判定（``_judge`` 直接被 ``_probe_browser`` 与
    ``login_status_sites`` 复用），不是回读。只删不搬会让投递浏览器 / 网申浏览器的
    「停在登录页」静默退化成「无法判断」——这正是本轮删除最容易误伤的一处。
    """
    assert login_status._judge("手机号码登录 获取验证码")[0] == "logged-out"
    # 长页不算登录页：状态页至少一张卡片，页面很长时那几个词可能只是页脚链接。
    long_page = "手机号码登录 获取验证码" + "岗位列表 " * 300
    assert login_status._judge(long_page)[0] != "logged-out"


# ===== 原条目 7 A1：`unknown` 必须给出原因 =====
#
# 四种情形一次钉住（顺序就是 `_judge` 的判定顺序）：
# 1. ok            —— 页面有账号标记（唯一的正面证据）；
# 2. logged-out    —— 独立的「登录」CTA；
# 3. unknown+原因  —— 有正文但没有账号标记（Moka 那类头像式页头）；
# 4. 内容过少      —— 正文 < 20 字，连"有没有登录入口"都无从判断。


def test_judge_ok_comes_only_from_account_markers():
    status, detail = login_status._judge("岗位列表 " * 40 + "\n退出登录")
    assert (status, detail) == ("ok", "页面有账号标记")


def test_judge_independent_login_cta_is_logged_out():
    status, detail = login_status._judge("校园招聘 岗位列表 " * 20 + "\n登录\n")
    assert (status, detail) == ("logged-out", "页面显示登录入口")


def test_judge_unknown_fallback_explains_why():
    """A1 的核心断言：兜底分支的 detail **不许是空串**，且这句要在 Cookie 场景也讲得通。

    文案不能提"公开岗位页"——``_judge`` 同时服务 Cookie 探针与投递入口页。
    """
    status, detail = login_status._judge("岗位列表 " * 40)

    assert status == "unknown"
    assert detail == "页面没有账号标记（公开页无法证明登录态）"
    assert "岗位页" not in detail


def test_judge_thin_content_says_too_little():
    assert login_status._judge("") == ("unknown", "页面内容过少，无法判断")
    assert login_status._judge("   ") == ("unknown", "页面内容过少，无法判断")


def test_judge_site_reuses_the_same_reason():
    """站点路径与 Cookie / 浏览器路径共用 ``_judge``：detail 也必须非空。"""
    status, detail = login_status_sites._judge_site(
        {"href": "https://x.example.com/jobs", "text": "岗位列表 " * 40}
    )
    assert (status, detail) == ("unknown", login_status.UNKNOWN_NO_MARKER_DETAIL)


def test_fallback_site_api_reports_a_reason_not_only_a_status(db_session, client, monkeypatch):
    """API 级：回退路径的 `detail` 也要非空（此前只断言了 status）。"""
    _visit(db_session, "https://plain.example.com/jobs", "某站", minutes=1)
    _stub_state(
        monkeypatch,
        {"href": "https://plain.example.com/jobs", "text": "岗位列表 " * 40},
        [],
    )

    response = client.post(
        "/api/login-status/webform-sites/check", json={"host": "plain.example.com"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unknown"
    assert body["detail"] == "页面没有账号标记（公开页无法证明登录态）"
