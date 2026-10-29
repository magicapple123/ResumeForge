# SPDX-License-Identifier: Apache-2.0
"""W4 条目字段排版：field_layout 域校验 + 四格式行装箱一致性。

* 域校验：白名单/去重/补末尾、columns 夹取、solo 子集、空域不落库；gap 是字号倍数
  （0–30.0，0 = 完全紧挨且必须落库；坏值当未设置、非默认值才落库、旧枚举可读）；
* profile_field_rows：默认逐字段一行、columns 装箱、solo 独占、空值跳过；
* HTML：等宽模式**一个 entry 一个共享 grid 容器**（列宽内容自适应，行内无 `、`），
  flow 模式仍是逐行 flex 且输出 `、`；无配置保留原有逐行标记；
* PDF：配了多列按列并排画（`meta_columns`），1 列 / 无配置 / flow 仍走单段 `meta_line`；
  Word / Markdown / TXT 行内仍用 " · " 连接。
"""

from __future__ import annotations

import io
import re
from types import SimpleNamespace

from app.schemas.resume import ResumeContent
from app.schemas.resume_entries import ResumeAward, ResumeEducation
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf
from app.services.pdf_exporter.canvas import _ResumePDF
from app.services.pdf_exporter.meta_columns import column_widths
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
    # 没写 align / gap → 与默认一致 → 不落库。
    assert "align" not in education and "gap" not in education


def test_validation_clamps_columns_and_drops_default_sections() -> None:
    clamped = validate_field_layout_domain({"version": 1, "education": {"columns": 9}})
    assert clamped == {"version": 1, "education": {"columns": 3}}
    # 夹到 1 / 已经 1 列 + 默认顺序 + 无 solo = 空分区；版本不支持整域丢弃（R2）。
    for raw in ({"version": 1, "education": {"columns": 0}}, {"version": 1}, None):
        assert validate_field_layout_domain(raw) is None
    assert validate_field_layout_domain({"version": 1, "education": {"columns": 1}}) is None
    assert validate_field_layout_domain({"version": 2, "education": {"columns": 2}}) is None


def _stored_education(education: dict) -> dict | None:
    """教育分区的落库结果；`None` = 与默认一致（不落库）。"""
    domain = validate_field_layout_domain({"version": 1, "education": education})
    return None if domain is None else domain["education"]


def _stored_gap(align: str, gap: object) -> object:
    """该 (align, gap) 落库后的 gap；`None` = 未设置（不落库）。"""
    stored = _stored_education({"columns": 2, "align": align, "gap": gap})
    return None if stored is None else stored.get("gap")


def test_align_and_gap_are_validated_and_only_stored_when_non_default() -> None:
    # gap 恰好等于**当前 align 的兜底值** → 视为未设置，不落库（两种模式兜底不同）。
    assert _stored_gap("equal", 1.6) is None and _stored_gap("flow", 1.2) is None
    # 同一倍数在另一模式下就是"非默认"，必须落库（1.6 对 flow 而言不等于 1.2）。
    assert _stored_gap("flow", 1.6) == 1.6
    assert _stored_gap("equal", 0.8) == 0.8
    # 坏值一律当未设置（不 422、不把整段丢掉）。
    assert all(_stored_gap("equal", bad) is None for bad in (True, "x", None, float("nan")))
    # 只改 align（columns 保持默认 1）同样是一个有效配置。
    assert _stored_education({"align": "flow"}) == {"columns": 1, "align": "flow"}


def test_gap_is_clamped_rounded_and_accepts_the_legacy_enum() -> None:
    """滑杆可以取任意值：越界夹取、保留 1 位小数；旧枚举读得懂、写回一律是数值。"""
    assert _stored_gap("equal", 99) == 30.0  # 夹到上限（30 倍字号）
    assert _stored_gap("equal", -1) == 0  # 夹到下限（0 = 两列完全紧挨）
    assert _stored_gap("equal", 2.44) == 2.4  # 1 位小数
    # 旧枚举：narrow / wide 映射成倍数，normal = 未设置。
    assert _stored_gap("equal", "narrow") == 0.8
    assert _stored_gap("equal", "wide") == 3.0
    assert _stored_gap("equal", "normal") is None
    assert _stored_gap("equal", "x") is None


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
        "align": "equal",
        "gap": None,
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
        "align": "equal",
        "gap": None,
        "order": list(PROFILE_FIELD_ORDER["awards"]),
        "solo": [],
    }


def test_resolve_fills_align_and_gap_for_legacy_and_broken_configs() -> None:
    """旧配置 `{"columns": 2}` 必须解析出 equal：用户不迁移也能拿到对齐的版面。"""
    legacy = resolve_field_layout({"field_layout": {"version": 1, "education": {"columns": 2}}})
    # 缺 align / gap → equal + 未设置（渲染端按 align 的兜底值，两种模式不同）。
    assert (legacy["education"]["align"], legacy["education"]["gap"]) == ("equal", None)
    broken = resolve_field_layout(
        {"field_layout": {"version": 1, "education": {"columns": 2, "align": 7, "gap": "huge"}}}
    )
    assert (broken["education"]["align"], broken["education"]["gap"]) == ("equal", None)


def test_resolve_keeps_non_default_align_and_gap() -> None:
    resolved = resolve_field_layout(
        {"field_layout": {"version": 1, "education": {"columns": 3, "align": "flow", "gap": 2.4}}}
    )
    assert (resolved["education"]["align"], resolved["education"]["gap"]) == ("flow", 2.4)
    # 旧枚举在解析层就已迁移成数值，渲染端只会看到数字。
    migrated = resolve_field_layout(
        {"field_layout": {"version": 1, "education": {"columns": 2, "gap": "wide"}}}
    )
    assert migrated["education"]["gap"] == 3.0


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


# 教育六字段的标签（= resume_labels.field_labels 的同值副本，避免每个用例各抄一份）。
_EDU_LABELS = {
    "study_form": "学习形式",
    "degree_type": "学位类型",
    "department": "院系",
    "rank": "成绩排名",
    "advisor": "导师",
    "research_direction": "研究方向",
}


def test_rows_default_to_one_field_per_line_and_skip_empty() -> None:
    rows = profile_field_rows(_education(), "education", _EDU_LABELS)
    assert rows == [
        [("学习形式", "全日制")],
        [("学位类型", "学士")],
        [("院系", "计算机学院")],
        [("成绩排名", "前5%")],
        [("导师", "张伟")],
        [("研究方向", "自然语言处理")],
    ]
    empty = ResumeEducation(school="空学校")
    assert profile_field_rows(empty, "education", _EDU_LABELS) == []


def test_rows_pack_by_columns_with_solo_fields_on_their_own_line() -> None:
    layout = resolve_field_layout(_layout_config())
    rows = profile_field_rows(_education(), "education", _EDU_LABELS, layout)
    assert rows == [
        [("成绩排名", "前5%"), ("学习形式", "全日制")],
        [("学位类型", "学士"), ("院系", "计算机学院")],
        [("导师", "张伟")],
        [("研究方向", "自然语言处理")],
    ]
    # 该分区没配置（layout 只有 education）时退回逐字段一行。
    assert profile_field_rows(_education(), "awards", {"issuer": "颁发机构"}, layout) == []


def test_row_cells_keep_field_names_for_data_resume_path() -> None:
    layout = resolve_field_layout(_layout_config())
    rows = profile_field_row_cells(_education(), "education", _EDU_LABELS, layout)
    assert rows[0] == [
        {"field": "rank", "label": "成绩排名", "value": "前5%"},
        {"field": "study_form", "label": "学习形式", "value": "全日制"},
    ]
    cells = [("成绩排名", "前5%"), ("学习形式", "全日制")]
    assert profile_row_text(cells) == "成绩排名：前5% · 学习形式：全日制"


def test_render_overrides_carries_resolved_field_layout() -> None:
    overrides = resolve_render_overrides(template="classic", format_config=_layout_config())
    assert overrides.field_layout == resolve_field_layout(_layout_config())
    assert not overrides.empty
    assert resolve_render_overrides(template="classic", format_config=None).field_layout == {}


# ===== 3. HTML =====


# 等宽：一个 entry **一个** grid 容器（cell 全平铺进去）；flow：一个 row 一个逐行 div。
_GRID_RE = re.compile(r'<div class="sub sub-row sub-grid[^"]*" data-role="meta">(.*?)</div>')
_FLOW_ROW_RE = re.compile(
    r'<div class="sub sub-row sub-cols-\d+ sub-gap-\w+ sub-flow" data-role="meta">(.*?)</div>'
)
# columns=2、align/gap 默认 → 容器是这个形态（`sub-gap-<分区>` 是固定类名，具体倍数由
# 分区级 CSS 给；未设置时没有对应规则 → 走 flex / grid 各自的兜底间距）。
_GRID_EDUCATION = '<div class="sub sub-row sub-grid sub-cols-2 sub-gap-education" data-role="meta">'
_GRID_AWARDS = '<div class="sub sub-row sub-grid sub-cols-2 sub-gap-awards" data-role="meta">'
_FLOW_EDUCATION = '<div class="sub sub-row sub-cols-2 sub-gap-education sub-flow" data-role="meta">'


def test_html_emits_one_shared_grid_per_entry_only_when_configured() -> None:
    default = render_html(_resume())
    assert "sub-row" not in default and "sub-cell" not in default
    assert ".sub.sub-grid" not in default
    # 原逐行标记仍在（默认分支逐字节不变，黄金基线另有守卫）。
    assert (
        '<div class="sub" data-role="meta">学习形式：<span data-resume-path="education.0.study_form">'
        in default
    )

    configured = render_html(_resume(), format_config=_layout_config())
    grids = _GRID_RE.findall(configured)
    # 一个 entry 只有一个 grid 容器：教育 6 个 cell 全在同一个容器里（跨行列宽才一致）。
    assert grids[0].count('class="sub-cell') == 6 and grids[1].count('class="sub-cell') == 3
    assert configured.count(_GRID_EDUCATION) == 1 and configured.count(_GRID_AWARDS) == 1
    assert ' sub-flow"' not in configured
    # 列宽内容自适应（`auto` 轨道）→ gap 不再被"列内留白"淹没，滑杆才看得见效果。
    assert ".sub.sub-grid { display: grid;" in configured
    assert "grid-template-columns: repeat(var(--sub-cols, 1), minmax(0, auto));" in configured
    assert ".sub-grid .sub-cell-solo { grid-column: 1 / -1; }" in configured
    # 顺序：成绩排名提到最前；等宽模式单元格之间**不再**输出分隔符；路径完整。
    assert grids[0].index("成绩排名") < grids[0].index("学习形式")
    assert '成绩排名：<span data-resume-path="education.0.rank">前5%</span>' in grids[0]
    assert "、" not in grids[0] and "、" not in grids[1]
    # 只剩一个 cell 的行（独占行 / 末行余一个）占满整行。
    assert 'class="sub-cell sub-cell-solo"' in grids[0]
    assert 'data-resume-path="education.0.research_direction"' in configured


def test_html_flow_mode_keeps_per_row_flex_and_the_inline_separator() -> None:
    """flow = 改造前的按内容顺排：一个 row 一个 div，行内仍用 list_separator 连接。"""
    html = render_html(
        _resume(),
        format_config={
            "field_layout": {"version": 1, "education": {"columns": 2, "align": "flow"}}
        },
    )
    rows = _FLOW_ROW_RE.findall(html)
    assert len(rows) == 3  # 教育 6 字段 / 2 列
    assert all("、" in row for row in rows)
    assert _FLOW_EDUCATION in html
    assert ".sub.sub-row { display: flex; flex-wrap: wrap;" in html


def test_html_gap_class_follows_config() -> None:
    html = render_html(
        _resume(), format_config={"field_layout": {"version": 1, "education": {"gap": 1.8}}}
    )
    # 分区级规则把倍数写进 --sub-gap；没调过的分区（awards）不产出规则 → 走兜底。
    assert ".sub-row.sub-gap-education { --sub-gap: calc(var(--fs) * 1.8); }" in html
    assert ".sub-row.sub-gap-awards {" not in html


def test_gap_reaches_both_align_modes_through_one_variable() -> None:
    css = field_layout_css({"education": {"columns": 2, "align": "flow", "gap": 0.8}})
    # 分区级规则给 --sub-gap 赋值；grid 与 flex 两条 column-gap 都消费同一个变量，
    # 因此不依赖规则书写顺序，也不必为任意倍数枚举类名。
    assert ".sub-row.sub-gap-education { --sub-gap: calc(var(--fs) * 0.8); }" in css
    # `justify-content: start` 是"gap 真实生效"的关键：少了它 `auto` 轨道被剩余空间拉伸，
    # 间距又被"列内留白"淹没（Chromium 实测 1.6→4.0 只动 16.8px，加它是 33.6px）。
    assert "justify-content: start" in css
    assert "column-gap: var(--sub-gap, calc(var(--fs) * 1.6));" in css
    assert "column-gap: var(--sub-gap, calc(var(--fs) * 1.2));" in css
    # gap 未设置 / 坏值的分区不产出规则（渲染端走 grid / flex 各自兜底）。
    for layout in (
        {"education": {"columns": 2}},
        {"education": {"columns": 2, "gap": None}},
        {"education": {"columns": 2, "gap": "0.8"}},
    ):
        assert "sub-gap-education" not in field_layout_css(layout)


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


def test_pdf_draws_columns_while_docx_joins_cells(monkeypatch) -> None:
    calls: list[int] = []
    original = _ResumePDF.meta_columns

    def counting(self, cells, widths, gap, base, *, style=None):
        calls.append(len(cells))
        return original(self, cells, widths, gap, base, style=style)

    monkeypatch.setattr(_ResumePDF, "meta_columns", counting)
    text = _pdf_text(_resume(), _layout_config())
    squashed = _squash(text)
    # 教育 2 个双列行（独占行仍是单列）+ 奖项 1 个双列行 = 3 次并排；不再拼成单段文本。
    assert len(calls) == 3 and max(calls) == 2
    assert "成绩排名：前5% · 学习形式" not in text
    assert "成绩排名：前5%·学习形式" not in squashed
    for label in ("成绩排名", "学习形式", "学位类型", "院系", "导师", "研究方向"):
        assert label in squashed
    # 无配置 / 1 列：完全不进多列分支（仍走 meta_line，默认产物逐字节不变）。
    calls.clear()
    assert "学习形式：全日制学位类型：学士" in _squash(_pdf_text(_resume()))
    calls.clear()
    for config in (
        {"field_layout": {"version": 1, "education": {"columns": 1, "gap": 2.0}}},
        {"field_layout": {"version": 1, "education": {"columns": 2, "align": "flow"}}},
    ):
        _pdf_text(_resume(), config)
    assert calls == []  # 1 列 / flow（行内顺排）都不进多列分支

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


def test_column_widths_budget_by_widest_cell_and_compress_proportionally() -> None:
    """列宽按每列最宽内容预算（不再平分）；超宽按比例压缩；长度恒为 columns。"""
    ruler = SimpleNamespace(get_string_width=lambda text: len(text) * 2.0, c_margin=0.0)
    rows = [[("导师", "张伟"), ("研究方向", "自然语言处理")], [("院系", "计算机学院")]]
    assert column_widths(ruler, rows, 2, 4.0, 200.0) == [16.0, 22.0]
    tight = column_widths(ruler, rows, 2, 4.0, 30.0)  # 超宽 → 等比压缩（间距优先保留）
    assert round(sum(tight) + 4.0, 9) == 30.0 and tight[0] < tight[1]
    # 末行不满：后面的列宽仍然保留（长度恰为 columns，跨行第二列才对得齐）。
    assert column_widths(ruler, [[("导师", "张伟")]], 3, 4.0, 200.0) == [10.0, 0.0, 0.0]
