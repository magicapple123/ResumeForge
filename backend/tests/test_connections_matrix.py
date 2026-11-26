# SPDX-License-Identifier: Apache-2.0
"""依赖矩阵（#9）的契约用例：矩阵的每一个格子都要**由 registry 投影**，前端零清单。

为什么这些断言只能在后端做：

1. 前端不许按 id 判断"这把 Key 是不是覆盖式"——`kind` 必须从响应里来。这条只有
   "构造一条覆盖式来源，看响应怎么说"能验证；
2. "新增一把 Key → 矩阵多一列"必须由后端证明：前端代码一行不改也能多一列，靠的就是
   registry 声明与这里的投影；
3. `used_by` 里写了不存在的 feature id 时**必须当场报错**，不能静默少一行——那种
   症状（"某个功能从矩阵里消失"）在界面上看不出来，只有启动校验能兜住。

只挂 `app.api.connections.router` 建最小 app：本模块的契约是"一次给齐三组 + 矩阵"，
挂进整站会让失败信息指向无关的启动逻辑。
"""

from __future__ import annotations

import pytest
from app.api import connections as connections_api
from app.database import get_db
from app.services import connections_view
from app.services.connections_view import build_connections, build_matrix
from app.services.credentials import CREDENTIAL_SOURCES
from app.services.credentials.registry import (
    FEATURE_GROUP_LABELS,
    FEATURES,
    GROUP_LLM,
    validate_matrix_references,
)
from app.services.credentials.types import CredentialFeature, CredentialScope, CredentialSource
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def matrix_client(db_session):
    """只挂本模块 router 的最小 app；`get_db` 覆盖成同一个会话。"""
    app = FastAPI()
    app.include_router(connections_api.router)

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _matrix(client: TestClient) -> dict:
    return client.get("/api/connections").json()["matrix"]


def test_columns_and_rows_follow_registry_declaration_order(matrix_client):
    """行列顺序 = 声明顺序，**不按字母排**：每加一把 Key 就重排，用户记住的位置会变。"""
    matrix = _matrix(matrix_client)

    # 闸门（代理口令）不占列：它不属于某个功能，所有出网请求都过它。
    expected_keys = [source.source_id for source in CREDENTIAL_SOURCES if not source.is_gate]
    assert [key["id"] for key in matrix["keys"]] == expected_keys
    assert [feature["id"] for feature in matrix["features"]] == [
        feature.feature_id for feature in FEATURES
    ]
    # 顺序不是巧合：字母序与声明序必须不同，否则这条断言测不出东西。
    assert [key["id"] for key in matrix["keys"]] != sorted(key["id"] for key in matrix["keys"])


def test_every_key_carries_state_and_a_landing_point(matrix_client):
    """每一列都要能点（section + anchor），且带上自己的状态（与 key_map 同源）。"""
    payload = matrix_client.get("/api/connections").json()
    status_by_id = {row["id"]: row["status"] for row in payload["key_map"]}

    for key in payload["matrix"]["keys"]:
        assert key["label"], key["id"]
        assert key["group"], key["id"]
        assert key["section"], key["id"]
        assert key["anchor"], key["id"]
        assert key["status"] in {"saved", "not_configured", "session_only"}, key["id"]
        # 状态与 key_map 同一份（矩阵不会单独算一遍，否则两处能说两件事）。
        assert key["status"] == status_by_id[key["id"]]


def test_edge_kind_is_computed_by_the_backend(matrix_client):
    """`kind` 必须由后端给：覆盖式来源（仅本次会话）画成空心环，其余是实心。"""
    matrix = _matrix(matrix_client)
    override_sources = {
        source.source_id for source in CREDENTIAL_SOURCES if source.edge_kind != "direct"
    }
    assert override_sources, "registry 里至少应有一条覆盖式来源，否则这条断言没有对象"

    for edge in matrix["edges"]:
        expected = "override" if edge["key"] in override_sources else "direct"
        assert edge["kind"] == expected, edge

    # 覆盖式来源的每一条边都在，且功能与它声明的 used_by 一致。
    for source in CREDENTIAL_SOURCES:
        if source.source_id in override_sources:
            covered = {
                edge["feature"] for edge in matrix["edges"] if edge["key"] == source.source_id
            }
            assert covered == set(source.used_by)


def test_gate_is_a_band_not_a_column(matrix_client):
    """代理口令是闸门：出现在 `gate` 里，不出现在列里，也没有任何边。"""
    matrix = _matrix(matrix_client)
    gate_sources = [source for source in CREDENTIAL_SOURCES if source.is_gate]
    assert len(gate_sources) == 1
    gate_source = gate_sources[0]

    assert matrix["gate"] == {"key": gate_source.source_id, "label": gate_source.label}
    assert gate_source.source_id not in {key["id"] for key in matrix["keys"]}
    assert gate_source.source_id not in {edge["key"] for edge in matrix["edges"]}


def test_a_new_registry_source_adds_a_column_without_frontend_changes(db_session, monkeypatch):
    """registry 加一条来源 → 矩阵多一列、多几条边。**前端一行都不用改**。

    这是"前端零清单"的反证点：如果有人把列或边写死在前端，这条会在后端先红。
    """
    fake = CredentialSource(
        source_id="fake.demo",
        group=GROUP_LLM,
        label="假来源（测试）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → fake.demo",
        configure_at="设置 → 假的分组 → 假来源",
        used_by=("resume_generation", "ocr"),
        section="model",
        anchor="conn-fake-demo",
        empty_meaning="留空并保存 = 移除",
    )
    monkeypatch.setattr(connections_view, "CREDENTIAL_SOURCES", (*CREDENTIAL_SOURCES, fake))

    matrix = build_connections(db_session)["matrix"]
    keys = [key["id"] for key in matrix["keys"]]

    assert keys[-1] == "fake.demo"
    assert len(keys) == len([source for source in CREDENTIAL_SOURCES if not source.is_gate]) + 1
    assert {"key": "fake.demo", "feature": "resume_generation", "kind": "direct"} in matrix["edges"]
    assert {"key": "fake.demo", "feature": "ocr", "kind": "direct"} in matrix["edges"]


def test_only_gate_features_are_reported_without_rows():
    """只经过闸门、不依赖任何 Key 的功能：`edges` 里一条都没有（前端据此合并成一句说明）。

    它仍然在 `features` 里——否则"矩阵里没有"与"这个功能不存在"会分不清。
    """
    matrix = build_matrix({})
    referenced = {edge["feature"] for edge in matrix["edges"]}
    orphans = [feature["id"] for feature in matrix["features"] if feature["id"] not in referenced]

    assert orphans == ["update_check"], orphans
    # 功能域必须都是登记过的，否则前端分组标题会退化成裸 id。
    assert {feature["group"] for feature in matrix["features"]} <= set(FEATURE_GROUP_LABELS)


def test_broken_used_by_reference_fails_loudly():
    """`used_by` 写了不存在的 feature id → 直接报错，不许静默少一行。"""
    broken = CredentialSource(
        source_id="fake.broken",
        group=GROUP_LLM,
        label="引用断裂（测试）",
        scope=CredentialScope.GLOBAL_FILE,
        location="x",
        configure_at="设置 → 假的分组",
        used_by=("no_such_feature",),
        section="model",
        anchor="conn-fake-broken",
    )
    with pytest.raises(RuntimeError) as err:
        validate_matrix_references((*CREDENTIAL_SOURCES, broken), FEATURES)
    assert "no_such_feature" in str(err.value)

    # 反证的另一半：没有闸门 / 没有落点也必须报错（否则"去配置"会静默失效）。
    no_anchor = CredentialSource(
        source_id="fake.no_anchor",
        group=GROUP_LLM,
        label="没有落点（测试）",
        scope=CredentialScope.GLOBAL_FILE,
        location="x",
        used_by=("assistant",),
    )
    with pytest.raises(RuntimeError) as err2:
        validate_matrix_references((*CREDENTIAL_SOURCES, no_anchor), FEATURES)
    assert "落点" in str(err2.value)


def test_two_gates_are_rejected():
    """闸门只能有一条：两条会让"哪个口令挡在出网前"变成两个答案。"""
    extra_gate = CredentialSource(
        source_id="fake.gate",
        group=GROUP_LLM,
        label="第二条闸门（测试）",
        scope=CredentialScope.GLOBAL_FILE,
        location="x",
        used_by=("assistant",),
        section="model",
        anchor="conn-fake-gate",
        is_gate=True,
    )
    with pytest.raises(RuntimeError) as err:
        validate_matrix_references((*CREDENTIAL_SOURCES, extra_gate), FEATURES)
    assert "闸门" in str(err.value)


def test_feature_groups_must_be_registered():
    """功能的分组没登记时也要报错（前端的组标题会退化成裸 id，等于丢了一句人话）。"""
    stray = CredentialFeature(feature_id="stray", label="游离功能", group="nowhere")
    with pytest.raises(RuntimeError) as err:
        validate_matrix_references(CREDENTIAL_SOURCES, (*FEATURES, stray))
    assert "nowhere" in str(err.value)


def test_key_map_and_rows_describe_the_same_credentials(matrix_client):
    """`key_map` 的 id 集合 == 各组 items 的 id 集合（#8 的「用于」按 id 关联，漂了就静默消失）。"""
    payload = matrix_client.get("/api/connections").json()
    credential_ids = {
        item["id"]
        for group in payload["groups"]
        if group["kind"] == "credential"
        for item in group["items"]
    }
    assert {row["id"] for row in payload["key_map"]} == credential_ids

    for row in payload["key_map"]:
        # `used_by` 是数组（矩阵要切格子），整句由后端拼回来给详情卡与「用于」。
        assert isinstance(row["used_by"], list), row["id"]
        assert len(row["used_by"]) >= 1, row["id"]
        assert row["used_by_text"] == "、".join(row["used_by"])
        assert row["empty_meaning"], row["id"]
