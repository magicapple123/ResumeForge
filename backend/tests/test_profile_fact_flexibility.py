# SPDX-License-Identifier: Apache-2.0
"""补充事实灵活化：九类 payload、自定义字段、隐藏字段与 AI 候选映射（契约 §1/§2/§5）。

守住的性质：

1. 新增 award/training/language 三类走同一套严格 payload 校验与 CRUD；
2. custom_fields 结构校验（key 格式、label 长度/唯一/不得与默认标签重名、值上限）；
3. 自定义字段按「当前定义」进候选：定义删除后旧值留在本地但不进 AI；
4. 映射结果：award→awards、language→skills、training→projects，其余 6 类保持现状；
5. 隐藏字段不进候选，证号永远不进候选；无事实时候选与改动前一致。
"""

from __future__ import annotations

import copy
import json

import pytest
from app.database import SessionLocal
from app.schemas.profile import ProfileOut
from app.services.profile.fact_context import (
    build_fact_sections,
    load_fact_context,
    prompt_sections,
)
from app.services.profile.fact_mapping import (
    award_candidate,
    language_candidate,
    map_fact_payload,
    training_candidate,
)
from app.services.profile.profile_relevance import (
    build_general_profile_context,
    build_profile_prompt_data,
)
from app.services.profile.profile_relevance_constants import (
    FACT_MERGE_TARGETS,
    FACT_SECTION_KEYS,
)
from tests.test_profile_relevance import make_diverse_profile

FACTS_API = "/api/profile/facts"
SCHEMA_API = "/api/profile/facts/schema"
CREDENTIAL_SECRET = "SECRET-CRED-NEVER-IN-PROMPT"

FACT_PAYLOADS: dict[str, dict] = {
    "publication": {"title": "跨行业事实建模", "note": "备注", "status": "published"},
    "research_project": {"name": "行业迁移研究", "description": ["研究设计"]},
    "patent": {"title": "事实抽取方法", "patent_number": "CN001", "status": "pending"},
    "credential": {
        "name": "信息安全工程师",
        "issuer": "示例机构",
        "status": "active",
        "credential_number": CREDENTIAL_SECRET,
        "verify_url": "https://example.com/verify",
    },
    "work_project": {"name": "简历工作台", "public_url": "https://example.com/p"},
    "practice": {"organization": "社区服务中心", "experience_kind": "volunteer"},
    "award": {
        "name": "年度优秀员工",
        "issuer": "示例公司",
        "date": "2024年5月",
        "level": "公司级",
        "description": "年度评选",
    },
    "training": {
        "name": "项目管理培训",
        "organization": "示例学院",
        "start_date": "2023.03",
        "end_date": "2023-05",
        "hours": "40",
        "description": ["课程一"],
        "outcomes": ["结业"],
    },
    "language": {
        "name": "英语",
        "level": "熟练",
        "certificate": "CET-6",
        "score": "580",
        "date": "2020/12",
    },
}


def _create(client, kind: str, payload: dict | None = None):
    body = {"kind": kind, "payload": copy.deepcopy(payload or FACT_PAYLOADS[kind])}
    response = client.post(FACTS_API, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _list(client, **params) -> list[dict]:
    response = client.get(FACTS_API, params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _load_ctx():
    with SessionLocal() as db:
        return load_fact_context(db)


def _put_schema(client, kind: str, *, hidden=None, custom=None, expected_revision=0):
    return client.put(
        f"{SCHEMA_API}/{kind}",
        json={
            "hidden_fields": hidden or [],
            "custom_fields": custom or [],
            "expected_revision": expected_revision,
        },
    )


def _custom_field(label: str, value: str) -> dict:
    return {
        "key": "cf_0123456789ab",
        "label": label,
        "value": value,
    }


# ===== 九类 CRUD =====


def test_create_and_list_all_nine_kinds(client):
    created = {kind: _create(client, kind) for kind in FACT_PAYLOADS}

    items = _list(client)
    assert len(items) == 9
    assert [item["kind"] for item in items] == list(FACT_PAYLOADS)
    assert {item["fact_id"] for item in items} == {fact["fact_id"] for fact in created.values()}
    # 日期归一化对新增类型同样生效。
    assert items[7]["payload"]["start_date"] == "2023-03"
    assert items[7]["payload"]["end_date"] == "2023-05"
    assert items[8]["payload"]["date"] == "2020-12"
    assert items[6]["payload"]["date"] == "2024-05"
    # 本地 CRUD 返回证号（用户自己的库），候选才剔除。
    assert items[3]["payload"]["credential_number"] == CREDENTIAL_SECRET


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("award", {"name": "奖", "extra": "x"}),
        ("award", {"name": "奖", "level": "级" * 65}),
        ("training", {"name": "课", "description": ["一"] * 201}),
        ("language", {"name": "英语", "unknown": 1}),
        ("language", {"name": "英语", "custom_fields": "不是数组"}),
    ],
)
def test_new_kinds_keep_strict_payload_validation(client, kind, payload):
    response = client.post(FACTS_API, json={"kind": kind, "payload": payload})
    assert response.status_code == 422, response.text
    assert _list(client) == []


@pytest.mark.parametrize(
    "custom_fields",
    [
        pytest.param([{"key": "cf_zzzzzzzzzzzz", "label": "甲", "value": "1"}], id="bad-key"),
        pytest.param([{"key": "cf_0123456789ab", "label": "", "value": "1"}], id="empty-label"),
        pytest.param(
            [{"key": "cf_0123456789ab", "label": "长" * 41, "value": "1"}], id="long-label"
        ),
        pytest.param(
            [{"key": "cf_0123456789ab", "label": "甲", "value": "x" * 2001}],
            id="long-value",
        ),
        pytest.param(
            [
                {"key": f"cf_{index:012x}", "label": f"字段{index}", "value": "1"}
                for index in range(21)
            ],
            id="too-many",
        ),
        pytest.param(
            [
                {"key": "cf_0123456789ab", "label": "甲", "value": "1"},
                {"key": "cf_abcdef012345", "label": "甲", "value": "2"},
            ],
            id="duplicate-label",
        ),
        pytest.param(
            [
                {"key": "cf_0123456789ab", "label": "甲", "value": "1"},
                {"key": "cf_0123456789ab", "label": "乙", "value": "2"},
            ],
            id="duplicate-key",
        ),
    ],
)
def test_custom_fields_structural_validation(client, custom_fields):
    payload = {"title": "论文", "custom_fields": custom_fields}
    response = client.post(FACTS_API, json={"kind": "publication", "payload": payload})
    assert response.status_code == 422, response.text


def test_custom_field_label_cannot_equal_default_label(client):
    """schemas 层拿不到标签表，这条由服务层补查（仍返回 422）。"""
    response = client.post(
        FACTS_API,
        json={
            "kind": "publication",
            "payload": {
                "title": "论文",
                "custom_fields": [{"key": "cf_0123456789ab", "label": "标题", "value": "x"}],
            },
        },
    )
    assert response.status_code == 422
    assert "默认字段重名" in response.text


def test_custom_fields_round_trip_and_mapping(client):
    _create(
        client,
        "publication",
        {
            "title": "论文",
            "note": "原备注",
            "custom_fields": [_custom_field("影响因子", "5.2")],
        },
    )
    stored = _list(client)[0]
    assert stored["payload"]["custom_fields"] == [
        {"key": "cf_0123456789ab", "label": "影响因子", "value": "5.2"}
    ]

    # 定义里显式登记这个 key，候选才会使用它（值快照 + 当前定义一起决定）。
    assert (
        _put_schema(
            client,
            "publication",
            custom=[{"key": "cf_0123456789ab", "label": "影响因子"}],
            expected_revision=0,
        ).status_code
        == 200
    )
    sections = prompt_sections(_load_ctx())
    publication = sections["publications"][0]
    assert publication["note"] == "原备注\n影响因子：5.2"


def test_deleted_custom_definition_stops_feeding_candidates_but_keeps_value(client):
    _create(
        client,
        "publication",
        {"title": "论文", "custom_fields": [_custom_field("影响因子", "5.2")]},
    )
    assert (
        _put_schema(
            client,
            "publication",
            custom=[{"key": "cf_0123456789ab", "label": "影响因子"}],
            expected_revision=0,
        ).status_code
        == 200
    )
    assert "影响因子：5.2" in prompt_sections(_load_ctx())["publications"][0]["note"]

    # 删除定义（第二次 PUT 不再包含它）→ 候选不再使用，但本地值仍在 payload。
    assert _put_schema(client, "publication", custom=[], expected_revision=1).status_code == 200
    assert "影响因子：5.2" not in prompt_sections(_load_ctx())["publications"][0]["note"]
    assert _list(client)[0]["payload"]["custom_fields"][0]["value"] == "5.2"

    # 同名重建会生成新 key，不会自动关联旧值（契约 §2）。
    rebuilt = _put_schema(
        client, "publication", custom=[{"label": "影响因子"}], expected_revision=2
    )
    assert rebuilt.status_code == 200
    assert rebuilt.json()["custom_fields"][0]["key"] != "cf_0123456789ab"
    assert "影响因子：5.2" not in prompt_sections(_load_ctx())["publications"][0]["note"]


# ===== prompt_sections / 候选映射 =====


def test_prompt_sections_nine_keys_and_context_snapshots(client):
    for kind in FACT_PAYLOADS:
        _create(client, kind)
    ctx = _load_ctx()
    sections = prompt_sections(ctx)

    assert list(sections) == list(FACT_SECTION_KEYS)
    assert build_fact_sections(ctx) == sections
    assert [item["kind"] for item in ctx.items] == list(FACT_PAYLOADS)
    assert ctx.hidden_by_kind["publication"] == ()
    assert set(ctx.hidden_by_kind) == set(FACT_PAYLOADS)
    assert set(ctx.custom_by_kind) == set(FACT_PAYLOADS)

    award = sections["awards"][0]
    assert award["name"] == FACT_PAYLOADS["award"]["name"]
    assert "示例公司" in award["description"]
    assert "公司级" in award["description"]
    assert sections["skills"][0]["name"] == "英语"
    assert sections["skills"][0]["level"].startswith("熟练")
    training = sections["trainings"][0]
    assert training["role"] == "学员"
    assert training["artifact_type"] == "培训"
    assert training["description"] == ["课程一", "结业"]
    # 四个独立事实 section 原样保留。
    assert sections["publications"][0]["title"] == "跨行业事实建模"
    assert sections["credentials"][0]["verify_url"] == "https://example.com/verify"


def test_mapping_new_kinds_with_custom_fields():
    award = award_candidate(
        {
            "name": "一等奖",
            "issuer": "示例协会",
            "level": "省级",
            "date": "2024-05",
            "description": "决赛",
            "custom_fields": [_custom_field("排名", "第 1 名")],
        }
    )
    assert award == {
        "name": "一等奖",
        "date": "2024-05",
        "description": "示例协会\n省级\n决赛\n排名：第 1 名",
    }

    training = training_candidate(
        {
            "name": "项目管理培训",
            "start_date": "2023-03",
            "end_date": "2023-05",
            "description": ["课程一"],
            "outcomes": ["结业"],
            "custom_fields": [_custom_field("学时", "40")],
        }
    )
    assert training["role"] == "学员"
    assert training["artifact_type"] == "培训"
    assert training["public_url"] == ""
    assert training["description"] == ["课程一", "结业", "学时：40"]

    language = language_candidate(
        {
            "name": "英语",
            "level": "熟练",
            "certificate": "CET-6",
            "score": "580",
            "custom_fields": [_custom_field("口语", "流利")],
        }
    )
    assert language["level"] == "熟练 / CET-6 / 580 / 口语：流利"
    assert language["custom_fields"] == [{"label": "口语", "value": "流利"}]


def test_existing_kinds_append_custom_lines_and_keep_credential_number_private():
    research = map_fact_payload(
        "research_project",
        {
            "name": "科研",
            "description": ["研究设计"],
            "custom_fields": [_custom_field("项目编号", "A-1")],
        },
    )
    assert research["description"] == ["研究设计", "项目编号：A-1"]

    credential = map_fact_payload(
        "credential",
        {
            "name": "证书",
            "credential_number": CREDENTIAL_SECRET,
            "note": "备注",
            "custom_fields": [_custom_field("等级", "高级")],
        },
    )
    assert credential["note"] == "备注\n等级：高级"
    assert "credential_number" not in credential
    assert CREDENTIAL_SECRET not in json.dumps(credential, ensure_ascii=False)

    patent = map_fact_payload(
        "patent",
        {"title": "专利", "custom_fields": [_custom_field("法律状态", "有效")]},
    )
    assert patent["custom_fields"] == [{"label": "法律状态", "value": "有效"}]


# ===== 隐藏字段 / 无事实时的稳定性 =====


def test_hidden_field_excluded_from_candidates_but_kept_in_payload(client):
    fact = _create(client, "publication", {"title": "隐藏的论文标题", "note": "备注"})
    assert fact["payload"]["title"] == "隐藏的论文标题"
    assert (
        _put_schema(client, "publication", hidden=["title"], expected_revision=0).status_code == 200
    )

    ctx = _load_ctx()
    # 快照 items 保留完整原始 payload（字段设置改回可见时旧值立刻回来）。
    assert ctx.items[0]["payload"]["title"] == "隐藏的论文标题"
    sections = prompt_sections(ctx)
    assert sections["publications"][0]["title"] == ""
    assert "隐藏的论文标题" not in json.dumps(sections, ensure_ascii=False)

    profile = make_diverse_profile()
    candidate = build_general_profile_context(profile, fact_sections=sections)
    assert "隐藏的论文标题" not in candidate.serialized


def test_profile_prompt_data_merges_new_sections_without_facts_unchanged(client):
    for kind in ("award", "training", "language"):
        _create(client, kind)
    sections = prompt_sections(_load_ctx())
    profile = make_diverse_profile()

    merged = build_profile_prompt_data(profile, fact_sections=sections)
    assert merged["awards"][-1]["name"] == FACT_PAYLOADS["award"]["name"]
    assert merged["skills"][-1]["name"] == "英语"
    assert merged["projects"][-1]["name"] == FACT_PAYLOADS["training"]["name"]
    assert merged["projects"][-1]["artifact_type"] == "培训"
    assert FACT_MERGE_TARGETS["trainings"] == "projects"

    baseline = build_profile_prompt_data(profile)
    assert build_profile_prompt_data(profile, fact_sections=None) == baseline
    empty = {key: [] for key in FACT_SECTION_KEYS}
    assert json.dumps(
        build_profile_prompt_data(profile, fact_sections=empty), ensure_ascii=False
    ) == json.dumps(baseline, ensure_ascii=False)


def test_general_profile_context_keeps_new_kinds(client):
    for kind in ("award", "training", "language"):
        _create(client, kind)
    sections = prompt_sections(_load_ctx())
    profile: ProfileOut = make_diverse_profile()

    selection = build_general_profile_context(profile, fact_sections=sections)
    data = selection.data
    assert data["awards"][-1]["name"] == FACT_PAYLOADS["award"]["name"]
    assert data["skills"][-1]["name"] == "英语"
    assert any(item["name"] == FACT_PAYLOADS["training"]["name"] for item in data["projects"])
    assert data == json.loads(selection.serialized)
    assert "credential_number" not in json.dumps(data, ensure_ascii=False)
