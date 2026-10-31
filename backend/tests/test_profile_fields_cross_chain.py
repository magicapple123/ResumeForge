# SPDX-License-Identifier: Apache-2.0
"""F8-F 跨链路集成：F1 真实存储 → 投影 → 四格式导出 → 生成回填（R-81）。

一条链路走到底（真的写 profile_entry，不用内存夹具拼 ConsumedProfile）：
1. 资料侧 F8 新字段落库后，投影把它们写进 ResumeContent 槽位；承载区不再出现这些默认
   字段的「标签：值」行，但自定义小字段行仍保留（C5/R-80 不变）。
2. HTML/Markdown/Word/PDF 四格式都渲染新字段行，顺序与契约 §1 一致。
3. 生成后置 apply_profile_field_backfill：空槽位用资料值补齐、AI 已写不覆盖、未匹配
   条目不补造、hidden 字段由消费快照裁掉后不回填。
4. 旧内容（无 F8 新字段）model_dump 无新键，四格式产物与 JSON round-trip 逐字节一致。
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

import pytest
from app.schemas.resume import ResumeContent, ResumeEducation, ResumeExperience
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.profile import (
    definition_store,
    entry_store,
    field_preferences,
    group_scope,
    profile_reader,
)
from app.services.profile.paper_policy import appended_field_specs
from app.services.profile.paper_projection import project_paper_content
from app.services.resume.generation_postprocess import apply_profile_field_backfill
from app.services.resume.resume_sample import sample_resume_content

W_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SYSTEM_END_MARKER = "个人总结"
# 旧内容的 model_dump 不得出现这些 F8 新键（只增不改 / 指纹不变）。
# level 是 skills 的既有属性名（F8 只是把 awards/research 的 level 也落槽），
# 所以逐键检查时排除它，避免把旧技能等级误判成新字段。
F8_KEYS = frozenset(
    {
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
        "issuer",
        "ratio",
        "outcome_type",
        "my_rank",
        "credential_type",
    }
)


def _seed(db, section_key: str, values: dict[str, str]) -> None:
    entry_store.upsert_entry(db, section_key, values=values)


def _consumed(db):
    return profile_reader.load_consumed_profile(db, group_scope.resolve_current_group_scope(db))


def _project(db) -> ResumeContent:
    return project_paper_content(_consumed(db))


def _seed_education_with_f8_fields(db) -> str:
    """真实 F1 存储：教育条目带全部 F8 新字段 + 一个自定义字段（合作方）。"""
    custom = definition_store.create_custom_field(db, "educations", "合作方", "single_line")
    _seed(
        db,
        "educations",
        {
            "educations.school": "某大学",
            "educations.major": "计算机",
            "educations.degree": "本科",
            "educations.study_form": "全日制",
            "educations.degree_type": "学士",
            "educations.department": "计算机学院",
            "educations.rank": "前 5%",
            "educations.advisor": "张伟",
            "educations.research_direction": "自然语言处理",
            "educations.achievements": "在校成果一",
            custom.field_id: "李娜",
        },
    )
    return custom.field_id


def _no_nonce(html: str) -> str:
    return re.sub(r"nonce(?:-|=)[\"']?[0-9a-f]+", "nonce-X", html)


def _docx_paragraphs(content: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        root = ElementTree.fromstring(bundle.read("word/document.xml"))
    return [
        "".join(node.text or "" for node in paragraph.iterfind(".//w:t", W_NS))
        for paragraph in root.iterfind(".//w:body/w:p", W_NS)
    ]


def _pdf_text(content: bytes) -> str:
    import pypdf

    return "".join(page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(content)).pages)


def _require_pdf() -> None:
    if not font_available():
        pytest.skip("本机没有可用中文字体，无法验证服务端 PDF；其余三格式已覆盖")


def _assert_no_f8_keys(node) -> None:
    if isinstance(node, dict):
        assert not (set(node) & F8_KEYS), sorted(set(node) & F8_KEYS)
        for value in node.values():
            _assert_no_f8_keys(value)
    elif isinstance(node, list):
        for item in node:
            _assert_no_f8_keys(item)


# ===== 1. F1 存储 → 投影：落槽位、承载区不再追加默认字段、自定义字段行保留 =====


def test_f1_store_projects_f8_fields_into_resume_slots(db_session):
    _seed_education_with_f8_fields(db_session)

    item = _project(db_session).education[0]

    assert (item.study_form, item.degree_type, item.department) == ("全日制", "学士", "计算机学院")
    assert (item.rank, item.advisor, item.research_direction) == ("前 5%", "张伟", "自然语言处理")
    carrier = "\n".join(item.achievements)
    for label in ("学习形式", "学位类型", "院系", "成绩排名", "导师", "研究方向"):
        assert label not in carrier
    assert "合作方：李娜" in carrier  # 自定义字段仍走 C5/R-80 追加
    dumped = _project(db_session).model_dump(mode="json")["education"][0]
    assert dumped["advisor"] == "张伟" and dumped["study_form"] == "全日制"


def test_all_sections_slot_routing_and_no_appended_default_lines(db_session):
    _seed(
        db_session,
        "experiences",
        {
            "experiences.company": "示例公司",
            "experiences.title": "后端开发",
            "experiences.description": "工作内容",
            "experiences.work_type": "全职",
            "experiences.team_size": "30 人",
        },
    )
    _seed(
        db_session,
        "projects",
        {
            "projects.name": "开源网关",
            "projects.description": "项目正文",
            "projects.project_size": "10 人月",
            "projects.outcome_type": "开源项目",
        },
    )
    _seed(
        db_session,
        "skills",
        {
            "skills.name": "Python",
            "skills.level": "熟练",
            "skills.category": "编程语言",
        },
    )
    _seed(
        db_session,
        "campus_experiences",
        {
            "campus_experiences.organization": "学生会",
            "campus_experiences.description": "经历描述",
            "campus_experiences.activity_type": "学生会",
        },
    )
    _seed(
        db_session,
        "awards",
        {
            "awards.title": "一等奖",
            "awards.description": "奖项说明",
            "awards.issuer": "教务处",
            "awards.level": "校级",
            "awards.award_ratio": "前 1%",
        },
    )
    _seed(
        db_session,
        "publications",
        {
            "publications.title": "论文标题",
            "publications.note": "备注",
            "publications.outcome_type": "期刊论文",
            "publications.authorship_rank": "第一作者",
        },
    )
    _seed(
        db_session,
        "research_projects",
        {
            "research_projects.name": "课题",
            "research_projects.description": "项目描述",
            "research_projects.level": "国家级",
            "research_projects.funding": "10 万",
        },
    )
    _seed(
        db_session,
        "credentials",
        {
            "credentials.title": "PMP",
            "credentials.note": "备注",
            "credentials.credential_type": "职业资格",
        },
    )

    content = _project(db_session)
    experience = content.experience[0]
    assert (experience.experience_kind, experience.team_size) == ("full_time", "30 人")
    assert experience.description == ["工作内容"]
    project = content.projects[0]
    assert (project.project_size, project.artifact_type) == ("10 人月", "开源项目")
    assert project.description == ["项目正文"]
    assert content.skills[0].category == "编程语言" and content.skills[0].level == "熟练"
    campus = content.campus_experience[0]
    assert campus.activity_type == "学生会" and campus.description == ["经历描述"]
    award = content.awards[0]
    assert (award.issuer, award.level, award.ratio) == ("教务处", "校级", "前 1%")
    assert award.description == "奖项说明"
    paper = content.publications[0]
    assert (paper.outcome_type, paper.my_rank) == ("期刊论文", "第一作者")
    assert paper.note == "备注"
    research = content.research_projects[0]
    assert (research.level, research.funding) == ("国家级", "10 万")
    assert research.description == ["项目描述"]
    credential = content.credentials[0]
    assert credential.credential_type == "职业资格" and credential.note == "备注"
    for section_key in (
        "educations",
        "experiences",
        "projects",
        "skills",
        "campus_experiences",
        "awards",
        "publications",
        "research_projects",
        "credentials",
    ):
        assert appended_field_specs(section_key) == (), section_key


# ===== 2. 四格式：新字段「标签：值」行出现且顺序正确 =====


EDUCATION_LINES = (
    ("学习形式", "全日制"),
    ("学位类型", "学士"),
    ("院系", "计算机学院"),
    ("成绩排名", "前 5%"),
    ("导师", "张伟"),
    ("研究方向", "自然语言处理"),
)


def test_html_renders_f8_field_lines_in_contract_order(db_session):
    _seed_education_with_f8_fields(db_session)
    html = render_html(_project(db_session))

    positions = [html.index(f"{label}：") for label, _ in EDUCATION_LINES]
    assert positions == sorted(positions)
    for label, value in EDUCATION_LINES:
        # v2 标签与值是相邻的两个 span（标签 span 内带全角冒号）。
        assert re.search(
            f"{label}：</span><span[^>]*>{re.escape(value)}</span>", html
        ), label
    assert 'data-role="meta"' in html


def test_markdown_renders_f8_field_lines(db_session):
    _seed_education_with_f8_fields(db_session)
    markdown = export_markdown(_project(db_session))

    positions = [markdown.index(f"- {label}：{value}") for label, value in EDUCATION_LINES]
    assert positions == sorted(positions)


def test_docx_renders_f8_field_lines(db_session):
    _seed_education_with_f8_fields(db_session)
    paragraphs = _docx_paragraphs(build_resume_docx(_project(db_session)).content)
    text = "\n".join(paragraphs)

    positions = [text.index(f"{label}：{value}") for label, value in EDUCATION_LINES]
    assert positions == sorted(positions)


def test_pdf_renders_f8_field_lines(db_session):
    _require_pdf()
    _seed_education_with_f8_fields(db_session)
    compact = re.sub(r"\s+", "", _pdf_text(build_resume_pdf(_project(db_session)).content))

    for label, value in EDUCATION_LINES:
        # pypdf 提取时会把"前 5%"的窄空格压掉：两边都去空白后再比。
        assert re.sub(r"\s+", "", f"{label}：{value}") in compact, label


# ===== 3. 生成后置回填 =====


def test_backfill_fills_empty_slots_from_profile(db_session):
    _seed_education_with_f8_fields(db_session)
    resume = ResumeContent(education=[ResumeEducation(school="某大学", major="计算机")])

    filled = apply_profile_field_backfill(resume, _consumed(db_session))

    item = filled.education[0]
    assert (item.advisor, item.study_form, item.research_direction) == (
        "张伟",
        "全日制",
        "自然语言处理",
    )
    assert resume.education[0].advisor == ""  # 纯函数：不就地修改入参


def test_backfill_keeps_ai_written_values_and_skips_unmatched_entries(db_session):
    _seed_education_with_f8_fields(db_session)
    resume = ResumeContent(
        education=[
            ResumeEducation(school="某大学", advisor="AI 自己写的导师"),
            ResumeEducation(school="不存在的大学"),
        ]
    )

    filled = apply_profile_field_backfill(resume, _consumed(db_session))

    assert filled.education[0].advisor == "AI 自己写的导师"
    assert filled.education[0].study_form == "全日制"
    assert filled.education[1].advisor == ""
    assert len(filled.education) == 2  # 不凭空造条目


def test_backfill_enum_mapping_and_hidden_fields(db_session):
    _seed(
        db_session,
        "experiences",
        {
            "experiences.company": "示例公司",
            "experiences.description": "工作内容",
            "experiences.work_type": "全职",
        },
    )
    _seed_education_with_f8_fields(db_session)
    field_preferences.patch_preference(
        db_session, "educations.advisor", section_key="educations", hidden=True
    )
    resume = ResumeContent(
        education=[ResumeEducation(school="某大学")],
        experience=[ResumeExperience(company="示例公司")],
    )

    filled = apply_profile_field_backfill(resume, _consumed(db_session))

    assert filled.experience[0].experience_kind == "full_time"  # 中文→既有 code
    assert filled.education[0].advisor == ""  # hidden 由 consumed 裁掉，不二次过滤
    assert filled.education[0].study_form == "全日制"


# ===== 4. 旧内容：没有新键、四格式产物与 round-trip 逐字节一致 =====


def test_old_content_has_no_new_keys_and_exports_are_stable():
    content = sample_resume_content()
    dumped = content.model_dump(mode="json")
    _assert_no_f8_keys(dumped)

    html = _no_nonce(render_html(content))
    markdown = export_markdown(content)
    docx_paragraphs = _docx_paragraphs(build_resume_docx(content).content)
    parsed = ResumeContent.model_validate(dumped)

    assert _no_nonce(render_html(parsed)) == html
    assert export_markdown(parsed) == markdown
    assert _docx_paragraphs(build_resume_docx(parsed).content) == docx_paragraphs
    for output in (html, markdown, "\n".join(docx_paragraphs)):
        for label in ("导师：", "学习形式：", "成绩排名：", "团队规模：", "证书类型："):
            assert label not in output
    assert html.index(SYSTEM_END_MARKER) > 0


def test_empty_f8_values_are_not_serialized():
    dumped = ResumeEducation().model_dump()
    for key in F8_KEYS:
        assert key not in dumped, key
    assert "study_form" not in ResumeEducation(study_form="").model_dump()
    assert ResumeEducation(advisor="张伟").model_dump()["advisor"] == "张伟"
