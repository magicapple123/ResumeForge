# SPDX-License-Identifier: Apache-2.0
"""v1 -> v2 转换里的自定义字段部分：承载区「标签：值」行解析、自建分区、页眉/总结。

从 document_converter_sections 拆出的唯一原因是单文件 500 行预算；两部分是同一实现的
两半：sections 负责"默认字段 -> item"，本模块负责"用户自定义字段 / 页眉 / 总结"。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ...schemas.resume_document import (
    FieldItem,
    FieldSource,
    HeaderItem,
    Placement,
    ResumeItem,
    TextItem,
)
from . import document_catalog as catalog
from .document_conversion_types import ConversionReport, CustomFieldHint, stable_object_id

__all__ = [
    "build_custom_section_items",
    "build_header_items",
    "extract_custom_field_items",
    "summary_items",
]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _valid_id(value: Any) -> str | None:
    text = _text(value)
    return text or None


#: 正文承载区板块：这些分区里识别出的「标签：值」行默认落到 body（计划 §7.3：
#: 列表承载体默认 body bullet；awards/publications/credentials 的标量 note 默认 trail）。
_BODY_CARRIER_SECTIONS = frozenset(
    {"education", "experience", "campus_experience", "projects", "research_projects"}
)


def _split_label_line(text: str) -> tuple[str, str] | None:
    """把「标签：值」拆成 (标签, 值)；不是这个形状返回 None（保守，不做正则猜测）。"""
    raw = str(text or "")
    for separator in ("：", ":"):
        index = raw.find(separator)
        if index > 0:
            label = raw[:index].strip()
            value = raw[index + 1 :].strip()
            if label and value and len(label) <= 40:
                return label, value
    return None


def extract_custom_field_items(
    items: Sequence[ResumeItem],
    section_key: str,
    hints: Sequence[CustomFieldHint],
    report: ConversionReport,
) -> list[ResumeItem]:
    """把正文文本块里命中自定义字段标签的行改成 FieldItem（计划 §7.3）。

    - 只认带资料定义的标签；同名标签只取第一行，后续行保留为文本并写 warning；
    - 放在 body 的自定义长文本用 paragraph 块 + 显示标签；短字段默认 trail；
    - 仅素材字段（material_only）转成 hidden（数据保留，不上纸面）。
    """
    hint_map = {_text(hint.label): hint for hint in hints if _text(hint.label)}
    result: list[ResumeItem] = []
    claimed: set[str] = set()
    for item in items:
        if not isinstance(item, TextItem) or item.hidden:
            result.append(item)
            continue
        split = _split_label_line(item.text)
        hint = hint_map.get(split[0]) if split else None
        if hint is None:
            result.append(item)
            continue
        label = split[0]
        if label in claimed:
            report.warn(section_key + "：自定义字段「" + label + "」出现多次，后续行保留为正文文本")
            result.append(item)
            continue
        placement = _hint_placement(hint)
        # 自定义字段的位置以资料定义（D6：短文本/日期/枚举 -> trail，多行 -> body，
        # 仅素材 -> hidden）为准；只有定义缺失时才按承载区类型兜底。**不能**因为是
        # "承载区里的行"就一律改 body——那会把用户在资料页选的 trail 短字段吞掉，
        # 且违反验收「自定义短字段在 trail / 长文本在 body」。
        body_style = "paragraph" if hint.field_type == "multi_line" else "bullet"
        result.append(
            FieldItem(
                id=item.id or stable_object_id("it_", section_key, label),
                key="custom:" + (hint.field_id or label),
                label=label,
                value=split[1],
                placement=placement,
                format=_hint_format(hint),
                show_label=True,
                body_style=body_style,
                source=FieldSource(section_key=hint.section_key, field_id=hint.field_id),
            )
        )
        claimed.add(label)
        report.fields_recognized += 1
        report.custom_fields_recorded += 1
    return result


def _hint_placement(hint: CustomFieldHint) -> Placement:
    if hint.material_only:
        return "hidden"
    placement = _text(hint.default_placement)
    if placement in ("title", "meta", "lead", "trail", "body", "hidden"):
        return placement  # type: ignore[return-value]
    return catalog.custom_field_placement(hint.field_type)


def _hint_format(hint: CustomFieldHint) -> str:
    if hint.field_type == "date_text":
        return "date"
    if hint.field_type == "enum":
        return "enum"
    if hint.field_type == "number":
        return "number"
    return "text"


def build_header_items(content: Any, report: ConversionReport) -> list[HeaderItem]:
    """v1 页眉标量 -> v2 HeaderItem（顺序固定：姓名/性别/意向/联系方式/照片）。"""
    items: list[HeaderItem] = []
    for spec in catalog.HEADER_FIELDS:
        value = getattr(content, spec.key, "")
        if spec.key == "photo":
            photo = _text(value)
            if not photo:
                continue
            items.append(
                HeaderItem(
                    id=stable_object_id("hd_", "header", spec.key),
                    key=spec.key,
                    value=photo,
                    placement="photo",
                    format="text",
                )
            )
            report.fields_recognized += 1
            continue
        text = _text(value)
        if not text:
            continue
        items.append(
            HeaderItem(
                id=stable_object_id("hd_", "header", spec.key),
                key=spec.key,
                value=text,
                placement=spec.placement,
                format=spec.fmt,
            )
        )
        report.fields_recognized += 1
    return items


def summary_items(summary: str, report: ConversionReport) -> list[ResumeItem]:
    """v1 summary -> 一个 paragraph TextItem（原文整段保留，不拆不改写）。"""
    text = str(summary or "").strip()
    if not text:
        return []
    report.lines_preserved += 1
    return [
        TextItem(
            id=stable_object_id("pt_", "summary", "content"),
            style="paragraph",
            text=text,
        )
    ]


def build_custom_section_items(
    entry: Any,
    report: ConversionReport,
    hints: Sequence[CustomFieldHint] | None = None,
    scope: str = "",
) -> list[ResumeItem]:
    """v1 自建分区的一条（text + lines）-> v2 items（主文本 body / 行字段 trail）。"""
    items: list[ResumeItem] = []
    hint_map = {_text(hint.label): hint for hint in hints or () if _text(hint.label)}
    text = _text(getattr(entry, "text", ""))
    if text:
        items.append(
            TextItem(
                # 条目 id 是条目级身份，不能再给文本项复用（否则 normalize 判重复后
                # 生成随机 id，转换就不确定了）；文本项 id 由 scope 稳定派生。
                id=stable_object_id("pt_", "custom", scope, "text"),
                style="paragraph",
                text=text,
            )
        )
        report.lines_preserved += 1
    for line in getattr(entry, "lines", None) or ():
        label = _text(getattr(line, "label", ""))
        value = _text(getattr(line, "value", ""))
        if not label or not value:
            continue
        hint = hint_map.get(label)
        if hint is not None:
            placement = _hint_placement(hint)
            fmt = _hint_format(hint)
            body_style = "paragraph" if hint.field_type == "multi_line" else "bullet"
            key = "custom:" + (hint.field_id or label)
            source: FieldSource | None = FieldSource(
                section_key=hint.section_key, field_id=hint.field_id
            )
            report.custom_fields_recorded += 1
        else:
            placement = "trail"
            fmt = "text"
            body_style = "bullet"
            key = "custom:" + label
            source = None
        items.append(
            FieldItem(
                id=stable_object_id("it_", "custom", scope, label),
                key=key,
                label=label,
                value=value,
                placement=placement,
                format=fmt,
                body_style=body_style,
                show_label=True,
                source=source,
            )
        )
        report.fields_recognized += 1
    return items
