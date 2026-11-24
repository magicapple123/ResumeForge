# SPDX-License-Identifier: Apache-2.0
"""F07 / I-29：网申登录态**逐站点**的口径。

三条不许退化的性质：
1. 清单只来自服务端派生（`web_form_fill_record` + `web_form_url_history`），前端只能传 host；
2. 未配置受限页的站点走公开页回退，**内容再正常也只能 `unknown`**（I-29）；
3. 受限页"跳登录 → logged-out / 出内容 → ok / 空壳或 404 → unknown"三分，猜错 URL 会误报失效。

从 `test_login_status.py` 按 500 行预算拆出（纯搬迁，用例数与断言逐条不变）。
共享脚手架在 `login_status_fixtures.py`。
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


# ===== F07：网申站点清单与逐站点检测 =====


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
        ({"href": "https://x.example.com/passport/login?next=1", "text": "随便"}, "logged-out"),
        ({"href": "https://x.example.com/jobs", "text": "密码登录 扫码登录"}, "logged-out"),
        (
            {
                "href": "https://ats.example.com/apply",
                "text": "Sign in to continue. Password",
                "hasPassword": True,
            },
            "logged-out",
        ),
        # I-29：公开页内容完整也不再是 ok——"没看到登录墙"对公开页恒真。
        ({"href": "https://x.example.com/jobs", "text": "岗位列表 " * 40}, "unknown"),
        ({"href": "https://x.example.com/jobs", "text": ""}, "unknown"),
        # 账号标记是唯一的正面证据。
        (
            {"href": "https://x.example.com/jobs", "text": "我的投递 个人中心 " * 40},
            "ok",
        ),
        # 独立的「登录」CTA：页面有内容但没登录。
        (
            {
                "href": "https://x.example.com/jobs",
                "text": "校园招聘 岗位列表 " * 20 + "\n登录\n",
            },
            "logged-out",
        ),
        # 「退出登录」含「登录」：不能把已登录的页面判成未登录。
        (
            {
                "href": "https://x.example.com/jobs",
                "text": "岗位列表 " * 40 + "\n退出登录",
            },
            "ok",
        ),
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


def test_parent_row_reports_logged_out_over_other_states(db_session):
    """I-29：1 个未登录 + 4 个未检测 → 父行「未登录」，detail 里要有「1 未登录」。"""
    for index in range(5):
        _visit(db_session, f"https://s{index}.example.com/jobs", f"S{index}", minutes=index)
    login_status_sites._save_site_status(
        db_session,
        "s0.example.com",
        "logged-out",
        "页面显示登录入口",
        "https://s0.example.com/jobs",
    )

    row = next(
        item for item in login_status.list_statuses(db_session) if item["id"] == "webform_browser"
    )

    assert row["status"] == "logged-out"
    assert row["detail"] == "5 个站点 · 0 正常 · 1 未登录"


# ===== I-29：受限页探测（GATED_PROBE）与回退路径 =====


def test_gated_probe_prefers_the_restricted_page(db_session, monkeypatch):
    """受限页可访问 = 登录的硬证据：detail 要写明这一点。"""
    _visit(db_session, "https://jobs.bytedance.com/campus/position", "字节校招", minutes=1)
    opened: list[str] = []
    _stub_state(
        monkeypatch,
        {
            "href": "https://jobs.bytedance.com/campus/position/application",
            "text": "我的投递 应聘记录 " * 30,
        },
        opened,
    )

    row = login_status_sites.check_webform_site(db_session, "jobs.bytedance.com")

    assert opened == ["https://jobs.bytedance.com/campus/position/application"]
    assert row["status"] == "ok"
    assert row["detail"] == "受限页可访问"


def test_gated_probe_bounced_to_login_is_logged_out(db_session, monkeypatch):
    """受限页被弹回登录 → logged-out，detail 说明「停在登录页」。"""
    _visit(db_session, "https://jobs.bytedance.com/campus/position", "字节校招", minutes=1)
    _stub_state(
        monkeypatch,
        {
            "href": (
                "https://jobs.bytedance.com/campus/login?redirect_path=%2Fposition%2Fapplication"
            ),
            "text": "登录 扫码登录",
        },
        [],
    )

    row = login_status_sites.check_webform_site(db_session, "jobs.bytedance.com")

    assert row["status"] == "logged-out"
    assert row["detail"] == "停在登录页"


def test_gated_probe_empty_shell_is_unknown_not_ok(db_session, monkeypatch):
    """受限页返回空壳 / 404 时落 unknown：不能因为"没看到登录页"又回到 ok。"""
    _visit(db_session, "https://jobs.bytedance.com/campus/position", "字节校招", minutes=1)
    _stub_state(monkeypatch, {"href": "https://jobs.bytedance.com/x", "text": ""}, [])

    assert login_status_sites.check_webform_site(db_session, "jobs.bytedance.com")["status"] == (
        "unknown"
    )


def test_fallback_public_page_never_reports_ok(db_session, monkeypatch):
    """未配置受限页的站点退回岗位页：内容再正常也只能「无法判断」。"""
    _visit(db_session, "https://plain.example.com/jobs", "某站", minutes=1)
    _stub_state(
        monkeypatch,
        {"href": "https://plain.example.com/jobs", "text": "岗位列表 " * 40},
        [],
    )

    row = login_status_sites.check_webform_site(db_session, "plain.example.com")

    assert row["status"] == "unknown"


def test_gated_sites_only_the_ones_with_hard_evidence_are_configured():
    """不要猜 URL：本轮只有 bytedance 两条证据都成立，其余 4 站必须留空走回退。"""
    assert login_status_sites.GATED_PROBE == {"jobs.bytedance.com": "/campus/position/application"}


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
