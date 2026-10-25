# SPDX-License-Identifier: Apache-2.0
"""B 验收：当前组驱动生成（R-28/R-29/R-30/R-31 + C1/C5-B①/C2/R-73 + claims 来源筛选）。

全部用 F1 存储层 + F2 读取边界 + 真实投影构造消费快照，再走真实生成编排（只把模型
换成回放 provider）：断言模型 Prompt 里未参与分区整键不出现、参与但空的分区保留空数组、
自定义字段以「标签：值」进 Prompt 且生成后补回承载区、自建分区由服务端确定性写入、
语言漏写时补位、证书编号永不进 Prompt、claims 只带入能关联本次快照的来源。
"""

import json

from app.schemas.claim import ClaimCreate
from app.schemas.resume import GenerateOptions
from app.services import claims
from app.services.profile import definition_store, entry_store
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_profile_group_budget import (
    UNPARTICIPATING,
    all_sections_consumed,
    seed_profile,
    seven_sections_consumed,
)
from tests.test_profile_relevance import CapturingProvider, make_job


def _job():
    return make_job(
        "后端开发工程师",
        "负责后端服务与 RESTful API 开发。",
        "熟悉 Python、FastAPI 与 MySQL。",
    )


async def _run(db, consumed, response: dict):
    provider = CapturingProvider(response)
    events = [
        event
        async for event in ResumeGenerator(provider).generate(
            None, _job(), GenerateOptions(enhance=False), consumed=consumed
        )
    ]
    return provider, events


def _candidate(provider: CapturingProvider) -> dict:
    import re

    content = provider.messages[1]["content"]
    match = re.search(r"## 候选个人资料.*?```json\n(.*?)\n```", content, re.DOTALL)
    assert match is not None
    return json.loads(match.group(1))


async def test_model_prompt_contains_only_participating_sections(db_session):
    seed_profile(db_session)
    provider, events = await _run(
        db_session, seven_sections_consumed(db_session), {"summary": "示例总结"}
    )
    candidate = _candidate(provider)
    assert not (set(candidate) & set(UNPARTICIPATING))
    assert set(candidate) >= {"educations", "experiences", "projects", "languages"}
    progress = [event["message"] for event in events if event["type"] == "progress"]
    assert progress, "至少应有首条进度事件"
    for message in progress:
        for label in ("学术成果", "科研项目", "知识产权", "证书资质"):
            assert label not in message
    done = next(event for event in events if event["type"] == "done")
    assert done["resume"]["summary"]
    # 七项组含语言能力：模型没写语言时由 R-73 补位（origin=restored）。
    skill_names = [item["name"] for item in done["resume"]["skills"]]
    assert "英语" in skill_names
    assert any(annotation.get("origin") == "restored" for annotation in done["fact_annotations"])


async def test_c1_empty_participating_section_keeps_empty_array(db_session):
    seed_profile(db_session, include_new_sections=False)
    provider, events = await _run(
        db_session, all_sections_consumed(db_session), {"summary": "示例总结"}
    )
    candidate = _candidate(provider)
    # C1：在组里就出现，没数据就是空数组（不是省键）。
    assert candidate["publications"] == []
    assert candidate["research_projects"] == []
    assert candidate["patents"] == []
    assert candidate["credentials"] == []
    # 进度文案不把空分区说成"已整理 N 条"，也没有组外分区。
    progress = [event["message"] for event in events if event["type"] == "progress"]
    assert all("学术成果 0" not in message for message in progress)
    done = next(event for event in events if event["type"] == "done")
    # 输出侧空列表不序列化（旧内容指纹/字节不变），但键缺失不等于"没参与"。
    assert not done["resume"].get("publications")


async def test_custom_fields_enter_prompt_as_lines_and_are_restored(db_session):
    seed_profile(db_session)
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    project = next(
        entry
        for entry in entry_store.list_entries(db_session, section_key="projects")
        if entry.values.get("projects.name") == "检索平台"
    )
    entry_store.upsert_entry(
        db_session,
        "projects",
        entry_id=project.entry_id,
        values={field.field_id: "张伟"},
        expected_revision=project.revision,
    )
    provider, events = await _run(
        db_session,
        all_sections_consumed(db_session),
        {
            "summary": "示例总结",
            "projects": [
                {
                    "name": "检索平台",
                    "role": "后端",
                    "description": ["实现检索接口"],
                }
            ],
        },
    )
    candidate = _candidate(provider)
    project_candidate = next(item for item in candidate["projects"] if item["name"] == "检索平台")
    assert project_candidate["custom_fields"] == [{"label": "导师姓名", "value": "张伟"}]
    # C5-B①：提示词要求保留「标签：值」独立成行、标签名不得改写。
    system_prompt = provider.messages[0]["content"]
    assert "标签：值" in system_prompt and "标签名必须逐字保留" in system_prompt
    done = next(event for event in events if event["type"] == "done")
    description = "\n".join(done["resume"]["projects"][0]["description"])
    assert "导师姓名：张伟" in description, "缺失的自定义字段行必须自动补回承载区"
    restore_annotations = [
        annotation
        for annotation in done["fact_annotations"]
        if annotation.get("origin") == "restored"
    ]
    assert any(
        "导师姓名" in str(annotation.get("source_fact")) for annotation in restore_annotations
    )


async def test_custom_section_is_projected_deterministically_and_privacy_bound(db_session):
    seed_profile(db_session)
    section = definition_store.create_custom_section(db_session, "开源贡献")
    field = definition_store.create_custom_field(db_session, section.key, "贡献说明", "multi_line")
    entry_store.upsert_entry(db_session, section.key, values={field.field_id: "维护内部组件库"})
    credential = next(
        entry for entry in entry_store.list_entries(db_session, section_key="credentials")
    )
    entry_store.upsert_entry(
        db_session,
        "credentials",
        entry_id=credential.entry_id,
        values={"credentials.credential_number": "SECRET-CRED-001"},
        expected_revision=credential.revision,
    )
    provider, events = await _run(
        db_session, all_sections_consumed(db_session), {"summary": "示例总结"}
    )
    candidate_text = json.dumps(_candidate(provider), ensure_ascii=False)
    # H：证书编号永不进模型（即使字段被展开填写）。
    assert "SECRET-CRED-001" not in candidate_text
    assert "credential_number" not in candidate_text
    done = next(event for event in events if event["type"] == "done")
    custom_sections = done["resume"].get("custom_sections") or []
    assert [item["title"] for item in custom_sections] == ["开源贡献"]
    assert custom_sections[0]["entries"][0]["text"] == "维护内部组件库"


def test_claims_baseline_filters_by_snapshot_entry_ids(db_session):
    seed_profile(db_session)
    project = next(entry for entry in entry_store.list_entries(db_session, section_key="projects"))
    linked = claims.create_claim(
        db_session,
        ClaimCreate(
            title="关联主张",
            subject="检索平台",
            source_fact="实现检索接口",
            candidate_wording="实现检索接口",
            sources=[{"type": "link", "location": project.entry_id, "public": False}],
            verification_status="已确认",
        ),
    )
    claims.create_claim(
        db_session,
        ClaimCreate(
            title="旧资料主张",
            source_fact="旧资料事实",
            candidate_wording="旧资料表述",
            verification_status="已确认",
        ),
    )
    claims.create_claim(
        db_session,
        ClaimCreate(
            title="待确认主张",
            source_fact="待确认事实",
            candidate_wording="【待补】待确认表述",
            verification_status="待确认",
        ),
    )
    baseline = claims.build_baseline(db_session, source_entry_ids={project.entry_id})
    assert linked.id
    assert "实现检索接口" in baseline.baseline_text
    assert "旧资料事实" not in baseline.baseline_text
    assert any("重新核对" in warning for warning in baseline.warnings)
    # 禁止措辞仍是抑制约束：不因"关联不上"而放行。
    assert any("待确认表述" in wording for wording in baseline.blocked_wording)
    # 不传参数 = 全量语义（既有调用方/旧测试逐字节不变）。
    full = claims.build_baseline(db_session)
    assert "旧资料事实" in full.baseline_text
