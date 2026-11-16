# SPDX-License-Identifier: Apache-2.0
"""「恢复默认」与快照接口的守卫（I-10 阶段 2 / 4）。

断言口径（与问题清单的验收项一一对应）：

- 可重置项列表里**没有密钥键**；
- 按 key / 按 scope 恢复默认都生效，且**带 Key 的卡只复位参数、不删 Key**；
- 未知键、密钥键、未知 scope、"scope 与 keys 都给"一律 **422 且零写入**；
- 快照导出物 grep 不到任何密钥形态；导入未知键 422 且库零变化；版本过新 422。
"""

from __future__ import annotations

import json

from app.models.setting import AppSetting
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

_SECRET_KEYS = ("asr_api_key", "tracker.probe.cookie", "search_deepseek_api_key")


def test_reset_targets_list_resettable_keys_without_secrets(client: TestClient):
    payload = client.get("/api/settings/reset-targets").json()
    keys = [entry["key"] for entry in payload["entries"]]
    assert "webform_relaxed_mode" in keys
    assert "llm_config" in keys
    for secret in _SECRET_KEYS:
        assert secret not in keys, f"密钥键 {secret} 不得出现在可重置列表里"
    assert payload["scopes"], "至少要有一个可重置分组"
    for entry in payload["entries"]:
        assert set(entry) >= {"key", "scope", "kind", "storage", "default", "current", "is_default"}


def test_reset_targets_rejects_unknown_scope(client: TestClient):
    assert client.get("/api/settings/reset-targets?scope=nope").status_code == 422


def test_reset_by_keys_restores_default(client: TestClient):
    put = client.put("/api/settings/webform-relaxed-mode", json={"enabled": True})
    assert put.status_code == 200
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is True

    response = client.post("/api/settings/reset", json={"keys": ["webform_relaxed_mode"]})
    assert response.status_code == 200
    body = response.json()
    assert body["reset"][0]["before"] is True
    assert body["reset"][0]["after"] is False
    assert body["dataset_scoped"] is True
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is False


def test_reset_unknown_key_is_422_and_writes_nothing(client: TestClient):
    client.put("/api/settings/webform-relaxed-mode", json={"enabled": True})
    response = client.post(
        "/api/settings/reset", json={"keys": ["webform_relaxed_mode", "not_a_setting"]}
    )
    assert response.status_code == 422
    # 零写入：可重置的那个键也不能被顺手改掉
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is True


def test_reset_rejects_secret_key(client: TestClient):
    for secret in _SECRET_KEYS:
        response = client.post("/api/settings/reset", json={"keys": [secret]})
        assert response.status_code == 422, f"密钥键 {secret} 必须被拒绝"


def test_reset_requires_exactly_one_of_scope_and_keys(client: TestClient):
    assert client.post("/api/settings/reset", json={}).status_code == 422
    both = client.post(
        "/api/settings/reset", json={"scope": "model", "keys": ["webform_relaxed_mode"]}
    )
    assert both.status_code == 422
    assert client.post("/api/settings/reset", json={"scope": "nope"}).status_code == 422
    assert client.post("/api/settings/reset", json={"keys": []}).status_code == 422


def test_reset_scope_model_keeps_api_key_and_leaves_other_scopes(
    client: TestClient, db_session: Session
):
    """`scope:"model"` 复位参数但保留 API Key；其它 scope 的值不受影响。"""
    db_session.add(
        AppSetting(
            key="llm_config",
            value=json.dumps(
                {
                    "api_key": "enc-placeholder",
                    "base_url": "https://example.test/v1",
                    "model": "kept-model",
                    "temperature": 1.4,
                }
            ),
        )
    )
    db_session.commit()
    client.put("/api/settings/webform-relaxed-mode", json={"enabled": True})

    response = client.post("/api/settings/reset", json={"scope": "model"})
    assert response.status_code == 200
    assert "llm_config" in [item["key"] for item in response.json()["reset"]]

    stored = json.loads(db_session.get(AppSetting, "llm_config").value)
    assert stored["api_key"] == "enc-placeholder"
    assert stored["base_url"] == "https://example.test/v1"
    assert stored["temperature"] == 0.1
    # 其它 scope 原样保留
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is True


def test_snapshot_export_contains_no_secrets(client: TestClient, db_session: Session):
    db_session.add_all(
        [
            AppSetting(
                key="llm_config",
                value=json.dumps({"api_key": "sk-live-SNAPSHOT-SECRET", "temperature": 1.1}),
            ),
            AppSetting(key="asr_api_key", value="sk-asr-SNAPSHOT-SECRET"),
            AppSetting(key="tracker.probe.cookie", value="sessionid=SNAPSHOT-COOKIE"),
        ]
    )
    db_session.commit()

    response = client.get("/api/settings/snapshot")
    assert response.status_code == 200
    body = response.json()
    text = json.dumps(body, ensure_ascii=False)
    assert body["format_version"] >= 1
    assert body["dataset_scoped"] is True
    for marker in ("SNAPSHOT-SECRET", "SNAPSHOT-COOKIE", "api_key", "cookie"):
        assert marker not in text, f"快照导出物里出现了 {marker}"
    assert body["settings"]["llm_config"]["temperature"] == 1.1


def test_snapshot_import_round_trip(client: TestClient):
    client.put("/api/settings/reminder-popup", json={"enabled": False})
    exported = client.get("/api/settings/snapshot").json()
    client.put("/api/settings/reminder-popup", json={"enabled": True})

    response = client.post("/api/settings/snapshot", json=exported)
    assert response.status_code == 200
    applied = [item["key"] for item in response.json()["applied"]]
    assert "reminder_popup_on_start" in applied
    assert client.get("/api/settings/reminder-popup").json()["enabled"] is False


def test_snapshot_import_unknown_key_is_422_and_writes_nothing(client: TestClient):
    response = client.post(
        "/api/settings/snapshot",
        json={
            "format_version": 1,
            "settings": {"webform_relaxed_mode": True, "not_a_setting": True},
        },
    )
    assert response.status_code == 422
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is False


def test_snapshot_import_rejects_newer_version(client: TestClient):
    response = client.post(
        "/api/settings/snapshot",
        json={"format_version": 99, "settings": {"webform_relaxed_mode": True}},
    )
    assert response.status_code == 422
    assert client.get("/api/settings/webform-relaxed-mode").json()["enabled"] is False


def test_snapshot_import_rejects_secret_key_in_payload(client: TestClient):
    response = client.post(
        "/api/settings/snapshot",
        json={"format_version": 1, "settings": {"asr_api_key": "sk-injected"}},
    )
    assert response.status_code == 422
