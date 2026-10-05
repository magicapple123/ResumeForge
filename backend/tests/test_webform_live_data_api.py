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

    refreshed_data, _catalog = refresh()
    assert refreshed_data["referral_code"] == "UPDATED456"
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

    refreshed_data, _catalog = refresh()
    assert refreshed_data["referral_code"] == "UPDATED456"
