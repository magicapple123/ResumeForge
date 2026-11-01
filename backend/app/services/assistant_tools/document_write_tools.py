# SPDX-License-Identifier: Apache-2.0
"""简历文档写入工具（#38 P2）：局部改字段 / 追加条目 / 重排板块 / 设置条目布局。

四个工具都是 ``writes=True``：用户未同意写入时，执行层只跑 ``preview``（只读复刻改动）
并生成待确认提案，用户在界面上点「确认执行」才真正落库（RF-01）。因此这里的 handler
可以直接按"已经被批准"来写：
- 保存走 ``document_io.prepare_document_for_save``（唯一写收口：转 v2 + 校验对象 id）；
- 保存前自动留一份「助手修改前」命名版本（撤销点），与正文同事务提交；
- 任何"没有变化 / 路径不存在 / 类型不匹配"都在写库前报可读错误，绝不静默写一份空改动。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...schemas.resume_document import new_object_id
from ._types import ToolResult
from .document_support import (
    MAX_RESULT_CHARS,
    document_for,
    entry_label,
    entry_layout,
    make_field_item,
    make_text_item,
    normalized_entry_layout,
    persist_document,
    record_or_error,
    require_path,
    resolve_section,
    same_value,
    section_label,
    section_titles,
    undo_hint,
    validate_value,
)


def _tool_update_resume_field(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    _path, target = require_path(document, arguments)
    if target.item is None:
        raise ValueError(
            "这个 path 指向整条条目或整段内容，不是单个字段；改条目布局用 set_entry_layout"
        )
    value = validate_value(arguments.get("value"))
    before = target.read()
    if same_value(before, value):
        raise ValueError("修改前后内容一致，没有写入")
    from ..resume.document_paths import write_document_value

    if not write_document_value(document, _path, value):
        raise ValueError("值的类型与这个字段不匹配（文本字段要字符串，列表字段要字符串数组）")
    after = target.read()
    titles = section_titles(document)
    revision, version = persist_document(
        db, record, document, change_summary=f"助手修改 {target.path}"
    )
    section_name = section_label(titles, target.section)
    entry_name = entry_label(target.entry or {})
    payload = {
        "resume_id": record.id,
        "path": target.path,
        "section_label": section_name,
        "before": before,
        "after": after,
        "revision": revision,
        "undo": undo_hint(version),
    }
    return ToolResult(
        # 界面上的摘要只写人话（分区/条目简称/字段名）：内部 path（含 ob_ 对象 id）
        # 只进回给模型的 text，不往"助手做了什么"与提案结果里露（与 #20 同一口径）。
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"修改了简历「{record.title}」的「{section_name} · {entry_name}」：{before} → {after}",
        link="/resumes",
        changed=True,
    )


def _tool_add_resume_entry(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    section_key, section = resolve_section(document, str(arguments.get("section") or ""))
    entry_payload = arguments.get("entry") or {}
    if not isinstance(entry_payload, dict):
        raise ValueError("entry 必须是对象：{fields: {...}, body: [...]}")
    fields = entry_payload.get("fields") or {}
    body = entry_payload.get("body") or []
    if not isinstance(fields, dict) or not isinstance(body, list):
        raise ValueError("entry.fields 必须是对象、entry.body 必须是字符串数组")
    items = [
        make_field_item(section_key, str(key), validate_value(value))
        for key, value in fields.items()
    ]
    items.extend(make_text_item(str(text)) for text in body if str(text).strip())
    if not items:
        raise ValueError("新条目至少要有一个字段或一条正文")
    entry = {
        "id": new_object_id("ob_en"),
        "hidden": False,
        "lock_content": False,
        "lock_layout": False,
        "layout": normalized_entry_layout(entry_payload.get("layout") or {}),
        "items": items,
    }
    section.setdefault("entries", []).append(entry)
    revision, version = persist_document(
        db, record, document, change_summary=f"助手在 {section_key} 新增条目"
    )
    payload = {
        "resume_id": record.id,
        "section": section_key,
        "section_label": section_label(section_titles(document), section_key),
        "entry_id": entry["id"],
        "path": f"{section_key}.{entry['id']}",
        "revision": revision,
        "undo": undo_hint(version),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"在简历「{record.title}」的「{payload['section_label']}」新增了一条",
        link="/resumes",
        changed=True,
    )


def _tool_reorder_sections(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    raw_order = arguments.get("order")
    if not isinstance(raw_order, list) or not raw_order:
        raise ValueError("需要提供 order：板块 key（或标题）的完整顺序数组")
    sections = [item for item in document.get("sections") or [] if isinstance(item, dict)]
    by_key = {str(section.get("key") or ""): section for section in sections}
    titles = section_titles(document)
    ordered: list[dict] = []
    seen: set[str] = set()
    for raw in raw_order:
        text = str(raw or "").strip()
        key = next(
            (candidate for candidate, title in titles.items() if text in {candidate, title}), None
        )
        if key is None or key not in by_key:
            raise ValueError(f"order 里的板块「{raw}」不存在。可用板块：{'、'.join(by_key)}")
        if key in seen:
            raise ValueError(f"order 里的板块「{key}」重复了")
        seen.add(key)
        ordered.append(by_key[key])
    missing = [key for key in by_key if key not in seen]
    if missing:
        raise ValueError(f"order 必须包含全部板块（缺：{'、'.join(missing)}）")
    before = [str(section.get("key")) for section in sections]
    if [str(section.get("key")) for section in ordered] == before:
        raise ValueError("板块顺序没有变化，没有写入")
    document["sections"] = ordered
    revision, version = persist_document(db, record, document, change_summary="助手调整板块顺序")
    after = [str(section.get("key")) for section in ordered]
    payload = {
        "resume_id": record.id,
        "before": before,
        "after": after,
        "revision": revision,
        "undo": undo_hint(version),
    }
    labels = [section_label(titles, key) for key in after]
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"调整了简历「{record.title}」的板块顺序：{' → '.join(labels)}",
        link="/resumes",
        changed=True,
    )


def _tool_set_entry_layout(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    _path, target = require_path(document, arguments)
    if target.entry is None:
        raise ValueError("这个 path 没有指向某个条目，请传条目路径（如 education.1）")
    entry = target.entry
    raw_layout = arguments.get("layout")
    if not isinstance(raw_layout, dict) or not raw_layout:
        raise ValueError(
            "需要提供 layout 对象（head / columns / align / gap / start_on_new_page / keep_together）"
        )
    before = entry_layout(entry)
    after = {**before, **raw_layout}
    if after == before:
        raise ValueError("条目布局没有变化，没有写入")
    entry["layout"] = after
    revision, version = persist_document(
        db, record, document, change_summary=f"助手调整条目布局 {target.path}"
    )
    titles = section_titles(document)
    payload = {
        "resume_id": record.id,
        "path": target.path,
        "before": before,
        "after": after,
        "revision": revision,
        "undo": undo_hint(version),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=(
            f"调整了简历「{record.title}」里「{section_label(titles, target.section)} · "
            f"{entry_label(entry)}」的条目布局"
        ),
        link="/resumes",
        changed=True,
    )
