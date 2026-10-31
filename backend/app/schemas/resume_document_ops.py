# SPDX-License-Identifier: Apache-2.0
"""v2 文档的操作函数：遍历 / 归一化 / 补 id / 解析校验 / 序列化。

从 schemas/resume_document.py 拆出的唯一原因是单文件 500 行预算；resume_document 仍
懒加载 re-export 这里的全部名字，既有导入路径不变。
"""

from __future__ import annotations

from collections.abc import Iterator

from pydantic import ValidationError

from .resume_document import (
    MAX_AUTHORS,
    MAX_CONTACT_BREAKS,
    MAX_HEADER_ITEMS,
    MAX_LIST_VALUES,
    OBJECT_ID_PATTERN,
    AuthorsItem,
    DocumentValidationError,
    HeaderItem,
    ListItem,
    ResumeDocument,
    ResumeEntry,
    ResumeItem,
    ResumeSection,
    TextItem,
    new_object_id,
)

__all__ = [
    "block_index",
    "document_item_count",
    "document_to_json",
    "ensure_document_ids",
    "iter_entries",
    "iter_items",
    "new_object_id",
    "normalize_document",
    "parse_document",
    "validate_document_ids_v2",
]


# ===== 遍历 / 计数 / 归一化 / 校验 =====


def iter_entries(document: ResumeDocument) -> Iterator[tuple[ResumeSection, ResumeEntry]]:
    for section in document.sections:
        for entry in section.entries:
            yield section, entry


def iter_items(
    document: ResumeDocument,
) -> Iterator[tuple[ResumeSection, ResumeEntry, ResumeItem]]:
    for section, entry in iter_entries(document):
        for item in entry.items:
            yield section, entry, item


def document_item_count(document: ResumeDocument) -> int:
    return sum(1 for _ in iter_items(document))


def _normalize_header_item(item: HeaderItem) -> HeaderItem | None:
    value = (item.value or "").strip()
    if not value:
        return None
    return item.model_copy(update={"value": value})


def _normalize_item(item: ResumeItem) -> ResumeItem | None:
    if isinstance(item, TextItem):
        text = (item.text or "").strip()
        return item.model_copy(update={"text": text}) if text else None
    if isinstance(item, ListItem):
        values = [str(value).strip() for value in item.values if str(value or "").strip()]
        hidden_values = [
            str(value).strip() for value in item.hidden_values if str(value or "").strip()
        ]
        if not values and not hidden_values:
            return None
        return item.model_copy(
            update={
                "values": values[:MAX_LIST_VALUES],
                "hidden_values": hidden_values[:MAX_LIST_VALUES],
            }
        )
    if isinstance(item, AuthorsItem):
        authors = [
            author.model_copy(update={"name": author.name.strip()})
            for author in item.authors
            if str(author.name or "").strip()
        ]
        return item.model_copy(update={"authors": authors[:MAX_AUTHORS]}) if authors else None
    value = (item.value or "").strip()
    if not value:
        return None
    label = (item.label or "").strip()
    return item.model_copy(update={"value": value, "label": label})


def normalize_document(document: ResumeDocument) -> ResumeDocument:
    """保存前的归一化：去空值/空条目/空板块、去重内置 key、补 id、裁剪超长值。

    往返不变（normalize(normalize(x)) == normalize(x)）：转换器与 API 写入口共用这一份
    规则，不允许各写一份"什么算空"。
    """
    doc = document.model_copy(deep=True)
    doc.language = "en-US" if doc.language == "en-US" else "zh-CN"
    header_items = [
        normalized
        for item in doc.header.items
        if (normalized := _normalize_header_item(item)) is not None
    ]
    doc.header.items = header_items[:MAX_HEADER_ITEMS]
    doc.header.contact_breaks = [
        str(key).strip() for key in doc.header.contact_breaks if str(key or "").strip()
    ][:MAX_CONTACT_BREAKS]

    sections: list[ResumeSection] = []
    seen_section_keys: set[str] = set()
    for section in doc.sections:
        key = (section.key or "").strip()
        if not key or key in seen_section_keys:
            continue
        seen_section_keys.add(key)
        entries: list[ResumeEntry] = []
        for entry in section.entries:
            seen_keys: set[str] = set()
            items: list[ResumeItem] = []
            for item in entry.items:
                normalized = _normalize_item(item)
                if normalized is None:
                    continue
                if isinstance(normalized, TextItem):
                    items.append(normalized)
                    continue
                item_key = (normalized.key or "").strip()
                if item_key and not item_key.startswith("custom:") and item_key in seen_keys:
                    continue  # 内置 key 只能有一个；重复的丢弃（写入校验阶段会 422）
                if item_key:
                    seen_keys.add(item_key)
                items.append(normalized)
            if not items:
                continue
            entries.append(entry.model_copy(update={"items": items}))
        if not entries:
            continue
        sections.append(section.model_copy(update={"entries": entries}))
    doc.sections = sections
    return ensure_document_ids(doc)


def _take_new_id(used: set[str]) -> str:
    while True:
        candidate = new_object_id()
        if candidate not in used:
            used.add(candidate)
            return candidate


def ensure_document_ids(document: ResumeDocument) -> ResumeDocument:
    """给缺失/重复的 id 补稳定值；已有合法且唯一的 id 原样保留（幂等）。"""
    doc = document.model_copy(deep=True)
    used: set[str] = set()

    def take(existing: str | None) -> str:
        if existing and existing not in used and OBJECT_ID_PATTERN.fullmatch(existing):
            used.add(existing)
            return existing
        return _take_new_id(used)

    for item in doc.header.items:
        item.id = take(item.id)
    for section in doc.sections:
        for entry in section.entries:
            entry.id = take(entry.id)
            for item in entry.items:
                item.id = take(item.id)
    return doc


def validate_document_ids_v2(document: ResumeDocument, *, allow_missing: bool = False) -> None:
    """写入前校验 id：非法/重复抛 DocumentValidationError（不静默重生成）。

    allow_missing=True 用于写入入口：客户端新建的 item 允许暂时没有 id（服务端
    normalize 会补），但**已经带了**的 id 必须合法且全局唯一——否则编辑定位/撤销/
    预览高亮会指向错的对象，静默重生成等于把用户设备上的标识悄悄换掉。
    """
    seen: set[str] = set()
    for item in document.header.items:
        _check_one_id(item.id, "header", seen, allow_missing=allow_missing)
    for section in document.sections:
        for entry_index, entry in enumerate(section.entries):
            _check_one_id(
                entry.id or "",
                f"{section.key}.entries[{entry_index}]",
                seen,
                allow_missing=allow_missing,
            )
            for item_index, item in enumerate(entry.items):
                _check_one_id(
                    item.id,
                    f"{section.key}.{entry_index}.items[{item_index}]",
                    seen,
                    allow_missing=allow_missing,
                )


def _check_one_id(value: str, path: str, seen: set[str], *, allow_missing: bool = False) -> None:
    if not value:
        if allow_missing:
            return
        raise DocumentValidationError(f"{path} 缺少对象标识")
    if not OBJECT_ID_PATTERN.fullmatch(value):
        raise DocumentValidationError(f"{path} 的对象标识不合法")
    if value in seen:
        raise DocumentValidationError(f"{path} 的对象标识重复：{value}")
    seen.add(value)


def _pydantic_path(exc: ValidationError) -> str:
    first = exc.errors()[0]
    location = ".".join(str(part) for part in first.get("loc", ()))
    message = str(first.get("msg", "结构不合法"))
    return f"{location}: {message}" if location else message


def parse_document(raw: object) -> ResumeDocument:
    """把任意 v2 JSON 解析成规范化文档；结构不合法抛 DocumentValidationError。"""
    if not isinstance(raw, dict):
        raise DocumentValidationError("简历内容必须是对象")
    if raw.get("version") != 2:
        raise DocumentValidationError(
            "简历内容版本不是 2（旧版内容请先经 document_converter 转换）"
        )
    try:
        document = ResumeDocument.model_validate(raw)
    except ValidationError as exc:
        raise DocumentValidationError(_pydantic_path(exc)) from exc
    # 先校验客户端带来的 id（非法/重复 -> 422），再补缺失 id；顺序不能反，否则
    # "重复 id"会被静默改成新 id，两次打开同一份文档的撤销/定位就断链了。
    validate_document_ids_v2(document, allow_missing=True)
    normalized = normalize_document(document)
    return normalized


def document_to_json(document: ResumeDocument) -> dict:
    """稳定序列化：不序列化 None（gap/columns 继承分区），空 section/entry 已被 normalize 去掉。"""
    return document.model_dump(mode="json", exclude_none=True)


def block_index(items: list[ResumeItem]) -> dict[str, int]:
    """item id -> 在 body 块序列里的下标（计划/预览定位辅助）。"""
    return {
        item.id: index
        for index, item in enumerate(items)
        if isinstance(item, TextItem) or item.placement == "body"
    }


# 计划输出（DocumentPlan / Inline / CellPlan / BlockPlan / HeadPlan / EntryPlan /
# SectionPlan / HeaderPlan）已迁到 schemas/resume_document_plan.py（单文件行数预算）。
# 这里用模块级 __getattr__ 懒加载 re-export：既保持
# "from app.schemas.resume_document import DocumentPlan" 的既有导入路径不变，又不产生
# resume_document -> resume_document_plan -> resume_document 的循环 import。
