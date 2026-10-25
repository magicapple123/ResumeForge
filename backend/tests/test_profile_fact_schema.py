# SPDX-License-Identifier: Apache-2.0
"""补充事实的字段设置 API 与隐藏字段语义（灵活化契约 §3-4）。

守住的性质：

1. GET/PUT/reset 的形状与 revision 条件写（409 + 顶层 code）；
2. 未知字段/重复/超限/重名 → 400，且失败不落库；
3. 隐藏字段：create 忽略客户端值、update 保留旧值、reset 后旧值恢复可见；
4. 事实 payload 里始终保留完整值（隐藏只是"不用"，不是清空）。
"""

from __future__ import annotations

import copy
import re

import pytest
from app.database import SessionLocal
from app.services.profile.fact_field_schema import (
    FACT_DEFAULT_FIELDS,
    KindFieldSchema,
    custom_fields_of,
    load_field_schemas,
    visible_default_fields,
    visible_payload,
)

FACTS_API = "/api/profile/facts"
SCHEMA_API = "/api/profile/facts/schema"
KINDS = list(FACT_DEFAULT_FIELDS)
CUSTOM_KEY_RE = re.compile(r"^cf_[0-9a-f]{12}$")


def _get_schema(client) -> dict:
    response = client.get(SCHEMA_API)
    assert response.status_code == 200, response.text
    return response.json()


def _schema_of(client, kind: str) -> dict:
    for item in _get_schema(client)["kinds"]:
        if item["kind"] == kind:
            return item
    raise AssertionError(f"schema 里没有 {kind}")


def _put_schema(client, kind: str, *, hidden=None, custom=None, expected_revision=0):
    return client.put(
        f"{SCHEMA_API}/{kind}",
        json={
            "hidden_fields": hidden or [],
            "custom_fields": custom or [],
            "expected_revision": expected_revision,
        },
    )


def _reset_schema(client, kind: str, *, expected_revision: int):
    return client.post(f"{SCHEMA_API}/{kind}/reset", json={"expected_revision": expected_revision})


def _create(client, kind: str, payload: dict):
    response = client.post(FACTS_API, json={"kind": kind, "payload": payload})
    assert response.status_code == 201, response.text
    return response.json()


def _list(client) -> list[dict]:
    response = client.get(FACTS_API)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _patch(client, fact_id: str, payload: dict, expected_revision: int = 1):
    response = client.patch(
        f"{FACTS_API}/{fact_id}",
        json={"payload": payload, "expected_revision": expected_revision},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _publication_payload(**overrides) -> dict:
    payload = {
        "title": "原始论文",
        "authors": [{"name": "张三", "is_self": True}],
        "venue": "期刊A",
        "year": "2024",
        "status": "published",
        "note": "备注",
    }
    payload.update(overrides)
    return payload


# ===== GET / PUT / reset 的基本形状 =====


def test_get_schema_returns_nine_kinds_with_defaults(client):
    body = _get_schema(client)

    assert body["max_custom_field_value_chars"] == 2000
    assert [item["kind"] for item in body["kinds"]] == KINDS
    for item in body["kinds"]:
        assert item["default_fields"] == list(FACT_DEFAULT_FIELDS[item["kind"]])
        assert item["hidden_fields"] == []
        assert item["custom_fields"] == []
        assert item["revision"] == 0
        assert item["max_custom_fields"] == 20


def test_put_hides_defaults_and_generates_custom_keys(client):
    created = _put_schema(
        client,
        "publication",
        hidden=["title", "note"],
        custom=[{"label": "影响因子"}],
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["revision"] == 1
    assert body["hidden_fields"] == ["title", "note"]
    assert len(body["custom_fields"]) == 1
    generated = body["custom_fields"][0]
    assert CUSTOM_KEY_RE.fullmatch(generated["key"])
    assert generated["label"] == "影响因子"

    # 第二次 PUT：回传已有 key 保留身份，隐藏项整体替换，revision +1。
    updated = _put_schema(
        client,
        "publication",
        hidden=["url"],
        custom=[{"key": generated["key"], "label": "影响因子（五年）"}],
        expected_revision=1,
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["revision"] == 2
    assert body["hidden_fields"] == ["url"]
    assert body["custom_fields"] == [{"key": generated["key"], "label": "影响因子（五年）"}]
    assert _schema_of(client, "publication")["revision"] == 2
    # 其他类型不受影响：定义是按类型的。
    assert _schema_of(client, "award")["revision"] == 0


def test_put_conflict_returns_409_with_code(client):
    first = _put_schema(client, "award", hidden=["issuer"], expected_revision=0)
    assert first.status_code == 200

    stale = _put_schema(client, "award", hidden=["level"], expected_revision=0)
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "profile_fact_schema_revision_conflict"
    assert body["revision"] == 1
    assert body["detail"]
    # 冲突不落库：旧设置原样保留。
    assert _schema_of(client, "award")["hidden_fields"] == ["issuer"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"hidden_fields": ["not_a_field"]}, id="unknown-hidden"),
        pytest.param({"custom_fields": [{"label": ""}]}, id="empty-label"),
        pytest.param({"custom_fields": [{"label": "  "}]}, id="blank-label"),
        pytest.param({"custom_fields": [{"label": "标题"}]}, id="label-equals-default"),
        pytest.param({"custom_fields": [{"label": "长" * 41}]}, id="label-too-long"),
        pytest.param({"custom_fields": [{"label": "甲"}, {"label": "甲"}]}, id="duplicate-labels"),
        pytest.param(
            {"custom_fields": [{"key": "cf_zzzzzzzzzzzz", "label": "甲"}]},
            id="bad-key",
        ),
        pytest.param(
            {
                "custom_fields": [
                    {"key": "cf_0123456789ab", "label": "甲"},
                    {"key": "cf_0123456789ab", "label": "乙"},
                ]
            },
            id="duplicate-keys",
        ),
        pytest.param(
            {"custom_fields": [{"label": f"字段{index}"} for index in range(21)]},
            id="too-many-custom-fields",
        ),
    ],
)
def test_put_rejects_invalid_configurations_with_400(client, body):
    request = {"hidden_fields": [], "custom_fields": [], "expected_revision": 0, **body}
    response = client.put(f"{SCHEMA_API}/publication", json=request)
    assert response.status_code == 400, response.text
    assert response.json()["detail"]
    # 失败不落库。
    assert _schema_of(client, "publication")["revision"] == 0


def test_reset_restores_defaults_and_checks_revision(client):
    # 从未配置过：reset 等价于默认，不写库。
    fresh = _reset_schema(client, "language", expected_revision=0)
    assert fresh.status_code == 200
    assert fresh.json()["revision"] == 0
    assert fresh.json()["hidden_fields"] == []

    assert _put_schema(client, "language", hidden=["score"], expected_revision=0).status_code == 200
    reset = _reset_schema(client, "language", expected_revision=1)
    assert reset.status_code == 200, reset.text
    assert reset.json()["revision"] == 2
    assert reset.json()["hidden_fields"] == []
    assert reset.json()["custom_fields"] == []

    stale = _reset_schema(client, "language", expected_revision=1)
    assert stale.status_code == 409
    assert stale.json()["code"] == "profile_fact_schema_revision_conflict"
    assert stale.json()["revision"] == 2


# ===== 隐藏字段的保留 / 恢复语义 =====


def test_hidden_fields_are_kept_on_update_and_ignored_on_create(client):
    fact = _create(client, "publication", _publication_payload())
    assert fact["payload"]["title"] == "原始论文"

    assert (
        _put_schema(client, "publication", hidden=["title"], expected_revision=0).status_code == 200
    )

    # update：客户端看不到 title，即使传了新值也保留旧值；其余字段正常更新。
    payload = copy.deepcopy(fact["payload"])
    payload["title"] = "客户端想改的标题"
    payload["note"] = "更新后的备注"
    updated = _patch(client, fact["fact_id"], payload, expected_revision=1)
    assert updated["payload"]["title"] == "原始论文"
    assert updated["payload"]["note"] == "更新后的备注"

    # create：隐藏字段的客户端值被忽略，落成字段默认值。
    created_hidden = _create(client, "publication", _publication_payload(title="隐藏字段不该落库"))
    assert created_hidden["payload"]["title"] == ""

    # 列表/详情里仍是完整 payload：隐藏只是"不用"，底层旧值还在。
    stored = {item["fact_id"]: item for item in _list(client)}
    assert stored[fact["fact_id"]]["payload"]["title"] == "原始论文"


def test_hidden_values_are_visible_again_after_reset(client):
    fact = _create(client, "publication", _publication_payload())
    assert (
        _put_schema(client, "publication", hidden=["title"], expected_revision=0).status_code == 200
    )
    assert _schema_of(client, "publication")["hidden_fields"] == ["title"]

    assert _reset_schema(client, "publication", expected_revision=1).status_code == 200
    assert _schema_of(client, "publication")["hidden_fields"] == []

    payload = copy.deepcopy(fact["payload"])
    payload["title"] = "恢复可见后可以改"
    updated = _patch(client, fact["fact_id"], payload, expected_revision=1)
    assert updated["payload"]["title"] == "恢复可见后可以改"


# ===== 字段目录的纯函数 =====


def test_visible_default_fields_and_visible_payload():
    schema = KindFieldSchema(
        kind="credential",
        revision=3,
        hidden_fields=("credential_number",),
        custom_fields=({"key": "cf_0123456789ab", "label": "等级"},),
    )
    visible = visible_default_fields("credential", schema)
    assert "credential_number" not in visible
    assert visible[0] == "name"
    assert len(visible) == len(FACT_DEFAULT_FIELDS["credential"]) - 1

    payload = {
        "name": "PMP",
        "credential_number": "SECRET-1",
        "custom_fields": [{"key": "cf_0123456789ab", "label": "等级", "value": "高级"}],
    }
    stripped = visible_payload("credential", payload, schema)
    assert "credential_number" not in stripped
    # custom_fields 原样返回（是否使用由调用方按定义决定）。
    assert stripped["custom_fields"] == payload["custom_fields"]


def test_custom_fields_of_normalizes_and_drops_empty_values():
    payload = {
        "custom_fields": [
            {"key": "cf_0123456789ab", "label": " 甲 ", "value": " 1 "},
            {"key": "cf_abcdef012345", "label": "乙", "value": "   "},
            {"key": "cf_111111111111", "label": "", "value": "x"},
            "not-a-dict",
        ]
    }
    assert custom_fields_of(payload) == [{"label": "甲", "value": "1"}]


def test_load_field_schemas_defaults_cover_all_nine_kinds():
    with SessionLocal() as db:
        schemas = load_field_schemas(db)
    assert list(schemas) == KINDS
    for kind, schema in schemas.items():
        assert schema.revision == 0
        assert schema.hidden_fields == ()
        assert schema.custom_fields == ()
        assert schema.kind == kind
