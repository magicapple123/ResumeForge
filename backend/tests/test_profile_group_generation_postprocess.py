# SPDX-License-Identifier: Apache-2.0
"""F3-B 生成后处理验收（O/K/R + C5-B/C2/语言补位）：纯函数级用例，不调模型。
覆盖：
- O（C5-B/R-80）：AI 改写正文后，缺失的自定义字段「标签：值」按定义顺序补回承载区；
  归一化匹配（去空白/标点）已出现则不重复补；补回不抛错、不拒绝保存；
- 仅素材分区（basic_info / 知识产权 / 语言能力）的自定义字段不追加到纸面；C2/R-79：
  content.custom_sections 由 project_paper_content(consumed) 确定性写入，标题/条目/标签行
  与"从资料填充"链路同一实现；无自建分区时为空列表；
- R-72/R-73：语言能力映射进 skills 末尾、origin=restored、已存在不重复、
  当前组不含 languages 不补；技能+语言合并超 200 条抛结构化 LanguageCapacityError。
"""

from __future__ import annotations

import pytest
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeAward, ResumeContent, ResumeProject, ResumeSkill
from app.services.resume.generation_postprocess import (
    attach_custom_sections,
    ensure_custom_field_lines_in_resume,
)
from app.services.resume.language_restore import (
    LanguageCapacityError,
    restore_language_skills,
)
from app.services.resume.resume_consistency import check_consistency
from app.services.resume.resume_coverage import find_unwritten_details


def _spec(
    field_id: str,
    key: str,
    label: str,
    field_type: str = "single_line",
    *,
    order: int = 1,
    is_builtin: bool = True,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id=field_id,
        key=key,
        label=label,
        field_type=field_type,
        order=order,
        llm_allowed=True,
        webform_allowed=True,
        private=False,
        is_builtin=is_builtin,
    )


def _section(
    key: str,
    name: str,
    fields: list[ConsumedFieldSpec],
    entries: list[ConsumedEntry],
    *,
    form: str = "multi",
    carrier: str | None = None,
    primary_field_id: str | None = None,
    material_only: bool = False,
    revision: int = 1,
) -> ConsumedSection:
    return ConsumedSection(
        key=key,
        name=name,
        form=form,
        carrier_field_id=carrier,
        material_only=material_only,
        primary_field_id=primary_field_id,
        fields=tuple(fields),
        entries=tuple(entries),
        revision=revision,
    )


def _entry(entry_id: str, sort_order: int, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=sort_order, values=values)


def _profile(sections: dict[str, ConsumedSection], order: list[str]) -> ConsumedProfile:
    return ConsumedProfile(
        group_id="group-1",
        group_name="默认组",
        is_default=True,
        participating_keys=tuple(order),
        section_order=tuple(order),
        workspace_revision=5,
        sections=sections,
    )


def _custom_projects_profile() -> ConsumedProfile:
    custom = _spec("cf-mentor", "mentor", "导师姓名", is_builtin=False, order=3)
    projects = _section(
        "projects",
        "项目经历",
        [
            _spec("projects.name", "name", "项目名称", order=1),
            _spec("projects.description", "description", "项目描述", "multi_line", order=2),
            custom,
        ],
        [
            _entry(
                "e1",
                0,
                {
                    "projects.name": "简历通",
                    "projects.description": "开发接口",
                    "cf-mentor": "张伟",
                },
            )
        ],
        carrier="projects.description",
    )
    return _profile({"projects": projects}, ["projects"])


def test_missing_custom_field_line_is_appended_to_carrier():
    consumed = _custom_projects_profile()
    resume = ResumeContent(
        projects=[ResumeProject(name="简历通", description=["负责接口开发与维护"])]
    )
    result, annotations = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result.projects[0].description == ["负责接口开发与维护", "导师姓名：张伟"]
    assert annotations == [
        {
            "path": "projects.0.description",
            "origin": "restored",
            "source_subject": "简历通",
            "source_fact": "导师姓名：张伟",
        }
    ]
    # 幂等：第二次不再重复追加（R-80 不重复补）。
    again, extra = ensure_custom_field_lines_in_resume(result, consumed)
    assert again.projects[0].description == result.projects[0].description
    assert extra == []


def test_value_already_present_after_normalization_is_not_appended():
    consumed = _custom_projects_profile()
    # AI 改写时把"张伟"放进了正文，并加了空格/标点变体：归一化后视为已呈现。
    resume = ResumeContent(
        projects=[ResumeProject(name="简历通", description=["导师：张 伟 负责接口开发"])]
    )
    result, annotations = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result.projects[0].description == ["导师：张 伟 负责接口开发"]
    assert annotations == []


def test_multiple_custom_fields_appended_in_definition_order():
    fields = [
        _spec("projects.name", "name", "项目名称", order=1),
        _spec("projects.description", "description", "项目描述", "multi_line", order=2),
        _spec("cf-a", "a", "导师姓名", is_builtin=False, order=3),
        _spec("cf-b", "b", "合作方", is_builtin=False, order=4),
    ]
    projects = _section(
        "projects",
        "项目经历",
        fields,
        [_entry("e1", 0, {"projects.name": "简历通", "cf-a": "张伟", "cf-b": "某公司"})],
        carrier="projects.description",
    )
    consumed = _profile({"projects": projects}, ["projects"])
    # 没有模型条目 = 不凭自定义字段造经历（不补造）。
    resume = ResumeContent(projects=[ResumeProject(name="简历通", description=["改写过"])])
    result, _ = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result.projects[0].description == ["改写过", "导师姓名：张伟", "合作方：某公司"]


def test_material_only_fields_are_not_appended():
    basic_custom = _spec("cf-political", "political", "政治面貌", is_builtin=False)
    patent_custom = _spec("cf-type", "type", "成果类型", is_builtin=False)
    language_custom = _spec("cf-note", "note", "语种备注", is_builtin=False)
    sections = {
        "basic_info": _section(
            "basic_info",
            "基本信息",
            [basic_custom],
            [_entry("b1", 0, {"cf-political": "中共党员"})],
            form="singleton",
            material_only=True,
        ),
        "patents": _section(
            "patents",
            "知识产权",
            [patent_custom],
            [_entry("p1", 0, {"cf-type": "软件著作权"})],
            material_only=True,
        ),
        "languages": _section(
            "languages",
            "语言能力",
            [language_custom],
            [_entry("l1", 0, {"cf-note": "雅思 7"})],
            material_only=True,
        ),
    }
    consumed = _profile(sections, list(sections))
    resume = ResumeContent(summary="", skills=[ResumeSkill(name="Python")])
    result, annotations = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result == resume
    assert annotations == []


def test_award_scalar_carrier_is_appended():
    award_custom = _spec("cf-issuer", "issuer", "颁奖单位", is_builtin=False)
    awards = _section(
        "awards",
        "荣誉奖项",
        [_spec("awards.title", "title", "奖项名称"), award_custom],
        [_entry("a1", 0, {"awards.title": "一等奖", "cf-issuer": "某学会"})],
        carrier="awards.description",
    )
    consumed = _profile({"awards": awards}, ["awards"])
    resume = ResumeContent(awards=[ResumeAward(name="一等奖", description="校级比赛")])
    result, _ = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result.awards[0].description == "校级比赛\n颁奖单位：某学会"


def test_ambiguous_entry_match_does_not_append():
    custom = _spec("cf-a", "a", "导师姓名", is_builtin=False)
    projects = _section(
        "projects",
        "项目经历",
        [_spec("projects.name", "name", "项目名称"), custom],
        [
            _entry("dup1", 0, {"projects.name": "同名项目", "cf-a": "张伟"}),
            _entry("dup2", 1, {"projects.name": "同名项目", "cf-a": "李四"}),
        ],
        carrier="projects.description",
    )
    consumed = _profile({"projects": projects}, ["projects"])
    resume = ResumeContent(projects=[ResumeProject(name="同名项目", description=["改写过"])])
    result, annotations = ensure_custom_field_lines_in_resume(resume, consumed)
    assert result.projects[0].description == ["改写过"]
    assert annotations == []


def test_attach_custom_sections_uses_projection_result():
    text_field = _spec("cs1text", "text", "描述", "multi_line")
    item_field = _spec("cs1item", "item", "条目", is_builtin=False)
    section = _section(
        "custom:sec1",
        "开源贡献",
        [text_field, item_field],
        [_entry("c1", 0, {"cs1text": "维护项目", "cs1item": "star 100"})],
        primary_field_id="cs1text",
    )
    consumed = _profile({"custom:sec1": section}, ["custom:sec1"])
    resume = ResumeContent(summary="模型自己写的总结", custom_sections=[])
    result = attach_custom_sections(resume, consumed)
    assert result.summary == "模型自己写的总结"
    assert [item.model_dump() for item in result.custom_sections] == [
        {
            "key": "custom:sec1",
            "title": "开源贡献",
            "entries": [
                {
                    "entry_id": "c1",
                    "text": "维护项目",
                    "lines": [{"label": "条目", "value": "star 100"}],
                }
            ],
        }
    ]
    # 空自建分区 → custom_sections 为空（旧简历指纹不因 C2 改变）。
    empty = attach_custom_sections(resume, _profile({}, []))
    assert empty.custom_sections == []


def _languages_section(**values: str) -> ConsumedSection:
    return _section(
        "languages",
        "语言能力",
        [
            _spec("languages.language", "language", "语言", order=1),
            _spec("languages.level", "level", "水平/等级", order=2),
            _spec("languages.certificate", "certificate", "证书", order=3),
            _spec("languages.score", "score", "分数", order=4),
        ],
        [_entry("l1", 0, values)],
        material_only=True,
    )


def test_language_restore_appends_after_existing_skills():
    languages = _languages_section(
        **{
            "languages.language": "英语",
            "languages.level": "CET-6",
            "languages.score": "550",
        }
    )
    consumed = _profile({"languages": languages}, ["languages"])
    resume = ResumeContent(skills=[ResumeSkill(name="Python", level="熟练")])
    result, annotations = restore_language_skills(resume, consumed)
    assert [skill.name for skill in result.skills] == ["Python", "英语"]
    assert result.skills[1].level == "CET-6 · 550"
    assert annotations == [
        {
            "path": "skills.1",
            "origin": "restored",
            "source_subject": "英语",
            "source_fact": "CET-6 · 550",
        }
    ]


def test_language_restore_skips_present_and_absent_languages():
    languages = _languages_section(**{"languages.language": "英语"})
    consumed = _profile({"languages": languages}, ["languages"])
    present = ResumeContent(skills=[ResumeSkill(name="英语", level="CET-6")])
    result, annotations = restore_language_skills(present, consumed)
    assert result is present and annotations == []
    untouched = restore_language_skills(present, _profile({}, []))
    assert untouched == (present, [])


def test_language_capacity_error_is_structured():
    languages = _languages_section(**{"languages.language": "英语"})
    consumed = _profile({"languages": languages}, ["languages"])
    resume = ResumeContent(skills=[ResumeSkill(name=f"技能{i}") for i in range(200)])
    with pytest.raises(LanguageCapacityError) as exc:
        restore_language_skills(resume, consumed)
    assert exc.value.total == 201
    assert "200" in exc.value.detail


def test_consistency_tolerates_absent_sections_7_item_group():
    """R-29/R-30：七项组里 skills/educations 等整键不出现，诊断不得 KeyError。"""
    resume = ResumeContent(projects=[ResumeProject(name="简历通", description=["开发接口"])])
    selection_data = {"data": {"projects": [{"name": "简历通", "description": ["开发接口"]}]}}
    assert check_consistency(resume, _profile({}, []), selection_data) == []
    # 候选里没有 skills，但简历写了技能名 → 如实提示"疑似虚构"，而不是抛 KeyError。
    resume_with_skill = resume.model_copy(update={"skills": [ResumeSkill(name="Python")]})
    assert any(
        "技能" in w for w in check_consistency(resume_with_skill, _profile({}, []), selection_data)
    )


def test_unwritten_details_accepts_consumed_and_legacy_entry_names():
    """双分派：consumed 入口与旧 entry_names 入口给出同一份未写入清单。"""
    resume = ResumeContent(projects=[ResumeProject(name="已写项目")])
    entry_names = {"projects": ["已写项目", "漏写项目"]}
    data = {"projects": [{"name": "已写项目"}]}
    legacy = find_unwritten_details(resume, entry_names, data)
    consumed_entry = find_unwritten_details(
        resume, _profile({}, []), {"entry_names": entry_names, "data": data}
    )
    assert legacy == consumed_entry
    assert legacy[0]["filtered"] == ["漏写项目"]
