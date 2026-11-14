# SPDX-License-Identifier: Apache-2.0
"""逐间隔几何：最后一列没有"下一个"间隔，索引越界要安全。

三条：显式间隔列表不能被 justify 改写；em→mm 只换算一次（重复换算会把间距放大数倍）；
长度对不上时回到"无逐间隔"而不是硬套。
"""

from __future__ import annotations

import pytest
from app.services.pdf_exporter.meta_columns import draw_meta_columns, justify_gap
from test_pdf_exporter import _pdf_with_font, needs_font


@needs_font
@pytest.mark.parametrize("gaps, columns", [([1.5], 2), ([1, 1], 3), ([], 2), ([1], 3)])
def test_pdf_gap_list_is_safe_for_last_column_and_mismatched_lengths(gaps, columns):
    pdf = _pdf_with_font()
    cells = [("Field", str(index)) for index in range(columns)]
    starts = []
    original = pdf.multi_cell

    def record(*args, **kwargs):
        starts.append(pdf.get_x())
        return original(*args, **kwargs)

    pdf.multi_cell = record
    draw_meta_columns(pdf, cells, [40] * columns, gaps, 14)
    drawn = starts[-columns:]
    assert len(drawn) == columns
    for index in range(columns - 1):
        expected = 40 + (gaps[index] if index < len(gaps) else 0)
        assert drawn[index + 1] - drawn[index] == pytest.approx(expected)
    assert len(pdf.output()) > 500


@needs_font
def test_justify_does_not_rewrite_explicit_gap_list():
    pdf = _pdf_with_font()
    gaps = [4.5, 5.0]
    assert justify_gap(pdf, [40, 40, 40], gaps, "between") is gaps


@needs_font
def test_gap_ratios_convert_from_font_pixels_to_millimeters_once():
    from app.schemas.resume_document import SectionLayout
    from app.services.pdf_exporter.meta_columns import resolve_cell_widths

    pdf = _pdf_with_font()
    layout = SectionLayout(columns=3, column_widths=[40, 30, 30], column_gaps=[1.5, 0.8])
    widths, gaps = resolve_cell_widths(pdf, [["A", "B", "C"]], 3, layout, 0)
    # The exporter consistently uses six decimal places for the CSS pixel ratio.
    expected = [pdf.layout.base_px * ratio * 0.264583 for ratio in (1.5, 0.8)]
    assert gaps == pytest.approx(expected)
    assert sum(widths) + sum(gaps) == pytest.approx(pdf.frame_width)
