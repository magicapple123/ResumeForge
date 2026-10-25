# SPDX-License-Identifier: Apache-2.0
"""F8-B 四格式纸面渲染：新增可选字段按「标签：值」出现在条目既有内容之后。

口径（F8 契约 §2 + 2026-10-26 Lead 裁决）：
- 只有本批新增字段在条目既有渲染内容之后输出；复用的 experience_kind/artifact_type/
  funding 保持既有位置（旧产物逐字节不变，见既有 golden 套件）；
- 顺序 = 契约 §1 表顺序；空值跳过；标签只来自 resume_labels.FIELD_LABELS（中英）；
- skills 走行内：同一行/标签之后「 · 技能分类：值」；
- 无任何新增字段时四格式零变化（HTML 分支不渲染、其余格式不产行）。
"""

from __future__ import annotations

import io
import json
import re

from app.schemas.resume import ResumeContent
from app.schemas.resume_credentials import ResumeCredential
from app.schemas.resume_entries import (
    ResumeAward,
    ResumeCampusExperience,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from app.schemas.resume_research import (
    ResumePublication,
    ResumeResearchProject,
)
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.markdown_export import export_markdown
from docx import Document
from pypdf import PdfReader

# 本批新增字段的中文标签（复用字段 experience_kind/artifact_type/funding 不在内）。
NEW_LABELS = (
    "学习形式",
    "学位类型",
    "院系",
    "成绩排名",
    "导师",
    "研究方向",
    "团队规模",
    "项目规模",
    "技能分类",
    "活动类型",
    "颁发机构",
    "级别",
    "获奖比例",
    "我的署名位次",
    "证书类型",
    "成果类型",
)

# 教育条目里六个新字段的契约顺序（渲染顺序断言用）。
EDUCATION_ORDER = ("学习形式", "学位类型", "院系", "成绩排名", "导师", "研究方向")


def _rich_resume() -> ResumeContent:
    """每一类都带新增字段；第二条教育/技能故意留空，验证空值跳过。"""
    return ResumeContent(
        name="张三",
        summary="后端工程师",
        education=[
            ResumeEducation(
                school="示例大学",
                major="软件工程",
                degree="本科",
                start_date="2020-09",
                end_date="2024-06",
                study_form="全日制",
                degree_type="学士",
                department="计算机学院",
                rank="前5%",
                advisor="张伟",
                research_direction="自然语言处理",
            ),
            ResumeEducation(school="示例中学"),
        ],
        experience=[
            ResumeExperience(
                company="星云科技",
                role="后端实习生",
                start_date="2023-06",
                end_date="2023-09",
                description=["开发接口"],
                experience_kind="internship",
                team_size="30人",
            )
        ],
        campus_experience=[
            ResumeCampusExperience(
                organization="学生会",
                role="部长",
                description=["组织活动"],
                activity_type="志愿服务",
            )
        ],
        projects=[
            ResumeProject(
                name="检索平台",
                role="后端",
                description=["实现检索接口"],
                artifact_type="开源项目",
                project_size="10人月",
            )
        ],
        skills=[
            ResumeSkill(name="Python", level="熟练", category="编程语言"),
            ResumeSkill(name="MySQL"),
        ],
        awards=[
            ResumeAward(
                name="一等奖学金",
                date="2023",
                description="学业",
                issuer="教务处",
                level="校级",
                ratio="前5%",
            )
        ],
        publications=[
            ResumePublication(
                title="论文A",
                venue="某期刊",
                year="2024",
                status="published",
                note="备注",
                outcome_type="期刊论文",
                my_rank="第一作者",
            )
        ],
        research_projects=[
            ResumeResearchProject(
                name="科研A",
                organization="实验室",
                description=["研究内容"],
                outcomes=["研究成果"],
                funding="10 万",
                level="国家级",
            )
        ],
        credentials=[
            ResumeCredential(name="PMP", issuer="PMI", note="备注", credential_type="职业资格")
        ],
    )


def _plain_resume() -> ResumeContent:
    """没有任何新增字段（旧简历形状）：四格式不得出现新标签。"""
    return ResumeContent(
        name="李四",
        summary="旧简历",
        education=[ResumeEducation(school="示例大学", major="软件工程", degree="本科")],
        experience=[ResumeExperience(company="某公司", role="实习生", description=["工作内容"])],
        campus_experience=[ResumeCampusExperience(organization="社团", role="成员")],
        projects=[ResumeProject(name="某项目", description=["项目内容"])],
        skills=[ResumeSkill(name="Python", level="熟练")],
        awards=[ResumeAward(name="奖学金", date="2023")],
        publications=[ResumePublication(title="论文", venue="期刊", year="2024")],
        research_projects=[ResumeResearchProject(name="科研", description=["研究"])],
        credentials=[ResumeCredential(name="证书", issuer="机构")],
    )


def _html(resume: ResumeContent) -> str:
    return render_html(resume)


def _markdown(resume: ResumeContent, language: str = "zh-CN") -> str:
    return export_markdown(resume, language=language)


def _docx_text(resume: ResumeContent) -> str:
    document = Document(io.BytesIO(build_resume_docx(resume).content))
    return "\n".join(paragraph.text for paragraph in document.paragraphs)


def _pdf_text(resume: ResumeContent, page_limit: int = 3) -> str:
    content = build_resume_pdf(resume, page_limit=page_limit).content
    return "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _assert_order(text: str, ordered: tuple[str, ...]) -> None:
    positions = [text.index(item) for item in ordered]
    assert positions == sorted(positions), dict(zip(ordered, positions, strict=True))


def test_html_renders_new_fields_in_order_with_paths_and_escaped() -> None:
    html = _html(_rich_resume())
    # 教育六字段顺序（契约 §1 表顺序）。
    _assert_order(html, tuple(f"{label}：" for label in EDUCATION_ORDER))
    # 其余分区：标签与值都出现在纸面，且 data-resume-path 指向正确条目字段。
    for path, label, value in (
        ("experience.0.team_size", "团队规模", "30人"),
        ("projects.0.project_size", "项目规模", "10人月"),
        ("campus_experience.0.activity_type", "活动类型", "志愿服务"),
        ("awards.0.issuer", "颁发机构", "教务处"),
        ("awards.0.level", "级别", "校级"),
        ("awards.0.ratio", "获奖比例", "前5%"),
        ("publications.0.outcome_type", "成果类型", "期刊论文"),
        ("publications.0.my_rank", "我的署名位次", "第一作者"),
        ("research_projects.0.level", "级别", "国家级"),
        ("credentials.0.credential_type", "证书类型", "职业资格"),
        ("skills.0.category", "技能分类", "编程语言"),
    ):
        assert f'data-resume-path="{path}"' in html
        assert f"{label}：" in html and value in html
    # 空值跳过：第二条教育/第二条技能不产生新行。
    assert html.count("学习形式：") == 1
    assert html.count("技能分类") == 1
    # 转义：jinja 自动转义，绝不把用户文本当 HTML 注入。
    escaped = _rich_resume().model_copy(
        update={"education": [ResumeEducation(school="某大学", department="<b>安全</b>&")]}
    )
    escaped_html = _html(escaped)
    assert "&lt;b&gt;安全&lt;/b&gt;&amp;" in escaped_html
    assert "<b>安全</b>" not in escaped_html


def test_markdown_renders_new_fields_in_order() -> None:
    markdown = _markdown(_rich_resume())
    expected_lines = [
        "- 学习形式：全日制",
        "- 学位类型：学士",
        "- 院系：计算机学院",
        "- 成绩排名：前5%",
        "- 导师：张伟",
        "- 研究方向：自然语言处理",
        "- 团队规模：30人",
        "- 项目规模：10人月",
        "- 成果类型：期刊论文",
        "- 我的署名位次：第一作者",
        "- 级别：国家级",
        "- 证书类型：职业资格",
        "- 活动类型：志愿服务",
        "- 颁发机构：教务处",
        "- 级别：校级",
        "- 获奖比例：前5%",
    ]
    _assert_order(markdown, tuple(expected_lines))
    # 奖项新字段挂在各自 award 行下（两空格缩进）。
    assert "  - 颁发机构：教务处" in markdown
    # skills 行内：同一行「 · 」后接标签，MySQL 无分类不追加。
    assert "- Python（熟练） ｜ 技能分类：编程语言" in markdown
    assert "- MySQL" in markdown and "MySQL ｜" not in markdown
    # 英文标签来自同一份 FIELD_LABELS。
    english = _markdown(_rich_resume(), language="en-US")
    assert "- Study Mode：全日制" in english and "- Advisor：张伟" in english


def test_docx_and_pdf_render_new_fields_in_order() -> None:
    docx_text = _docx_text(_rich_resume())
    _assert_order(_squash(docx_text), tuple(f"{label}：" for label in EDUCATION_ORDER))
    for label, value in (
        ("团队规模", "30人"),
        ("项目规模", "10人月"),
        ("活动类型", "志愿服务"),
        ("颁发机构", "教务处"),
        ("级别", "校级"),
        ("获奖比例", "前5%"),
        ("成果类型", "期刊论文"),
        ("我的署名位次", "第一作者"),
        ("级别", "国家级"),
        ("证书类型", "职业资格"),
        ("技能分类", "编程语言"),
    ):
        assert f"{label}：{value}" in _squash(docx_text)

    pdf_text = _squash(_pdf_text(_rich_resume()))
    _assert_order(pdf_text, tuple(f"{label}：" for label in EDUCATION_ORDER))
    assert "技能分类：编程语言" in pdf_text
    for label, value in (
        ("团队规模", "30人"),
        ("项目规模", "10人月"),
        ("活动类型", "志愿服务"),
        ("颁发机构", "教务处"),
        ("获奖比例", "前5%"),
        ("成果类型", "期刊论文"),
    ):
        assert f"{label}：{value}" in pdf_text


def test_old_content_has_zero_new_field_output_in_all_formats() -> None:
    """旧简历形状（无新增字段）→ 四格式一个新增标签都不出现，且模型不序列化新键。"""
    plain = _plain_resume()
    dumped = json.dumps(plain.model_dump(), ensure_ascii=False)
    # level/issuer 是既有属性名（旧模型上可能已有值），不参与"空串不序列化"检查；
    # 其余 F8 新字段在旧简历上必须整键不出现。
    for field in (
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
        "my_rank",
        "outcome_type",
        "credential_type",
    ):
        assert f'"{field}"' not in dumped  # 空串不序列化（旧内容指纹不变）

    for text in (
        _html(plain),
        _markdown(plain),
        _squash(_docx_text(plain)),
        _squash(_pdf_text(plain)),
    ):
        for label in NEW_LABELS:
            assert f"{label}：" not in text
