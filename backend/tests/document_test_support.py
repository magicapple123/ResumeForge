# SPDX-License-Identifier: Apache-2.0
"""v2 文档测试断言工具（backend/tests 迁移期共用辅助，唯一实现）。

为什么需要它（计划 §10.1）：v1 的 content 是 11 个按分区写死的数组
（content["education"][0]["school"]），v2 是"有序 item 列表 + placement"，断言方式必须换：
按 key 找 item、取 FieldItem.value / TextItem.text、检查 placement/format。如果每个测试文件
各写一份"怎么从 v2 里取字段"，一个 shape 变化就要改上百处；这里只保留一份选取器。

分工（2026-10-30 与 backend-api 对齐）：
- 本模块是**唯一实现**；tests/document_helpers.py 由 backend-api 做兼容 re-export
  （同一组名字，不复制实现），两个入口都能用；
- 本模块不 import document_helpers（避免循环）。

使用约定：

1. 结构断言（保存/读取/API 契约）按 key 找 item：section_of / entry_of / item_by_key /
   field_value / item_placement，不写 sections[i].entries[j].items[k] 的下标链；
2. 行为断言（渲染/导出/翻译/锁定）优先断言产物文本或 v1 分析视图；v1 分析视图用
   legacy_of（与生产分析路径同一个 document_legacy_view 临时桥，下一批删除）；
3. 旧 v1 夹具用 as_document 转 v2 再喂 v2 入口；不要在测试里手写 v1 拼装再和 v2 对比；
4. doc 参数可以是 v2 dict、v1 dict、ResumeDocument 或 API 响应里的 content。

导入：from document_test_support import ...（tests 目录没有 __init__，pytest 把测试目录
放进 sys.path，与 dataset_api_helpers 等既有辅助模块一致）。
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.schemas.resume import ResumeContent
from app.schemas.resume_document import (
    ResumeDocument,
    document_to_json,
    parse_document,
)
from app.services.resume.document_converter import ensure_document_version
from app.services.resume.document_plan import build_document_plan, plan_to_text
from tests.document_v1_oracle import historical_values

__all__ = [
    "as_document",
    "author_names",
    "body_texts",
    "display_value",
    "doc_of",
    "document_text",
    "entries_of",
    "entry_count",
    "entry_of",
    "entry_texts",
    "field_value",
    "header_items",
    "header_value",
    "item_by_id",
    "item_by_key",
    "item_placement",
    "item_path",
    "item_text",
    "item_texts",
    "item_value",
    "item_values",
    "items",
    "items_by_key",
    "legacy_of",
    "make_document",
    "require_entry",
    "require_field",
    "require_item",
    "require_section",
    "response_document",
    "section_keys",
    "section_of",
    "stored_document",
    "values",
    "walk_entries",
    "walk_items",
]


# ===== 版本收口 =====


def as_document(
    content: Any,
    *,
    language: str | None = None,
    format_config: Any = None,
    custom_fields: Any = None,
) -> dict:
    """任意版本 content -> 已归一化的 v2 dict。

    用于"把旧夹具喂给 v2 入口"与"断言存储形状"；幂等：v2 再收口不变。
    language/format_config/custom_fields 只在 v1 转换时生效（v2 直通）：旧 v1 夹具
    要带 v1 的 format_config（section_order/field_layout/contact_breaks）进来时传它。
    """
    if isinstance(content, ResumeDocument):
        return content.model_dump(mode="json", exclude_none=True)
    if isinstance(content, ResumeContent):
        content = content.model_dump(exclude_none=True)
    return ensure_document_version(
        content,
        language=language,
        format_config=format_config,
        custom_fields=custom_fields,
    )


def doc_of(content: Any) -> ResumeDocument:
    """任意版本 content -> 规范化 ResumeDocument 模型（结构/ id 已校验）。"""
    return parse_document(as_document(content))


def legacy_of(content: Any) -> ResumeContent:
    """任意版本 content -> v1 分析视图（只给分析算法/兼容断言用，不是渲染口径）。"""
    if isinstance(content, ResumeContent):
        return content
    return historical_values(as_document(content))


def _read_document(content: Any) -> dict:
    """只读选取器的快速入口：v2 dict 直接返回（已归一化），其余版本走 as_document。"""
    if isinstance(content, dict) and content.get("version") == 2:
        return content
    return as_document(content)


def make_document(
    sections: list[dict] | None = None,
    header: list[dict] | None = None,
    *,
    language: str = "zh-CN",
) -> dict:
    """用最简结构造一份合法 v2 文档 dict（缺 id 的 item/entry 自动补）。"""
    raw = {
        "version": 2,
        "language": language,
        "header": {"items": list(header or [])},
        "sections": list(sections or []),
    }
    return document_to_json(parse_document(raw))


# ===== 遍历 =====


def walk_sections(document: Any) -> list[dict]:
    return list(_read_document(document).get("sections") or [])


def walk_entries(document: Any) -> Iterator[tuple[dict, dict]]:
    """遍历 (section, entry)。"""
    for section in walk_sections(document):
        for entry in section.get("entries") or []:
            yield section, entry


def walk_items(document: Any) -> Iterator[tuple[dict, dict, dict]]:
    """遍历 (section, entry, item)。"""
    for section, entry in walk_entries(document):
        for item in entry.get("items") or []:
            yield section, entry, item


def section_keys(document: Any) -> list[str]:
    return [str(section.get("key") or "") for section in walk_sections(document)]


# ===== 板块 / 条目 =====


def section_of(document: Any, section_key: str) -> dict | None:
    return next(
        (section for section in walk_sections(document) if section.get("key") == section_key),
        None,
    )


def entries_of(document: Any, section_key: str) -> list[dict]:
    section = section_of(document, section_key)
    return list((section or {}).get("entries") or [])


def entry_of(document: Any, section_key: str, index: int = 0) -> dict | None:
    entries = entries_of(document, section_key)
    if -len(entries) <= index < len(entries):
        return entries[index]
    return None


def entry_count(document: Any, section_key: str) -> int:
    return len(entries_of(document, section_key))


# ===== item =====


def items(document: Any, section_key: str, entry_index: int = 0) -> list[dict]:
    """某条目下的 item 列表（默认第一个条目）。"""
    entry = entry_of(document, section_key, entry_index)
    return list((entry or {}).get("items") or [])


def _iter_items(document: Any, section_key: str | None) -> Iterator[dict]:
    for section, _entry, item in walk_items(document):
        if section_key is None or section.get("key") == section_key:
            yield item


def item_by_key(
    document: Any, key: str, *, section: str | None = None, entry_index: int = 0
) -> dict | None:
    """按 item.key 取**第一个**匹配的 item（指定 section / entry 时只在该条目里找）。"""
    if section is not None:
        return next(
            (item for item in items(document, section, entry_index) if item.get("key") == key),
            None,
        )
    return next((item for item in _iter_items(document, None) if item.get("key") == key), None)


def items_by_key(document: Any, key: str, *, section: str | None = None) -> list[dict]:
    return [item for item in _iter_items(document, section) if item.get("key") == key]


def item_placement(document: Any, key: str, *, section: str | None = None) -> str | None:
    item = item_by_key(document, key, section=section)
    return None if item is None else str(item.get("placement") or "")


def field_value(
    document: Any, key: str, *, section: str | None = None, entry_index: int = 0
) -> str:
    """field 类 item 的值（非 field 不猜：返回空串）。"""
    item = item_by_key(document, key, section=section, entry_index=entry_index)
    if item is None or item.get("kind") != "field":
        return ""
    return str(item.get("value") or "")


def header_items(document: Any) -> list[dict]:
    return list((_read_document(document).get("header") or {}).get("items") or [])


def header_value(document: Any, key: str) -> str:
    for item in header_items(document):
        if item.get("key") == key:
            return str(item.get("value") or "")
    return ""


# ===== 文本 / 值 =====


def item_texts(item: dict) -> list[str]:
    """一个 item 里的全部非空文本（与 values/texts 共用同一口径）。"""
    kind = item.get("kind")
    if kind == "text":
        text = str(item.get("text") or "").strip()
        return [text] if text else []
    if kind == "list":
        return [str(value).strip() for value in item.get("values") or [] if str(value).strip()]
    if kind == "authors":
        return [
            str(author.get("name") or "").strip()
            for author in item.get("authors") or []
            if str(author.get("name") or "").strip()
        ]
    text = str(item.get("value") or "").strip()
    return [text] if text else []


def entry_texts(entry: dict) -> list[str]:
    """一个条目下全部 item 的非空文本（按 items 顺序；含 hidden item）。"""
    found: list[str] = []
    for item in entry.get("items") or []:
        found.extend(item_texts(item))
    return found


def values(document: Any) -> list[str]:
    """文档里全部非空标量值（header + item，按出现顺序）。

    用于"文字不丢"类断言：assert "示例公司" in values(content)。
    """
    found: list[str] = []
    for item in header_items(document):
        text = str(item.get("value") or "").strip()
        if text:
            found.append(text)
    for _section, _entry, item in walk_items(document):
        found.extend(item_texts(item))
    return found


def texts(document: Any) -> list[str]:
    """文档里全部文本 = values(document)（同一口径的别名）。"""
    return values(document)


def author_names(document: Any, key: str, *, section: str | None = None) -> list[str]:
    item = item_by_key(document, key, section=section)
    if item is None or item.get("kind") != "authors":
        return []
    return [str(author.get("name") or "") for author in item.get("authors") or []]


# ===== 严格选取器（找不到时报出可用 key，失败信息可读） =====


def require_section(document: Any, key: str) -> dict:
    section = section_of(document, key)
    if section is None:
        raise AssertionError(f"文档里没有分区 {key!r}（现有：{section_keys(document)}）")
    return section


def require_entry(document: Any, key: str, index: int = 0) -> dict:
    entries = entries_of(document, key)
    if not entries:
        raise AssertionError(f"分区 {key!r} 没有条目（现有分区：{section_keys(document)}）")
    try:
        return entries[index]
    except IndexError:
        raise AssertionError(f"分区 {key!r} 只有 {len(entries)} 条，取不到第 {index} 条") from None


def require_item(entry: dict, key: str, *, kind: str | None = None) -> dict:
    for item in entry.get("items") or []:
        if item.get("key") == key and (kind is None or item.get("kind") == kind):
            return item
    keys = [str(item.get("key") or "") for item in entry.get("items") or []]
    raise AssertionError(f"条目里没有字段 {key!r}（现有：{keys}）")


def require_field(entry: dict, key: str) -> dict:
    return require_item(entry, key, kind="field")


def item_by_id(entry: dict, item_id: str) -> dict:
    for item in entry.get("items") or []:
        if item.get("id") == item_id:
            return item
    ids = [str(item.get("id") or "") for item in entry.get("items") or []]
    raise AssertionError(f"条目里没有 id={item_id!r} 的 item（现有：{ids}）")


# ===== item 取值 =====


def item_value(item: dict) -> str:
    """FieldItem.value（对 list/authors/text 会 assert，提醒用对选取器）。"""
    assert item.get("kind") == "field", f"不是 FieldItem：{item.get('kind')!r}"
    return str(item.get("value") or "")


def item_values(item: dict) -> list[str]:
    """ListItem.values。"""
    assert item.get("kind") == "list", f"不是 ListItem：{item.get('kind')!r}"
    return [str(value) for value in item.get("values") or []]


def item_text(item: dict) -> str:
    """TextItem.text。"""
    assert item.get("kind") == "text", f"不是 TextItem：{item.get('kind')!r}"
    return str(item.get("text") or "")


def display_value(item: dict) -> str:
    """item 的可读值（field -> value；list -> 分号连接；authors -> 姓名顿号连接；text -> text）。"""
    kind = item.get("kind")
    if kind == "list":
        return "；".join(item_values(item))
    if kind == "authors":
        return "、".join(str(author.get("name") or "") for author in item.get("authors") or [])
    if kind == "text":
        return item_text(item)
    return item_value(item)


def body_texts(document: Any, section_key: str, entry_index: int = 0) -> list[str]:
    """某条目的正文块文本（TextItem 与 placement=body 的字段，按 items 顺序）。"""
    found: list[str] = []
    for item in items(document, section_key, entry_index):
        if item.get("kind") == "text":
            if not item.get("hidden"):
                found.append(item_text(item))
        elif item.get("placement") == "body":
            found.append(display_value(item))
    return found


def has_custom_field(content: Any, label: str, value: str) -> bool:
    """content 里是否有 label/value 匹配的自定义字段（v2 item 或 v1 承载区「标签：值」文本）。

    D6/§17.3：自定义字段的位置以资料定义 hint 为准（短字段 trail / 多行 body / 仅素材
    hidden），所以断言"字段补回来了"不能只看正文行——这里两种形态都认。
    """
    document = as_document(content)
    needle = f"{label}：{value}"
    for _section, _entry, item in walk_items(document):
        if (
            item.get("kind") == "field"
            and item.get("label") == label
            and item.get("value") == value
        ):
            return True
        if item.get("kind") == "text" and needle in str(item.get("text") or ""):
            return True
    return False


def legacy_projection(out: Any) -> Any:
    """投影响应的 content 是 v2 dict；把 out.content 换成 v1 分析视图（供旧断言口径读）。"""
    out.content = legacy_of(out.content)
    return out


def item_path(document: Any, key: str, item_key: str, entry_index: int = 0) -> str:
    """item 的稳定路径（section_key.entry_id.item_id，与 planner 的 path 同口径）。"""
    entry = require_entry(document, key, entry_index)
    item = require_field(entry, item_key)
    return f"{key}.{entry.get('id') or ''}.{item.get('id') or ''}"


# ===== planner 纸面文本（隐藏项不会出现） =====


def document_text(content: Any) -> str:
    """v2 文档按 planner 展平成纯文本（"字段值确实在纸面上"的断言用）。"""
    document = content if isinstance(content, ResumeDocument) else as_document(content)
    return "\n".join(plan_to_text(build_document_plan(document)))


# ===== HTTP 响应便捷入口 =====


def response_document(response: Any) -> dict:
    """从详情/保存接口响应里取 v2 content（断言 2xx 后按 v2 解析）。"""
    assert response.status_code in (200, 201), getattr(response, "text", "")
    payload = response.json()
    return as_document(payload.get("content", payload))


def stored_document(client: Any, resume_id: int) -> dict:
    """GET /api/resumes/{id} 读回存储的 v2 content。"""
    return response_document(client.get(f"/api/resumes/{resume_id}"))
