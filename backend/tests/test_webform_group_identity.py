# SPDX-License-Identifier: Apache-2.0
"""System groups use stable identities without renaming user fields."""

from app.services.webform.field_types import GROUP_IDENTITY, LEGACY_GROUP_IDS, normalize_group_id


def test_all_catalog_outputs_use_ascii_group_identities(client):
    for route in ("fields", "extra-profile"):
        response = client.get(f"/api/webform/{route}")
        assert response.status_code == 200
        body = response.json()
        assert all(group.isascii() and group.islower() for group in body["groups"])
        assert {field["group"] for field in body["fields"]} <= set(body["groups"])
    assert GROUP_IDENTITY == "identity"
    assert all(normalize_group_id(legacy).isascii() for legacy in LEGACY_GROUP_IDS)
    assert normalize_group_id("新建的用户分组") == "新建的用户分组"


def test_custom_group_keeps_persisted_field_key_and_user_label(client):
    key = "CUSTOM_导师姓名"
    response = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {key: "Professor Example"},
            "details": {
                key: {
                    "value": "Professor Example",
                    "source": "manual",
                    "reuse": "general",
                    "label": "My advisor",
                }
            },
        },
    )
    assert response.status_code == 200
    field = next(item for item in response.json()["fields"] if item["key"] == key)
    assert field["group"] == "custom"
    assert field["label"] == "My advisor"
    targets = client.get("/api/webform/memory-targets")
    assert targets.status_code == 200
    target = next(item for item in targets.json()["targets"] if item["field_key"] == key)
    assert target["group"] == "custom"
    assert target["target_id"] == f"extra:{key}"
    assert target["label"] == "My advisor"
    assert all(item["group"].isascii() for item in targets.json()["targets"])
