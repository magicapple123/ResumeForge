# SPDX-License-Identifier: Apache-2.0
"""语言能力投影测试（2026-10 起的独立分区契约）。

用户反馈「我的资料里的语言能力在制作台变成了专业技能」：旧实现按 R-72 路线 1 把语言
压成一条 `ResumeSkill` 塞进 `content.skills`，于是制作台页签必然是「专业技能」。新口径：

- 语言能力是**独立正文分区**（key = `languages`），内容形状 `ResumeContent.languages`；
- 五个资料字段各自往返（语言/水平/证书/分数/取得时间），不再拼接成 level 字符串；
- 空条目不产生纸面占位；空列表不序列化（旧简历内容指纹不变）；
- 编辑器视图给出 `resume_field="languages"` 与逐字段 `resume_attr`。

本文件同时钉住：语言不再进入 skills、快照指纹随语言变化、语言补位写进 languages。
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
from app.schemas.resume_entries import ResumeLanguageItem, ResumeSkill
from app.services.profile import definition_catalog, paper_projection
from app.services.profile.projection_views import editor_schema
from tests.document_test_support import legacy_of


def _legacy_content(out):
    """投影 content 已是 v2 dict：本文件按 v1 分析口径断言（断言行为不变）。"""
    out.content = legacy_of(out.content)
    return out


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


def _section(*entries: ConsumedEntry) -> ConsumedSection:
    spec = definition_catalog.get_section("languages")
    assert spec is not None
    return ConsumedSection(
        key="languages",
        name=spec.name,
        form=spec.form,
        carrier_field_id=spec.carrier_field_id,
        material_only=spec.material_only,
        primary_field_id=None,
        fields=_fields(),
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


def test_languages_are_a_standalone_content_section() -> None:
    assert "languages" in ResumeContent.model_fields
    # 不给 ResumeSkill 加语言专属字段：语言不再是技能。
    for legacy in ("certificate", "obtained_at", "score"):
        assert legacy not in ResumeSkill.model_fields


def test_five_profile_fields_round_trip_into_languages() -> None:
    entry = _entry(
        "l1",
        {
            "languages.language": "英语",
            "languages.level": "CET-6",
            "languages.certificate": "六级证书",
            "languages.score": "550",
            "languages.obtained_at": "2020-06",
        },
    )
    out = _legacy_content(paper_projection.build_projection(_consumed(_section(entry))))
    assert len(out.content.languages) == 1
    item = out.content.languages[0]
    assert isinstance(item, ResumeLanguageItem)
    assert (item.name, item.level, item.certificate, item.score, item.obtained_at) == (
        "英语",
        "CET-6",
        "六级证书",
        "550",
        "2020-06",
    )
    # 关键回归：语言不再并入专业技能。
    assert out.content.skills == []


def test_entries_keep_source_order_and_empty_entries_are_skipped() -> None:
    section = _section(
        _entry("empty", {}),
        _entry("l1", {"languages.language": "英语"}, 0),
        _entry("l2", {"languages.language": "日语", "languages.level": "N2"}, 1),
        # 只有取得时间也是有效内容（不能因为主字段空就整条丢掉）。
        _entry("l3", {"languages.obtained_at": "2024-06"}, 2),
    )
    out = _legacy_content(paper_projection.build_projection(_consumed(section)))
    assert [item.name for item in out.content.languages] == ["英语", "日语", ""]
    assert out.content.languages[2].obtained_at == "2024-06"


def test_overlong_level_is_truncated_to_schema_limit() -> None:
    entry = _entry("l1", {"languages.language": "英语", "languages.level": "级" * 80})
    out = _legacy_content(paper_projection.build_projection(_consumed(_section(entry))))
    assert len(out.content.languages[0].level) == 64


def test_language_candidates_expose_languages_content_path() -> None:
    section = _section(
        _entry("l1", {"languages.language": "英语", "languages.level": "CET-6"}),
        _entry("l2", {"languages.language": "日语"}, 1),
    )
    out = paper_projection.build_projection(_consumed(section))
    rows = [item for item in out.candidates if item.section_key == "languages"]
    assert len(rows) == 2
    assert all(item.document_path == f"languages.{item.document_entry['id']}" for item in rows)
    assert [
        next(i["value"] for i in item.document_entry["items"] if i.get("key") == "name")
        for item in rows
    ] == ["英语", "日语"]


def test_languages_follow_system_skills_and_do_not_merge_into_them() -> None:
    skills = _skills_section(_entry("s1", {"skills.name": "Python", "skills.level": "熟练"}))
    languages = _section(_entry("l1", {"languages.language": "英语", "languages.level": "CET-6"}))
    out = _legacy_content(paper_projection.build_projection(_profile(skills, languages)))
    assert [(item.name, item.level) for item in out.content.skills] == [("Python", "熟练")]
    assert [(item.name, item.level) for item in out.content.languages] == [("英语", "CET-6")]


def test_snapshot_token_changes_when_language_changes() -> None:
    def token(values: dict[str, str]) -> str:
        profile = _consumed(_section(_entry("l1", values)))
        content = paper_projection.project_paper_content(profile)
        return paper_projection.snapshot_token(profile, content)

    assert token({"languages.language": "英语"}) != token({"languages.language": "日语"})


def test_editor_schema_maps_language_fields_to_resume_attrs() -> None:
    schema = editor_schema(_consumed(_section(_entry("l1", {"languages.language": "英语"}))))
    section = next(item for item in schema.sections if item.section_key == "languages")
    assert section.resume_field == "languages"
    assert section.form == "multi"
    attrs = {field.key: field.resume_attr for field in section.fields}
    assert attrs == {
        "language": "name",
        "level": "level",
        "certificate": "certificate",
        "score": "score",
        "obtained_at": "obtained_at",
    }


def test_empty_language_section_does_not_serialize() -> None:
    content = ResumeContent(name="张三")
    assert "languages" not in json.dumps(content.model_dump(mode="json"), ensure_ascii=False)
