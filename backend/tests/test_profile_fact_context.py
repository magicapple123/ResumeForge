# SPDX-License-Identifier: Apache-2.0
"""补充事实候选快照（A3）：只读、去私密、映射与 profile 候选链路接入。

守住四条性质：

1. load_fact_context 只取未删事实、按展示顺序、不产生写入；
2. prompt_sections 输出六个 section，作者顺序/状态原样，证号绝不出现；
3. build_profile_prompt_data / general / targeted 三条入口都能合并新 section，
   fact_sections=None（或空 section）时输出与改动前完全一致；
4. 作品项目并入 projects（补 public_url/artifact_type）、实践并入 experiences
   （补 experience_kind），targeted 的岗位相关性排序不作用于独立事实 section。
"""

from __future__ import annotations

import copy
import json

from app.database import SessionLocal
from app.models.profile import UserProfile
from app.schemas.profile import ProfileOut
from app.services.profile.fact_context import (
    ProfileFactContext,
    build_fact_sections,
    load_fact_context,
    prompt_sections,
)
from app.services.profile.fact_mapping import (
    credential_candidate,
    http_url,
    publication_candidate,
)
from app.services.profile.profile_relevance import (
    build_general_profile_context,
    build_profile_prompt_data,
    build_targeted_profile_context,
)
from app.services.profile.profile_relevance_constants import FACT_SECTION_KEYS
from tests.test_profile_relevance import make_diverse_profile, make_job

FACTS_API = "/api/profile/facts"
PROFILE_API = "/api/profile"
CREDENTIAL_SECRET = "SECRET-CRED-NEVER-IN-PROMPT"

FACT_PAYLOADS: dict[str, dict] = {
    "publication": {
        "title": "跨行业候选人事实建模",
        "authors": [
            {"name": "王五", "is_self": True},
            {"name": "赵六", "corresponding": True},
        ],
        "venue": "示例期刊",
        "year": "2024",
        "status": "under_review",
        "url": "https://example.com/paper",
    },
    "research_project": {
        "name": "行业迁移研究",
        "role": "负责人",
        "organization": "示例大学",
        "start_date": "2023.03",
        "end_date": "至今",
        "description": ["完成访谈与数据分析"],
        "outcomes": ["输出行业报告"],
    },
    "patent": {
        "title": "一种事实抽取方法",
        "inventors": [{"name": "王五", "is_self": True}],
        "patent_number": "CN2024000002",
        "status": "pending",
        "url": "https://example.com/patent",
    },
    "credential": {
        "name": "信息安全工程师",
        "issuer": "示例机构",
        "status": "active",
        "credential_number": CREDENTIAL_SECRET,
        "verify_url": "https://example.com/verify",
    },
    "work_project": {
        "name": "简历事实工作台",
        "role": "主要维护者",
        "tech_stack": ["Python"],
        "description": ["实现候选事实合并"],
        "highlights": ["保持旧提示词逐字节不变"],
        "public_url": "https://example.com/project",
        "artifact_type": "开源软件",
    },
    "practice": {
        "organization": "社区服务中心",
        "role": "志愿者",
        "experience_kind": "volunteer",
        "description": ["每周服务两小时"],
    },
}


def _create(client, kind: str, *, sort_order: int | None = None, payload: dict | None = None):
    body = {
        "kind": kind,
        "payload": copy.deepcopy(payload or FACT_PAYLOADS[kind]),
    }
    if sort_order is not None:
        body["sort_order"] = sort_order
    response = client.post(FACTS_API, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _load_ctx() -> ProfileFactContext:
    with SessionLocal() as db:
        return load_fact_context(db)


def _empty_sections() -> dict[str, list]:
    return {key: [] for key in FACT_SECTION_KEYS}


# ===== 只读快照 =====


def test_load_fact_context_only_live_ordered_and_read_only(client):
    # 还没有资料主表行时：空快照，且读取不创建 profile 行。
    assert _load_ctx().items == []
    with SessionLocal() as db:
        assert db.query(UserProfile).count() == 0

    publication = _create(client, "publication", sort_order=2)
    patent = _create(client, "patent", sort_order=0)
    trashed = _create(client, "practice", sort_order=1)
    assert client.delete(f"{FACTS_API}/{trashed['fact_id']}").status_code == 200

    ctx = _load_ctx()
    assert [item["kind"] for item in ctx.items] == ["patent", "publication"]
    assert [item["fact_id"] for item in ctx.items] == [patent["fact_id"], publication["fact_id"]]
    for item in ctx.items:
        assert set(item) == {"fact_id", "kind", "revision", "payload"}
        assert item["revision"] == 1
    with SessionLocal() as db:
        assert db.query(UserProfile).count() == 1


def test_prompt_sections_groups_six_kinds_and_keeps_order(client):
    created = {kind: _create(client, kind) for kind in FACT_PAYLOADS}
    ctx = _load_ctx()
    sections = prompt_sections(ctx)

    assert list(sections) == list(FACT_SECTION_KEYS)
    assert build_fact_sections(ctx) == sections
    assert set(created) == set(FACT_PAYLOADS)

    publication = sections["publications"][0]
    assert publication["title"] == FACT_PAYLOADS["publication"]["title"]
    assert [author["name"] for author in publication["authors"]] == ["王五", "赵六"]
    assert [author["is_self"] for author in publication["authors"]] == [True, False]
    assert [author["corresponding"] for author in publication["authors"]] == [False, True]
    assert publication["status"] == "under_review"
    assert publication["url"] == "https://example.com/paper"

    assert sections["research_projects"][0]["start_date"] == "2023-03"
    assert sections["research_projects"][0]["end_date"] == "至今"
    assert sections["research_projects"][0]["outcomes"] == ["输出行业报告"]
    assert sections["patents"][0]["status"] == "pending"
    assert sections["patents"][0]["inventors"][0]["is_self"] is True
    assert sections["credentials"][0]["status"] == "active"

    work_project = sections["work_projects"][0]
    assert work_project["name"] == "简历事实工作台"
    assert work_project["public_url"] == "https://example.com/project"
    assert work_project["artifact_type"] == "开源软件"
    assert work_project["tech_stack"] == ["Python"]

    practice = sections["practices"][0]
    assert practice["company"] == "社区服务中心"
    assert practice["experience_kind"] == "volunteer"
    assert practice["description"] == ["每周服务两小时"]


def test_prompt_sections_skip_unknown_kind_without_failing():
    ctx = ProfileFactContext(
        items=[
            {"fact_id": "a" * 24, "kind": "hobby", "revision": 1, "payload": {"name": "摄影"}},
            {
                "fact_id": "b" * 24,
                "kind": "publication",
                "revision": 1,
                "payload": {"title": "合法论文"},
            },
        ]
    )

    sections = prompt_sections(ctx)

    assert sections["publications"][0]["title"] == "合法论文"
    assert all(section == [] for key, section in sections.items() if key != "publications")


# ===== 隐私红线 =====


def test_credential_number_never_reaches_prompt_data(client):
    credential = _create(client, "credential")

    # 本地 CRUD 响应可以含证号（用户自己的库）。
    listing = client.get(FACTS_API, params={"kind": "credential"}).json()
    assert listing["items"][0]["payload"]["credential_number"] == CREDENTIAL_SECRET

    sections = prompt_sections(_load_ctx())
    assert "credential_number" not in sections["credentials"][0]
    assert credential["fact_id"]  # 事实 id 仍在（来源定位需要）
    assert CREDENTIAL_SECRET not in json.dumps(sections, ensure_ascii=False)

    profile = make_diverse_profile()
    prompt_data = build_profile_prompt_data(profile, fact_sections=sections)
    assert CREDENTIAL_SECRET not in json.dumps(prompt_data, ensure_ascii=False)

    general = build_general_profile_context(profile, fact_sections=sections)
    assert CREDENTIAL_SECRET not in general.serialized
    targeted = build_targeted_profile_context(
        profile, make_job("后端工程师", "", "Python"), fact_sections=sections
    )
    assert CREDENTIAL_SECRET not in targeted.serialized


def test_mapping_filters_non_http_urls_and_keeps_author_markers():
    assert http_url("javascript:alert(1)") == ""
    assert http_url("file:///etc/passwd") == ""
    assert http_url("  https://example.com/a  ") == "https://example.com/a"

    # 模拟旧数据/导入数据绕过写入校验后的库内值：候选映射仍只放行 http(s)。
    legacy = {
        "title": "旧论文",
        "authors": [
            {"name": "甲", "is_self": True, "corresponding": False},
            {"name": "乙", "is_self": False, "corresponding": True},
        ],
        "url": "javascript:alert(1)",
        "status": "published",
    }
    mapped = publication_candidate(legacy)
    assert mapped["url"] == ""
    assert [author["is_self"] for author in mapped["authors"]] == [True, False]
    assert credential_candidate({"name": "证", "credential_number": "X"})["name"] == "证"
    assert "credential_number" not in credential_candidate({"name": "证", "credential_number": "X"})


# ===== None / 空 facts 时输出不变 =====


def test_build_profile_prompt_data_none_is_byte_identical():
    profile = make_diverse_profile()

    baseline = build_profile_prompt_data(profile)
    assert build_profile_prompt_data(profile, fact_sections=None) == baseline
    assert json.dumps(
        build_profile_prompt_data(profile, fact_sections={}), ensure_ascii=False
    ) == json.dumps(baseline, ensure_ascii=False)
    assert json.dumps(
        build_profile_prompt_data(profile, fact_sections=_empty_sections()), ensure_ascii=False
    ) == json.dumps(baseline, ensure_ascii=False)
    # 没有任何新事实时不允许凭空多出新键。
    assert set(baseline) == {
        "name",
        "gender",
        "birth_year",
        "phone",
        "email",
        "city",
        "target_city",
        "job_intent",
        "personal_website",
        "github",
        "summary",
        "educations",
        "experiences",
        "campus_experiences",
        "projects",
        "skills",
        "awards",
    }


def test_general_and_targeted_unchanged_without_facts():
    profile = make_diverse_profile()
    job = make_job("后端开发工程师", "负责服务开发", "熟悉 Python 与 FastAPI")

    general_baseline = build_general_profile_context(profile)
    general_empty = build_general_profile_context(profile, fact_sections=_empty_sections())
    assert general_empty.data == general_baseline.data
    assert general_empty.serialized == general_baseline.serialized
    assert general_empty.selected_counts == general_baseline.selected_counts
    assert general_empty.omitted_counts == general_baseline.omitted_counts
    assert general_empty.entry_names == general_baseline.entry_names

    targeted_baseline = build_targeted_profile_context(profile, job)
    targeted_empty = build_targeted_profile_context(profile, job, fact_sections=_empty_sections())
    assert targeted_empty.data == targeted_baseline.data
    assert targeted_empty.serialized == targeted_baseline.serialized
    assert targeted_empty.entry_names == targeted_baseline.entry_names


# ===== 候选链路合并新 section =====


def test_general_profile_context_keeps_new_sections(client):
    for kind in FACT_PAYLOADS:
        _create(client, kind)
    sections = prompt_sections(_load_ctx())
    profile = make_diverse_profile()

    selection = build_general_profile_context(profile, fact_sections=sections)
    data = selection.data

    for section in ("publications", "research_projects", "patents", "credentials"):
        assert data[section], section
    assert data["publications"][0]["title"] == FACT_PAYLOADS["publication"]["title"]

    # 作品项目追加在既有项目之后，且带 public_url / artifact_type。
    assert [item["name"] for item in data["projects"][:2]] == [
        item.name for item in profile.projects
    ]
    work_project = data["projects"][-1]
    assert work_project["name"] == FACT_PAYLOADS["work_project"]["name"]
    assert work_project["public_url"] == "https://example.com/project"
    assert work_project["artifact_type"] == "开源软件"

    # 实践经历追加在既有经历之后，且带 experience_kind。
    practice = data["experiences"][-1]
    assert practice["company"] == "社区服务中心"
    assert practice["experience_kind"] == "volunteer"

    # data 与实际发送给模型的 JSON 完全一致。
    assert data == json.loads(selection.serialized)
    assert selection.selected_counts["publications"] == 1
    # 覆盖度诊断的"筛选前都有谁"也登记新栏目（与 resume_coverage 的身份字段一致）；
    # 作品/实践通过既有 projects/experiences 键登记。
    assert selection.entry_names["publications"] == (FACT_PAYLOADS["publication"]["title"],)
    assert FACT_PAYLOADS["work_project"]["name"] in selection.entry_names["projects"]
    assert "社区服务中心" in selection.entry_names["experiences"]


def test_targeted_profile_context_keeps_new_sections_without_reordering(client):
    first = _create(client, "publication", payload={"title": "第一篇"})
    second = _create(client, "publication", payload={"title": "第二篇"})
    _create(client, "patent")
    _create(client, "work_project")
    # 让实践经历与后端岗位有真实交集（相关性筛选后仍保留），验证它带着
    # experience_kind 进入 experiences。
    _create(
        client,
        "practice",
        payload={
            "organization": "社区服务中心",
            "role": "数据志愿者",
            "experience_kind": "volunteer",
            "description": ["使用 Python 与 FastAPI 整理社区数据"],
        },
    )
    sections = prompt_sections(_load_ctx())
    profile = make_diverse_profile()

    backend_job = make_job("后端开发工程师", "负责服务开发", "熟悉 Python 与 FastAPI")
    targeted = build_targeted_profile_context(profile, backend_job, fact_sections=sections)
    # 独立事实 section 不参与岗位相关性排序：保持资料顺序（创建顺序），不因 JD 是
    # 后端岗位就丢掉论文/专利。
    assert [item["title"] for item in targeted.data["publications"]] == ["第一篇", "第二篇"]
    assert [item["title"] for item in targeted.data["patents"]] == [
        FACT_PAYLOADS["patent"]["title"]
    ]
    assert first["fact_id"] != second["fact_id"]

    # 作品/实践并入既有栏目后遵循该栏目既有的岗位相关性筛选（排序算法不改）；
    # 命中岗位信号时它们出现在候选里，并保留新键。
    assert any(item.get("public_url") for item in targeted.data["projects"])
    assert any(item.get("experience_kind") == "volunteer" for item in targeted.data["experiences"])
    assert targeted.data == json.loads(targeted.serialized)


def test_only_new_facts_without_old_profile_are_readable(client):
    # G23 的数据基础：没有姓名/旧经历，只有新事实时 fact_context 仍能取到内容。
    assert client.put(PROFILE_API, json={}).status_code == 200
    _create(client, "publication")
    _create(client, "credential")

    ctx = _load_ctx()
    sections = prompt_sections(ctx)
    assert len(ctx.items) == 2
    assert sections["publications"] and sections["credentials"]

    profile = ProfileOut(id=1)
    selection = build_general_profile_context(profile, fact_sections=sections)
    # 身份字段照旧不发给模型；新事实照常进入候选。
    assert "name" not in selection.data
    assert selection.data["publications"][0]["title"] == FACT_PAYLOADS["publication"]["title"]


def test_budget_serialization_handles_new_sections(client):
    """长预算压缩要能处理新键：不 KeyError，输出仍是合法且不超预算的 JSON。"""
    _create(client, "publication")
    _create(client, "research_project")
    sections = prompt_sections(_load_ctx())
    profile = make_diverse_profile(
        summary="个人总结" * 4_000,
        projects=[
            {
                "id": 1,
                "name": "超长项目",
                "role": "开发",
                "description": "\n".join(["描述" * 400 for _ in range(6)]),
            }
        ],
    )

    selection = build_general_profile_context(profile, max_chars=2_000, fact_sections=sections)
    assert len(selection.serialized) <= 2_000
    assert json.loads(selection.serialized) == selection.data
