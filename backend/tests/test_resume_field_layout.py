# SPDX-License-Identifier: Apache-2.0
"""W4 条目字段排版：field_layout 域校验 + 四格式行装箱一致性。

覆盖（task-4 MVP）：

* 域校验：分区/字段白名单、去重、未列出补末尾、columns 夹取、solo 子集、空域不落库；
* profile_field_rows：默认逐字段一行（= 现状）、columns 装箱、solo 独占、空值跳过；
* HTML：有配置出现 .sub-row/.sub-cell 且 data-resume-path 完整、CSS 只在有配置时注入；
  无配置保留原有逐行标记（不含 sub-row / 新 CSS）；
* PDF / Word / Markdown / TXT：行内单元格用 " · " 连接，无配置时逐字段一行不变。
"""

from __future__ import annotations

import io
import re

from app.schemas.resume import ResumeContent
from app.schemas.resume_entries import ResumeAward, ResumeEducation
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.markdown_export import export_markdown
from app.services.resume.profile_field_lines import (
    PROFILE_FIELD_ORDER,
    profile_field_row_cells,
    profile_field_rows,
    profile_row_text,
)
from app.services.resume.resume_field_layout import (
    FIELD_LAYOUT_SECTIONS,
    field_layout_css,
    resolve_field_layout,
    validate_field_layout_domain,
)
from app.services.resume.resume_render_overrides import resolve_render_overrides
from app.services.resume.resume_template_format import validated_format_config
from app.services.txt_exporter import export_txt
from docx import Document
from pypdf import PdfReader

# 教育六字段的默认顺序（= F8 契约顺序 = 改造前逐行顺序）。
EDUCATION_DEFAULT = PROFILE_FIELD_ORDER["education"]


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
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
            )
        ],
        awards=[
            ResumeAward(name="一等奖学金", date="2023", issuer="教务处", level="校级", ratio="前5%")
        ],
    )


def _layout_config() -> dict:
    """教育 2 列、成绩排名提到最前、研究方向独占一行；奖项 2 列。"""
    return {
        "field_layout": {
            "version": 1,
            "education": {
                "columns": 2,
                "order": ["rank", "study_form", "degree_type", "department", "advisor"],
                "solo": ["research_direction"],
            },
            "awards": {"columns": 2},
        }
    }


def _squash(text: str) -> str:
    return re.sub(r"[\s\x00]+", "", text)


# ===== 1. 域校验 =====


def test_validation_drops_unknown_keys_and_normalizes_order() -> None:
    domain = validate_field_layout_domain(
        {
            "version": 1,
            "education": {
                "columns": 2,
                "order": ["rank", "bogus", "rank", "study_form"],
                "solo": ["advisor", "not_a_field"],
            },
            "skills": {"columns": 3},  # 不在七个承载分区里：整段丢弃
            "nope": {"columns": 2},
        }
    )
    assert domain is not None
    assert set(domain) == {"version", "education"}
    education = domain["education"]
    # 未知字段丢弃、重复去重、未列出的按默认顺序补在末尾（全量顺序）。
    assert education["order"] == [
        "rank",
        "study_form",
        "degree_type",
        "department",
        "advisor",
        "research_direction",
    ]
    # solo 是 order 的子集（未知字段丢弃）。
    assert education["solo"] == ["advisor"]


def test_validation_clamps_columns_and_drops_default_sections() -> None:
    assert validate_field_layout_domain({"version": 1, "education": {"columns": 9}}) == {
        "version": 1,
        "education": {"columns": 3},
    }
    # 夹到 1 之后与默认一致 → 空分区（不落库）。
    assert validate_field_layout_domain({"version": 1, "education": {"columns": 0}}) is None
    # 与默认完全一致（1 列 + 默认顺序 + 无 solo）= 空分区，不落库。
    assert validate_field_layout_domain({"version": 1, "education": {"columns": 1}}) is None
    assert validate_field_layout_domain({"version": 1}) is None
    assert validate_field_layout_domain(None) is None
    # 版本不支持：整域丢弃（R2）。
    assert validate_field_layout_domain({"version": 2, "education": {"columns": 2}}) is None


def test_domain_survives_validated_format_config_and_empty_is_not_stored() -> None:
    config = validated_format_config({"field_layout": _layout_config()["field_layout"]})
    assert config["field_layout"]["education"]["columns"] == 2
    assert config["field_layout"]["education"]["solo"] == ["research_direction"]
    empty = validated_format_config({"field_layout": {"version": 1, "education": {"columns": 1}}})
    assert "field_layout" not in empty


def test_resolve_expands_to_full_order_and_is_empty_by_default() -> None:
    assert resolve_field_layout(None) == {}
    assert resolve_field_layout({}) == {}
    assert resolve_field_layout({"field_layout": "broken"}) == {}
    resolved = resolve_field_layout(_layout_config())
    assert set(resolved) == {"education", "awards"}
    assert resolved["education"] == {
        "columns": 2,
        "order": [
            "rank",
            "study_form",
            "degree_type",
            "department",
            "advisor",
            "research_direction",
        ],
        "solo": ["research_direction"],
    }
    assert resolved["awards"] == {
        "columns": 2,
        "order": list(PROFILE_FIELD_ORDER["awards"]),
        "solo": [],
    }


def test_all_seven_sections_are_covered_and_skills_credentials_are_not() -> None:
    assert FIELD_LAYOUT_SECTIONS == (
        "education",
        "experience",
        "campus_experience",
        "projects",
        "awards",
        "publications",
        "research_projects",
    )
    for section_key in FIELD_LAYOUT_SECTIONS:
        assert section_key in PROFILE_FIELD_ORDER


# ===== 2. profile_field_rows 装箱 =====


def _education() -> ResumeEducation:
    return _resume().education[0]


def test_rows_default_to_one_field_per_line_and_skip_empty() -> None:
    labels = {
        "study_form": "学习形式",
        "degree_type": "学位类型",
        "department": "院系",
        "rank": "成绩排名",
        "advisor": "导师",
        "research_direction": "研究方向",
    }
    rows = profile_field_rows(_education(), "education", labels)
    assert rows == [
        [("学习形式", "全日制")],
        [("学位类型", "学士")],
        [("院系", "计算机学院")],
        [("成绩排名", "前5%")],
        [("导师", "张伟")],
        [("研究方向", "自然语言处理")],
    ]
    empty = ResumeEducation(school="空学校")
    assert profile_field_rows(empty, "education", labels) == []


def test_rows_pack_by_columns_with_solo_fields_on_their_own_line() -> None:
    labels = {
        "study_form": "学习形式",
        "degree_type": "学位类型",
        "department": "院系",
        "rank": "成绩排名",
        "advisor": "导师",
        "research_direction": "研究方向",
    }
    layout = resolve_field_layout(_layout_config())
    rows = profile_field_rows(_education(), "education", labels, layout)
    assert rows == [
        [("成绩排名", "前5%"), ("学习形式", "全日制")],
        [("学位类型", "学士"), ("院系", "计算机学院")],
        [("导师", "张伟")],
        [("研究方向", "自然语言处理")],
    ]
    # 该分区没配置（layout 只有 education）时退回逐字段一行。
    assert profile_field_rows(_education(), "awards", {"issuer": "颁发机构"}, layout) == []


def test_row_cells_keep_field_names_for_data_resume_path() -> None:
    labels = {
        "study_form": "学习形式",
        "degree_type": "学位类型",
        "department": "院系",
        "rank": "成绩排名",
        "advisor": "导师",
        "research_direction": "研究方向",
    }
    layout = resolve_field_layout(_layout_config())
    rows = profile_field_row_cells(_education(), "education", labels, layout)
    assert rows[0] == [
        {"field": "rank", "label": "成绩排名", "value": "前5%"},
        {"field": "study_form", "label": "学习形式", "value": "全日制"},
    ]
    assert (
        profile_row_text([("成绩排名", "前5%"), ("学习形式", "全日制")])
        == "成绩排名：前5% · 学习形式：全日制"
    )


def test_render_overrides_carries_resolved_field_layout() -> None:
    overrides = resolve_render_overrides(template="classic", format_config=_layout_config())
    assert overrides.field_layout == resolve_field_layout(_layout_config())
    assert not overrides.empty
    assert resolve_render_overrides(template="classic", format_config=None).field_layout == {}


# ===== 3. HTML =====


_SUB_ROW_RE = re.compile(r'<div class="sub sub-row" data-role="meta">(.*?)</div>')


def test_html_emits_sub_rows_with_complete_paths_only_when_configured() -> None:
    default = render_html(_resume())
    assert "sub-row" not in default and "sub-cell" not in default
    assert ".sub.sub-row" not in default
    # 原逐行标记仍在（默认分支逐字节不变，黄金基线另有守卫）。
    assert (
        '<div class="sub" data-role="meta">学习形式：<span data-resume-path="education.0.study_form">'
        in default
    )

    configured = render_html(_resume(), format_config=_layout_config())
    rows = _SUB_ROW_RE.findall(configured)
    assert len(rows) == 6  # 教育 4 行 + 奖项 2 行
    assert ".sub.sub-row { display: flex; flex-wrap: wrap;" in configured
    # 顺序：成绩排名提到最前；行内用 list_separator 连接；每个单元格保留字段路径。
    assert rows[0].index("成绩排名") < rows[0].index("学习形式")
    assert '成绩排名：<span data-resume-path="education.0.rank">前5%</span>、' in rows[0]
    for row in rows:
        assert row.count('class="sub-cell"') >= 1
    assert 'data-resume-path="education.0.research_direction"' in configured
    assert 'data-resume-path="awards.0.ratio"' in configured
    assert configured.count('class="sub sub-row"') == 6


def test_html_escapes_values_inside_sub_cells() -> None:
    resume = _resume().model_copy(
        update={"education": [ResumeEducation(school="某大学", department="<b>安全</b>&")]}
    )
    html = render_html(
        resume,
        format_config={"field_layout": {"version": 1, "education": {"columns": 2}}},
    )
    assert "&lt;b&gt;安全&lt;/b&gt;&amp;" in html
    assert "<b>安全</b>" not in html


# ===== 4. PDF / Word / Markdown / TXT =====


def _pdf_text(resume: ResumeContent, config: dict | None = None) -> str:
    content = build_resume_pdf(resume, page_limit=3, format_config=config).content
    return "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)


def _docx_text(resume: ResumeContent, config: dict | None = None) -> str:
    document = Document(
        io.BytesIO(build_resume_docx(resume, page_limit=3, format_config=config).content)
    )
    return "\n".join(paragraph.text for paragraph in document.paragraphs)


def test_markdown_and_txt_join_cells_per_row() -> None:
    markdown = export_markdown(_resume(), format_config=_layout_config())
    assert "- 成绩排名：前5% · 学习形式：全日制" in markdown
    assert "- 学位类型：学士 · 院系：计算机学院" in markdown
    assert "- 导师：张伟" in markdown
    assert "- 研究方向：自然语言处理" in markdown
    assert "  - 颁发机构：教务处 · 级别：校级" in markdown
    # 无配置：逐字段一行（旧产物不变）。
    default = export_markdown(_resume())
    assert "- 学习形式：全日制\n- 学位类型：学士" in default
    # 无配置时同一字段行内不会出现连接符（行内连接只属于 field_layout 分支）。
    assert "成绩排名：前5% · 学习形式" not in default

    txt = export_txt(_resume(), format_config=_layout_config())
    assert "成绩排名：前5% · 学习形式：全日制" in txt
    assert "学习形式：全日制\n学位类型：学士" in export_txt(_resume())


def test_pdf_and_docx_join_cells_per_row() -> None:
    pdf_text = _squash(_pdf_text(_resume(), _layout_config()))
    assert "成绩排名：前5%·学习形式：全日制" in pdf_text
    assert "学位类型：学士·院系：计算机学院" in pdf_text
    assert "研究方向：自然语言处理" in pdf_text
    assert "颁发机构：教务处·级别：校级" in pdf_text
    # 无配置：逐字段一行（不出现行内连接符）。
    default_pdf = _squash(_pdf_text(_resume()))
    assert "学习形式：全日制学位类型：学士" in default_pdf

    docx_text = _docx_text(_resume(), _layout_config())
    assert "成绩排名：前5% · 学习形式：全日制" in docx_text
    assert "颁发机构：教务处 · 级别：校级" in docx_text
    assert "学习形式：全日制\n学位类型：学士" in _docx_text(_resume())


def test_empty_config_keeps_html_byte_identical() -> None:
    """无配置 / 空域：产物与带空域时逐字节一致（差异只有每次渲染随机的 CSP nonce）。"""
    # CSP nonce 是每次渲染随机会值（32 位十六进制），比对前归一。
    pattern = re.compile(r"[0-9a-f]{32}")

    def normalized(html: str) -> str:
        return pattern.sub("X", html)

    baseline = normalized(render_html(_resume()))
    assert normalized(render_html(_resume(), format_config={})) == baseline
    assert (
        normalized(render_html(_resume(), format_config={"field_layout": {"version": 1}}))
        == baseline
    )
    assert field_layout_css(None) == ""
    assert field_layout_css({}) == ""
