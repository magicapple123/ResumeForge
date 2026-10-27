# SPDX-License-Identifier: Apache-2.0
"""F7 跨链路验收 O 集成测试：真实 F1 存储 → F2 reader/projection → 生成 / 填充两条链路。

**为什么用真实 service 而不是构造 DTO**：验收 O 要证明"同一条资料在生成链路与填充链路
产出的承载区文本一致"，中间任何一层被 mock 掉都会把两套实现的分叉藏起来。因此本文件：
1. 用 F1 存储层写入 13 分区 + 自定义字段/自定义大字段（真实 DB）；
2. 用 F2 的唯一读取实现 load_consumed_profile 得到消费快照；
3. 填充链路 = project_paper_content(consumed)（前端新建/从资料填充消费的就是它）；
4. 生成链路 = 模拟模型输出（改写正文、漏写自定义行/自建分区/语言）→ 真实
   generation_postprocess.ensure_custom_field_lines_in_resume / attach_custom_sections /
   language_restore.restore_languages 后处理。

断言：C5-B「标签：值」两条链路逐字一致且生成侧缺失可补回；C1 空键；C2 自建独立成栏且
两链路一致；material_only 字段不回声（确定性链路不写 + C6 保存前回声阻断负例）；R-72
语言映射一致。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.resume import ResumeContent, ResumeProject, ResumeSkill
from app.services.profile import definition_store, entry_store
from app.services.profile.group_scope import resolve_current_group_scope
from app.services.profile.paper_projection import project_paper_content
from app.services.profile.profile_context import build_consumed_data
from app.services.profile.profile_reader import load_consumed_profile
from app.services.resume.generation_postprocess import (
    MaterialOnlyEchoError,
    attach_custom_sections,
    block_material_only_echo,
    enforce_material_only_echo,
    ensure_custom_field_lines_in_resume,
)
from app.services.resume.language_restore import restore_languages
from tests.test_profile_group_budget import (
    UNPARTICIPATING,
    seed_profile,
    seven_sections_consumed,
)

BUILTIN_ORDER = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
)

# 仅素材字段的独有值：确定性的投影/后处理都不许把它们写进任何纸面位置。
PATENT_ONLY_VALUE = "软件著作权独有值"
BASIC_ONLY_VALUE = "RH阴性独有值"
LANGUAGE_ONLY_VALUE = "雅思备注独有值"


def _consumed(db):
    """真实 F2 读取边界：当前组的消费快照（与端点/生成链路同一实现）。"""
    return load_consumed_profile(db, resolve_current_group_scope(db))


def _seed_custom(db) -> dict:
    """在真实资料上补自定义字段、自定义大字段与条目值（F1 存储层）。"""
    mentor = definition_store.create_custom_field(db, "projects", "导师姓名", "single_line")
    partner = definition_store.create_custom_field(db, "projects", "合作方", "single_line")
    project = next(
        item
        for item in entry_store.list_entries(db, section_key="projects")
        if item.values.get("projects.name") == "检索平台"
    )
    entry_store.upsert_entry(
        db,
        "projects",
        entry_id=project.entry_id,
        values={mentor.field_id: "张伟", partner.field_id: "某公司"},
        expected_revision=project.revision,
    )

    # 仅素材分区的自定义字段：只进生成素材，不上纸面（C6/R-43/R-76）。
    patent_field = definition_store.create_custom_field(
        db, "patents", "成果类型补充", "single_line"
    )
    patent = entry_store.list_entries(db, section_key="patents")[0]
    entry_store.upsert_entry(
        db,
        "patents",
        entry_id=patent.entry_id,
        values={patent_field.field_id: PATENT_ONLY_VALUE},
        expected_revision=patent.revision,
    )
    basic_field = definition_store.create_custom_field(db, "basic_info", "血型", "single_line")
    basic = entry_store.list_entries(db, section_key="basic_info")[0]
    entry_store.upsert_entry(
        db,
        "basic_info",
        entry_id=basic.entry_id,
        values={basic_field.field_id: BASIC_ONLY_VALUE},
        expected_revision=basic.revision,
    )
    language_field = definition_store.create_custom_field(
        db, "languages", "语种备注", "single_line"
    )
    language = entry_store.list_entries(db, section_key="languages")[0]
    entry_store.upsert_entry(
        db,
        "languages",
        entry_id=language.entry_id,
        values={language_field.field_id: LANGUAGE_ONLY_VALUE},
        expected_revision=language.revision,
    )

    # C2：自建大字段（第一个多行字段成为主文本，其余字段生成「标签：值」行）。
    section = definition_store.create_custom_section(db, "开源贡献")
    description = definition_store.create_custom_field(db, section.key, "贡献描述", "multi_line")
    repo = definition_store.create_custom_field(db, section.key, "仓库链接", "single_line")
    entry_store.upsert_entry(
        db,
        section.key,
        values={description.field_id: "维护开源项目", repo.field_id: "https://example.com/repo"},
    )
    # C1：在组里但完全没有数据/字段的自建分区也要保留（不产生纸面占位）。
    empty_section = definition_store.create_custom_section(db, "待补充")
    return {
        "custom_section_key": section.key,
        "empty_section_key": empty_section.key,
        "mentor_label": "导师姓名",
        "partner_label": "合作方",
    }


def _project(content: ResumeContent, name: str) -> ResumeProject:
    return next(item for item in content.projects if item.name == name)


def _dumped(content: ResumeContent) -> str:
    return json.dumps(content.model_dump(mode="json"), ensure_ascii=False)


def test_fill_chain_projection_from_real_storage_has_lines_and_c2_and_languages(db_session):
    """填充链路（projection.content）：承载区标签行、C2 自建栏目、仅素材不回声、R-72。"""
    seed_profile(db_session)
    ids = _seed_custom(db_session)
    consumed = _consumed(db_session)
    content = project_paper_content(consumed)

    # C5-B：填充链路的承载区自带「标签：值」行（服务端投影单源，前端不拼标签）。
    project = _project(content, "检索平台")
    assert project.description[-2:] == ["导师姓名：张伟", "合作方：某公司"]
    # F8（R-81）：成果类型已有独立槽位，不再追加到承载区；承载区只保留自定义字段行。
    service = _project(content, "预约服务")
    assert service.artifact_type == "开源项目"
    assert "成果类型：" not in "\n".join(service.description)

    # C2：自建大字段独立成栏；与系统分区内容互不混入。
    custom_titles = {item.title: item for item in content.custom_sections}
    assert "开源贡献" in custom_titles
    custom = custom_titles["开源贡献"]
    assert custom.key == ids["custom_section_key"]
    assert custom.entries[0].text == "维护开源项目"
    assert [(line.label, line.value) for line in custom.entries[0].lines] == [
        ("仓库链接", "https://example.com/repo")
    ]
    assert all("维护开源项目" not in "\n".join(item.description) for item in content.projects)
    # 空自建分区不产生纸面占位，但仍参与/存在于消费快照（C1）。
    assert "待补充" not in custom_titles

    # 2026-10：语言能力独立成栏，不再并入 skills（用户反馈 #11）。
    skill_names = [item.name for item in content.skills]
    assert skill_names == ["Python", "RF_CUSTOM_SKILL_XYZ", "MySQL"]
    assert [item.name for item in content.languages] == ["英语"]
    language = content.languages[0]
    assert (language.level, language.score) == ("CET-6", "550")

    # material_only（basic_info / 知识产权 / 语言能力）的自定义字段值不上纸面（C6）。
    dumped = _dumped(content)
    for value in (PATENT_ONLY_VALUE, BASIC_ONLY_VALUE, LANGUAGE_ONLY_VALUE):
        assert value not in dumped


def test_c1_empty_participating_keys_from_real_storage(db_session):
    """C1：真实存储 → 消费快照：参与但空的分区保留空键/空数组；未参与整键不出现。"""
    seed_profile(db_session, include_new_sections=False)
    consumed = _consumed(db_session)
    assert set(consumed.sections) == set(consumed.participating_keys) == set(BUILTIN_ORDER)
    for key in ("publications", "research_projects", "patents", "credentials", "languages"):
        empty = consumed.sections[key]
        assert empty.entries == ()  # 在组里但没数据
        assert empty.fields  # 定义仍完整（前端可渲染空分区）
    data = build_consumed_data(consumed)
    for key in ("publications", "research_projects", "patents", "credentials", "languages"):
        assert data[key] == []  # C1：空数组键，而不是省键

    # 七项组：未参与分区整键不出现；参与分区照常。
    consumed_seven = seven_sections_consumed(db_session)
    data_seven = build_consumed_data(consumed_seven)
    assert not (set(data_seven) & set(UNPARTICIPATING))
    assert "educations" in data_seven and "projects" in data_seven


def test_generation_chain_postprocess_matches_fill_chain(db_session):
    """生成链路（模型改写 + 真实后处理）与填充链路的承载区/自建栏目/语言逐字一致。"""
    seed_profile(db_session)
    _seed_custom(db_session)
    consumed = _consumed(db_session)
    fill_content = project_paper_content(consumed)
    fill_lines = _project(fill_content, "检索平台").description[-2:]

    # 模拟模型输出：改写了描述、漏写自定义行/自建分区/语言（允许改写，C5-B 可补回）。
    model_resume = ResumeContent(
        summary="模型改写的总结",
        projects=[ResumeProject(name="检索平台", description=["AI 改写后的项目描述"])],
        skills=[ResumeSkill(name="Python", level="熟练")],
    )
    fixed, annotations = ensure_custom_field_lines_in_resume(model_resume, consumed)
    generated_lines = fixed.projects[0].description[-2:]
    assert generated_lines == fill_lines  # 两条链路同一份「标签：值」实现（R-37 单源）
    assert fixed.projects[0].description[0] == "AI 改写后的项目描述"  # 正文保留 AI 改写
    assert [item["origin"] for item in annotations] == ["restored"]
    assert annotations[0]["source_fact"] == "导师姓名：张伟；合作方：某公司"

    # C2：生成侧自建栏目由服务端确定性写入，与填充链路逐字一致。
    with_custom = attach_custom_sections(fixed, consumed)
    assert [item.model_dump() for item in with_custom.custom_sections] == [
        item.model_dump() for item in fill_content.custom_sections
    ]

    # 2026-10：模型漏写语言时补进独立 languages 分区，字段与填充链路一致。
    restored, language_annotations = restore_languages(with_custom, consumed)
    assert restored.languages[-1].name == "英语"
    assert restored.languages[-1].model_dump() == fill_content.languages[-1].model_dump()
    assert (restored.languages[-1].level, restored.languages[-1].score) == ("CET-6", "550")
    assert language_annotations[-1]["origin"] == "restored"

    # 后处理不会把仅素材值写进任何纸面位置（C6）。
    dumped = _dumped(restored)
    for value in (PATENT_ONLY_VALUE, BASIC_ONLY_VALUE, LANGUAGE_ONLY_VALUE):
        assert value not in dumped
    assert all(value not in annotation.get("source_fact", "") for annotation in annotations)


def test_generation_postprocess_is_idempotent_on_model_output(db_session):
    """补回后可重跑（保存重试/修订路径）：不重复追加，正文与两条链路保持稳定。"""
    seed_profile(db_session)
    _seed_custom(db_session)
    consumed = _consumed(db_session)
    model_resume = ResumeContent(
        projects=[ResumeProject(name="检索平台", description=["AI 改写后的项目描述"])]
    )
    once, _ = ensure_custom_field_lines_in_resume(model_resume, consumed)
    twice, extra = ensure_custom_field_lines_in_resume(once, consumed)
    assert twice.projects[0].description == once.projects[0].description
    assert extra == []


def test_c6_material_only_echo_is_blocked_before_save(db_session):
    """C6 负例：模型把仅素材值抄进 summary → 生成后处理抛阻断错误（调用方不写库）。"""
    seed_profile(db_session)
    _seed_custom(db_session)
    consumed = _consumed(db_session)
    fill_content = project_paper_content(consumed)
    # 合法纸面内容（系统承载区 + 自建栏目 + 语言映射）不触发回声阻断。
    block_material_only_echo(fill_content, consumed)

    echoed = fill_content.model_copy(update={"summary": f"我熟悉{PATENT_ONLY_VALUE}。"})
    with pytest.raises(MaterialOnlyEchoError) as exc_info:
        block_material_only_echo(echoed, consumed)
    error = exc_info.value
    assert error.section_key == "patents" and error.path == "summary"
    assert PATENT_ONLY_VALUE in error.detail and "请在正文中删除" in error.detail
    # 保存入口的薄封装返回可直接展示的中文错误（不抛异常给调用方）。
    message = enforce_material_only_echo(echoed, consumed)
    assert message and PATENT_ONLY_VALUE in message
    # 纯检查不改动内容（调用方据此拒绝保存，而不是被悄悄改写）。
    assert echoed.summary.endswith("。") and PATENT_ONLY_VALUE in echoed.summary


def test_c6_value_with_legal_paper_source_is_not_blocked(db_session):
    """C6 误报抑制：同一字符串本来就有合法纸面来源时，不算仅素材独有的回声。"""
    seed_profile(db_session)
    _seed_custom(db_session)
    echo_field = definition_store.create_custom_field(
        db_session, "patents", "同值字段", "single_line"
    )
    patent = entry_store.list_entries(db_session, section_key="patents")[0]
    entry_store.upsert_entry(
        db_session,
        "patents",
        entry_id=patent.entry_id,
        values={echo_field.field_id: "检索平台"},  # 与项目名称同值：项目名本身合法上纸面
        expected_revision=patent.revision,
    )
    consumed = _consumed(db_session)
    block_material_only_echo(project_paper_content(consumed), consumed)  # 不抛
    assert enforce_material_only_echo(project_paper_content(consumed), consumed) is None
