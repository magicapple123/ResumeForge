# SPDX-License-Identifier: Apache-2.0
"""W4「条目级字段排版」：`field_layout.entries.<分区>.<id>` 的校验、渲染与回退。

覆盖本批次（第三批）的四件事：

* **校验**：只存显式改过的键、等价继承整条丢弃、非法 id / 未知分区整条丢弃、
  `entries` 为空不落库、整域为空返回 None；
* **HTML / CSS**：同分区两条教育记录，只覆盖其中一条的列数 / 间距时，两条的容器类名
  与 CSS 规则各不相同（另一条仍走分区级）；
* **PDF**：条目级 gap 真的改变了第二列起点（用 `visitor_text` 取 x，不是只看文本）；
* **回退**：`entries` 里的 id 在该分区不存在时静默忽略，不报错、不影响产物。

`test_resume_field_layout.py` 已贴 500 行预算，条目级用例单独成文件。
"""

from __future__ import annotations

import io

from app.schemas.resume import ResumeContent
from app.schemas.resume_entries import ResumeAward, ResumeEducation
from app.services.exporter import render_html
from app.services.pdf_exporter import build_resume_pdf
from app.services.resume.markdown_export import export_markdown
from app.services.resume.profile_field_lines import (
    PROFILE_FIELD_ORDER,
    effective_profile_field_layout,
    profile_field_rows,
)
from app.services.resume.resume_field_layout import (
    field_layout_css,
    merge_entry_layout,
    resolve_field_layout,
    validate_field_layout_domain,
)
from app.services.resume.resume_labels import field_labels
from app.services.resume.resume_render_overrides import resolve_render_overrides
from app.services.resume.resume_template_format import validated_format_config
from pypdf import PdfReader

# 两个合法的 W01 id（`OBJECT_ID_PATTERN` = `^[A-Za-z0-9_-]{8,32}$`）。
ENTRY_A = "eduAAAA1111"
ENTRY_B = "eduBBBB2222"
# 该分区不存在的 id：回退用例。
ENTRY_GHOST = "eduZZZZ9999"


def _config(entries: dict | None = None, section: dict | None = None) -> dict:
    """教育分区配置（可选）+ 条目级覆盖（可选）的 format_config。"""
    field_layout: dict = {"version": 1}
    if section is not None:
        field_layout["education"] = section
    if entries is not None:
        field_layout["entries"] = {"education": entries}
    return {"field_layout": field_layout}


def _two_educations() -> ResumeContent:
    """同分区两条教育：字段值**字符长度一致**（PDF 用例要比第二列起点，列宽不能有差）。"""
    return ResumeContent(
        name="张三",
        education=[
            ResumeEducation(
                school="示例大学",
                id=ENTRY_A,
                major="软件工程",
                degree="本科",
                start_date="2020-09",
                end_date="2024-06",
                study_form="全日制",
                degree_type="学士甲",
                department="计算机学院",
                rank="前5%",
                advisor="张伟",
                research_direction="自然语言处理",
            ),
            ResumeEducation(
                school="另一所大学",
                id=ENTRY_B,
                major="软件工程",
                degree="本科",
                start_date="2016-09",
                end_date="2020-06",
                study_form="全日制",
                degree_type="学士乙",
                department="计算机学院",
                rank="前5%",
                advisor="张伟",
                research_direction="自然语言处理",
            ),
        ],
    )


# ===== 1. 校验 =====


def test_validation_keeps_only_explicit_keys_and_drops_equivalent_entry() -> None:
    """只存显式改过的键；与分区解析结果等价的整条丢弃（= "没改过"）。"""
    domain = validate_field_layout_domain(
        _config(
            section={"columns": 2},
            entries={ENTRY_A: {"columns": 3}, ENTRY_B: {"columns": 2}},
        )["field_layout"]
    )
    assert domain is not None
    assert domain["education"] == {"columns": 2}
    # ENTRY_B 写的是"和分区级一样"的 2 列 → 等价继承 → 整条不落库。
    assert domain["entries"] == {"education": {ENTRY_A: {"columns": 3}}}


def test_validation_keeps_other_explicit_keys_and_merges_with_baseline() -> None:
    """gap / align / order / solo 与分区级同一套校验：非默认才存，坏值当未设置。"""
    domain = validate_field_layout_domain(
        _config(
            section={"columns": 2, "gap": 2.0},
            entries={
                ENTRY_A: {"gap": 4.0, "align": "flow"},
                # gap 与分区级相同 → 不存；坏的 align 落回 equal = 与基线相同 → 整条丢弃。
                ENTRY_B: {"gap": 2.0, "align": "diagonal"},
            },
        )["field_layout"]
    )
    assert domain is not None
    assert domain["entries"]["education"] == {ENTRY_A: {"align": "flow", "gap": 4.0}}


def test_validation_drops_illegal_ids_and_unknown_sections() -> None:
    domain = validate_field_layout_domain(
        {
            "version": 1,
            "entries": {
                "education": {
                    "short": {"columns": 3},  # 5 位 < 8，不合法
                    "has space 123": {"columns": 3},  # 含空格，不合法
                    "eduAAAA1111; }": {"columns": 3},  # 试图逃出选择器，不合法
                    ENTRY_A: {"columns": 3},
                },
                "skills": {ENTRY_B: {"columns": 3}},  # 不在七个承载分区里
            },
        }
    )
    assert domain == {"version": 1, "entries": {"education": {ENTRY_A: {"columns": 3}}}}


def test_validation_empty_entries_are_not_stored_and_empty_domain_is_none() -> None:
    # 条目级 9 列 → 夹到 3；与分区级 2 列不同 → 保留（夹取口径与分区级同一套）。
    clamped = validate_field_layout_domain(
        _config(section={"columns": 2}, entries={ENTRY_A: {"columns": 9}})["field_layout"]
    )
    assert clamped == {
        "version": 1,
        "education": {"columns": 2},
        "entries": {"education": {ENTRY_A: {"columns": 3}}},
    }
    # 空的 entries 段不落库（条目级全部等价继承 = 什么都没改）。
    assert "entries" not in validate_field_layout_domain(
        {
            "version": 1,
            "education": {"columns": 2},
            "entries": {"education": {ENTRY_A: {"columns": 2}}},
        }
    )
    # 整域为空（只有等价继承 / 空 entries / 空对象 / 坏形状）→ None（契约 R3）。
    for raw in (
        {"version": 1},
        {"version": 1, "entries": {}},
        {"version": 1, "entries": {"education": {}}},
        {"version": 1, "entries": {"education": {ENTRY_A: {"columns": 1}}}},
        {"version": 1, "entries": {"education": {ENTRY_A: "broken"}}},
    ):
        assert validate_field_layout_domain(raw) is None


def test_entry_level_works_without_any_section_level_config() -> None:
    """用户只调了"上海大学这一条"：分区级仍是默认，域里只有 entries。"""
    domain = validate_field_layout_domain(
        _config(entries={ENTRY_A: {"columns": 3}})["field_layout"]
    )
    assert domain == {"version": 1, "entries": {"education": {ENTRY_A: {"columns": 3}}}}


def test_resolve_attaches_entries_and_expands_entry_only_section() -> None:
    resolved = resolve_field_layout(_config(entries={ENTRY_A: {"columns": 3}}))
    # 只有条目级覆盖的分区也要出现（模板靠 `field_layout.get(section)` 选 .sub-row 分支）。
    assert set(resolved) == {"education"}
    section = resolved["education"]
    assert section["columns"] == 1 and section["align"] == "equal" and section["gap"] is None
    assert section["order"] == list(PROFILE_FIELD_ORDER["education"]) and section["solo"] == []
    assert section["entries"] == {ENTRY_A: {"columns": 3}}
    # 没有条目级覆盖时 `entries` 键不出现（旧配置解析结果逐键不变）。
    plain = resolve_field_layout(_config(section={"columns": 2}))
    assert "entries" not in plain["education"]


def test_merge_entry_layout_overrides_only_explicit_keys() -> None:
    resolved = resolve_field_layout(
        _config(
            section={"columns": 2, "gap": 2.0, "solo": ["advisor"]},
            entries={ENTRY_A: {"columns": 3}},
        )
    )
    section = resolved["education"]
    merged = merge_entry_layout(section, section["entries"][ENTRY_A], "education")
    assert merged == {
        "columns": 3,  # 条目覆盖
        "align": "equal",  # 继承分区级
        "gap": 2.0,  # 继承分区级
        "order": list(PROFILE_FIELD_ORDER["education"]),
        "solo": ["advisor"],
    }
    # 两边都空 → None（调用方据此走默认逐字段一行）。
    assert merge_entry_layout(None, None) is None
    # 分区配置缺失时用该分区的默认形状。
    assert merge_entry_layout({}, None, "education") == {
        "columns": 1,
        "align": "equal",
        "gap": None,
        "order": list(PROFILE_FIELD_ORDER["education"]),
        "solo": [],
    }


def test_entry_level_survives_the_save_path_and_render_overrides() -> None:
    """保存链路（`validated_format_config`）与渲染入口（`resolve_render_overrides`）都带上条目级。"""
    raw = _config(entries={ENTRY_A: {"columns": 3}})["field_layout"]
    assert validated_format_config({"field_layout": raw})["field_layout"] == raw
    overrides = resolve_render_overrides(template="classic", format_config={"field_layout": raw})
    assert overrides.field_layout["education"]["entries"] == {ENTRY_A: {"columns": 3}}
    # 空 entries 段在保存链路里就被丢掉（空域不落库）。
    assert validated_format_config({"field_layout": {"version": 1, "entries": {}}}) == {}


def test_effective_layout_is_none_without_section_config() -> None:
    education = _two_educations().education[0]
    labels = field_labels("zh-CN")
    assert effective_profile_field_layout(education, "education", {}) is None
    # 该条目没有覆盖时，生效配置就是分区配置（装箱结果与改造前一致）。
    layout = resolve_field_layout(_config(section={"columns": 2}))
    effective = effective_profile_field_layout(education, "education", layout)
    assert effective is not None and effective["columns"] == 2
    # 6 个字段 / 2 列 = 3 行（分区级行为，与改造前逐字段装箱一致）。
    assert len(profile_field_rows(education, "education", labels, layout)) == 3


# ===== 2. HTML + CSS =====


def test_html_uses_per_entry_columns_and_gap_classes() -> None:
    html = render_html(
        _two_educations(),
        format_config=_config(
            section={"columns": 2, "gap": 2.0},
            entries={ENTRY_A: {"columns": 3, "gap": 4.0}},
        ),
    )
    # ENTRY_A：3 列 + 条目级 gap 类名（两个类名都挂，条目级规则不存在时落回分区级）。
    assert (
        f'<div class="sub sub-row sub-grid sub-cols-3 sub-gap-education-{ENTRY_A}'
        ' sub-gap-education" data-role="meta">' in html
    )
    # ENTRY_B：仍是分区级的 2 列（条目级只影响被覆盖的那一条）。
    assert (
        f'<div class="sub sub-row sub-grid sub-cols-2 sub-gap-education-{ENTRY_B}'
        ' sub-gap-education" data-role="meta">' in html
    )
    # 只有一个条目容器是 3 列（基础 CSS 里的 `.sub-row.sub-cols-3` 规则不算）。
    assert html.count('class="sub sub-row sub-grid sub-cols-3') == 1


def test_css_emits_entry_gap_rule_only_for_the_overridden_entry() -> None:
    layout = resolve_field_layout(_config(section={"gap": 2.0}, entries={ENTRY_A: {"gap": 4.0}}))
    css = field_layout_css(layout)
    section_rule = ".sub-row.sub-gap-education { --sub-gap: calc(var(--fs) * 2.0); }"
    entry_rule = f".sub-row.sub-gap-education-{ENTRY_A} {{ --sub-gap: calc(var(--fs) * 4.0); }}"
    assert section_rule in css and entry_rule in css
    # 同特异性（都是 2 个类选择器）→ 条目级必须写在分区级**之后**才生效。
    assert css.index(section_rule) < css.index(entry_rule)
    # 没覆盖 gap 的条目一条规则都不产；非法 id 拼不进规则（校验层已丢弃，这里再兜一次）。
    assert f"sub-gap-education-{ENTRY_B}" not in css
    assert "evil" not in field_layout_css({"education": {"entries": {"bad id; }": {"gap": 4.0}}}})


def test_html_gap_css_reaches_only_the_overridden_entry() -> None:
    html = render_html(
        _two_educations(),
        format_config=_config(section={"gap": 2.0}, entries={ENTRY_A: {"gap": 4.0}}),
    )
    assert f".sub-row.sub-gap-education-{ENTRY_A} {{ --sub-gap: calc(var(--fs) * 4.0); }}" in html
    assert f".sub-row.sub-gap-education-{ENTRY_B} {{" not in html


def test_markdown_text_unchanged_but_row_packing_is_per_entry() -> None:
    """Markdown 按**行**输出（行内用 ` · ` 连接），所以条目级 `solo` 会改变它的行结构。

    这条同时钉住两件事：① 条目级配置确实进了 `profile_field_rows` —— 它同时供 HTML / PDF /
    Word / Markdown 使用，被覆盖那条多出一行、同分区另一条仍是 3 行；② 列数本身不改变
    文本导出（文本流没有列宽），变化只来自行分组。
    """
    plain = export_markdown(_two_educations())
    entry_config = _config(section={"columns": 2}, entries={ENTRY_A: {"solo": ["department"]}})
    assert export_markdown(_two_educations(), format_config=entry_config) != plain

    labels = field_labels("zh-CN")
    layout = resolve_field_layout(entry_config)
    resume = _two_educations()
    rows_a = profile_field_rows(resume.education[0], "education", labels, layout)
    rows_b = profile_field_rows(resume.education[1], "education", labels, layout)
    # 默认 2 列 / 6 个字段 = 3 行；被覆盖那条的院系独占一行 → 4 行。
    assert len(rows_b) == 3
    assert len(rows_a) == 4
    assert any(len(row) == 1 for row in rows_a)


# ===== 3. PDF（真实坐标） =====


def _text_positions(resume: ResumeContent, config: dict) -> list[tuple[str, float, float]]:
    """PDF 里每段文本的 (文本, 起点 x, 起点 y)；坐标是页面用户单位（unit="mm" → 毫米）。"""
    content = build_resume_pdf(resume, page_limit=3, format_config=config).content
    positions: list[tuple[str, float, float]] = []

    def visitor(text: str, _cm, tm, _font_dict, _font_size) -> None:
        cleaned = text.replace(" ", "").strip()
        if cleaned:
            positions.append((cleaned, float(tm[4]), float(tm[5])))

    for page in PdfReader(io.BytesIO(content)).pages:
        page.extract_text(visitor_text=visitor)
    return positions


def _pick(
    positions: list[tuple[str, float, float]], marker: str, index: int = 0
) -> tuple[float, float]:
    """第 `index` 个包含 `marker` 的文本块的 (x, y)。"""
    matches = [item for item in positions if marker in item[0]]
    assert len(matches) > index, f"PDF 里找不到第 {index} 个 {marker!r}：{positions}"
    return matches[index][1], matches[index][2]


def test_pdf_entry_gap_moves_the_second_column_right() -> None:
    """条目级 gap 生效：被覆盖那条的第二列起点比未覆盖的更靠右。"""
    config = _config(section={"columns": 2}, entries={ENTRY_A: {"gap": 4.0}})
    positions = _text_positions(_two_educations(), config)
    # 两条教育的第二列内容（字符长度一致 → 第一列宽度相同，x 的差异只可能来自 gap）。
    x_a, _ = _pick(positions, "学士甲")
    x_b, _ = _pick(positions, "学士乙")
    assert x_a > x_b + 3.0, (x_a, x_b)
    # 无条目级覆盖时两条的第二列起点一致（都走分区级兜底间距）。
    baseline = _text_positions(_two_educations(), _config(section={"columns": 2}))
    assert abs(_pick(baseline, "学士甲")[0] - _pick(baseline, "学士乙")[0]) < 0.5


def test_pdf_entry_columns_change_the_row_layout() -> None:
    """条目级列数生效：ENTRY_A 3 列 → 院系与学业类型同行；ENTRY_B 2 列 → 院系换到下一行。"""
    config = _config(section={"columns": 2}, entries={ENTRY_A: {"columns": 3}})
    positions = _text_positions(_two_educations(), config)
    _, y_a = _pick(positions, "学士甲")
    _, y_b = _pick(positions, "学士乙")
    # 两条的「院系」文本相同（值也一样），按绘制顺序取第 1 / 第 2 次出现。
    _, y_dept_a = _pick(positions, "院系：计算机学院", 0)
    _, y_dept_b = _pick(positions, "院系：计算机学院", 1)
    assert abs(y_dept_a - y_a) < 0.5  # A：3 列，院系仍在第一行
    assert y_dept_b < y_b - 0.5  # B：2 列，院系换到下一行（PDF 的 y 向下递减）


# awards 走的是 `draw_bullets_with_profile_fields`（拿不到条目对象的那条旧路径），
# 现在它也能拿到 `items`，所以条目级几何在 PDF 的奖项里同样生效。
AWARD_A = "awdAAAA1111"
AWARD_B = "awdBBBB2222"


def _two_awards() -> ResumeContent:
    """同分区两个奖项：三个补充字段值的字符长度一致（x 之差只可能来自 gap）。"""
    return ResumeContent(
        name="张三",
        awards=[
            ResumeAward(
                name="一等奖", id=AWARD_A, issuer="机构甲甲", level="级别甲", ratio="比例甲"
            ),
            ResumeAward(
                name="二等奖", id=AWARD_B, issuer="机构乙乙", level="级别乙", ratio="比例乙"
            ),
        ],
    )


def _awards_config(entries: dict | None = None) -> dict:
    """奖项分区固定 2 列（可选）+ 条目级覆盖（可选）的 format_config。"""
    field_layout: dict = {"version": 1, "awards": {"columns": 2}}
    if entries is not None:
        field_layout["entries"] = {"awards": entries}
    return {"field_layout": field_layout}


def test_pdf_awards_honour_per_entry_gap() -> None:
    """PDF 的奖项也按**条目**算几何：被覆盖那条的第二列（级别）比未覆盖的更靠右。"""
    positions = _text_positions(_two_awards(), _awards_config({AWARD_A: {"gap": 4.0}}))
    x_a, _ = _pick(positions, "级别甲")
    x_b, _ = _pick(positions, "级别乙")
    assert x_a > x_b + 3.0, (x_a, x_b)
    # 没有条目级覆盖时两条的第二列起点一致（都走分区级兜底间距）。
    baseline = _text_positions(_two_awards(), _awards_config())
    assert abs(_pick(baseline, "级别甲")[0] - _pick(baseline, "级别乙")[0]) < 0.5


# ===== 4. 回退 =====


def test_unknown_entry_id_in_entries_is_ignored() -> None:
    """`entries` 里的 id 在该分区不存在（条目被删了）：静默忽略，产物不因它改变。"""
    ghost = _config(entries={ENTRY_GHOST: {"columns": 3, "gap": 6.0}})
    html = render_html(_two_educations(), format_config=ghost)
    # 分区级 1 列（默认）：仍走 .sub-row 标记，但每条都是 1 列。
    assert html.count('class="sub sub-row sub-grid sub-cols-1') == 2
    assert 'class="sub sub-row sub-grid sub-cols-3' not in html
    # 没有任何容器挂上幽灵条目的类名（那条 CSS 规则只可能是"没人用的死规则"，无害）。
    assert f'{ENTRY_GHOST}"' not in html
    # 域里那条配置本身是合法的（id 字符集没问题），只是这个分区没有这条记录：
    # 渲染端按"取不到就继承分区默认"处理，不报错；清理死规则是保存侧 prune 的事。
    resolved = resolve_field_layout(ghost)
    assert resolved["education"]["entries"] == {ENTRY_GHOST: {"gap": 6.0, "columns": 3}}


def test_entry_override_without_id_on_the_item_falls_back_to_section() -> None:
    """条目对象没有 id（旧记录）→ 拿不到覆盖，走分区级（不报错）。"""
    resume = ResumeContent(
        name="张三",
        education=[
            ResumeEducation(
                school="无标识大学",
                study_form="全日制",
                degree_type="学士",
                department="计算机学院",
            )
        ],
    )
    html = render_html(
        resume, format_config=_config(section={"columns": 2}, entries={ENTRY_A: {"columns": 3}})
    )
    assert 'sub-cols-2 sub-gap-education" data-role="meta"' in html
    assert 'class="sub sub-row sub-grid sub-cols-3' not in html
    assert f"sub-gap-education-{ENTRY_A}" not in html
