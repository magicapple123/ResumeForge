# SPDX-License-Identifier: Apache-2.0
"""F2-B 纸面契约测试：承载区单点（R-37/R-42/R-77）+ C5-B（R-80）+ 投影红线段。

只写"契约"这一层：13 行承载区映射与定义目录一一对应、每个默认字段都有纸面去路
（没有静默丢内容的字段）、自建分区主文本/标签行规则、候选/布局/快照指纹的确定性，
以及证书编号不进任何出口（H）。数值级内容映射在 test_profile_group_projection.py。
"""

from __future__ import annotations

import json
from dataclasses import replace

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent
from app.services.profile import definition_catalog, paper_policy
from app.services.profile.paper_projection import (
    build_projection,
    ensure_custom_field_lines,
    normalize_for_match,
    project_carrier_text,
)
from tests.document_test_support import legacy_of


def _legacy_content(out):
    """投影 content 已是 v2 dict：本文件按 v1 分析口径断言（断言行为不变）。"""
    out.content = legacy_of(out.content)
    return out


# v3 §5.7 的 13 行承载区映射：只有这 10 行有承载区，三行仅素材。
EXPECTED_CARRIERS = {
    "educations": "educations.achievements",
    "experiences": "experiences.description",
    "projects": "projects.description",
    "skills": "skills.level",
    "campus_experiences": "campus_experiences.description",
    "awards": "awards.description",
    "summary": "summary.content",
    "publications": "publications.note",
    "research_projects": "research_projects.description",
    "credentials": "credentials.note",
}
MATERIAL_ONLY = ("basic_info", "patents", "languages")


def _builtin_fields(section_key: str) -> tuple[ConsumedFieldSpec, ...]:
    spec = definition_catalog.get_section(section_key)
    assert spec is not None
    return tuple(
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


def _section(section_key: str, *entries: ConsumedEntry) -> ConsumedSection:
    spec = definition_catalog.get_section(section_key)
    assert spec is not None
    return ConsumedSection(
        key=section_key,
        name=spec.name,
        form=spec.form,
        carrier_field_id=spec.carrier_field_id,
        material_only=spec.material_only,
        primary_field_id=None,
        fields=_builtin_fields(section_key),
        entries=entries,
    )


def _entry(entry_id: str, section_key: str, sort_order: int = 0, **values: str) -> ConsumedEntry:
    return ConsumedEntry(
        entry_id=entry_id,
        sort_order=sort_order,
        values={f"{section_key}.{key}": value for key, value in values.items()},
    )


def _profile(*sections: ConsumedSection, revision: int = 7) -> ConsumedProfile:
    keys = tuple(section.key for section in sections)
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=keys,
        section_order=keys,
        workspace_revision=revision,
        sections={section.key: section for section in sections},
    )


def _custom_field(field_id: str, label: str, field_type: str = "single_line"):
    return ConsumedFieldSpec(
        field_id=field_id,
        key=field_id.split(".")[-1],
        label=label,
        field_type=field_type,
        order=1,
        llm_allowed=True,
        webform_allowed=True,
        private=False,
        is_builtin=False,
    )


def test_carrier_map_is_exactly_the_13_rows_and_derived_from_catalog() -> None:
    for key in definition_catalog.BUILTIN_SECTION_KEYS:
        spec = definition_catalog.get_section(key)
        assert spec is not None
        assert paper_policy.carrier_field_id(key) == EXPECTED_CARRIERS.get(key)
        assert paper_policy.carrier_field_id(key) == spec.carrier_field_id
        assert paper_policy.is_material_only(key) == (key in MATERIAL_ONLY)
    # 自建/未知分区没有承载区（C2：自建独立成栏，不再追加到别的分区）
    assert paper_policy.carrier_field_id("custom:abc123") is None
    assert paper_policy.carrier_field_id("no_such_section") is None
    assert paper_policy.is_material_only("custom:abc123") is False


def test_every_default_field_has_a_paper_route() -> None:
    """槽位 / 承载区 / 追加 / 私密 / 仅素材，五选一；漏一个就是静默丢内容。"""
    for key in definition_catalog.BUILTIN_SECTION_KEYS:
        spec = definition_catalog.get_section(key)
        assert spec is not None
        rule = paper_policy.SECTION_RULES.get(key)
        appended = {item.field_id for item in paper_policy.appended_field_specs(key)}
        for builtin in spec.fields:
            routed = (
                spec.material_only
                or builtin.private
                or builtin.field_id == spec.carrier_field_id
                or builtin.field_id in appended
                or (rule is not None and builtin.key in rule.slots)
            )
            assert routed, "字段没有纸面去路：" + builtin.field_id


def test_f8_fields_are_slots_not_appended() -> None:
    """F8（R-81）：20 个资料小字段全部进槽位，appended 清单对这些分区为空。

    "哪些字段要回填"不是第二份手写表：FROM SlotRule.backfill 派生 BACKFILL_SLOT_KEYS，
    这里逐分区钉住内容（顺序=契约 §1 表顺序），漏标/多标/回退成 appended 都会红。
    """
    expected = {
        "educations": (
            "study_form",
            "degree_type",
            "department",
            "rank",
            "advisor",
            "research_direction",
        ),
        "experiences": ("team_size", "work_type"),
        "projects": ("project_size", "outcome_type"),
        "skills": ("category",),
        "campus_experiences": ("activity_type",),
        "awards": ("issuer", "level", "award_ratio"),
        "publications": ("outcome_type", "authorship_rank"),
        "research_projects": ("level", "funding"),
        "credentials": ("credential_type",),
    }
    assert {key: tuple(value) for key, value in paper_policy.BACKFILL_SLOT_KEYS.items()} == expected
    assert sum(len(value) for value in expected.values()) == 20
    for section_key in expected:
        assert paper_policy.appended_field_specs(section_key) == ()
        assert paper_policy.backfill_slot_rules(section_key) == tuple(
            (field_key, paper_policy.SECTION_RULES[section_key].slots[field_key])
            for field_key in expected[section_key]
        )
    # 既有槽位不受回填标记影响；私密字段仍不落纸面。
    assert paper_policy.SECTION_RULES["awards"].slots["title"].backfill is False
    assert paper_policy.SECTION_RULES["projects"].slots["public_url"].backfill is False
    assert all(
        paper_policy.SECTION_RULES[key].slots["status"].backfill is False
        for key in ("publications", "credentials")
    )
    for key in (*MATERIAL_ONLY, "summary"):
        assert paper_policy.appended_field_specs(key) == ()
    assert "credentials.credential_number" not in {
        item.field_id for item in paper_policy.appended_field_specs("credentials")
    }


def test_custom_section_text_field_priority_and_fallback() -> None:
    primary = _custom_field("custom:s1.f1", "主文本")
    other = _custom_field("custom:s1.f2", "其他", "multi_line")
    base = replace(
        _section("basic_info"),
        key="custom:s1",
        name="开源贡献",
        carrier_field_id=None,
        material_only=False,
        primary_field_id="custom:s1.f1",
        fields=(primary, other),
    )
    assert paper_policy.custom_section_text_field(base) == "custom:s1.f1"
    assert paper_policy.custom_section_line_fields(base, "custom:s1.f1") == (other,)
    # primary 指向已删除字段 → **不再**回退第一个多行字段（否则两条链语义分叉）
    assert paper_policy.custom_section_text_field(replace(base, primary_field_id="deleted")) is None
    no_text = replace(base, primary_field_id=None, fields=(primary, other))
    assert paper_policy.custom_section_text_field(no_text) is None
    assert paper_policy.custom_section_line_fields(no_text, None) == (primary, other)


def test_candidate_title_fields_cover_all_13_sections() -> None:
    assert set(paper_policy.CANDIDATE_FIELDS) == set(definition_catalog.BUILTIN_SECTION_KEYS)
    assert paper_policy.candidate_fields("custom:s1") == (None, None)
    assert paper_policy.candidate_fields("projects") == ("name", "role")


def test_status_enums_only_map_known_words() -> None:
    publication = paper_policy.SECTION_RULES["publications"].slots["status"].enum
    assert publication is not None and publication["已发表"] == "published"
    assert "返修中" not in publication
    credential = paper_policy.SECTION_RULES["credentials"].slots["status"].enum
    assert credential is not None and credential["已过期"] == "expired"


def test_normalize_for_match_removes_whitespace_and_punctuation() -> None:
    assert normalize_for_match("张 伟（第一作者），CET-6 · 550\n") == "张伟第一作者CET6550"
    assert normalize_for_match("\u3000全角空格\u200b零宽") == "全角空格零宽"
    assert normalize_for_match("a,b;c:d! e?f") == "abcdef"
    assert normalize_for_match("") == ""
    assert normalize_for_match("保持原样abc123") == "保持原样abc123"


def test_ensure_appends_missing_lines_in_order_and_skips_empty_values() -> None:
    text, appended = ensure_custom_field_lines(
        "项目描述正文", [("合作方", "李娜"), ("导师姓名", "张伟"), ("空字段", "  ")]
    )
    assert text == "项目描述正文\n合作方：李娜\n导师姓名：张伟"
    assert appended == ["合作方：李娜", "导师姓名：张伟"]
    empty, appended_empty = ensure_custom_field_lines("", [("导师姓名", "张伟")])
    assert (empty, appended_empty) == ("导师姓名：张伟", ["导师姓名：张伟"])


def test_ensure_does_not_duplicate_already_present_values() -> None:
    text, appended = ensure_custom_field_lines(
        "该项目由 张 伟 主导，合作方是李娜。", [("导师姓名", "张伟"), ("合作方", "李娜")]
    )
    assert text == "该项目由 张 伟 主导，合作方是李娜。" and appended == []
    again, appended_again = ensure_custom_field_lines(text, [("导师姓名", "张伟")])
    assert again == text and appended_again == []  # 幂等
    spec = _custom_field("projects.f1", "导师姓名")
    with_spec, _ = ensure_custom_field_lines("正文", [spec], values={"projects.f1": "张伟"})
    assert with_spec == "正文\n导师姓名：张伟"
    original = "正文"
    ensure_custom_field_lines(original, [("导师姓名", "张伟")])
    assert original == "正文"  # 不改写传入文本


def test_project_carrier_text_only_appends_custom_fields_after_f8() -> None:
    text = project_carrier_text(
        {
            "projects.description": "项目正文",
            "projects.project_size": "10 人",
            "projects.public_url": "https://example.com/p",
            "projects.outcome_type": "开源项目",
        },
        "projects",
    )
    # F8：规模/成果类型/公开链接都有独立槽位，承载区只剩默认正文（不再重复追加）。
    assert text == "项目正文"
    custom = _custom_field("projects.f1", "导师姓名")
    with_custom = project_carrier_text(
        {
            "projects.description": "项目正文",
            "projects.project_size": "10 人",
            "projects.f1": "张伟",
        },
        "projects",
        [custom],
    )
    assert with_custom == "项目正文\n导师姓名：张伟"
    assert (
        project_carrier_text(
            {"credentials.note": "备注", "credentials.credential_number": "ID-999"}, "credentials"
        )
        == "备注"
    )  # 私密证号永不落纸面
    assert project_carrier_text({"patents.title": "专利"}, "patents") == ""
    assert project_carrier_text({"custom:s1.content": "x"}, "custom:s1") == ""


def test_project_carrier_text_orders_custom_fields_and_falls_back_unknown_enum() -> None:
    custom = _custom_field("projects.f1", "导师姓名")
    text = project_carrier_text(
        {"projects.description": "正文", "projects.project_size": "10 人", "projects.f1": "张伟"},
        "projects",
        [custom],
    )
    assert text == "正文\n导师姓名：张伟"
    summary = project_carrier_text(
        {"summary.content": "总结正文", "summary.f1": "补充内容"},
        "summary",
        [_custom_field("summary.f1", "补充")],
    )
    assert summary == "总结正文\n补充：补充内容"
    # 未识别枚举仍退回承载区（不静默丢值）：工作类型不是 _WORK_TYPE 的中文时保持原文。
    assert (
        project_carrier_text(
            {"experiences.description": "正文", "experiences.work_type": "灵活用工"}, "experiences"
        )
        == "正文\n工作类型：灵活用工"
    )
    assert (
        project_carrier_text(
            {"publications.note": "备注", "publications.status": "返修中"}, "publications"
        )
        == "备注\n状态：返修中"
    )


def test_candidates_and_source_layout_follow_global_order() -> None:
    out = _legacy_content(
        build_projection(
            _profile(
                _section("basic_info", _entry("b1", "basic_info", name="王小明")),
                _section(
                    "educations",
                    _entry("e2", "educations", 1, school="某大学", major="计算机"),
                    _entry("e1", "educations", 2, school="某中学"),
                ),
                _section("projects", _entry("p1", "projects")),
            )
        )
    )
    assert [item.section_key for item in out.candidates] == [
        "basic_info",
        "educations",
        "educations",
        "projects",
    ]
    assert [item.entry_id for item in out.candidates] == ["b1", "e2", "e1", "p1"]
    assert out.candidates[0].title == "王小明"
    assert (out.candidates[1].title, out.candidates[1].subtitle) == ("某大学", "计算机")
    assert out.candidates[3].title == "项目经历"  # 空条目也作为候选出现
    assert out.content.projects == []  # 但空条目不产生纸面占位
    # Native candidate locations point to the exact projected row, in source order.
    assert out.candidates[0].document_path == out.candidates[3].document_path == ""
    for candidate in out.candidates[1:3]:
        assert candidate.document_path == f"education.{candidate.document_entry['id']}"
    assert [
        next(i["value"] for i in row.document_entry["items"] if i.get("key") == "school")
        for row in out.candidates[1:3]
    ] == ["某大学", "某中学"]
    layout = [
        (item.section_key, item.form, item.entry_count, item.material_only)
        for item in out.source_layout
    ]
    assert layout == [
        ("basic_info", "singleton", 1, True),
        ("educations", "multi", 2, False),
        ("projects", "multi", 1, False),
    ]


def test_snapshot_token_is_deterministic_and_revision_sensitive() -> None:
    sections = (
        _section("skills", _entry("s1", "skills", name="Python", level="熟练")),
        _section("languages", _entry("l1", "languages", language="英语")),
    )
    first = _legacy_content(build_projection(_profile(*sections, revision=3)))
    second = _legacy_content(build_projection(_profile(*sections, revision=3)))
    assert first.snapshot_token == second.snapshot_token and len(first.snapshot_token) == 64
    assert first.content.model_dump() == second.content.model_dump()
    changed = _legacy_content(build_projection(_profile(*sections, revision=4)))
    assert changed.snapshot_token != first.snapshot_token
    assert (first.scope.workspace_revision, first.scope.group_name) == (3, "默认组")


def test_credential_number_never_leaks_to_any_output() -> None:
    out = _legacy_content(
        build_projection(
            _profile(
                _section(
                    "credentials",
                    _entry(
                        "c1",
                        "credentials",
                        title="PMP",
                        status="有效",
                        note="备注",
                        credential_number="SECRET-123",
                    ),
                )
            )
        )
    )
    assert out.content.credentials[0].name == "PMP"
    dumped = json.dumps(out.content.model_dump(mode="json"), ensure_ascii=False)
    candidates = json.dumps([item.model_dump() for item in out.candidates], ensure_ascii=False)
    assert "SECRET-123" not in dumped and "SECRET-123" not in candidates
    assert all("SECRET-123" not in item.message for item in out.warnings)
    # 消费 DTO 类型里没有折叠态（Q：折叠/隐藏不得进入投影输入）
    assert "collapsed" not in ConsumedSection.__dataclass_fields__
    assert "hidden" not in ConsumedSection.__dataclass_fields__
    # 2026-10：语言能力已是独立正文分区（不再并进 skills），属于内容字段。
    assert "languages" in ResumeContent.model_fields
