# SPDX-License-Identifier: Apache-2.0
"""布局规划的行装箱助手（从 app.services.resume.document_plan 纯搬迁拆出）。

planner 里 `_plan_entry` / `plan_section` 用到的行级组装：lead/trail 两侧装箱、正文块、
inline 板块的单行排列与稳定排序。全是纯函数，只依赖 schemas 与同目录的文本投影助手；
document_plan 对它们只做 import，行为不变。
"""

from __future__ import annotations

from collections.abc import Sequence

from ...schemas.resume_document import (
    BlockPlan,
    CellPlan,
    Inline,
    ResumeEntry,
    ResumeItem,
    ResumeSection,
    RowLayout,
    TextItem,
)
from .document_plan_format import body_style_of, item_inlines, wants_paren
from .resume_labels import list_separator
from .resume_rich_marks import item_text


def _joined_segments(
    items: Sequence[ResumeItem],
    section_key: str,
    entry_id: str,
    language: str,
    role: str,
) -> list[Inline]:
    segments: list[Inline] = []
    for item in items:
        if isinstance(item, TextItem):
            continue
        part = item_inlines(item, section_key, entry_id, language, show_label=False, role=role)
        if not part:
            continue
        if segments:
            segments.append(Inline(text=" · ", role=role))
        segments.extend(part)
    return segments


def _pack_rows(
    items: Sequence[ResumeItem],
    layout: RowLayout,
    section_key: str,
    entry_id: str,
    language: str,
) -> list[list[CellPlan]]:
    """lead/trail 装箱：solo 先冲行再独占整行；equal 每行 columns 个；flow 一行顺排。

    入参是**这一侧**的生效布局（问题 4）：正文前 2 列、正文后 3 列时，两侧的行数与每行
    cell 数各不相同——这正是"分侧列数"的全部意义。
    """
    columns = layout.columns or 1
    align = layout.align or "equal"
    cells: list[CellPlan] = []
    for item in items:
        if isinstance(item, TextItem):
            continue
        segments = item_inlines(item, section_key, entry_id, language, role="meta")
        if not segments:
            continue
        cells.append(CellPlan(segments=segments, solo=bool(item.solo)))
    rows: list[list[CellPlan]] = []
    current: list[CellPlan] = []
    for cell in cells:
        if cell.solo:
            if current:
                rows.append(current)
                current = []
            rows.append([cell])
            continue
        current.append(cell)
        if align == "equal" and len(current) >= columns:
            rows.append(current)
            current = []
    if current:
        rows.append(current)
    if align == "flow":
        separator = list_separator(language)
        for row in rows:
            for index in range(len(row) - 1):
                row[index].segments.append(Inline(text=separator, role="meta"))
    return rows


def _body_blocks(
    entry: ResumeEntry, section_key: str, entry_id: str, language: str
) -> list[BlockPlan]:
    blocks: list[BlockPlan] = []
    for item in entry.items:
        path = section_key + "." + entry_id + "." + item.id
        if isinstance(item, TextItem):
            if item.hidden:
                continue
            blocks.append(
                BlockPlan(
                    kind=item.style,
                    segments=[
                        # I-12：文本块的正文在 `text` 上（不是 value），读路径同一个入口。
                        Inline(text=item_text(item, key="text"), role="body", path=path)
                    ],
                    path=path,
                )
            )
            continue
        if item.placement != "body":
            continue
        segments = item_inlines(
            item,
            section_key,
            entry_id,
            language,
            role="body",
            wrap_paren=wants_paren(item),
        )
        if not segments:
            continue
        blocks.append(BlockPlan(kind=body_style_of(item), segments=segments, path=path))
    return blocks


#: inline 板块里条目的稳定排序：黑字（body）在前、灰字（trail/lead 等）在后。
#: 为什么需要它：converter 按字段目录顺序产出 item（技能 = category(trail) → name/level(body)），
#: 不排的话一行会以「技能分类：编程语言」开头，而 v1 的标签观感是「Python（熟练）· 编程语言」。
#: 只在**同一 placement 组内**保持数据顺序（sorted 稳定），不改变用户对条目内字段顺序的调整。
_INLINE_PLACEMENT_ORDER = {"body": 0}


def _inline_sort_key(item: ResumeItem) -> int:
    return _INLINE_PLACEMENT_ORDER.get(getattr(item, "placement", ""), 1)


def _inline_rows(section: ResumeSection, language: str) -> list[list[CellPlan]]:
    """inline 板块：每个条目一行；黑字（body）在前、灰字（trail）在后；wrap=paren 值加括号。"""
    rows: list[list[CellPlan]] = []
    for entry in section.entries:
        if entry.hidden:
            continue
        entry_id = entry.id or ""
        row: list[CellPlan] = []
        order = sorted(entry.items, key=_inline_sort_key)
        for item in order:
            if isinstance(item, TextItem):
                continue
            if item.placement == "hidden":
                continue
            role = "body" if item.placement == "body" else "meta"
            segments = item_inlines(
                item,
                section.key,
                entry_id,
                language,
                role=role,
                show_label=item.placement != "body",
                wrap_paren=wants_paren(item),
            )
            if segments:
                row.append(CellPlan(segments=segments))
        if row:
            rows.append(row)
    return rows
