# SPDX-License-Identifier: Apache-2.0
"""需求 6 验收：自建板块可选择是否参与岗位筛选，且"选了就必须真的参与"。

四类证据：
- **开关关（默认）**：自建板块的条目全部进简历，没有"未写入"报告——与改动前一致；
- **开关开 + 后端岗**：运营类条目被筛掉，``coverage_notes`` 出现板块名与条数，
  生成说明的「候选资料组成」出现该板块的条数；
- **开关开 + 运营岗**：同一板块留下的是另一条 → 两次入选条目集合**不同**（硬证据）；
- **接口往返**：``PATCH filter_by_job`` 后再读工作区仍为 true；只改名字不会把开关重置。

判定与内置分区**同一个** ``profile_matching._score_item`` + 同一个 ``JobFocus``：
本文件不假设第二套打分，只断言"同样的 JD 关键词在自建板块里也算命中"。
"""

from __future__ import annotations

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import GenerateOptions, ResumeContent
from app.services.profile import definition_store, entry_store
from app.services.profile.profile_custom_filter import (
    apply_custom_section_filter,
    find_unwritten_custom_details,
    plan_custom_section_filter,
)
from app.services.profile.profile_matching import build_job_focus
from app.services.profile.workspace_bootstrap import active_custom_sections
from app.services.resume.generation_postprocess import attach_custom_sections
from app.services.resume.resume_generator import ResumeGenerator
from app.services.resume.resume_rationale import build_generation_rationale
from tests.test_profile_group_budget import all_sections_consumed, seed_profile
from tests.test_profile_relevance import CapturingProvider, make_job

WORKSPACE_API = "/api/profile/workspace"
SECTIONS_API = "/api/profile/sections"
SECTION_API = "/api/profile/sections/{section_key}"

SECTION_KEY = "custom:sec-certs"
SECTION_NAME = "证书与作品"
OPS_NAME = "运营数据分析师（中级）"
OPS_TEXT = "活动策划、用户研究、数据复盘、Excel"
BACKEND_NAME = "后端接口开发认证"
BACKEND_TEXT = "Python、FastAPI、MySQL、RESTful API"


def _job_backend():
    return make_job(
        "后端开发工程师",
        "负责后端服务与 RESTful API 开发。",
        "熟悉 Python、FastAPI 与 MySQL。",
    )


def _job_operations():
    return make_job(
        "产品运营实习生",
        "参与用户研究、活动策划、内容运营与数据复盘。",
        "熟练使用 Excel，具备跨部门协作能力。",
    )


def _spec(field_id: str, label: str) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id=field_id,
        key=field_id,
        label=label,
        field_type="multi_line",
        order=1,
        llm_allowed=True,
        webform_allowed=True,
        private=False,
        is_builtin=False,
    )


def _consumed(*, filter_by_job: bool) -> ConsumedProfile:
    """一份只有自建板块的消费快照（不设 primary_field_id = 真实默认形态，走全文交集）。"""
    section = ConsumedSection(
        key=SECTION_KEY,
        name=SECTION_NAME,
        form="multi",
        carrier_field_id=None,
        material_only=False,
        primary_field_id=None,
        fields=(_spec("cf-name", "名称"), _spec("cf-desc", "说明")),
        entries=(
            ConsumedEntry(
                entry_id="c1", sort_order=0, values={"cf-name": OPS_NAME, "cf-desc": OPS_TEXT}
            ),
            ConsumedEntry(
                entry_id="c2",
                sort_order=1,
                values={"cf-name": BACKEND_NAME, "cf-desc": BACKEND_TEXT},
            ),
        ),
        revision=1,
        filter_by_job=filter_by_job,
    )
    return ConsumedProfile(
        group_id="g1",
        group_name="默认方案",
        is_default=True,
        participating_keys=(SECTION_KEY,),
        section_order=(SECTION_KEY,),
        workspace_revision=1,
        sections={SECTION_KEY: section},
    )


def _names(resume: ResumeContent) -> list[str]:
    """简历里自建板块的条目名（没有主文本字段时条目只有「标签：值」行）。"""
    return [
        entry.text or next((line.value for line in entry.lines if line.value), "")
        for section in resume.custom_sections
        for entry in section.entries
    ]


# ===== ① 开关关：行为与改动前一致 =====


def test_switch_off_keeps_every_entry_and_reports_nothing():
    consumed = _consumed(filter_by_job=False)
    focus = build_job_focus(_job_backend())
    plan = plan_custom_section_filter(consumed, focus)
    assert plan.active is False

    resume = attach_custom_sections(ResumeContent(), consumed, custom_filter=plan)
    assert sorted(_names(resume)) == sorted([OPS_NAME, BACKEND_NAME])
    assert find_unwritten_custom_details(resume, consumed, plan) == []


def test_no_job_means_no_filtering_even_when_switch_is_on():
    """通用简历（没有岗位）没有"相关性"可判，开关开着也不能裁条目。"""
    consumed = _consumed(filter_by_job=True)
    plan = plan_custom_section_filter(consumed, None)
    assert plan.active is False
    resume = attach_custom_sections(ResumeContent(), consumed, custom_filter=plan)
    assert sorted(_names(resume)) == sorted([OPS_NAME, BACKEND_NAME])


def test_empty_job_signals_keep_everything():
    """JD 里提取不到任何信号时不筛（与 _select_entries 的无信号分支一致）。

    ``build_job_focus`` 会把标题里 ≥2 字的词当信号，所以这里用一个单字标题 +
    空描述构造"真的没有任何信号"的极端输入。
    """
    consumed = _consumed(filter_by_job=True)
    plan = plan_custom_section_filter(consumed, build_job_focus(make_job("岗", "")))
    assert plan.active is False


# ===== ② 开关开：真的参与，且两个方向结果不同 =====


def test_backend_job_drops_operations_entry_and_reports_it():
    consumed = _consumed(filter_by_job=True)
    plan = plan_custom_section_filter(consumed, build_job_focus(_job_backend()))
    assert plan.active is True
    assert list(plan.kept[SECTION_KEY]) == ["c2"]

    resume = attach_custom_sections(ResumeContent(), consumed, custom_filter=plan)
    assert _names(resume) == [BACKEND_NAME]

    details = find_unwritten_custom_details(resume, consumed, plan)
    assert [item["section_label"] for item in details] == [SECTION_NAME]
    note = details[0]
    assert note["total"] == 2
    assert note["section"] == SECTION_KEY
    assert note["filtered"] == [OPS_NAME]
    # 自建板块由服务端确定性投影写入，模型没有取舍权 → 不能报成"模型没写"。
    assert note["model_omitted"] == []


def test_operations_job_keeps_the_other_entry():
    """同一份资料 + 两个方向 → 入选条目集合不同（"真的参与"的硬证据）。"""
    backend_plan = plan_custom_section_filter(
        _consumed(filter_by_job=True), build_job_focus(_job_backend())
    )
    ops_plan = plan_custom_section_filter(
        _consumed(filter_by_job=True), build_job_focus(_job_operations())
    )
    backend_names = _names(
        attach_custom_sections(
            ResumeContent(), _consumed(filter_by_job=True), custom_filter=backend_plan
        )
    )
    ops_names = _names(
        attach_custom_sections(
            ResumeContent(), _consumed(filter_by_job=True), custom_filter=ops_plan
        )
    )
    assert backend_names == [BACKEND_NAME]
    assert ops_names == [OPS_NAME]
    assert set(backend_names) != set(ops_names)


def test_rationale_reports_custom_section_count():
    consumed = _consumed(filter_by_job=True)
    plan = plan_custom_section_filter(consumed, build_job_focus(_job_backend()))
    rationale = build_generation_rationale(
        job=_job_backend(),
        selection_counts={"projects": 1},
        omitted_counts={},
        focus_skills=("Python",),
        focus_domains=("backend",),
        coverage_details=[],
        baseline_confirmed=[],
        custom_sections=plan.counts(),
    )
    assert "候选资料组成：项目 1 条、证书与作品 1 条。" in rationale
    # 被筛掉的那一条要计入"另有 N 条…没有进入候选资料"（如实告知，不静默丢）。
    assert "另有 1 条内容因为与岗位关键词交集不足或超出篇幅预算" in rationale


# ===== ③ 接口往返：开关读得回来，改名不会重置它 =====


def test_filter_switch_round_trip_through_api(client):
    created = client.post(SECTIONS_API, json={"name": SECTION_NAME})
    assert created.status_code == 201, created.text
    section_key = created.json()["key"]
    assert created.json()["filter_by_job"] is False

    enabled = client.patch(
        SECTION_API.format(section_key=section_key),
        json={"filter_by_job": True, "expected_revision": created.json()["revision"]},
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["filter_by_job"] is True

    workspace = client.get(WORKSPACE_API).json()
    stored = next(item for item in workspace["sections"] if item["key"] == section_key)
    assert stored["filter_by_job"] is True

    # 只改名不能让开关悄悄回落（两个参数都是"没传 = 不改"）。
    renamed = client.patch(
        SECTION_API.format(section_key=section_key),
        json={"name": "作品与证书", "expected_revision": enabled.json()["revision"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "作品与证书"
    assert renamed.json()["filter_by_job"] is True


def test_filter_switch_rejects_builtin_section(client):
    response = client.patch(
        SECTION_API.format(section_key="projects"),
        json={"filter_by_job": True, "expected_revision": 0},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "builtin_protected"


# ===== ④ 端到端：同一岗位、开关关/开各生成一次 =====


def _seed_cert_section(db) -> str:
    section = definition_store.create_custom_section(db, SECTION_NAME)
    name_field = definition_store.create_custom_field(db, section.key, "名称", "multi_line")
    desc_field = definition_store.create_custom_field(db, section.key, "说明", "multi_line")
    entry_store.upsert_entry(
        db, section.key, values={name_field.field_id: OPS_NAME, desc_field.field_id: OPS_TEXT}
    )
    entry_store.upsert_entry(
        db,
        section.key,
        values={name_field.field_id: BACKEND_NAME, desc_field.field_id: BACKEND_TEXT},
    )
    return section.key


async def _generate(db, response: dict) -> dict:
    provider = CapturingProvider(response)
    events = [
        event
        async for event in ResumeGenerator(provider).generate(
            None, _job_backend(), GenerateOptions(enhance=False), consumed=all_sections_consumed(db)
        )
    ]
    done = next(event for event in events if event["type"] == "done")
    return {"done": done, "provider": provider}


def _custom_texts(done: dict) -> list[str]:
    return [
        entry["text"] or next((line["value"] for line in entry["lines"] if line["value"]), "")
        for section in done["resume"].get("custom_sections") or []
        for entry in section["entries"]
    ]


async def test_generation_off_then_on_yields_different_custom_entries(db_session):
    """开/关各生成一次，自建板块的入选条目集合必须不同（做不到就是没生效）。"""
    seed_profile(db_session)
    section_key = _seed_cert_section(db_session)

    off = await _generate(db_session, {"summary": "示例总结"})
    off_texts = _custom_texts(off["done"])
    assert sorted(off_texts) == sorted([OPS_NAME, BACKEND_NAME])
    assert not [note for note in off["done"]["coverage_notes"] if note["section"] == section_key]

    row = next(item for item in active_custom_sections(db_session) if item.key == section_key)
    definition_store.update_custom_section(
        db_session, section_key, filter_by_job=True, expected_revision=int(row.revision or 1)
    )

    on = await _generate(db_session, {"summary": "示例总结"})
    on_texts = _custom_texts(on["done"])
    assert on_texts == [BACKEND_NAME]
    assert set(on_texts) != set(off_texts)

    dropped = [note for note in on["done"]["coverage_notes"] if note["section"] == section_key]
    assert len(dropped) == 1
    assert dropped[0]["section_label"] == SECTION_NAME
    assert dropped[0]["filtered"] == [OPS_NAME]
    assert "证书与作品" in on["done"]["rationale"]
    # 自建板块从不进模型提示词：两次 Prompt 的候选资料必须完全一致（差异只在纸面附件）。
    assert off["provider"].messages == on["provider"].messages


def test_apply_filter_only_touches_filtered_sections():
    """纯函数边界：开关关着的自建板块、内置分区都不被裁。"""
    consumed = _consumed(filter_by_job=True)
    plan = plan_custom_section_filter(consumed, build_job_focus(_job_backend()))
    filtered = apply_custom_section_filter(consumed, plan)
    assert [entry.entry_id for entry in filtered.sections[SECTION_KEY].entries] == ["c2"]
    # 没有计划 = 原样返回（同一个对象，零拷贝）。
    assert apply_custom_section_filter(consumed, None) is consumed
