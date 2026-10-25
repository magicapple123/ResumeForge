# SPDX-License-Identifier: Apache-2.0
"""职业场景 A1：目录、CRUD、限额、revision 409、归档、数据集隔离。

覆盖契约 §2.4 与计划 §13.1 的 G08（同 id 跨数据集隔离）/G09（revision 不一致 409）/
G10（未知/归档/非法参数明确失败）。数据集切换参考 tests/test_dataset_scope.py：
数据集文件与指针都由 conftest 按进程隔离并在用例后清理，不触碰真实数据。
"""

from __future__ import annotations

import json

import pytest
from app import database
from app.schemas.career_scenario import (
    MAX_CONFIG_BYTES,
    MAX_SCENARIOS_PER_DATASET,
    RESUME_SECTION_KEYS,
    CareerScenarioConfig,
    CareerScenarioCreate,
)
from app.schemas.generation_context import CareerContextRequest
from app.services.career_scenarios import catalog as catalog_module
from app.services.career_scenarios import store
from app.services.career_scenarios.resolve import resolve_context
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER, SECTION_LABELS

API = "/api/career-scenarios"

CONFIG = {
    "career_stage": "experienced",
    "employment_status": "employed",
    "purpose": "career_change",
    "target_industries": ["制造业", "软件"],
    "target_function": "数据分析",
    "cooperation_form": "full_time",
    "content_language": "zh-CN",
    "work_region": "华东",
    "preferred_sections": ["projects", "skills"],
    "expression_preferences": "解释可转移技能",
    "include_employment_status": False,
}


@pytest.fixture(autouse=True)
def _clear_catalog_cache():
    """目录缓存是进程级的；每个用例从磁盘重新读，避免用例间互相污染。"""
    catalog_module.clear_cache()
    yield
    catalog_module.clear_cache()


def _create(client, name: str = "后端转型", config: dict | None = None) -> dict:
    payload = {"name": name, "config": CONFIG if config is None else config}
    response = client.post(API, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


def _seed_scenario(db_session, name: str) -> int:
    row = store.create_scenario(
        db_session, CareerScenarioCreate(name=name, config=CareerScenarioConfig())
    )
    return row.id


# ===== 分区 key：schema 与 services 两份声明必须逐项一致 =====


def test_schema_section_keys_match_resume_sections_single_source():
    """schemas 不得 import services，所以 key 表有两份；这里逐个比对两边。"""
    assert len(RESUME_SECTION_KEYS) == len(DEFAULT_SECTION_ORDER)
    for index, service_key in enumerate(DEFAULT_SECTION_ORDER):
        assert RESUME_SECTION_KEYS[index] == service_key, (index, service_key)
        assert service_key in SECTION_LABELS
    assert set(SECTION_LABELS) == set(RESUME_SECTION_KEYS)


# ===== 内置目录 =====


def test_catalog_endpoint_returns_builtin_presets_from_data_file(client):
    response = client.get(f"{API}/catalog")
    assert response.status_code == 200, response.text
    body = response.json()

    source = json.loads(catalog_module.CATALOG_PATH.read_text(encoding="utf-8"))
    assert body["catalog_version"] == source["catalog_version"]
    assert body["schema_version"] == source["schema_version"]
    # 版本号来自数据文件，不是代码里另写一份。
    assert body["catalog_version"] == "1"
    assert body["limits"]["max_scenarios"] == MAX_SCENARIOS_PER_DATASET
    assert body["limits"]["max_config_bytes"] == MAX_CONFIG_BYTES

    presets = body["presets"]
    assert [item["key"] for item in presets] == [item["key"] for item in source["presets"]]
    assert len(presets) == 8
    for preset in presets:
        config = preset["config"]
        assert config["include_employment_status"] is False
        # loader 把 suggested_sections 归一进 config.preferred_sections：同一件事只有一份值。
        assert preset["suggested_sections"] == config["preferred_sections"]
        assert set(preset["suggested_sections"]) <= set(RESUME_SECTION_KEYS)
        assert 1 <= len(preset["guidance"]) <= 3


def test_catalog_returns_503_when_data_file_is_corrupted(client, monkeypatch, tmp_path):
    broken = tmp_path / "catalog.json"
    broken.write_text("{ 这不是 JSON", encoding="utf-8")
    monkeypatch.setattr(catalog_module, "CATALOG_PATH", broken)
    catalog_module.clear_cache()

    response = client.get(f"{API}/catalog")
    assert response.status_code == 503
    body = response.json()
    assert body["code"] == "career_scenario_catalog_unavailable"
    assert body["detail"]
    # 目录不可用不阻断旧生成：场景 CRUD 本身不依赖目录。
    assert _create(client, "目录损坏时仍可保存")["revision"] == 1


def test_catalog_returns_503_when_data_file_is_missing(client, monkeypatch, tmp_path):
    monkeypatch.setattr(catalog_module, "CATALOG_PATH", tmp_path / "absent.json")
    catalog_module.clear_cache()
    response = client.get(f"{API}/catalog")
    assert response.status_code == 503
    assert response.json()["code"] == "career_scenario_catalog_unavailable"


_VALID_PRESET = {
    "key": "general",
    "name": "通用",
    "config": {},
    "suggested_sections": [],
    "guidance": ["按事实陈述"],
}


def _write_catalog(tmp_path, data: dict, monkeypatch) -> None:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(catalog_module, "CATALOG_PATH", path)
    catalog_module.clear_cache()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda data: data.pop("presets"),
        lambda data: data.update(schema_version=2),
        lambda data: data.update(presets=[]),
        lambda data: data["presets"][0].pop("guidance"),
        lambda data: data["presets"][0]["config"].update(include_employment_status=True),
        lambda data: data["presets"][0].update(suggested_sections=["not_a_section"]),
        lambda data: data["presets"].append(dict(data["presets"][0])),
    ],
)
def test_malformed_catalog_is_reported_as_unavailable(
    client, monkeypatch, tmp_path, mutate
):
    data = {
        "catalog_version": "1",
        "schema_version": 1,
        "presets": [json.loads(json.dumps(_VALID_PRESET))],
    }
    mutate(data)
    _write_catalog(tmp_path, data, monkeypatch)
    response = client.get(f"{API}/catalog")
    assert response.status_code == 503, response.text
    assert response.json()["code"] == "career_scenario_catalog_unavailable"


# ===== CRUD =====


def test_create_list_patch_roundtrip(client):
    created = _create(client, "跨行到数据分析", CONFIG)
    assert created["revision"] == 1
    assert created["schema_version"] == 1
    assert created["archived"] is False
    assert created["config"] == CONFIG
    assert created["created_at"] and created["updated_at"]

    listing = client.get(API).json()
    assert listing["total"] == 1
    assert [item["id"] for item in listing["items"]] == [created["id"]]

    response = client.patch(
        f"{API}/{created['id']}",
        json={
            "name": "跨行数据分析（秋招）",
            "config": {**CONFIG, "target_function": "数据工程"},
            "expected_revision": 1,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["revision"] == 2
    assert body["name"] == "跨行数据分析（秋招）"
    assert body["config"]["target_function"] == "数据工程"
    # 未显式给出的维度保持原值。
    assert body["config"]["target_industries"] == ["制造业", "软件"]

    # 只改名称的 PATCH 不丢配置。
    response = client.patch(
        f"{API}/{created['id']}", json={"name": "再改一次", "expected_revision": 2}
    )
    assert response.status_code == 200
    assert response.json()["config"] == body["config"]
    assert response.json()["revision"] == 3


def test_stale_patch_returns_409_and_writes_nothing(client):
    created = _create(client, "初始名称")
    first = client.patch(
        f"{API}/{created['id']}", json={"name": "第一次修改", "expected_revision": 1}
    )
    assert first.status_code == 200
    assert first.json()["revision"] == 2

    stale = client.patch(
        f"{API}/{created['id']}", json={"name": "过期窗口写入", "expected_revision": 1}
    )
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "career_scenario_revision_conflict"
    assert body["revision"] == 2

    current = client.get(API).json()["items"][0]
    assert current["name"] == "第一次修改"  # 冲突那次一个字节都没写
    assert current["revision"] == 2

    missing = client.patch(f"{API}/999999", json={"name": "不存在", "expected_revision": 1})
    assert missing.status_code == 404
    assert missing.json()["code"] == "career_scenario_not_found"


def test_archive_hides_by_default_and_can_be_restored(client):
    created = _create(client, "待归档场景")
    archived = client.patch(
        f"{API}/{created['id']}", json={"archived": True, "expected_revision": 1}
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived"] is True
    assert archived.json()["revision"] == 2

    assert client.get(API).json()["total"] == 0
    with_archived = client.get(API, params={"include_archived": True}).json()
    assert with_archived["total"] == 1
    assert with_archived["items"][0]["archived"] is True

    restored = client.patch(
        f"{API}/{created['id']}", json={"archived": False, "expected_revision": 2}
    )
    assert restored.status_code == 200
    assert restored.json()["archived"] is False
    assert restored.json()["revision"] == 3
    # 重新启用保留原 id（归档不删除行）。
    assert client.get(API).json()["items"][0]["id"] == created["id"]


# ===== 校验 =====


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "x", "config": {}, "unknown_field": 1},
        {"name": "", "config": {}},
        {"name": "x" * 41, "config": {}},
        {"name": "x", "config": {"career_stage": "intern"}},
        {"name": "x", "config": {"purpose": "unknown"}},
        {"name": "x", "config": {"unknown_dimension": True}},
        {"name": "x", "config": {"preferred_sections": ["unknown_section"]}},
        {"name": "x", "config": {"target_industries": ["a"] * 6}},
        {"name": "x", "config": {"target_industries": ["行" * 41]}},
        {"name": "x", "config": {"target_function": "职" * 121}},
        {"name": "x", "config": {"expression_preferences": "偏" * 801}},
    ],
)
def test_invalid_payloads_are_rejected(client, payload):
    assert client.post(API, json=payload).status_code == 422


def test_patch_requires_expected_revision(client):
    created = _create(client, "版本必填")
    assert client.patch(f"{API}/{created['id']}", json={"name": "y"}).status_code == 422
    assert (
        client.patch(
            f"{API}/{created['id']}", json={"name": "y", "expected_revision": 0}
        ).status_code
        == 422
    )


def test_config_normalizes_duplicate_and_unknown_values():
    config = CareerScenarioConfig.model_validate(
        {"preferred_sections": ["projects", "projects", "summary"]}
    )
    assert config.preferred_sections == ["projects", "summary"]
    config = CareerScenarioConfig.model_validate(
        {"target_industries": [" 制造业 ", "制造业", ""]}
    )
    assert config.target_industries == ["制造业"]


# ===== 每数据集限额 =====


def test_scenario_limit_is_per_dataset_and_ignores_archived(client, db_session):
    for index in range(MAX_SCENARIOS_PER_DATASET - 1):
        _seed_scenario(db_session, f"已存场景{index}")
    for index in range(5):
        scenario_id = _seed_scenario(db_session, f"已归档场景{index}")
        store.set_archived(db_session, scenario_id, archived=True, expected_revision=1)

    # 第 50 个未归档场景仍可创建（5 个归档行不占名额）。
    assert _create(client, "最后名额")["revision"] == 1
    over = client.post(API, json={"name": "超限场景", "config": {}})
    assert over.status_code == 400, over.text
    body = over.json()
    assert body["code"] == "career_scenario_limit_reached"
    assert str(MAX_SCENARIOS_PER_DATASET) in body["detail"]

    db_session.rollback()  # 换一个事务再数，避免读到本会话旧快照
    assert store.active_scenario_count(db_session) == MAX_SCENARIOS_PER_DATASET


# ===== 数据集隔离（G08）=====


def test_same_scenario_id_resolves_per_dataset(client):
    main_scenario = _create(client, "主数据场景", {"target_function": "数据分析"})
    dataset_b = _create_dataset(client, "隔离数据集B")
    assert _activate(client, dataset_b).status_code == 200

    assert client.get(API).json()["total"] == 0
    b_scenario = _create(client, "数据集B场景", {"target_function": "护理"})
    # 两个数据集都是空库起步，同一条场景拿到同一个数字 id —— 正是要验的隔离点。
    assert b_scenario["id"] == main_scenario["id"]
    request = CareerContextRequest(scenario_id=b_scenario["id"], expected_revision=1)

    with database.SessionLocal() as session:
        snapshot_b = resolve_context(session, request)
    assert snapshot_b is not None
    assert snapshot_b.display_name == "数据集B场景"
    assert snapshot_b.resolved_dimensions["target_function"] == "护理"

    assert _activate(client, "main").status_code == 200
    assert [item["id"] for item in client.get(API).json()["items"]] == [main_scenario["id"]]
    with database.SessionLocal() as session:
        snapshot_main = resolve_context(session, request)
    assert snapshot_main is not None
    assert snapshot_main.display_name == "主数据场景"
    assert snapshot_main.resolved_dimensions["target_function"] == "数据分析"

