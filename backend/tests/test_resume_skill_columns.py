# SPDX-License-Identifier: Apache-2.0
"""技能每行个数（R-08）：`format_config.skill_columns` 的三个投射点。

只钉三件事，且都能被断言：

1. CSS 侧只输出 `max-width` 规则（**不是** grid），未设该键时一个字都不写；
2. PDF 版式把用户值单独放在 `skill_columns`（0 = 没设过），与模板写死的 `tag_columns` 不混；
3. 折行上限 = 一行的 N 等分，第 N+1 个标签必然换行。
"""

from __future__ import annotations

from app.services.pdf_exporter.layout import resolve_layout
from app.services.pdf_exporter.skill_tags import pack_rows_by_columns, wrap_skill_tags
from app.services.resume.resume_template_format import format_css, validated_format_config


def test_format_config_keeps_skill_columns_in_range():
    assert validated_format_config({"skill_columns": 3})["skill_columns"] == 3
    # 越界丢弃（与其它 FORMAT_FIELDS 同一条契约），不是夹紧。
    assert "skill_columns" not in validated_format_config({"skill_columns": 0})
    assert "skill_columns" not in validated_format_config({"skill_columns": 5})


def test_format_css_emits_max_width_not_grid():
    css = format_css({"skill_columns": 3})
    assert "--skill-columns: 3" in css
    assert ".skill-list li { max-width: calc(" in css
    # 强制等宽的 grid 方案被明确否决：长标签会被压扁。
    assert "grid-template-columns" not in css
    # 未设置 → 空串（存量简历逐字节不变）。
    assert format_css({}) == ""
    assert format_css({"skill_columns": None}) == ""


def test_layout_keeps_user_choice_separate_from_template_grid():
    layout = resolve_layout(
        template="classic", base_px=16, format_config={"skill_columns": 2}, margin_mm=None
    )
    assert layout.skill_columns == 2
    # 模板写死的网格列数与用户覆盖互不影响：classic 没有网格（1）。
    assert layout.tag_columns == 1

    untouched = resolve_layout(template="classic", base_px=16, format_config=None, margin_mm=None)
    assert untouched.skill_columns == 0


def test_wrap_cap_limits_tags_per_row():
    """三个等宽标签：不设上限时一行能排三个，设 N 后最多 N 个一行。"""
    widths = [40.0, 40.0, 40.0]
    gap = 4.0
    available = 132.0  # 恰好能放下三个 40 + 两个 4
    assert wrap_skill_tags(widths, max_width=available, gap=gap) == [[0, 1, 2]]
    assert pack_rows_by_columns(widths, available, gap, 1) == [[0], [1], [2]]
    assert pack_rows_by_columns(widths, available, gap, 2) == [[0, 1], [2]]
    assert pack_rows_by_columns(widths, available, gap, 3) == [[0, 1, 2]]
    # 0 = 没设过：调用方走旧路径，这里不返回任何行。
    assert pack_rows_by_columns(widths, available, gap, 0) == []


def test_pack_rows_by_columns_lets_a_long_tag_take_its_own_row():
    """超过 N 等分的标签按自身宽度记账：它会挤掉同行短标签，必要时独占一行。"""
    available = 132.0
    gap = 4.0
    widths = [40.0, 120.0, 40.0]
    # N=2：第二个标签 120 > 一行的 64 → 与第一个放不下，独占一行。
    assert pack_rows_by_columns(widths, available, gap, 2) == [[0], [1], [2]]
