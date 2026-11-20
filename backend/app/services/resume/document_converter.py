# SPDX-License-Identifier: Apache-2.0
"""v1 ResumeContent -> v2 ResumeDocument 转换器与读时版本收口（D11/D12）。

**调用面只有一个**：所有读取简历 content 的入口（详情/render/export/AI/bilingual/history）
统一走 ensure_document_version(content)：v2 直接校验/归一化，v1 走 convert_content 转换
（不写库）；保存时写 v2。幂等：v2 再转不变。

**文字不丢**的保证：convert_content 只做"识别为 item"或"保留为文本块"两种处理；
无法识别的内容一律 TextItem，并在 ConversionReport 里记明细（多少字段识别、多少行保留、
哪些分区为空、哪些警告）。

已存文档的分析直接读取 v2 节点。本模块不 import API/DB/渲染，纯函数可单测。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...schemas.resume import ResumeContent
from ...schemas.resume_document import (
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeSection,
    TextItem,
    document_to_json,
    normalize_document,
    parse_document,
)
from ...schemas.resume_entries import MAX_RESUME_LIST_ITEMS
from . import document_catalog as catalog
from .document_conversion_types import (
    ConversionError,
    ConversionReport,
    CustomFieldHint,
    stable_object_id,
)
from .document_converter_custom import (
    build_custom_section_items,
    build_header_items,
    summary_items,
)
from .document_converter_layout import (  # noqa: F401  (_apply_field_layout 使用；常量保留旧属性)
    FIELD_LAYOUT_SECTIONS,
    _apply_field_layout,
)
from .document_converter_sections import build_entry_items, hints_by_doc_section
from .resume_contact import validate_contact_breaks
from .resume_labels import normalize_language
from .resume_sections import normalized_section_order

__all__ = [
    "ConversionError",
    "ConversionReport",
    "CustomFieldHint",
    "convert_content",
    "ensure_document_version",
    "ensure_document_version_with_report",
]

#: 照片页眉字段的固定位置（5.3：前端已删掉照片的「位置」下拉，语义恒为 photo）。
_PHOTO_HEADER_KEY = "photo"
#: 「位置下拉」留下、但任何渲染方都不认照片的四种死值。**不含 contact**——那个是
#: I-02 的重复照片守卫刻意保留的状态，见 `_normalize_photo_placement` 的说明。
_PHOTO_STALE_PLACEMENTS = frozenset({"hidden", "name", "name_meta", "subtitle"})

#: v2 分区 key -> v1 ResumeContent 的列表属性名。
_V1_LIST_ATTRS: dict[str, str] = {
    "education": "education",
    "experience": "experience",
    "projects": "projects",
    "campus_experience": "campus_experience",
    "awards": "awards",
    "publications": "publications",
    "research_projects": "research_projects",
    "patents": "patents",
    "credentials": "credentials",
    "skills": "skills",
    "languages": "languages",
}


def _normalize_photo_placement(document: dict) -> dict:
    """把照片页眉字段的位置收敛为常量 ``"photo"``（5.3；幂等）。

    **为什么放在这里**：``ensure_document_version_with_report`` 是读与写共同的唯一上游——
    读侧 ``document_io.document_for_record``（详情/render/export/AI/双语/历史）与
    ``document_io.document_or_422``（预览/导出/预检）都经过它，写侧
    ``prepare_document_for_save*`` 也经过它。只改写入库、不改读侧，会让"还没保存的文档"
    与库里产物的形状不一致；放在别处则要维护第二份调用点。

    **为什么必须归一，而不是让渲染层忽略**：后端有二十多处 ``placement == "hidden"``
    的消费方（document_html / document_plan_rows / document_analysis / document_view /
    bilingual_variants …），导出是服务端从库里的文档重渲。前端"假装它是 photo"只会得到
    "预览有照片、导出没有"。

    **为什么排除 ``contact``**：I-02 那条缺陷（页眉 hide→show 把位置写死成 contact）走的是
    另一套机制——读侧 planner 只看 data URI 前缀就当照片、写侧
    ``_heal_header_photo_placements`` 在 `header.photo` 空着时才认领，且"已有照片时不抢占"
    正靠这条 contact 状态。把它们一起扫成 photo 会让两张照片同时 placement=photo，
    后者按"最后一个赢"覆盖前者。``hidden`` / ``name`` / ``name_meta`` / ``subtitle``
    这四种才是"位置下拉"留下的、任何渲染方都不认照片的死值。

    只动 ``key == "photo"`` 的字段：姓名、姓名旁小字、求职意向、联系方式的 placement
    各有语义，不能一起扫平。已经是 ``photo`` 的原样返回，不加任何键——幂等，且旧文档
    的字节不变。
    """
    header = document.get("header")
    if not isinstance(header, dict):
        return document
    items = header.get("items")
    if not isinstance(items, list):
        return document
    for item in items:
        if not isinstance(item, dict) or item.get("key") != _PHOTO_HEADER_KEY:
            continue
        if item.get("placement") in _PHOTO_STALE_PLACEMENTS:
            item["placement"] = "photo"
    return document


def ensure_document_version_with_report(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> tuple[dict, ConversionReport | None]:
    """把任意版本的 content 收口成 v2 dict；返回 (document dict, 转换报告或 None)。

    报告为 None 表示本来就是 v2（没有发生转换）——API 用它决定要不要提示"已升级"。
    三个出口都过 ``_normalize_photo_placement``：照片的位置只可能是 ``"photo"``（5.3）。
    """
    if isinstance(content, ResumeDocument):
        return _normalize_photo_placement(document_to_json(normalize_document(content))), None
    if not isinstance(content, dict):
        raise ConversionError("简历内容必须是对象")
    if content.get("version") == 2:
        return _normalize_photo_placement(document_to_json(parse_document(content))), None
    document, report = convert_content(
        content,
        language=language or "zh-CN",
        format_config=format_config,
        custom_fields=custom_fields,
    )
    return _normalize_photo_placement(document_to_json(document)), report


def ensure_document_version(
    content: Any,
    *,
    language: str | None = None,
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> dict:
    """v2 直通 / v1 转换后的 v2 dict（幂等；读路径统一入口）。"""
    return ensure_document_version_with_report(
        content, language=language, format_config=format_config, custom_fields=custom_fields
    )[0]


def convert_content(
    content: Any,
    *,
    language: str = "zh-CN",
    format_config: Mapping[str, Any] | None = None,
    custom_fields: Mapping[str, Sequence[CustomFieldHint | Mapping[str, Any]]] | None = None,
) -> tuple[ResumeDocument, ConversionReport]:
    """把 v1 ResumeContent（模型或 dict）转成 v2 文档 + 报告；结构非法抛 ConversionError。"""
    legacy = _coerce_legacy(content)
    report = ConversionReport()
    hints = hints_by_doc_section(custom_fields)
    config = dict(format_config) if isinstance(format_config, Mapping) else {}
    header = ResumeHeader(
        items=build_header_items(legacy, report),
        contact_breaks=validate_contact_breaks(config.get("contact_breaks")),
    )
    sections = _convert_sections(legacy, hints, report)
    _apply_field_layout(sections, config)
    ordered = _ordered_sections(sections, config)
    document = ResumeDocument(
        language=normalize_language(language),
        header=header,
        sections=ordered,
    )
    return normalize_document(document), report


def _coerce_legacy(content: Any) -> ResumeContent:
    if isinstance(content, ResumeContent):
        return content
    if not isinstance(content, Mapping):
        raise ConversionError("简历内容必须是对象")
    if content.get("version") == 2:
        raise ConversionError("已经是 v2 文档，不需要转换")
    try:
        return ResumeContent.model_validate(dict(content))
    except Exception as exc:  # pydantic ValidationError 消息对用户可读
        raise ConversionError("旧版简历内容结构不合法：" + str(exc)) from exc


def _convert_sections(
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> list[ResumeSection]:
    sections: list[ResumeSection] = []
    for spec in catalog.SECTION_ORDER:
        section = _convert_system_section(spec, legacy, hints, report)
        if section is not None:
            sections.append(section)
    sections.extend(_convert_custom_sections(legacy, hints, report))
    return sections


def _cap_items(items: list[Any], report: ConversionReport, section_key: str) -> list[Any]:
    """单条目 item 数超限时的兜底（计划 §3.4：截断 + warning，文字不丢）。

    v2 schema 的 ResumeEntry.items 有上限；旧数据（例如承载区被塞进 501 行）如果原样
    转成 item 会让整份文档校验失败。策略：超出部分若都是 TextItem，**合并成一个正文块**
    （文字一个不丢，只是不再逐行分条）；混合类型无法合并时截断并如实记 warning。
    """
    if len(items) <= MAX_RESUME_LIST_ITEMS:
        return items
    keep = list(items[: MAX_RESUME_LIST_ITEMS - 1])
    overflow = list(items[MAX_RESUME_LIST_ITEMS - 1 :])
    texts = [item for item in overflow if isinstance(item, TextItem)]
    other = [item for item in overflow if not isinstance(item, TextItem)]
    if texts and not other:
        # texts 里全是 TextItem（上面的 isinstance 筛过），style 一定存在。
        merged_style = texts[0].style
        keep.append(
            TextItem(
                style=merged_style,
                text="\n".join(str(item.text or "") for item in texts),
            )
        )
        report.warn(
            f"分区「{section_key}」的单条内容超过 {MAX_RESUME_LIST_ITEMS} 条："
            "超出部分已合并为一个正文块（文字保留，不再逐行分条）"
        )
        return keep
    report.warn(
        f"分区「{section_key}」的单条内容超过 {MAX_RESUME_LIST_ITEMS} 条："
        f"已截断保留前 {MAX_RESUME_LIST_ITEMS} 条（含非文本字段，无法安全合并），请精简后重新保存"
    )
    return keep[:MAX_RESUME_LIST_ITEMS]


def _convert_system_section(
    spec: Any,
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> ResumeSection | None:
    if spec.kind == "text":
        items = _cap_items(summary_items(getattr(legacy, "summary", ""), report), report, spec.key)
        if not items:
            return None
        entry = ResumeEntry(id=stable_object_id("ob_", spec.key, "entry"), items=items)
        return ResumeSection(key=spec.key, title="", kind="text", entries=[entry])
    entries: list[ResumeEntry] = []
    attr = _V1_LIST_ATTRS.get(spec.key)
    source_entries = list(getattr(legacy, attr, []) or []) if attr else []
    for index, legacy_entry in enumerate(source_entries):
        stable_entry_id = _entry_id(legacy_entry)
        scope = stable_entry_id or ("idx" + str(index))
        items = _cap_items(
            build_entry_items(spec.key, legacy_entry, report, hints, scope=scope),
            report,
            spec.key,
        )
        if not items:
            continue
        entries.append(
            ResumeEntry(
                id=stable_entry_id or stable_object_id("ob_", spec.key, scope),
                hidden=bool(getattr(legacy_entry, "hidden", False)),
                lock_content=bool(getattr(legacy_entry, "lock_content", False)),
                lock_layout=bool(getattr(legacy_entry, "lock_layout", False)),
                items=items,
            )
        )
    if not entries:
        if source_entries:
            report.empty_sections.append(spec.key)
            report.warn(
                "分区「"
                + spec.key
                + "」有 "
                + str(len(source_entries))
                + " 条旧数据但未产生纸面内容"
            )
        return None
    return ResumeSection(key=spec.key, title="", kind=spec.kind, entries=entries)


def _convert_custom_sections(
    legacy: ResumeContent,
    hints: Mapping[str, Sequence[CustomFieldHint]],
    report: ConversionReport,
) -> list[ResumeSection]:
    sections: list[ResumeSection] = []
    for legacy_section in getattr(legacy, "custom_sections", []) or []:
        key = str(getattr(legacy_section, "key", "") or "").strip()
        title = str(getattr(legacy_section, "title", "") or "").strip()
        if not key or not title:
            report.warn("自建分区缺少 key/title，已跳过（内容丢失风险需人工核对）")
            continue
        entries: list[ResumeEntry] = []
        for index, legacy_entry in enumerate(getattr(legacy_section, "entries", []) or []):
            stable_entry_id = _entry_id(legacy_entry, fallback_attr="entry_id")
            scope = stable_entry_id or ("idx" + str(index))
            items = _cap_items(
                build_custom_section_items(legacy_entry, report, hints.get(key), scope=scope),
                report,
                key,
            )
            if not items:
                continue
            entries.append(
                ResumeEntry(
                    id=stable_entry_id or stable_object_id("ob_", key, scope),
                    hidden=bool(getattr(legacy_entry, "hidden", False)),
                    items=items,
                )
            )
        if entries:
            sections.append(ResumeSection(key=key, title=title, kind="entries", entries=entries))
    return sections


def _entry_id(entry: Any, *, fallback_attr: str = "id") -> str | None:
    raw = str(getattr(entry, fallback_attr, "") or "").strip()
    if not raw:
        return None
    from .document_identity import is_object_id

    return raw if is_object_id(raw) else None


def _ordered_sections(
    sections: list[ResumeSection], format_config: Mapping[str, Any]
) -> list[ResumeSection]:
    """按 `format_config.section_order` 排分区。

    内置键沿用 `normalized_section_order`（七个键齐全、未知键按默认补齐）；
    #24：`custom:*` 键**按它在 section_order 里的位置**插入——用户在生成弹窗把
    自建板块拖到「项目经历」后面，落库的 `document.sections` 就是这个顺序，而不是
    一律排在末尾。raw 里没有 / 已不存在的 custom 键不产生空位；没被插进去的
    自建分区按出现顺序追加在末尾（与旧行为一致）。
    """
    by_key = {section.key: section for section in sections}
    raw_order = format_config.get("section_order")
    keys_in_order: list[str] = []
    if isinstance(raw_order, (list, tuple)):
        seen: set[str] = set()
        for item in raw_order:
            key = str(item).strip()
            if key and key not in seen:
                seen.add(key)
                keys_in_order.append(key)

    def rank(key: str) -> int:
        try:
            return keys_in_order.index(key)
        except ValueError:
            return len(keys_in_order)

    ordered: list[ResumeSection] = []
    placed: set[str] = set()

    def place_custom_before(builtin_key: str | None) -> None:
        """把 raw 顺序里排在 builtin_key 之前、还没落位的自建板块依次插入。"""
        while True:
            pending = [
                key
                for key in keys_in_order
                if key.startswith("custom:") and key in by_key and key not in placed
            ]
            nxt = next(
                (
                    key
                    for key in pending
                    if builtin_key is None or rank(key) < rank(builtin_key)
                ),
                None,
            )
            if nxt is None:
                return
            ordered.append(by_key.pop(nxt))
            placed.add(nxt)

    for key in normalized_section_order(raw_order):
        place_custom_before(key)
        section = by_key.pop(key, None)
        if section is not None:
            ordered.append(section)
            placed.add(key)
    place_custom_before(None)
    # 兜底：不在标准顺序里的系统分区（理论上不会发生）与其余自建分区按出现顺序追加。
    ordered.extend(by_key.values())
    return ordered

def _custom_before(custom_key: str, builtin_key: str | None, raw_order: Any) -> bool:
    """custom_key 在 raw section_order 里是否排在 builtin_key 之前（builtin 不在表里=最后）。"""
    if not isinstance(raw_order, (list, tuple)):
        return False
    keys = [str(item).strip() for item in raw_order]
    try:
        custom_at = keys.index(custom_key)
    except ValueError:
        return False
    if builtin_key is None:
        return True
    try:
        builtin_at = keys.index(builtin_key)
    except ValueError:
        return True
    return custom_at < builtin_at
