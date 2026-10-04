"""网申填表接口 · live 会话的记忆落点与开关。

「记住这条」经接口转发、默认落点只在网申资料（简历资料一个字都不许动），以及
live 开关只切功能不动会话。共享桩 ``browser_port`` 见 ``test_webform_api.py``。
"""
from app.models.profile import UserProfile
from app.services import webform as webform_service

from test_webform_api import browser_port

# page_client 式的 fixture re-export：pytest 按本模块命名空间解析 fixture。
__all__ = ["browser_port"]


def test_memory_targets_endpoint_returns_only_the_web_form_profile(
    client, browser_port, db_session
):
    """**只剩「网申资料」**——简历资料里的字段（姓名、教育）一个都不在里面。

    这几条目标以前是有的：按一下「记住这条」就能改简历资料里的值。2026-09-28 收掉了，
    理由见 ``services/webform/profile_targets.py`` 的模块说明。这里从**接口**这一层
    再确认一次，防止有人只改了服务层却漏了这条出口。
    """
    from app.models.profile import Education
    from app.services.webform import extra_profile

    profile = UserProfile(name="张三")
    profile.educations.append(Education(school="天津工业大学", courses="操作系统"))
    db_session.add(profile)
    db_session.commit()
    extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名", source="manual"
    )

    response = client.get("/api/webform/memory-targets")

    assert response.status_code == 200
    targets = {item["target_id"]: item for item in response.json()["targets"]}
    assert targets["extra:CUSTOM_导师姓名"]["label"] == "导师姓名"
    assert all(key.startswith("extra:") for key in targets), targets
    assert "profile:name" not in targets
    assert not [key for key in targets if key.startswith("educations:")]


def test_live_remember_endpoint_forwards_the_user_selected_target(
    client, browser_port, monkeypatch
):
    received: dict[str, str] = {}

    def remember_live_choice(**payload):
        received.update(payload)
        return True

    monkeypatch.setattr(webform_service, "remember_live_choice", remember_live_choice)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post(
        "/api/webform/live/remember",
        json={
            "target_id": "extra:height",
            "value": "180",
            "label": "身高",
            "reuse": "general",
        },
    )

    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert received == {
        "target_id": "extra:height",
        "value": "180",
        "label": "身高",
        "reuse": "general",
    }


def test_live_start_remember_defaults_to_the_web_form_profile_never_the_resume(
    client, browser_port, db_session, monkeypatch
):
    """默认落点**只在网申资料**——哪怕这个字段在「我的资料」里已经有值。

    这条断言以前是 ``target_id == "profile:name"``，也就是把值写进简历资料。
    2026-09-28 收紧了：简历资料会被生成进简历正文，按一下「记住这条」顺手改掉它，
    代价比放进网申资料大得多。**这里连"简历资料一个字都没变"一起断言**。
    """
    from app.services.webform import extra_profile

    browser_port.listening = True
    db_session.add(UserProfile(name="张三"))
    db_session.commit()
    captured: dict[str, object] = {}

    def fake_start_live(*args, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(webform_service, "start_live", fake_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post("/api/webform/live/start", json={"ai": False})

    assert response.status_code == 200
    assert captured["require_memory_choice"] is False
    store = captured["store"]
    assert callable(store)

    entry = {"key": "name", "label": "姓名", "value": "李四"}
    assert store(entry) is True
    assert entry["target_id"] == "custom", "默认落点不该指向简历资料里的字段"
    assert entry["destination"].startswith("网申资料")
    assert db_session.query(UserProfile).one().name == "张三", "简历资料被改动了"
    assert extra_profile.list_entries(db_session)["CUSTOM_姓名"] == "李四"


def test_live_start_remember_adds_an_unknown_field_to_extra_profile(
    client, browser_port, db_session, monkeypatch
):
    from app.services.webform import extra_profile

    browser_port.listening = True
    db_session.add(UserProfile(name="张三"))
    db_session.commit()
    captured: dict[str, object] = {}

    def fake_start_live(*args, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(webform_service, "start_live", fake_start_live)
    monkeypatch.setattr(webform_service, "live_status", lambda: {"running": True})

    response = client.post("/api/webform/live/start", json={"ai": False})

    assert response.status_code == 200
    store = captured["store"]
    assert callable(store)

    entry = {"key": "CUSTOM_导师姓名", "label": "导师姓名", "value": "王教授"}
    assert store(entry) is True
    assert entry["target_id"] == "custom"
    assert entry["destination"].startswith("网申资料")
    assert extra_profile.list_entries(db_session)["CUSTOM_导师姓名"] == "王教授"


def test_live_enabled_toggles_only_the_feature_and_keeps_the_session(client, monkeypatch):
    calls: list[bool] = []
    monkeypatch.setattr(webform_service, "set_live_enabled", calls.append)
    monkeypatch.setattr(
        webform_service,
        "live_status",
        lambda: {"running": True, "enabled": False},
    )

    response = client.post("/api/webform/live/enabled", json={"enabled": False})

    assert response.status_code == 200
    assert calls == [False]
    assert response.json()["running"] is True
    assert response.json()["enabled"] is False
