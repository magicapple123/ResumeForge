"""Split date-control grouping for year/month/day form controls."""
from __future__ import annotations

from dataclasses import replace

from ..fields import FIELD_SYNONYMS
from .model import Control


_DATE_PARENT_FIELDS = (
    "birth_date",
    "birth_year",
    "education_start",
    "education_end",
    "work_start",
    "work_end",
)

# 「起」「止」成对的日期字段：同一区块里**紧挨着**的两个同父日期组，第二组是"止"。
# 场景：教育背景的"就读时间"是四个连排控件（年/月/年/月），两组的上下文一模一样，
# 分组只能把两组都解析成 education_start（起）——第二组需要一个不依赖文本的结构性
# 推断，见 ``FormEngine._complete_split_date_pairs``。（这条规则源自 2026-10-05 鹰角
# apply 页的一次实测；同日复核发现那一页的四个控件其实是组件库下拉、已归入「只填
# 不点」，所以它现在只对**文本形态**的年/月连排生效。）
START_END_DATE_FIELDS: dict[str, str] = {
    "education_start": "education_end",
    "work_start": "work_end",
    "experience_start": "experience_end",
    "project_start": "project_end",
    "campus_start": "campus_end",
}


def _date_context(control: Control) -> str:
    """Return all local text that can identify the parent date field.

    The control's own label matters here: several real forms label the two
    components only as 年 and 月 while putting the parent label on the
    component's label element. The old grouping code ignored that local text
    and could therefore fail to link otherwise obvious pairs.
    """
    return " ".join(
        part
        for part in (
            control.own_text(),
            control.block_label,
            control.nearby_text,
            control.aria_describedby,
        )
        if part
    ).casefold()


def _parent_field(group: list[Control]) -> str | None:
    shared_text = " ".join(_date_context(item) for item in group)
    hits = [
        (field_name, synonym)
        for field_name in _DATE_PARENT_FIELDS
        for synonym in FIELD_SYNONYMS[field_name]
        if synonym.casefold() in shared_text
    ]
    if not hits:
        return None
    field_names = {field_name for field_name, _synonym in hits}
    if len(field_names) != 1:
        return None
    return max(hits, key=lambda item: len(item[1]))[0]


def link_split_date_controls(controls: list[Control]) -> list[Control]:
    """Link adjacent year/month/day controls to one parent date field.

    The grouping deliberately remains conservative: controls must be adjacent,
    contain distinct date components, and share exactly one known parent field.
    If any signal is missing, the controls remain ungrouped rather than
    risking a start/end date being merged.
    """
    linked: list[Control] = []
    index = 0
    while index < len(controls):
        first = controls[index]
        if first.date_part() is None:
            linked.append(first)
            index += 1
            continue

        group: list[Control] = []
        parts: set[str] = set()
        cursor = index
        while cursor < len(controls) and len(group) < 3:
            candidate = controls[cursor]
            part = candidate.date_part()
            if part is None or part in parts:
                break
            group.append(candidate)
            parts.add(part)
            cursor += 1

        if len(group) < 2:
            linked.append(first)
            index += 1
            continue

        field_name = _parent_field(group)
        if field_name is None:
            linked.extend(group)
            index = cursor
            continue

        group_id = f"date:{group[0].index}:{field_name}"
        linked.extend(
            replace(
                item,
                date_group=group_id,
                date_part_label=field_name,
            )
            for item in group
        )
        index = cursor
    return linked


__all__ = ["START_END_DATE_FIELDS", "link_split_date_controls"]
