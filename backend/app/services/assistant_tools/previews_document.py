# SPDX-License-Identifier: Apache-2.0
"""简历文档写工具的写入预览（RF-01）。

预览的职责是让用户在点「确认执行」之前**看清楚要改什么**：目标对象、影响范围
（只改这一段/这一条，不碰别处，保存会推进一版并自动留撤销点）与逐项 before/after。
这里只读复刻 handler 的意图，不执行任何写入；路径不存在/参数不合法时直接报可读错误
（比给一张"确认了也执行不了"的卡片诚实）。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .authorization import FieldChange, WritePreview
from .document_support import (
    ENTRY_LAYOUT_KEYS,
    document_for,
    entry_label,
    entry_layout,
    field_labels_for_tool,
    make_field_item,
    record_or_error,
    require_path,
    resolve_section,
    section_label,
    section_titles,
    validate_value,
)

# 条目布局项的中文说法：预览是给用户看的，不露协议字段名（start_on_new_page 之类）。
_ENTRY_LAYOUT_LABELS = {
    "head": "条目标题排布",
    "columns": "列数",
    "align": "对齐方式",
    "gap": "列间距",
    "start_on_new_page": "从新页开始",
    "keep_together": "整条不跨页",
}


def _label(labels: dict[str, str], key: str) -> str:
    return labels.get(key) or key


def _entry_target(record, document: dict, target) -> str:
    titles = section_titles(document)
    label = section_label(titles, target.section)
    if target.entry is None:
        return f"简历「{record.title}」的{label}"
    return f"简历「{record.title}」的「{label} · {entry_label(target.entry)}」"


def preview_update_resume_field(db: Session, arguments: dict) -> WritePreview:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    _path, target = require_path(document, arguments)
    labels = field_labels_for_tool()
    before = target.read()
    after = arguments.get("value")
    item_key = str((target.item or {}).get("key") or "")
    field_name = _label(labels, item_key) if item_key else target.path
    return WritePreview(
        target=_entry_target(record, document, target),
        scope=(
            "只改这一个字段；保存后简历版本号 +1，执行前自动留一份「助手修改前」命名版本"
            "（可在版本面板恢复）"
        ),
        changes=[FieldChange(field=field_name, before=_text(before), after=_text(after))],
    )


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, list):
        return "；".join(str(item) for item in value)
    text = str(value)
    return text if len(text) <= 200 else text[:200] + "…"


def preview_add_resume_entry(db: Session, arguments: dict) -> WritePreview:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    section_key, _section = resolve_section(document, str(arguments.get("section") or ""))
    labels = field_labels_for_tool()
    entry_payload = arguments.get("entry") or {}
    if not isinstance(entry_payload, dict):
        raise ValueError("entry 必须是对象：{fields: {...}, body: [...]}")
    fields = entry_payload.get("fields") or {}
    body = entry_payload.get("body") or []
    if not isinstance(fields, dict) or not isinstance(body, list):
        raise ValueError("entry.fields 必须是对象、entry.body 必须是字符串数组")
    changes: list[FieldChange] = []
    for key, value in fields.items():
        # 与 handler 走同一个建 item 的函数：非法字段（如列表字段）在确认前就报错。
        make_field_item(section_key, str(key), validate_value(value))
        changes.append(FieldChange(field=_label(labels, str(key)), before=None, after=_text(value)))
    for index, text in enumerate(body, start=1):
        if str(text).strip():
            changes.append(FieldChange(field=f"正文第 {index} 条", before=None, after=_text(text)))
    if not changes:
        raise ValueError("新条目至少要有一个字段或一条正文")
    titles = section_titles(document)
    return WritePreview(
        target=f"简历「{record.title}」的「{section_label(titles, section_key)}」新条目",
        scope=(
            "在板块末尾追加一条；不改已有条目；保存后简历版本号 +1，并自动留一份"
            "「助手修改前」命名版本"
        ),
        changes=changes,
    )


def preview_reorder_sections(db: Session, arguments: dict) -> WritePreview:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    raw_order = arguments.get("order")
    if not isinstance(raw_order, list) or not raw_order:
        raise ValueError("需要提供 order：板块 key（或标题）的完整顺序数组")
    titles = section_titles(document)
    before_keys = [str(section.get("key") or "") for section in document.get("sections") or []]
    resolved: list[str] = []
    for raw in raw_order:
        text = str(raw or "").strip()
        key = next(
            (candidate for candidate, title in titles.items() if text in {candidate, title}), None
        )
        if key is None:
            raise ValueError(f"order 里的板块「{raw}」不存在。可用板块：{'、'.join(before_keys)}")
        if key in resolved:
            raise ValueError(f"order 里的板块「{key}」重复了")
        resolved.append(key)
    missing = [key for key in before_keys if key not in resolved]
    if missing:
        raise ValueError(f"order 必须包含全部板块（缺：{'、'.join(missing)}）")
    if resolved == before_keys:
        raise ValueError("板块顺序没有变化，没有写入")
    return WritePreview(
        target=f"简历「{record.title}」的板块顺序",
        scope="只调整板块先后，不改任何条目内容；保存后简历版本号 +1，并自动留撤销点",
        changes=[
            FieldChange(
                field="板块顺序",
                before=" → ".join(section_label(titles, key) for key in before_keys),
                after=" → ".join(section_label(titles, key) for key in resolved),
            )
        ],
    )


def preview_set_entry_layout(db: Session, arguments: dict) -> WritePreview:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    _path, target = require_path(document, arguments)
    if target.entry is None:
        raise ValueError("这个 path 没有指向某个条目，请传条目路径（如 education.1）")
    raw_layout = arguments.get("layout")
    if not isinstance(raw_layout, dict) or not raw_layout:
        raise ValueError(f"需要提供 layout 对象（可用：{'、'.join(ENTRY_LAYOUT_KEYS)}）")
    unknown = [key for key in raw_layout if key not in ENTRY_LAYOUT_KEYS]
    if unknown:
        raise ValueError(f"不支持的条目布局项：{'、'.join(unknown)}")
    before = entry_layout(target.entry)
    changes = [
        FieldChange(
            field=_label(_ENTRY_LAYOUT_LABELS, key),
            before=_text(before.get(key)),
            after=_text(value),
        )
        for key, value in raw_layout.items()
    ]
    return WritePreview(
        target=_entry_target(record, document, target),
        scope=(
            "只改这一条的条目级布局（其他条目与全局版式不动）；保存后简历版本号 +1，"
            "并自动留一份「助手修改前」命名版本"
        ),
        changes=changes,
    )
