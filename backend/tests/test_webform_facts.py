# SPDX-License-Identifier: Apache-2.0
"""补充事实接入网申填表：目录、表单数据与放宽模式标签。

守三条边界：
1. 事实可见字段进入 catalog / data / custom_labels；
2. hidden 默认字段、credential_number 永不出现在任何取数结果里；
3. 已有简历/网申资料优先，事实只补空缺。
"""

from __future__ import annotations

import json

from app.services.webform import build_catalog, build_form_data, fact_custom_labels


def _create_fact(client, kind: str, payload: dict):
    response = client.post("/api/profile/facts", json={"kind": kind, "payload": payload})
    assert response.status_code == 201, response.text
    return response.json()


def _schema(client, kind: str) -> dict:
    response = client.get("/api/profile/facts/schema")
    assert response.status_code == 200, response.text
    return next(item for item in response.json()["kinds"] if item["kind"] == kind)


def _update_schema(client, kind: str, *, hidden_fields, custom_fields, expected_revision):
    response = client.put(
        f"/api/profile/facts/schema/{kind}",
        json={
            "hidden_fields": hidden_fields,
            "custom_fields": custom_fields,
            "expected_revision": expected_revision,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _reset_schema(client, kind: str, expected_revision: int) -> dict:
    response = client.post(
        f"/api/profile/facts/schema/{kind}/reset",
        json={"expected_revision": expected_revision},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _add_custom_field(client, kind: str, key: str, label: str) -> dict:
    current = _schema(client, kind)
    return _update_schema(
        client,
        kind,
        hidden_fields=list(current["hidden_fields"]),
        custom_fields=[*current["custom_fields"], {"key": key, "label": label}],
        expected_revision=current["revision"],
    )


def test_credential_fact_feeds_webform_without_private_number(client, db_session):
    _add_custom_field(client, "credential", "cf_aaaaaaaaaaaa", "证书编号后四位")
    _create_fact(
        client,
        "credential",
        {
            "name": "示例注册工程师",
            "issuer": "示例认证机构",
            "status": "active",
            "credential_number": "SECRET-NUMBER-123",
            "custom_fields": [
                {"key": "cf_aaaaaaaaaaaa", "label": "证书编号后四位", "value": "8888"}
            ],
        },
    )

    data = build_form_data(db_session)
    assert "示例注册工程师" in data["professional_cert"]
    fact_keys = [key for key in data if key.startswith("CUSTOM_FACT_")]
    assert fact_keys, "事实字段应以 CUSTOM_FACT_ key 进入 data（供放宽模式匹配）"
    dumped_data = json.dumps(data, ensure_ascii=False)
    assert "SECRET-NUMBER-123" not in dumped_data

    catalog = build_catalog(db_session)
    labels = [entry["label"] for entry in catalog]
    assert "证书名称" in labels
    assert "证书编号后四位" in labels
    assert any(entry["group"] == "补充事实：资格证照" for entry in catalog)
    dumped_catalog = json.dumps(catalog, ensure_ascii=False)
    assert "SECRET-NUMBER-123" not in dumped_catalog

    custom_labels = fact_custom_labels(db_session)
    assert set(custom_labels) == set(fact_keys)
    assert "证书编号后四位" in custom_labels.values()


def test_hidden_default_field_is_not_exported_and_restores(client, db_session):
    _create_fact(
        client,
        "credential",
        {"name": "示例资格", "issuer": "示例颁发机构", "status": "active"},
    )
    current = _schema(client, "credential")
    updated = _update_schema(
        client,
        "credential",
        hidden_fields=["issuer"],
        custom_fields=current["custom_fields"],
        expected_revision=current["revision"],
    )
    assert updated["hidden_fields"] == ["issuer"]

    hidden_data = json.dumps(build_form_data(db_session), ensure_ascii=False)
    hidden_catalog = json.dumps(build_catalog(db_session), ensure_ascii=False)
    assert "示例颁发机构" not in hidden_data
    assert "示例颁发机构" not in hidden_catalog

    reset = _reset_schema(client, "credential", updated["revision"])
    assert reset["hidden_fields"] == []
    restored_data = json.dumps(build_form_data(db_session), ensure_ascii=False)
    assert "示例颁发机构" in restored_data
    # 隐藏没有删除底层值：恢复默认后旧值仍可见。
    fact = client.get("/api/profile/facts").json()["items"][0]
    assert fact["payload"]["issuer"] == "示例颁发机构"


def test_new_kinds_feed_webform_fields_and_catalog(client, db_session):
    _create_fact(
        client,
        "award",
        {"name": "示例技能大赛", "issuer": "示例协会", "date": "2025-06", "level": "省级"},
    )
    _create_fact(
        client,
        "language",
        {"name": "英语", "level": "熟练", "certificate": "CET-6", "score": "560"},
    )
    _create_fact(
        client,
        "training",
        {"name": "数据分析训练营", "organization": "示例学院", "hours": "40"},
    )

    data = build_form_data(db_session)
    assert data["award_name"] == "示例技能大赛"
    assert "英语" in data["language_other"] and "CET-6" in data["language_other"]
    assert "数据分析训练营" in json.dumps(build_form_data(db_session), ensure_ascii=False)

    catalog = build_catalog(db_session)
    groups = {entry["group"] for entry in catalog}
    assert "补充事实：荣誉与获奖" in groups
    assert "补充事实：语言能力" in groups
    assert "补充事实：培训与课程" in groups


def test_unique_custom_label_maps_to_canonical_field(client, db_session):
    _add_custom_field(client, "work_project", "cf_bbbbbbbbbbbb", "职业资格证书")
    _create_fact(
        client,
        "work_project",
        {
            "name": "示例作品",
            "custom_fields": [
                {"key": "cf_bbbbbbbbbbbb", "label": "职业资格证书", "value": "电气工程师"}
            ],
        },
    )
    data = build_form_data(db_session)
    assert data.get("professional_cert") == "电气工程师"


def test_existing_values_win_over_fact_values(client, db_session):
    # 网申资料里已有 professional_cert 时，事实不得覆盖。
    client.put(
        "/api/webform/extra-profile",
        json={"values": {"professional_cert": "已有的证书"}},
    )
    _create_fact(
        client,
        "credential",
        {"name": "事实里的证书", "issuer": "示例机构", "status": "active"},
    )
    data = build_form_data(db_session)
    assert data["professional_cert"] == "已有的证书"
