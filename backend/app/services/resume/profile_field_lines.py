# SPDX-License-Identifier: Apache-2.0
"""F8 纸面渲染的新增条目字段：分区→字段顺序 + 「标签：值」行（单一来源）。

HTML 模板无法 import Python（_resume_blocks.j2 按同一顺序显式写行）；Markdown / Word /
PDF 三个 Python 渲染器都从这里取——不许各处再抄一份字段顺序，否则四格式迟早漂移。
标签仍只来自 resume_labels.FIELD_LABELS（渲染层不写中文字面量）。

只列 F8 新增/复用的有纸面追加行字段：已复用的 experience_kind / artifact_type /
funding 保持既有渲染位置（契约 §2），不在这里重复输出。

顺序 = 契约 §1 表顺序 = 模型字段追加顺序；新增字段只增不改，空值跳过。
"""

from __future__ import annotations

from collections.abc import Mapping

# 分区键用 ResumeContent 字段名（education/experience/...），与四个渲染器的分区键一致。
PROFILE_FIELD_ORDER: dict[str, tuple[str, ...]] = {
    "education": (
        "study_form",
        "degree_type",
        "department",
        "rank",
        "advisor",
        "research_direction",
    ),
    "experience": ("team_size",),
    "campus_experience": ("activity_type",),
    "projects": ("project_size",),
    "skills": ("category",),
    "awards": ("issuer", "level", "ratio"),
    "publications": ("outcome_type", "my_rank"),
    "research_projects": ("level",),
    "credentials": ("credential_type",),
}

# 行内单元格之间的连接符（PDF / Word / Markdown / TXT 用；HTML 用模板里的
# list_separator，与既有行内字段的标点一致）。
ROW_SEPARATOR = " · "

__all__ = [
    "PROFILE_FIELD_ORDER",
    "ROW_SEPARATOR",
    "profile_field_lines",
    "profile_field_row_cells",
    "profile_field_rows",
    "profile_field_text",
    "profile_row_text",
]


def profile_field_lines(
    item: object, section_key: str, labels: Mapping[str, str]
) -> list[tuple[str, str]]:
    """该条目要追加的 (标签, 值) 行：空值跳过、顺序固定。

    labels 传 resume_labels.field_labels(language)；缺键直接 KeyError（宁可导出时炸出
    明显错误，也不要把某一行静默丢掉）。
    """
    rows: list[tuple[str, str]] = []
    for field in PROFILE_FIELD_ORDER.get(section_key, ()):
        value = str(getattr(item, field, "") or "").strip()
        if value:
            rows.append((labels[field], value))
    return rows


def _section_layout(layout: object, section_key: str) -> dict | None:
    """取该分区的排版配置（layout 是 resolve_field_layout 的整张表；畸形输入按无配置）。"""
    if not isinstance(layout, dict):
        return None
    payload = layout.get(section_key)
    return payload if isinstance(payload, dict) else None


def _ordered_fields(section_key: str, section_layout: dict | None) -> tuple[str, ...]:
    """该分区实际输出字段的顺序：配置顺序在前，未列出的按默认顺序补在末尾。"""
    defaults = PROFILE_FIELD_ORDER.get(section_key, ())
    raw_order = section_layout.get("order") if section_layout is not None else None
    fields: list[str] = []
    seen: set[str] = set()
    if isinstance(raw_order, (list, tuple)):
        for field in raw_order:
            if isinstance(field, str) and field in defaults and field not in seen:
                seen.add(field)
                fields.append(field)
    fields.extend(field for field in defaults if field not in seen)
    return tuple(fields)


def _columns_of(section_layout: dict) -> int:
    """列数防御性夹取 1–3（解析层已校验；消费层再兜一次，绝不因坏数据抛异常）。"""
    raw = section_layout.get("columns")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return 1
    return max(1, min(int(raw), 3))


def _pack_cells(
    cells: list[tuple[str, str, str]], columns: int, solo: frozenset[str]
) -> list[list[tuple[str, str, str]]]:
    """按列数装箱：行满换行；solo 字段先冲掉当前行再独占一行。"""
    rows: list[list[tuple[str, str, str]]] = []
    current: list[tuple[str, str, str]] = []
    for cell in cells:
        if cell[0] in solo:
            if current:
                rows.append(current)
                current = []
            rows.append([cell])
            continue
        current.append(cell)
        if len(current) >= columns:
            rows.append(current)
            current = []
    if current:
        rows.append(current)
    return rows


def _collect_cells(
    item: object, section_key: str, labels: Mapping[str, str], section_layout: dict | None
) -> list[tuple[str, str, str]]:
    """按顺序取非空字段的 (字段名, 标签, 值)。"""
    cells: list[tuple[str, str, str]] = []
    for field in _ordered_fields(section_key, section_layout):
        value = str(getattr(item, field, "") or "").strip()
        if value:
            cells.append((field, labels[field], value))
    return cells


def _solo_of(section_layout: dict | None) -> frozenset[str]:
    raw = section_layout.get("solo") if section_layout is not None else None
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(item for item in raw if isinstance(item, str))


def profile_field_rows(
    item: object, section_key: str, labels: Mapping[str, str], layout: object = None
) -> list[list[tuple[str, str]]]:
    """该条目按「条目字段排版」装箱后的 (标签, 值) 行（四格式同一份实现）。

    ``layout`` 是 ``resolve_field_layout`` 的整张表（``None`` / 该分区没配置时）。
    **无配置时每字段一行**——与改造前的逐行渲染完全一致（四格式默认产物不变）。
    空值跳过；``solo`` 字段独占一行；``columns`` 控制一行最多几个单元格。
    """
    section_layout = _section_layout(layout, section_key)
    cells = _collect_cells(item, section_key, labels, section_layout)
    if section_layout is None:
        return [[(label, value)] for _field, label, value in cells]
    rows = _pack_cells(cells, _columns_of(section_layout), _solo_of(section_layout))
    return [[(label, value) for _field, label, value in row] for row in rows]


def profile_field_row_cells(
    item: object, section_key: str, labels: Mapping[str, str], layout: object = None
) -> list[list[dict[str, str]]]:
    """同 ``profile_field_rows``，但保留**字段名**（HTML 模板要拼 data-resume-path）。

    装箱逻辑只有 ``_pack_cells`` 一份；这里只把三元组转成模板可直接点属性访问的 dict，
    避免 HTML 模板自己再排一次（那样四格式就又分叉了）。
    """
    section_layout = _section_layout(layout, section_key)
    cells = _collect_cells(item, section_key, labels, section_layout)
    if section_layout is None:
        rows = [[cell] for cell in cells]
    else:
        rows = _pack_cells(cells, _columns_of(section_layout), _solo_of(section_layout))
    return [
        [{"field": field, "label": label, "value": value} for field, label, value in row]
        for row in rows
    ]


def profile_row_text(row: list[tuple[str, str]], separator: str = ROW_SEPARATOR) -> str:
    """一行单元格拼成行内文本：``标签：值 · 标签：值``（PDF / Word / Markdown 共用）。"""
    return separator.join(f"{label}：{value}" for label, value in row)


def profile_field_text(item: object, section_key: str, labels: Mapping[str, str]) -> str:
    """把同一组行拼成行内文本（skills 行内流用）：标签：值 · 标签：值。"""
    return " · ".join(
        f"{label}：{value}" for label, value in profile_field_lines(item, section_key, labels)
    )
