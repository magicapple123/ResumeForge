# SPDX-License-Identifier: Apache-2.0
"""F2-B R-72 语言映射测试：唯一纯函数（language_projection）+ 投影层汇总警告。

路线 1 的口径：语言条目整条映射成 ResumeContent.skills，name=语言，
level=「水平/等级 · 证书 · 分数」，不含取得时间与自定义字段，语言排在系统技能之后。
本文件只测映射本身与 64 字符上限；拼接顺序/整份投影在 test_profile_group_projection.py。
"""

from __future__ import annotations

import json

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent
from app.schemas.resume_entries import ResumeSkill
from app.services.profile import definition_catalog, paper_projection
from app.services.profile import language_projection as lang


def _fields() -> tuple[ConsumedFieldSpec, ...]:
    spec = definition_catalog.get_section("languages")
    assert spec is not None
    return tuple(
        ConsumedFieldSpec(
            field_id=item.field_id,
            key=item.key,
            label=item.label,
            field_type=item.field_type,
            order=item.order,
            llm_allowed=item.llm_allowed,
            webform_allowed=item.webform_allowed,
            private=item.private,
            is_builtin=True,
        )
        for item in spec.fields
    )


def _entry(entry_id: str, values: dict[str, str], sort_order: int = 0) -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=sort_order, values=values)


def _section(*entries: ConsumedEntry, extra_field: ConsumedFieldSpec | None = None):
    spec = definition_catalog.get_section("languages")
    assert spec is not None
    fields = _fields()
    if extra_field is not None:
        fields = (*fields, extra_field)
    return ConsumedSection(
        key="languages",
        name=spec.name,
        form=spec.form,
        carrier_field_id=spec.carrier_field_id,
        material_only=spec.material_only,
        primary_field_id=None,
        fields=fields,
        entries=entries,
    )


def _skills_section(*entries: ConsumedEntry) -> ConsumedSection:
    spec = definition_catalog.get_section("skills")
    assert spec is not None
    fields = tuple(
        ConsumedFieldSpec(
            item.field_id,
            item.key,
            item.label,
            item.field_type,
            item.order,
            item.llm_allowed,
            item.webform_allowed,
            item.private,
            True,
        )
        for item in spec.fields
    )
    return ConsumedSection(
        "skills",
        spec.name,
        spec.form,
        spec.carrier_field_id,
        spec.material_only,
        None,
        fields,
        entries,
    )


def _profile(*sections: ConsumedSection) -> ConsumedProfile:
    keys = tuple(section.key for section in sections)
    return ConsumedProfile(
        "g1", "默认组", True, keys, keys, 5, {item.key: item for item in sections}
    )


def _consumed(section: ConsumedSection) -> ConsumedProfile:
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("languages",),
        section_order=("languages",),
        workspace_revision=5,
        sections={"languages": section},
    )


def test_level_joins_level_certificate_score_in_that_order() -> None:
    entry = _entry(
        "l1",
        {
            "languages.language": "英语",
            "languages.level": "CET-6",
            "languages.certificate": "六级证书",
            "languages.score": "550",
        },
    )
    skills = lang.project_language_skills(_section(entry))
    assert len(skills) == 1
    assert skills[0].name == "英语"
    assert skills[0].level == "CET-6 · 六级证书 · 550"
    assert lang.language_level(entry) == "CET-6 · 六级证书 · 550"


def test_empty_segments_are_skipped() -> None:
    only_certificate = _entry("l1", {"languages.language": "日语", "languages.certificate": "JLPT"})
    assert lang.language_level(only_certificate) == "JLPT"
    only_name = _entry("l2", {"languages.language": "法语"})
    assert lang.language_level(only_name) == ""
    assert lang.project_language_skills(_section(only_name))[0].level == ""


def test_obtained_at_and_custom_fields_never_enter_level() -> None:
    """R-72/§11 第 5 条：取得时间与语言的自定义字段都不上纸面。"""
    custom = ConsumedFieldSpec(
        field_id="languages.custom1",
        key="custom1",
        label="备注",
        field_type="single_line",
        order=1,
        llm_allowed=True,
        webform_allowed=True,
        private=False,
        is_builtin=False,
    )
    entry = _entry(
        "l1",
        {
            "languages.language": "英语",
            "languages.level": "CET-6",
            "languages.obtained_at": "2020-06",
            "languages.custom1": "自定义值",
        },
    )
    section = _section(entry, extra_field=custom)
    skills = lang.project_language_skills(section)
    assert skills[0].level == "CET-6"
    assert "2020-06" not in json.dumps([item.model_dump() for item in skills])
    assert "自定义值" not in json.dumps([item.model_dump() for item in skills])


def test_entries_keep_source_order_and_same_name_is_not_deduplicated() -> None:
    entries = (
        _entry(
            "l1",
            {
                "languages.language": "英语",
                "languages.level": "CET-6",
                "languages.score": "550",
            },
            0,
        ),
        _entry(
            "l2",
            {
                "languages.language": "英语",
                "languages.certificate": "雅思",
                "languages.score": "7",
            },
            1,
        ),
        _entry("l3", {"languages.language": "日语", "languages.level": "N2"}, 2),
    )
    skills = lang.project_language_skills(_section(*entries))
    assert [(item.name, item.level) for item in skills] == [
        ("英语", "CET-6 · 550"),
        ("英语", "雅思 · 7"),
        ("日语", "N2"),
    ]


def test_fully_empty_entries_are_skipped_but_named_entries_kept() -> None:
    section = _section(
        _entry("empty", {}),
        _entry("date-only", {"languages.obtained_at": "2020-06"}),
        _entry("level-only", {"languages.level": "N2"}),
    )
    skills = lang.project_language_skills(section)
    assert [(item.name, item.level) for item in skills] == [("", "N2")]


def test_level_over_64_chars_is_truncated_and_reported() -> None:
    long_level = "语" * 70
    section = _section(_entry("l1", {"languages.language": "英语", "languages.level": long_level}))
    skills = lang.project_language_skills(section)
    assert len(skills[0].level) == 64
    assert lang.language_overflow_warnings(section) == [("l1", "英语", 70)]


def test_level_exactly_64_chars_is_not_reported() -> None:
    section = _section(_entry("l1", {"languages.language": "英语", "languages.level": "A" * 64}))
    assert len(lang.project_language_skills(section)[0].level) == 64
    assert lang.language_overflow_warnings(section) == []


def test_build_projection_turns_language_overflow_into_carrier_warning() -> None:
    section = _section(_entry("l1", {"languages.language": "英语", "languages.level": "级" * 80}))
    out = paper_projection.build_projection(_consumed(section))
    assert len(out.content.skills[0].level) == 64
    overflow = [item for item in out.warnings if item.code == "carrier_overflow"]
    assert len(overflow) == 1
    assert overflow[0].section_key == "languages" and overflow[0].entry_id == "l1"
    assert "64" in overflow[0].message


def test_language_mapping_is_the_single_implementation_shared_by_projection() -> None:
    assert paper_projection.project_language_skills is lang.project_language_skills
    assert ResumeSkill.model_fields["level"].metadata[0].max_length == lang.LANGUAGE_LEVEL_MAX


def test_language_mapping_does_not_change_resume_content_structure() -> None:
    """R-72/R-78：不改 ResumeContent 结构、不给 ResumeSkill 加语言专属字段。"""
    assert "languages" not in ResumeContent.model_fields
    assert "certificate" not in ResumeSkill.model_fields
    assert "obtained_at" not in ResumeSkill.model_fields
    assert "score" not in ResumeSkill.model_fields


def test_empty_language_section_projects_to_empty_list() -> None:
    section = _section()
    assert lang.project_language_skills(section) == []
    assert lang.language_overflow_warnings(section) == []


def test_language_skills_follow_system_skills_and_expose_content_path() -> None:
    """R-72：语言条目排在系统技能之后；候选位置指向合并后的 content.skills 下标。"""
    skills = _skills_section(_entry("s1", {"skills.name": "Python", "skills.level": "熟练"}))
    languages = _section(
        _entry("l1", {"languages.language": "英语", "languages.level": "CET-6"}),
        _entry("l2", {"languages.language": "日语", "languages.level": "N2"}, sort_order=1),
    )
    out = paper_projection.build_projection(_profile(skills, languages))
    assert [(item.name, item.level) for item in out.content.skills] == [
        ("Python", "熟练"),
        ("英语", "CET-6"),
        ("日语", "N2"),
    ]
    language_candidates = [
        item.paper_content_path for item in out.candidates if item.section_key == "languages"
    ]
    assert language_candidates == ["skills/1", "skills/2"]
