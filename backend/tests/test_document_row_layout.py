# SPDX-License-Identifier: Apache-2.0
"""问题 4：灰字段分侧（lead / trail）列布局 + 「分布」开关（justify）的后端口径。

三件事必须钉住，任何一条写反都只表现为"面板上设了、纸面没变"：

1. **继承链**：``entry.<side>.X ?? entry.X ?? section.<side>.X ?? section.X ?? 默认``
   （条目共用值优先于板块分侧值——条目自己那一套 scope 更近）；
2. **装箱按各自的列数**：正文前 2 列、正文后 3 列时，两侧的行数与每行 cell 数不同，
   这正是本需求的全部意义；
3. **旧文档不变**：两侧与 `justify` 全缺省时，`lead_layout` / `trail_layout` 回到
   "1 列 / 等宽 / 靠左 / gap=None"，与拆开之前完全一致（字节级不变由
   `verify/q04-golden.py` 守，这里守结构）。
"""

from __future__ import annotations

import pytest
from app.schemas.resume_document import (
    EntryLayout,
    FieldItem,
    ResumeDocument,
    ResumeEntry,
    ResumeSection,
    RowLayout,
    SectionLayout,
    parse_document,
)
from app.services.resume.document_plan import build_document_plan


def _item(item_id: str, placement: str, value: str = "v") -> FieldItem:
    """一条灰字段；`solo=False` 才能被当成可装箱的普通 cell。"""
    return FieldItem(id=f"ob_{item_id}_0001", key=f"k_{item_id}", value=value, placement=placement)


def _document(
    entry_layout: EntryLayout | None = None,
    section_layout: SectionLayout | None = None,
    lead: int = 2,
    trail: int = 3,
) -> ResumeDocument:
    """一个只有教育经历、正文前 `lead` 条 + 正文后 `trail` 条灰字段的最小文档。"""
    items = [_item(f"lead_{index}", "lead") for index in range(lead)]
    items += [_item(f"trail_{index}", "trail") for index in range(trail)]
    items.insert(
        0, FieldItem(id="ob_school_0001", key="school", value="上海大学", placement="title")
    )
    items.append(FieldItem(id="ob_body_000001", key="body", value="正文一行", placement="body"))
    return ResumeDocument(
        sections=[
            ResumeSection(
                key="education",
                title="教育经历",
                kind="entries",
                layout=section_layout or SectionLayout(),
                entries=[
                    ResumeEntry(
                        id="entry_01",
                        layout=entry_layout or EntryLayout(),
                        items=items,
                    )
                ],
            )
        ]
    )


def _entry(plan):
    return plan.sections[0].entries[0]


# ── 旧文档不变 ────────────────────────────────────────────────────


def test_default_row_layouts_match_legacy_single_column() -> None:
    """两侧全缺省 = 1 列 / 等宽 / 靠左 / gap 交给渲染器取兜底值。"""
    entry = _entry(build_document_plan(_document()))
    assert entry.lead_layout.columns == 1
    assert entry.lead_layout.align == "equal"
    assert entry.lead_layout.justify == "start"
    assert entry.lead_layout.gap is None
    assert entry.lead_layout.column_widths is None
    assert entry.trail_layout.columns == 1
    assert entry.trail_layout.justify == "start"
    # 单列 → 每条灰字段各占一行（与拆开之前一样）
    assert [len(row) for row in entry.lead_rows] == [1, 1]
    assert [len(row) for row in entry.trail_rows] == [1, 1, 1]


# ── 分侧列数（装箱） ──────────────────────────────────────────────


def test_section_sides_pack_independently() -> None:
    """板块级 lead=2 / trail=3：两侧按各自的列数装箱，互不影响。"""
    document = _document(
        section_layout=SectionLayout(lead=RowLayout(columns=2), trail=RowLayout(columns=3))
    )
    entry = _entry(build_document_plan(document))
    assert entry.lead_layout.columns == 2
    assert entry.trail_layout.columns == 3
    # 2 条 lead → 一行两个 cell；3 条 trail → 一行三个 cell
    assert [len(row) for row in entry.lead_rows] == [2]
    assert [len(row) for row in entry.trail_rows] == [3]


def test_entry_shared_value_beats_section_side_value() -> None:
    """`entry.X` 排在 `section.<side>.X` 之前：条目自己那一套更近。"""
    document = _document(
        entry_layout=EntryLayout(columns=1),
        section_layout=SectionLayout(lead=RowLayout(columns=3)),
    )
    entry = _entry(build_document_plan(document))
    assert entry.lead_layout.columns == 1
    assert [len(row) for row in entry.lead_rows] == [1, 1]


def test_entry_side_value_beats_entry_shared_value() -> None:
    """`entry.<side>.X` 最优先；另一侧回落到条目共用值。"""
    document = _document(
        entry_layout=EntryLayout(columns=1, gap=2, trail=RowLayout(columns=3)),
        section_layout=SectionLayout(columns=2),
    )
    entry = _entry(build_document_plan(document))
    assert entry.lead_layout.columns == 1
    assert entry.lead_layout.gap == 2
    assert entry.trail_layout.columns == 3
    # trail 没设 gap → 条目共用值 2
    assert entry.trail_layout.gap == 2
    assert [len(row) for row in entry.trail_rows] == [3]


def test_side_gap_and_justify_are_resolved_per_side() -> None:
    """间距 / 分布都跟着侧走（0 也是合法值，不能被 `or` 吃掉）。"""
    document = _document(
        section_layout=SectionLayout(
            lead=RowLayout(columns=2, gap=0, justify="between"),
            trail=RowLayout(columns=2, gap=4, justify="start"),
        )
    )
    entry = _entry(build_document_plan(document))
    assert entry.lead_layout.gap == 0
    assert entry.lead_layout.justify == "between"
    assert entry.trail_layout.gap == 4
    assert entry.trail_layout.justify == "start"


def test_column_widths_follow_the_side() -> None:
    """逐列宽度 / 逐间隔搬进了 `RowLayout`，不会因为另一侧列数不同而整体作废。"""
    document = _document(
        section_layout=SectionLayout(
            lead=RowLayout(columns=2, column_widths=[60, 40], column_gaps=[2]),
            trail=RowLayout(columns=3, column_widths=[20, 30, 50], column_gaps=[1, 1]),
        )
    )
    entry = _entry(build_document_plan(document))
    assert entry.lead_layout.column_widths == [60, 40]
    assert entry.lead_layout.column_gaps == [2]
    assert entry.trail_layout.column_widths == [20, 30, 50]
    assert entry.trail_layout.column_gaps == [1, 1]


# ── 校验范围 ──────────────────────────────────────────────────────


def test_entry_gap_upper_bound_is_16_and_section_keeps_30() -> None:
    """条目级放宽到 16；板块级**不下调**到 16（老数据可能 > 16）。"""
    assert EntryLayout(gap=16).gap == 16
    with pytest.raises(ValueError):
        EntryLayout(gap=16.5)
    # 分区级仍接受更大的历史值
    assert SectionLayout(gap=30).gap == 30
    assert SectionLayout(gap=12).gap == 12
    # 分侧也走同一个上限（RowLayout 的定义只有一份）
    assert RowLayout(gap=30).gap == 30


def test_row_layout_ignores_unknown_keys() -> None:
    """`extra="ignore"`：前端多带键（例如把整个 entry 的 layout 摊进去）不会 422。"""
    layout = RowLayout.model_validate({"columns": 2, "nope": 1, "justify": "between"})
    assert layout.columns == 2
    assert layout.justify == "between"
    assert not hasattr(layout, "nope")


def test_parse_document_round_trips_side_layouts() -> None:
    """JSON 往返：分侧布局与 justify 都存在，且旧文档（无这些键）解析成 None。"""
    raw = {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": [], "contact_breaks": []},
        "sections": [
            {
                "key": "education",
                "title": "",
                "kind": "entries",
                "layout": {
                    "columns": 1,
                    "justify": "between",
                    "lead": {"columns": 2, "gap": 3},
                    "trail": {"columns": 3, "justify": "start"},
                },
                "entries": [
                    {
                        "id": "entry_01",
                        "layout": {"head": "split", "lead": {"columns": 3, "gap": 16}},
                        "items": [
                            {
                                "kind": "field",
                                "id": "ob_school_0001",
                                "key": "school",
                                "value": "上海大学",
                                "placement": "title",
                            }
                        ],
                    }
                ],
            }
        ],
    }
    document = parse_document(raw)
    section = document.sections[0]
    assert section.layout.justify == "between"
    assert section.layout.lead == RowLayout(columns=2, gap=3)
    assert section.layout.trail == RowLayout(columns=3, justify="start")
    assert section.entries[0].layout.lead == RowLayout(columns=3, gap=16)

    legacy = parse_document(
        {
            "version": 2,
            "language": "zh-CN",
            "header": {"items": [], "contact_breaks": []},
            "sections": [
                {
                    "key": "education",
                    "title": "",
                    "kind": "entries",
                    "entries": [
                        {
                            "id": "entry_01",
                            "items": [
                                {
                                    "kind": "field",
                                    "id": "ob_school_0001",
                                    "key": "school",
                                    "value": "上海大学",
                                    "placement": "title",
                                }
                            ],
                        }
                    ],
                }
            ],
        }
    )
    assert legacy.sections[0].layout.lead is None
    assert legacy.sections[0].layout.trail is None
    assert legacy.sections[0].layout.justify == "start"
    assert legacy.sections[0].entries[0].layout.lead is None
