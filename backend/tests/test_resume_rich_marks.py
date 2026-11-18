# SPDX-License-Identifier: Apache-2.0
"""I-12 P0：`parse_marks` 的转换正确性（七种形态 + 三条硬性质）。

迁移工具 `scripts/migrate_inline_marks.py` 的"不猜/幂等"两条保证，靠的就是这里的性质：
投影一致（plain 恒等于 `strip_markers`）、区间不重叠、未闭合原样保留。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_rich_marks import RichRun, looks_unconverted, parse_marks
from app.services.resume.resume_rich_text_parse import strip_markers


@pytest.mark.parametrize(
    ("text", "expected_plain"),
    [
        ("带 8 人团队，覆盖 3 条产品线", "带 8 人团队，覆盖 3 条产品线"),
        ("**带 8 人团队**，覆盖 3 条产品线", "带 8 人团队，覆盖 3 条产品线"),
        ("{@color=#c0392b}拆解需求{@}并排期", "拆解需求并排期"),
        ("{@size=0.9,color=#c00}两样都改{@}", "两样都改"),
        ("**{@color=#2f855a}加粗又着色{@}**", "加粗又着色"),
        ("[作品集](https://example.com) 在这里", "作品集 在这里"),
        ("", ""),
    ],
)
def test_plain_is_always_the_strip_projection(text: str, expected_plain: str) -> None:
    """`plain` 必须恒等于 `strip_markers(text)`——否则迁移会把展示文本改掉。"""
    plain, _ = parse_marks(text)
    assert plain == expected_plain
    assert plain == strip_markers(text)


def test_plain_text_yields_no_runs() -> None:
    """没有任何样式的文本不产出 run（迁移时就不必写 `rich`）。"""
    _, runs = parse_marks("带 8 人团队")
    assert runs == []


def test_bold_run_covers_the_bold_text_only() -> None:
    _, runs = parse_marks("**带 8 人团队**，覆盖 3 条产品线")
    assert runs == [RichRun(start=0, end=7, bold=True)]


def test_color_run_carries_index_into_plain() -> None:
    plain, runs = parse_marks("{@color=#c0392b}拆解需求{@}并排期")
    assert plain == "拆解需求并排期"
    assert runs == [RichRun(start=0, end=4, color="#c0392b")]
    # 下标落在 plain 内，且切出来就是那四个字
    assert plain[runs[0].start : runs[0].end] == "拆解需求"


def test_size_and_color_come_together() -> None:
    _, runs = parse_marks("{@size=0.9,color=#c00}两样都改{@}")
    assert runs[0].size == 0.9
    assert runs[0].color == "#c00"


def test_nested_bold_and_color_merge_into_one_run() -> None:
    """加粗 + 着色嵌套时合并成一条 run（不是两条重叠的）。"""
    _, runs = parse_marks("**{@color=#2f855a}加粗又着色{@}**")
    assert len(runs) == 1
    assert runs[0].bold is True
    assert runs[0].color == "#2f855a"


def test_link_run_keeps_label_and_url() -> None:
    plain, runs = parse_marks("[作品集](https://example.com) 在这里")
    assert runs[0].link == "https://example.com"
    assert plain[runs[0].start : runs[0].end] == "作品集"


def test_unclosed_marker_is_kept_verbatim() -> None:
    """未闭合标记必须**原样保留**（不猜），且能被 `looks_unconverted` 抓出来。"""
    plain, runs = parse_marks("未闭合 {@color=#c00 露出来")
    assert plain == "未闭合 {@color=#c00 露出来"
    assert runs == []
    assert looks_unconverted(plain) is True


def test_runs_never_overlap_and_stay_in_bounds() -> None:
    """迁移工具依赖的硬性质：区间互不重叠、都在 plain 内。"""
    text = "**带 8 人团队**，{@color=#c00}拆解需求{@}并排期"
    plain, runs = parse_marks(text)
    cursor = 0
    for run in runs:
        assert 0 <= run.start < run.end <= len(plain)
        assert run.start >= cursor, "runs 必须按顺序且不重叠"
        cursor = run.end


def test_as_dict_omits_none_keys() -> None:
    """写进磁盘的 JSON 不带一堆 null（`bold=None` 与 `bold=False` 也是两个意思）。"""
    assert RichRun(start=1, end=2, bold=True).as_dict() == {"start": 1, "end": 2, "bold": True}
    assert RichRun(start=0, end=1).as_dict() == {"start": 0, "end": 1}
