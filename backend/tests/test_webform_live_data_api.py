# SPDX-License-Identifier: Apache-2.0
"""「点哪个填哪个」的数据读取 API 回归测试。"""

from app.services import webform as webform_service
from app.services.webform import browser as webform_browser


def test_live_start_and_refresh_include_all_profile_values(client, monkeypatch):
    captured: dict[str, object] = {}

    class ActiveBrowserManager:
        def is_active(self) -> bool:
            return True

        def client(self):
            return object()

    def capture_start_live(*args, **kwargs):
        captured["initial_data"] = args[1]
        captured["data_loader"] = kwargs["data_loader"]
        captured["autofill_data_loader"] = kwargs["autofill_data_loader"]

    monkeypatch.setattr(
        webform_browser, "get_browser_manager", lambda _db: ActiveBrowserManager()
    )
    monkeypatch.setattr(webform_service, "is_apply_running", lambda: False)
    monkeypatch.setattr(webform_service, "start_live", capture_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    first_save = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"referral_code": "FIRST123"},
            "details": {
                "referral_code": {
                    "value": "FIRST123",
                    "source": "learned",
                    "reuse": "once",
                }
            },
        },
    )
    assert first_save.status_code == 200

    response = client.post("/api/webform/live/start", json={"ai": False})
    assert response.status_code == 200
    assert captured["initial_data"]["referral_code"] == "FIRST123"

    refresh = captured["data_loader"]
    assert callable(refresh)
    autofill_refresh = captured["autofill_data_loader"]
    assert callable(autofill_refresh)
    second_save = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"referral_code": "UPDATED456"},
            "details": {
                "referral_code": {
                    "value": "UPDATED456",
                    "source": "learned",
                    "reuse": "once",
                }
            },
        },
    )
    assert second_save.status_code == 200

    refreshed_data, _catalog, scope_info = refresh()
    assert refreshed_data["referral_code"] == "UPDATED456"
    # 范围与差异清单跟 data/catalog 出自同一次取数（需求 3 的"三处同源"）。
    assert scope_info["scope"] == "group"
    assert scope_info["filtered_sections"] == []
    assert autofill_refresh()["referral_code"] == "UPDATED456"


def test_live_start_and_refresh_map_a_matching_custom_label(client, monkeypatch):
    captured: dict[str, object] = {}

    class ActiveBrowserManager:
        def is_active(self) -> bool:
            return True

        def client(self):
            return object()

    def capture_start_live(*args, **kwargs):
        captured["initial_data"] = args[1]
        captured["data_loader"] = kwargs["data_loader"]

    monkeypatch.setattr(
        webform_browser, "get_browser_manager", lambda _db: ActiveBrowserManager()
    )
    monkeypatch.setattr(webform_service, "is_apply_running", lambda: False)
    monkeypatch.setattr(webform_service, "start_live", capture_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    custom_key = "CUSTOM_内推码推荐人"
    first_save = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {custom_key: "345354543"},
            "details": {
                custom_key: {
                    "value": "345354543",
                    "source": "manual",
                    "reuse": "general",
                    "label": "内推码/推荐人",
                }
            },
        },
    )
    assert first_save.status_code == 200

    response = client.post("/api/webform/live/start", json={"ai": False})
    assert response.status_code == 200
    assert captured["initial_data"]["referral_code"] == "345354543"

    refresh = captured["data_loader"]
    assert callable(refresh)
    second_save = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {custom_key: "UPDATED456"},
            "details": {
                custom_key: {
                    "value": "UPDATED456",
                    "source": "manual",
                    "reuse": "general",
                    "label": "内推码 / 推荐人",
                }
            },
        },
    )
    assert second_save.status_code == 200

    refreshed_data, _catalog, _scope_info = refresh()
    assert refreshed_data["referral_code"] == "UPDATED456"


def test_live_scope_reaches_the_snapshot_and_survives_a_refresh(client, monkeypatch):
    """范围必须进**快照构造**：切到 all 之后，loader 交出的 scope_info 也要是 all。

    这条守的是需求 3 的硬约束——「不能出现清单按全部、预填按当前组」。如果范围只在
    面板上改而不进 loader，下一次刷新就会悄悄退回 group，而界面上开关还停在 all。
    """
    from types import SimpleNamespace

    calls: list[str] = []
    captured: dict[str, object] = {}

    class ActiveBrowserManager:
        def is_active(self) -> bool:
            return True

        def client(self):
            return object()

    def fake_view(_db, **_kwargs):
        scope = str(_kwargs.get("scope") or "group")
        calls.append(scope)
        return SimpleNamespace(
            data={"name": "张三"} if scope == "all" else {},
            catalog=[],
            scope=scope,
            filtered_sections=() if scope == "all" else ({"key": "education", "name": "教育经历"},),
            filtered_rows=(),
        )

    def capture_start_live(*_args, **kwargs):
        captured["scope"] = kwargs["scope"]
        captured["scope_setter"] = kwargs["scope_setter"]
        captured["data_loader"] = kwargs["data_loader"]

    monkeypatch.setattr(
        webform_browser, "get_browser_manager", lambda _db: ActiveBrowserManager()
    )
    monkeypatch.setattr(webform_service, "is_apply_running", lambda: False)
    monkeypatch.setattr(webform_service, "start_live", capture_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})
    monkeypatch.setattr(webform_service, "build_webform_view", fake_view)

    response = client.post("/api/webform/live/start", json={"ai": False, "scope": "all"})
    assert response.status_code == 200
    assert captured["scope"] == "all"

    data, _catalog, scope_info = captured["data_loader"]()
    assert data == {"name": "张三"}
    assert scope_info["scope"] == "all"

    # 面板切回「仅当前方案」：写回持有者，下一次取数立刻跟着变。
    captured["scope_setter"]("group")
    _data, _catalog, scope_info = captured["data_loader"]()
    assert scope_info["scope"] == "group"
    assert scope_info["filtered_sections"] == [{"key": "education", "name": "教育经历"}]


def test_live_scope_endpoint_delegates_to_the_service(client, monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(webform_service, "request_live_scope", seen.append)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post("/api/webform/live/scope", json={"scope": "all"})

    assert response.status_code == 200
    assert seen == ["all"]
