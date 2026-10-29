# SPDX-License-Identifier: Apache-2.0
"""F8 纸面新增字段的 PDF 绘制 helper（render.py / research_render.py 共用）。

**为什么单独成文件**：pdf_exporter/render.py 贴着 500 行硬预算，而"新增字段按什么顺序、
用什么样式画"在两处（主分区与学术分区）是同一件事。这里的 helper 只做绘制，字段顺序与
标签全部来自 services/resume/profile_field_lines 与 resume_labels，不维护第二份映射。

**旧产物逐字节不变**：没有新增字段时两个 helper 都不画任何东西（awards 仍走原来的一次
pdf.bullets 调用形状），与改造前的绘制顺序/段落数完全一致。

**W4 多列**：分区配了 `columns >= 2` 且这一行确实多于一个 cell 时改走 `pdf.meta_columns`
（同一行的「标签：值」并排，列间距来自配置的 `gap` 倍数）；否则仍走 `pdf.meta_line`
——也就是**无配置时一个分支都不进**，默认 PDF 产物不变（黄金基线守着）。

**W4 条目级**：几何（列数 / 间距）取**该条目**实际生效的配置
（`effective_profile_field_layout` = 分区默认叠上 `entries.<分区>.<id>` 覆盖），与 HTML 侧
同一条合并规则；`draw_profile_meta` 有 ``item`` 所以天然支持。``draw_bullets_with_profile_fields``
（awards）靠可选的 ``items``（与 ``extras`` 等长的条目序列，调用方传 ``resume.awards``）
拿到条目对象，逐条算同一份几何——不传 ``items`` 时仍按分区级几何画（旧行为，逐字节不变）。

**列宽按「该 entry 每列最宽内容」预算一次**（2026-10）：`column_widths` 每个 entry 只算一次、
该 entry 的所有行共用同一份列宽，否则逐行各算一次会让第二列起点逐行跳动（HTML 侧靠一个共享
grid 解决同一件事）。预算前必须先把字体切到副行字号（`set_meta_font`），因为
`get_string_width` 用的是**当前**字体。
"""

from __future__ import annotations

from collections.abc import Sequence

from ..resume.profile_field_lines import (
    effective_profile_field_layout,
    profile_field_rows,
    profile_field_text,
    profile_row_text,
)
from ..resume.resume_field_layout import DEFAULT_GAP_EQUAL, default_gap
from ..resume.resume_labels import level_text
from .layout import _PX_TO_MM
from .meta_columns import column_widths, set_meta_font

# 与解析层一致：列数 1–3。消费层再兜一次，绝不因坏数据画出负宽度。
_MAX_COLUMNS = 3


def column_geometry(section_layout: object) -> tuple[int, float]:
    """该分区一行画几列、列间距是几倍字号（`(columns, gap_ratio)`）。

    无配置 / 畸形输入一律 ``(1, DEFAULT_GAP_EQUAL)``——1 列 = 调用方走旧的单段 `meta_line`
    路径，默认产物因此不变。`gap` 未设置时按 `align` 的兜底值（equal 1.6 / flow 1.2），
    与 HTML 侧同一条 `default_gap` 规则，不在这里另写一份判断。

    ``align == "flow"``（按内容顺排）**强制 1 列**：那是"行内顺排、用分隔符连起来"的语义，
    HTML 侧也是逐行 flex + `list_separator`。把它画成并排 N 列会让预览与精确 PDF 反向漂移
    （用户选 flow 就是想取消对齐），所以这里与 equal 分开判断。
    """
    if not isinstance(section_layout, dict):
        return 1, DEFAULT_GAP_EQUAL
    align = section_layout.get("align")
    gap_raw = section_layout.get("gap")
    gap = (
        float(gap_raw)
        if isinstance(gap_raw, (int, float)) and not isinstance(gap_raw, bool)
        else default_gap(align if isinstance(align, str) else "equal")
    )
    if align == "flow":
        return 1, gap
    raw_columns = section_layout.get("columns")
    if isinstance(raw_columns, bool) or not isinstance(raw_columns, (int, float)):
        return 1, gap
    return max(1, min(int(raw_columns), _MAX_COLUMNS)), gap


def _draw_rows(pdf, rows, columns: int, gap_ratio: float, base: float, style) -> None:
    """画一个 entry 的全部「标签：值」行（多列时列宽按该 entry 的内容预算一次）。

    1 列 / 没有多 cell 行时逐行 ``meta_line``：与改造前逐字段一行完全一致（默认产物不变）。
    """
    if columns > 1 and any(len(row) > 1 for row in rows):
        # gap 是字号倍数 → 毫米（与 HTML 的 `calc(var(--fs) * N)` 同口径，不新造系数）。
        gap = float(gap_ratio) * base * _PX_TO_MM
        set_meta_font(pdf, base, style)
        widths = column_widths(pdf, rows, columns, gap, pdf.frame_width)
        for row in rows:
            if len(row) > 1:
                pdf.meta_columns(row, widths, gap, base, style=style)
            else:
                pdf.meta_line(profile_row_text(row), base, style=style)
        return
    for row in rows:
        pdf.meta_line(profile_row_text(row), base, style=style)


def _entry_geometry(item, section_key: str, field_layout) -> tuple[int, float]:
    """该**条目**实际生效的 (列数, 列间距倍数)。

    全文唯一的几何口径：分区默认叠上 `entries.<分区>.<id>` 覆盖（`effective_profile_field_layout`），
    再交给 `column_geometry` 解释。`draw_profile_meta` 与 `draw_bullets_with_profile_fields`
    都走这里，所以两条路径的"行按条目装箱、列宽却按分区算"不会再出现。
    """
    return column_geometry(effective_profile_field_layout(item, section_key, field_layout))


def draw_profile_meta(
    pdf, item, section_key: str, *, base: float, fields, style=None, field_layout=None
) -> None:
    """在条目既有内容之后画「标签：值」行（空值跳过；fields = field_labels(language)）。

    W4：有 ``field_layout`` 时按装箱后的**行**画；配了多列则一行并排画成 N 列
    （``pdf.meta_columns``），否则一行一条 ``meta_line``。无配置时
    ``profile_field_rows`` 返回「每字段一行」= 改造前的产物。

    **几何取该条目实际生效的配置**（分区默认叠上 `entries.<分区>.<id>` 覆盖）：同分区的
    两条教育可以一条 3 列、另一条 2 列；否则会出现"行按条目装箱、列宽与间距却按分区算"
    的错位（PDF 是"精确"预览，观感必须与 HTML 一致）。
    """
    columns, gap = _entry_geometry(item, section_key, field_layout)
    rows = profile_field_rows(item, section_key, fields, field_layout)
    _draw_rows(pdf, rows, columns, gap, base, style)


def skill_tag_text(skill, language: str, fields) -> str:
    """技能标签文本：既有「名称（等级）」+ 行内「 · 技能分类：值」（Lead F8 裁决）。"""
    text = level_text(skill.name, skill.level, language)
    extra = profile_field_text(skill, "skills", fields)
    return f"{text} · {extra}" if extra else text


def language_tag_text(item, language: str, fields) -> str:
    """语言能力标签文本（2026-10 独立分区）：语言（水平 · 证书 · 分数）· 取得时间。

    与 HTML/Word/Markdown 同一组装口径：空字段不产生多余分隔符，只有一端时不留孤零零的
    " · "；取得时间用字段前缀（`obtained`）而不是硬编码中文。
    """
    detail = " · ".join(part for part in (item.level, item.certificate, item.score) if part)
    text = level_text(item.name, detail, language) if item.name else detail
    if item.obtained_at:
        obtained = f"{fields['obtained']}：{item.obtained_at}"
        text = f"{text} · {obtained}" if text else obtained
    return text


def draw_bullets_with_profile_fields(
    pdf,
    lines: Sequence[str],
    extras: Sequence[Sequence[Sequence[tuple[str, str]]]],
    *,
    base: float,
    style=None,
    section: str | None = None,
    section_key: str | None = None,
    field_layout=None,
    items: Sequence[object] | None = None,
) -> None:
    """awards 专用：有新增字段时逐条 bullets + 其后追加标签行；否则保持原一次调用。

    ``extras`` 是"每条 award 的行组"（``profile_field_rows`` 的返回）。``section_key`` 用于
    取该分区的列数 / 间距（调用方传 ``"awards"``）；不传或该分区没配置时每行画一次
    ``meta_line``，与改造前逐字段一行/行内 " · " 连接完全一致。

    ``items`` 是**与 `extras` 等长**的条目序列（调用方传 ``resume.awards``）：传了它，每条
    award 的列数 / 间距就按**该条实际生效的**配置算（分区默认 + `entries.awards.<id>` 覆盖），
    与 HTML / Word / Markdown 的条目级行为一致；不传则沿用分区级几何（旧行为）。

    列宽按**每条 award 自己**的内容预算（不同条目的字段值长短不同，共用一个预算会让短条目
    的列被拉宽）。只有该条目真的有多 cell 行时才做这一步。
    """
    section_layout = None
    if section_key and isinstance(field_layout, dict):
        section_layout = field_layout.get(section_key)
    fallback = column_geometry(section_layout)
    if any(extras):
        for index, (line, rows) in enumerate(zip(lines, extras, strict=True)):
            pdf.bullets([line], base, style=style, section=section)
            geometry = fallback
            if items is not None and section_key:
                geometry = _entry_geometry(items[index], section_key, field_layout)
            columns, gap = geometry
            _draw_rows(pdf, rows, columns, gap, base, style)
    else:
        pdf.bullets(list(lines), base, style=style, section=section)


__all__ = [
    "column_geometry",
    "draw_bullets_with_profile_fields",
    "draw_profile_meta",
    "language_tag_text",
    "skill_tag_text",
]
