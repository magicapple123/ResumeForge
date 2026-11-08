# SPDX-License-Identifier: Apache-2.0
"""由冻结的 `ConsumedProfile` 构建稳定 RAG chunk 与 `canonical_item_hash` 桥接表。

**为什么不能只靠 `entry_id` 或列表下标**（计划 §3.2）：`build_consumed_data()` 经
`_legacy_entry()` 只产出模型字段，`entry_id` / `field_id` 已丢失；`_select_entries()` 又先
按 `SECTION_PRIMARY_FIELDS` 过滤空主字段再 enumerate，过滤后下标与 `ConsumedEntry` 顺序不
对齐。所以 chunk 必须直接从 `ConsumedProfile.sections[key].entries` 构建，并产出双向桥接表：

    canonical_item_hash = sha256(section_key + "\\x1f" + canonical_json(下游 item))

`canonical_json` 取下游实际会看到的那个 dict（`build_consumed_data()` 的 item；键序与 JSON
格式空白不影响 hash），不是 `display_text`。`display_text` 只由模型输入白名单投影生成：
先 `build_consumed_data()` 再 `build_llm_profile_prompt_data()`，private /
`llm_allowed=False` 的字段值不会出现。自建分区（`custom:<id>`）不在 builder 表里，主文本只认
`paper_policy.custom_section_text_field()`（计划 §3.1 的唯一来源，不猜别的字段），桥接的
"下游 item"用下游自建板块实际使用的 `custom_entry_corpus()`。

**确定性**：chunk 顺序 = 参与分区顺序（`section_order`，`participating_keys` 补齐）+ 条目原始
顺序；不读时钟 / 随机 / PID，同一输入两次构建逐字段一致。只读消费快照，形状与 builders 不一致
时跳过该分区（RAG 是派生数据，不能反过来阻断生成链）。
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable, Iterator, Mapping
from types import MappingProxyType
from typing import Any

from ...schemas.profile_projection import ConsumedEntry, ConsumedProfile, ConsumedSection
from ..profile.paper_policy import custom_section_text_field
from ..profile.profile_context import build_consumed_data, build_llm_profile_prompt_data
from ..profile.profile_custom_filter import custom_entry_corpus
from ..profile.profile_relevance_constants import (
    SECTION_PRIMARY_FIELDS,
    is_custom_section_key,
)
from .rag_types import ChunkingResult, RagChunk

_HASH_SEPARATOR = "\x1f"
_HEADER_SEPARATOR = "｜"
_WHITESPACE_RE = re.compile(r"\s+")


def _clean(value: Any) -> str:
    return str(value or "").strip()


def canonical_item_hash(section_key: str, item: Mapping[str, Any]) -> str:
    """下游 item 的规范哈希：键序 / JSON 格式空白不影响，任何字段值变化都会变。

    公式必须与下游（`_select_entries` / custom filter）逐字一致，否则 boost 会大面积
    失配——所以这里不 strip、不规范化值，只做 `sort_keys` 的 JSON 序列化。
    """
    canonical_json = json.dumps(dict(item), ensure_ascii=False, sort_keys=True)
    payload = f"{section_key}{_HASH_SEPARATOR}{canonical_json}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_text(text: str) -> str:
    """展示文本的规范形式：NFKC + 合并空白 + casefold（稳定 hash / 去重共用）。"""
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().casefold()


def _ordered_section_keys(consumed: ConsumedProfile) -> list[str]:
    """参与分区的确定性顺序：`section_order` 优先，`participating_keys` 补齐。"""
    participating = set(consumed.participating_keys)
    keys = (*consumed.section_order, *consumed.participating_keys)
    return list(dict.fromkeys(key for key in keys if key in participating))


def _item_list(
    data: Mapping[str, Any], section_key: str, expected: int
) -> list[dict[str, Any]] | None:
    """取下游投影里的同序号 item 列表；数量/形状不一致返回 None（该分区跳过）。"""
    items = data.get(section_key)
    if not isinstance(items, list) or len(items) != expected:
        return None
    if not all(isinstance(item, dict) for item in items):
        return None
    return items


def _allowed_field_ids(section: ConsumedSection, entry: ConsumedEntry) -> tuple[str, ...]:
    """进入展示/embedding 的字段 id（llm_allowed 且非 private、值非空，定义顺序）。"""
    return tuple(
        spec.field_id
        for spec in section.fields
        if spec.llm_allowed and not spec.private and _clean(entry.values.get(spec.field_id, ""))
    )


def _flatten_projected(value: Any) -> Iterator[str]:
    """把白名单投影值压成可读行；`{label, value}` 行用「标签：值」（投影里已有的形态）。"""
    if isinstance(value, str):
        if value.strip():
            yield value.strip()
    elif isinstance(value, Mapping):
        label = _clean(value.get("label", ""))
        item_value = value.get("value", "")
        if label and isinstance(item_value, str) and item_value.strip():
            yield f"{label}：{item_value.strip()}"
            return
        for nested in value.values():
            yield from _flatten_projected(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            yield from _flatten_projected(nested)


def _display_text(section_name: str, primary: str, body: Iterable[str]) -> str:
    """分区名 + 条目标识（主字段值）+ 白名单投影值逐行；全空条目返回空串。"""
    lines = list(body)
    if not primary and not lines:
        return ""
    header = f"{section_name}{_HEADER_SEPARATOR}{primary}" if primary else section_name
    return "\n".join([header, *lines])


#: (条目在分区内的原始位置, 条目, 下游 item, display_text)
_Prepared = tuple[int, ConsumedEntry, Mapping[str, Any], str]


def _prepare_entries(
    section: ConsumedSection,
    raw_data: Mapping[str, Any],
    projected_data: Mapping[str, Any],
) -> list[_Prepared]:
    """条目 → (原始位置, entry, 下游 item, display_text)；主字段为空/全空的丢弃。"""
    entries = section.entries
    custom = is_custom_section_key(section.key)
    raw_items: list[dict[str, Any]] = []
    projected_items: list[dict[str, Any]] = []
    primary_key: str | None = None
    if not custom:
        raw_items = _item_list(raw_data, section.key, len(entries)) or []
        projected_items = _item_list(projected_data, section.key, len(entries)) or []
        primary_key = SECTION_PRIMARY_FIELDS.get(section.key)
        if not entries or not raw_items or not projected_items or primary_key is None:
            return []
    primary_field_id = custom_section_text_field(section) if custom else None
    prepared: list[_Prepared] = []
    for order, entry in enumerate(entries):
        if custom:
            raw_item: Mapping[str, Any] = custom_entry_corpus(section, entry)
            primary = _clean(entry.values.get(primary_field_id, "")) if primary_field_id else ""
            if primary_field_id is not None and not primary:
                continue  # 显式主文本字段没值：与内置分区同口径丢弃
            body = [
                f"{spec.label}：{value}" if spec.label else value
                for spec in section.fields
                if spec.field_id != primary_field_id and spec.llm_allowed and not spec.private
                for value in (_clean(entry.values.get(spec.field_id, "")),)
                if value
            ]
        else:
            raw_item = raw_items[order]
            projected_item = projected_items[order]
            # 与 _select_entries 同一口径：主字段为空的条目下游同样会被过滤掉；这里按
            # entries 原始位置取 raw item，桥接表不会整体错一位。
            if not _clean(raw_item.get(primary_key or "", "")):
                continue
            primary = _clean(projected_item.get(primary_key or "", ""))
            body = [
                line
                for key, value in projected_item.items()
                if key != primary_key
                for line in _flatten_projected(value)
            ]
        display = _display_text(section.name, primary, body)
        if display:
            prepared.append((order, entry, raw_item, display))
    return prepared


def build_chunks(consumed: ConsumedProfile, *, dataset_id: str = "") -> ChunkingResult:
    """从冻结消费快照构建 chunk 与双向桥接表；同一输入两次调用逐字段一致。

    `dataset_id` 留给调用方拼索引/缓存键：chunk 内容与数据集无关，所以它不参与
    hash、也不进 `RagChunk`；数据集隔离由 `RagScope` 表达（计划 §4.1 缓存键）。
    """
    raw_data = build_consumed_data(consumed)
    projected_data = build_llm_profile_prompt_data(raw_data)
    chunks: list[RagChunk] = []
    canonical_by_entry: dict[tuple[str, str], str] = {}
    entry_by_canonical: dict[str, tuple[str, str]] = {}
    for section_order, section_key in enumerate(_ordered_section_keys(consumed)):
        section = consumed.sections.get(section_key)
        if section is None or section.form == "singleton":
            continue
        for entry_order, entry, raw_item, display in _prepare_entries(
            section, raw_data, projected_data
        ):
            canonical_hash = canonical_item_hash(section_key, raw_item)
            normalized = _normalize_text(display)
            chunks.append(
                RagChunk(
                    chunk_id=f"{section_key}:{entry.entry_id}",
                    section_key=section_key,
                    section_name=section.name,
                    entry_id=entry.entry_id,
                    field_ids=_allowed_field_ids(section, entry),
                    display_text=display,
                    normalized_text=normalized,
                    content_hash=hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
                    canonical_item_hash=canonical_hash,
                    section_order=section_order,
                    entry_order=entry_order,
                )
            )
            canonical_by_entry[(section_key, entry.entry_id)] = canonical_hash
            entry_by_canonical.setdefault(canonical_hash, (section_key, entry.entry_id))
    return ChunkingResult(
        chunks=tuple(chunks),
        canonical_by_entry=MappingProxyType(canonical_by_entry),
        entry_by_canonical=MappingProxyType(entry_by_canonical),
    )


def dedupe_chunks_by_entry(chunks: Iterable[RagChunk]) -> tuple[RagChunk, ...]:
    """同一 `(section_key, entry_id)` 只保留 `(section_order, entry_order)` 最小的那条。

    保序去重（输出顺序同输入）；平局保留先出现的那条。一个 entry 最多贡献一个候选，
    对应计划 §3.2「同一条目跨 chunk 的去重在这张表上做」。
    """
    ordered = list(chunks)
    best_index: dict[tuple[str, str], int] = {}
    for index, chunk in enumerate(ordered):
        key = (chunk.section_key, chunk.entry_id)
        current = best_index.get(key)
        if current is None or (chunk.section_order, chunk.entry_order) < (
            ordered[current].section_order,
            ordered[current].entry_order,
        ):
            best_index[key] = index
    return tuple(
        chunk
        for index, chunk in enumerate(ordered)
        if best_index[(chunk.section_key, chunk.entry_id)] == index
    )


__all__ = ["build_chunks", "canonical_item_hash", "dedupe_chunks_by_entry"]
