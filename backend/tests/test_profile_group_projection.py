# SPDX-License-Identifier: Apache-2.0
"""F2-B 纸面投影内容测试：C1 空分区、C2 自建独立分栏、R-42/R-79/R-44 映射与限长。

消费 DTO 直接构造（不依赖 reader 落库），把"投影是纯函数"钉住：空分区不产生占位、
未参与分区整键不出现、只映射有值内容。候选/布局/指纹/私密红线与 C5-B 在
test_profile_group_paper_contract.py；语言映射与排序在 test_profile_group_languages.py。
"""

from __future__ import annotations

import base64
import json
from dataclasses import replace

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
    PaperProjectionOut,
)
from app.schemas.resume import ResumeContent
from app.services.profile import definition_catalog
from app.services.profile.paper_projection import build_projection, project_paper_content


def _section(section_key: str, *entries: ConsumedEntry) -> ConsumedSection:
    spec = definition_catalog.get_section(section_key)
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
        section_key,
        spec.name,
        spec.form,
        spec.carrier_field_id,
        spec.material_only,
        None,
        fields,
        entries,
    )


def _entry(entry_id: str, section_key: str, sort_order: int = 0, **values: str) -> ConsumedEntry:
    """按 "字段 key=值" 构造条目的值（自动补 section_key. 前缀）。"""
    return ConsumedEntry(
        entry_id, sort_order, {f"{section_key}.{key}": value for key, value in values.items()}
    )


def _custom_field(field_id: str, label: str, field_type: str = "single_line"):
    return ConsumedFieldSpec(
        field_id, field_id.split(".")[-1], label, field_type, 1, True, True, False, False
    )


def _custom_section(
    section_id: str,
    name: str,
    fields: tuple[ConsumedFieldSpec, ...],
    *entries: ConsumedEntry,
    primary: str | None = None,
) -> ConsumedSection:
    return ConsumedSection(
        f"custom:{section_id}", name, "multi", None, False, primary, fields, entries
    )


def _profile(*sections: ConsumedSection, revision: int = 7) -> ConsumedProfile:
    keys = tuple(section.key for section in sections)
    return ConsumedProfile(
        "g1", "默认组", True, keys, keys, revision, {section.key: section for section in sections}
    )


def _content(*sections: ConsumedSection) -> ResumeContent:
    return project_paper_content(_profile(*sections))


def _out(*sections: ConsumedSection, **kwargs) -> PaperProjectionOut:
    return build_projection(_profile(*sections), **kwargs)


def _dump(content: ResumeContent) -> str:
    return json.dumps(content.model_dump(mode="json"), ensure_ascii=False)


def _png_data_url() -> str:
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def test_empty_sections_keep_keys_without_placeholder_and_excluded_absent() -> None:
    out = _out(_section("basic_info"), _section("educations"), _section("languages"))
    assert out.content.education == [] and out.content.skills == []
    assert out.candidates == [] and out.warnings == []
    assert [item.entry_count for item in out.source_layout] == [0, 0, 0]
    out = _out(
        _section("basic_info"),
        _section("educations", _entry("e1", "educations", school="某大学")),
        _section("projects", _entry("p1", "projects")),
    )
    assert "某大学" in _dump(out.content)
    assert out.content.experience == [] and out.content.projects == []  # 空条目不留占位
    assert [item.section_key for item in out.candidates] == ["educations", "projects"]


def test_basic_info_projects_identity_fields_only() -> None:
    content = _content(
        _section(
            "basic_info",
            _entry(
                "b1",
                "basic_info",
                name="王小明",
                gender="男",
                birth_month="1998-05",
                phone="13800000000",
                email="a@example.com",
                city="杭州",
                homepage="https://me.example.com",
                github="https://github.com/x",
                job_intention="后端工程师",
                target_city="上海",  # 只进生成素材（仅素材分区），不上纸面
                political_status="群众",
            ),
        )
    )
    assert (content.name, content.gender, content.birth_year) == ("王小明", "男", "1998-05")
    assert (content.phone, content.email, content.city) == ("13800000000", "a@example.com", "杭州")
    assert (content.personal_website, content.github) == (
        "https://me.example.com",
        "https://github.com/x",
    )
    assert content.job_intent == "后端工程师" and "上海" not in _dump(content)


def test_photo_data_url_passthrough_and_unresolved_warning() -> None:
    data_url = _png_data_url()

    def basic(photo: str) -> ConsumedSection:
        return _section("basic_info", _entry("b1", "basic_info", name="王", photo=photo))

    assert _content(basic(data_url)).photo == data_url  # data URL 原样透传
    missing = _out(basic("photo:3"))
    assert missing.content.photo == "" and [w.code for w in missing.warnings] == [
        "photo_unresolved"
    ]
    assert (
        _out(basic("photo:3"), resolve_photo=lambda reference: data_url).content.photo == data_url
    )
    rejected = _out(basic("photo:3"), resolve_photo=lambda reference: "not-an-image")
    assert rejected.content.photo == "" and rejected.warnings[0].code == "photo_unresolved"


def test_education_mapping_with_appended_default_and_custom_lines() -> None:
    section = _section(
        "educations",
        _entry(
            "e1",
            "educations",
            school="某大学",
            major="计算机",
            degree="本科",
            start_date="2016-09",
            end_date="2020-06",
            gpa="3.8/4.0",
            rank="前 5%",
            advisor="张伟",
            core_courses="数学\n英语",
            achievements="在校成果一",
            f1="李娜",
        ),
    )
    section = replace(section, fields=(*section.fields, _custom_field("educations.f1", "导师姓名")))
    item = _content(_section("basic_info"), section).education[0]
    assert (item.school, item.major, item.degree) == ("某大学", "计算机", "本科")
    assert (item.start_date, item.end_date, item.gpa) == ("2016-09", "2020-06", "3.8/4.0")
    # F8（R-81）：成绩排名/导师进独立槽位，不再追加到 achievements 承载区。
    assert (item.rank, item.advisor) == ("前 5%", "张伟")
    assert (item.courses, item.achievements) == (
        ["数学", "英语"],
        ["在校成果一", "导师姓名：李娜"],
    )


def test_project_mapping_outcome_line_and_invalid_url_fallback() -> None:
    content = _content(
        _section(
            "projects",
            _entry(
                "p1",
                "projects",
                name="开源项目",
                role="作者",
                tech_stack="Python, FastAPI、Docker",
                description="第一行\n第二行",
                highlights="亮点一",
                public_url="https://example.com/repo",
                project_size="10 人",
                outcome_type="开源项目",
            ),
            _entry(
                "p2",
                "projects",
                sort_order=1,
                name="项目二",
                description="正文",
                public_url="ftp://example.com/x",
            ),
        )
    )
    first, second = content.projects
    assert (first.name, first.role, first.public_url) == (
        "开源项目",
        "作者",
        "https://example.com/repo",
    )
    assert (first.tech_stack, first.highlights) == (["Python", "FastAPI", "Docker"], ["亮点一"])
    # F8（R-81）：规模/成果类型进独立槽位，承载区只保留正文。
    assert (first.project_size, first.artifact_type) == ("10 人", "开源项目")
    assert first.description == ["第一行", "第二行"]
    assert second.public_url == "" and second.description[-1] == "公开链接：ftp://example.com/x"


def test_skills_carrier_and_64_char_overflow_warning() -> None:
    normal = _content(
        _section("skills", _entry("s1", "skills", name="Python", level="熟练", category="编程语言"))
    )
    # F8（R-81）：技能分类进独立槽位，承载区 level 只保留正文。
    assert (normal.skills[0].level, normal.skills[0].category) == ("熟练", "编程语言")
    out = _out(_section("skills", _entry("s1", "skills", name="Python", level="熟" * 200)))
    assert out.content.skills[0].level == "熟" * 64
    assert [item.code for item in out.warnings] == ["carrier_overflow"]
    assert "64 字符上限" in out.warnings[0].message


def test_awards_and_summary_carrier_append() -> None:
    awards = _section(
        "awards",
        _entry(
            "a1",
            "awards",
            title="一等奖",
            awarded_at="2024-05",
            description="说明",
            issuer="教务处",
            level="校级",
            award_ratio="前 1%",
        ),
    )
    summary = replace(
        _section("summary", _entry("m1", "summary", content="正文", f1="补充内容")),
        fields=(*_section("summary").fields, _custom_field("summary.f1", "补充")),
    )
    content = _content(awards, summary)
    award = content.awards[0]
    assert (award.name, award.date) == ("一等奖", "2024-05")
    # F8（R-81）：颁发机构/级别/获奖比例进独立槽位，承载区 description 只保留说明。
    assert (award.issuer, award.level, award.ratio) == ("教务处", "校级", "前 1%")
    assert award.description == "说明"
    assert content.summary == "正文\n补充：补充内容"


def test_publication_research_mapping_and_unknown_status_fallback() -> None:
    publications = _section(
        "publications",
        _entry(
            "u1",
            "publications",
            title="论文标题",
            authors="张伟、李娜",
            venue="某会议",
            year="2024",
            status="已发表",
            url="https://doi.org/x",
            doi="10.1/x",
            volume_pages="1-3",
            note="备注",
            outcome_type="期刊论文",
            authorship_rank="第一作者",
        ),
        _entry("u2", "publications", title="待改论文", status="返修中", sort_order=1),
    )
    research = _section(
        "research_projects",
        _entry(
            "r1",
            "research_projects",
            name="课题",
            institution="某实验室",
            level="国家级",
            description="描述",
            outcomes="成果一\n成果二",
            funding="10 万",
        ),
    )
    content = _content(publications, research)
    paper = content.publications[0]
    assert [author.name for author in paper.authors] == ["张伟", "李娜"]
    assert (paper.status, paper.doi, paper.volume_pages) == ("published", "10.1/x", "1-3")
    # F8（R-81）：成果类型/我的署名位次进独立槽位，note 只保留备注。
    assert (paper.outcome_type, paper.my_rank) == ("期刊论文", "第一作者")
    assert paper.note == "备注"
    # 未知状态不擅改枚举：默认 other，原文退回承载区
    assert content.publications[1].status == "other"
    assert content.publications[1].note == "状态：返修中"
    project = content.research_projects[0]
    assert project.organization == "某实验室"
    assert (project.level, project.funding) == ("国家级", "10 万")
    assert project.description == ["描述"]
    assert project.outcomes == ["成果一", "成果二"]


def test_f8_empty_fields_do_not_serialize() -> None:
    """F8 可选字段空串不进 model_dump：旧简历内容指纹/导出逐字节不变（R-81）。"""
    from app.schemas.resume_credentials import ResumeCredential
    from app.schemas.resume_entries import (
        ResumeAward,
        ResumeCampusExperience,
        ResumeEducation,
        ResumeExperience,
        ResumeProject,
        ResumeSkill,
    )
    from app.schemas.resume_research import ResumePublication, ResumeResearchProject

    # 注意 issuer/level/outcome_type 这类属性名在旧模型里已存在（credentials.issuer、
    # skills.level、funding 等）；这里只钉**F8 全新**的属性，避免把既有字段的空串
    # 序列化语义（旧指纹依赖）当成回归。
    new_keys = {
        "study_form",
        "degree_type",
        "department",
        "rank",
        "advisor",
        "research_direction",
        "team_size",
        "project_size",
        "category",
        "activity_type",
        "ratio",
        "outcome_type",
        "my_rank",
        "credential_type",
    }
    for model in (
        ResumeEducation,
        ResumeExperience,
        ResumeCampusExperience,
        ResumeProject,
        ResumeSkill,
        ResumeAward,
        ResumePublication,
        ResumeResearchProject,
        ResumeCredential,
    ):
        dump = model().model_dump()
        assert not (set(dump) & new_keys), (model.__name__, set(dump) & new_keys)
        # experience_kind / artifact_type / funding 是既有可选/复用属性，保持原序列化行为；
        # 这里只钉住 F8 新键，不改变既有字段的指纹语义。


def test_experience_work_type_maps_to_code_and_team_size_slot() -> None:
    """F8：work_type 中文→A4 code；未知中文仍退回承载区（不静默丢值）。"""
    content = _content(
        _section(
            "experiences",
            _entry(
                "x1",
                "experiences",
                company="甲公司",
                title="工程师",
                work_type="全职",
                team_size="30 人",
                description="正文",
            ),
        )
    )
    item = content.experience[0]
    assert (item.experience_kind, item.team_size) == ("full_time", "30 人")
    assert item.description == ["正文"]
    unknown = _content(
        _section(
            "experiences",
            _entry("x2", "experiences", company="乙公司", work_type="灵活用工", description="正文"),
        )
    )
    assert unknown.experience[0].experience_kind == ""
    assert unknown.experience[0].description == ["正文", "工作类型：灵活用工"]


def test_patents_render_but_new_fields_stay_material_only() -> None:
    section = _section(
        "patents",
        _entry(
            "t1",
            "patents",
            title="一种方法",
            outcome_type="发明专利",
            inventors="张伟、李娜",
            inventor_rank="第一发明人",
            patent_number="CN123",
            status="已授权",
            application_date="2023-01",
            grant_date="2024-02",
            url="https://patent.example.com/x",
            country="中国",
            f1="自定义值",
        ),
    )
    section = replace(section, fields=(*section.fields, _custom_field("patents.f1", "自定义")))
    content = _content(section)
    patent = content.patents[0]
    assert (patent.title, patent.patent_number, patent.status, patent.country) == (
        "一种方法",
        "CN123",
        "granted",
        "中国",
    )
    assert (patent.filed_date, patent.granted_date) == ("2023-01", "2024-02")
    assert [author.name for author in patent.inventors] == ["张伟", "李娜"]
    dumped = _dump(content)
    assert "发明专利" not in dumped and "第一发明人" not in dumped and "自定义值" not in dumped


def test_custom_sections_are_independent_columns_in_participating_order() -> None:
    fields = (
        _custom_field("custom:s1.f1", "贡献描述", "multi_line"),
        _custom_field("custom:s1.f2", "仓库链接"),
    )
    open_source = _custom_section(
        "s1",
        "开源贡献",
        fields,
        ConsumedEntry("e1", 0, {"custom:s1.f1": "贡献正文", "custom:s1.f2": "https://repo"}),
        ConsumedEntry("e2", 1, {"custom:s1.f1": "第二条"}),
        primary="custom:s1.f1",
    )
    empty = _custom_section("s2", "空分区", (_custom_field("custom:s2.f1", "说明", "multi_line"),))
    projects = _section("projects", _entry("p1", "projects", name="项目", description="正文"))
    content = _content(_section("basic_info"), projects, open_source, empty)
    assert [item.title for item in content.custom_sections] == ["开源贡献"]
    custom = content.custom_sections[0]
    assert custom.key == "custom:s1"
    assert [item.text for item in custom.entries] == ["贡献正文", "第二条"]
    assert [(line.label, line.value) for line in custom.entries[0].lines] == [
        ("仓库链接", "https://repo")
    ]
    assert content.projects[0].description == ["正文"]  # 自建内容不混进系统分区承载区
    out = _out(_section("basic_info", _entry("b1", "basic_info", name="王")), projects, open_source)
    assert [
        item.paper_content_path for item in out.candidates if item.section_key == "custom:s1"
    ] == ["custom_sections/custom:s1/entries/0", "custom_sections/custom:s1/entries/1"]
    assert out.candidates[0].paper_content_path == ""  # basic_info 是标量，没有数组位置
    # primary 为空 → 第一个多行字段当主文本
    fallback = _custom_section(
        "s3",
        "自建",
        (
            _custom_field("custom:s3.f1", "名称"),
            _custom_field("custom:s3.f2", "描述", "multi_line"),
        ),
        ConsumedEntry("e3", 0, {"custom:s3.f2": "描述内容"}),
    )
    assert _content(fallback).custom_sections[0].entries[0].text == "描述内容"


def test_carrier_overflow_warns_and_keeps_default_text() -> None:
    base = "备" * 2000  # 备注结构上限 2000：默认正文已占满，追加行放不下
    section = _section(
        "publications", _entry("u1", "publications", title="论文", note=base, f1="X")
    )
    section = replace(section, fields=(*section.fields, _custom_field("publications.f1", "补充")))
    out = _out(section)
    assert out.content.publications[0].note == base
    assert [item.code for item in out.warnings] == ["carrier_overflow"]
    assert out.warnings[0].entry_id == "u1" and "补充" in out.warnings[0].message
    lines = "\n".join(f"行{index}" for index in range(501))
    out = _out(_section("projects", _entry("p1", "projects", name="项目", description=lines)))
    assert len(out.content.projects[0].description) == 500
    assert [item.code for item in out.warnings] == ["carrier_overflow"]
