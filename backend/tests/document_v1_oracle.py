# SPDX-License-Identifier: Apache-2.0
"""Frozen pre-phase4 regression oracle for historical profile projection assertions.

Test-only: no runtime consumer imports this module. Keeping the original expected
slot values makes converter/generation regressions visible while production only
reads native document nodes. New document behavior tests use native selectors.
"""

from __future__ import annotations

from typing import Any

from app.schemas.resume import ResumeContent
from app.schemas.resume_custom_sections import (
    ResumeCustomEntry,
    ResumeCustomLine,
    ResumeCustomSection,
)
from app.schemas.resume_document import (
    AuthorsItem,
    FieldItem,
    ListItem,
    ResumeDocument,
    ResumeEntry,
    ResumeSection,
    TextItem,
    parse_document,
)
from app.schemas.resume_research import ResumeAuthor
from app.services.resume import document_catalog as catalog
from app.services.resume.document_conversion_types import ConversionError
from app.services.resume.document_identity import is_object_id

__all__ = ["historical_values"]

#: 正文列表型属性（v1 模型里是 list[str]）：TextItem 与 body 字段都会回填到这里。
_LIST_ATTRS: dict[str, tuple[str, ...]] = {
    "education": ("courses", "achievements"),
    "experience": ("description",),
    "projects": ("tech_stack", "description", "highlights"),
    "campus_experience": ("description",),
    "research_projects": ("description", "outcomes"),
}

#: 正文承载区属性（v1 模型里是 list[str]；body 文本按行回填，顺序保持）。
_CARRIER_ATTR: dict[str, str] = {
    "education": "achievements",
    "experience": "description",
    "projects": "description",
    "campus_experience": "description",
    "research_projects": "description",
    "awards": "description",
}

#: 作者型属性（v1 模型里是 list[ResumeAuthor]）。
_AUTHOR_ATTRS: dict[str, tuple[str, ...]] = {
    "publications": ("authors",),
    "patents": ("inventors",),
}

_HEADER_ATTRS = {
    "name": "name",
    "gender": "gender",
    "job_intent": "job_intent",
    "phone": "phone",
    "email": "email",
    "city": "city",
    "birth_year": "birth_year",
    "github": "github",
    "personal_website": "personal_website",
    "photo": "photo",
}


def historical_values(content: Any) -> ResumeContent:
    """v2 文档（模型或 dict）-> v1 ResumeContent；v1 输入原样校验返回。"""
    if isinstance(content, ResumeContent):
        return content
    if isinstance(content, ResumeDocument):
        return _from_document(content)
    if not isinstance(content, dict):
        raise ConversionError("简历内容必须是对象")
    if content.get("version") != 2:
        try:
            return ResumeContent.model_validate(content)
        except Exception as exc:
            raise ConversionError("旧版简历内容结构不合法：" + str(exc)) from exc
    return _from_document(parse_document(content))


def _from_document(document: ResumeDocument) -> ResumeContent:
    raw: dict[str, Any] = {}
    for item in document.header.items:
        attr = _HEADER_ATTRS.get(item.key)
        if attr is None or not str(item.value or "").strip():
            continue
        raw[attr] = item.value
    custom_sections: list[dict[str, Any]] = []
    for section in document.sections:
        if catalog.section_spec(section.key) is None:
            custom = _legacy_custom_section(section)
            if custom is not None:
                custom_sections.append(custom.model_dump())
            continue
        if section.kind == "text":
            raw["summary"] = _section_text(section)
        elif section.kind == "inline":
            _inline_entries(section, raw)
        else:
            _entries_into(raw, section)
    if custom_sections:
        raw["custom_sections"] = custom_sections
    try:
        return ResumeContent.model_validate(raw)
    except Exception as exc:
        raise ConversionError("v2 -> v1 分析视图失败：" + str(exc)) from exc


def _entries_into(raw: dict[str, Any], section: ResumeSection) -> None:
    values: list[dict[str, Any]] = []
    for entry in section.entries:
        if entry.hidden:
            continue
        values.append(_entry_values(section, entry))
    if not values:
        return
    raw[_V1_ENTRY_ATTR[section.key]] = values


_V1_ENTRY_ATTR = {
    "education": "education",
    "experience": "experience",
    "projects": "projects",
    "campus_experience": "campus_experience",
    "awards": "awards",
    "publications": "publications",
    "research_projects": "research_projects",
    "patents": "patents",
    "credentials": "credentials",
}


def _entry_values(section: ResumeSection, entry: ResumeEntry) -> dict[str, Any]:
    values: dict[str, Any] = {}
    if entry.id:
        values["id"] = entry.id
    # 可见性与锁标记是**服务端状态**，不是纸面内容：分析算法（事实锁/正文锁回填、
    # 可见性过滤、大纲）必须能看见它们，否则 AI 改写一次锁就被静默抹掉。
    for flag in ("hidden", "lock_content", "lock_layout"):
        if getattr(entry, flag, False):
            values[flag] = True
    list_attrs = set(_LIST_ATTRS.get(section.key, ()))
    author_attrs = set(_AUTHOR_ATTRS.get(section.key, ()))
    body_lines: list[str] = []
    # 与 body_lines 同步收集 TextItem 的稳定 id：v1 的 point_ids 用于事实锁/来源锚点。
    body_points: list[str] = []
    for item in entry.items:
        if isinstance(item, TextItem):
            if not item.hidden:
                body_lines.append(item.text)
                body_points.append(str(item.id or ""))
            continue
        if item.placement == "hidden":
            continue
        if isinstance(item, AuthorsItem):
            attr = item.key if item.key in author_attrs else ""
            if attr:
                values[attr] = [
                    ResumeAuthor(
                        name=author.name,
                        is_self=author.is_self,
                        corresponding=author.corresponding,
                    ).model_dump()
                    for author in item.authors
                ]
            continue
        if isinstance(item, ListItem):
            attr = item.key if item.key in list_attrs else item.key
            if attr in list_attrs:
                values[attr] = list(item.values) + list(item.hidden_values)
            else:
                body_lines.append(_label_value(item, item.join, section.key))
            continue
        _apply_scalar(values, section.key, item, list_attrs, body_lines)
    carrier = _CARRIER_ATTR.get(section.key)
    if body_lines:
        if section.key == "awards":
            values[carrier or "description"] = "\n".join(body_lines)
        elif carrier in list_attrs or carrier is not None:
            values[carrier] = body_lines
            # point_ids 只在 id 全部合法时回填（长度/身份必须一一对应，否则宁可不锚）。
            if carrier in list_attrs and all(is_object_id(point) for point in body_points):
                values["point_ids"] = {carrier: body_points}
    return values


def _apply_scalar(
    values: dict[str, Any],
    section_key: str,
    item: FieldItem,
    list_attrs: set[str],
    body_lines: list[str],
) -> None:
    key = item.key
    if key == "period" and item.format == "date_range":
        start, _, end = str(item.value or "").partition("|")
        values["start_date"] = start.strip()
        values["end_date"] = end.strip()
        return
    if item.placement == "body":
        body_lines.append(_label_value(item, "semicolon", section_key))
        return
    if key in list_attrs:
        values[key] = [item.value]
        return
    values[key] = item.value


def _label_value(item: Any, join: str, section_key: str) -> str:
    label = str(getattr(item, "label", "") or "").strip()
    if isinstance(item, ListItem):
        separator = "；" if join == "semicolon" else "、"
        text = separator.join(item.values)
    else:
        text = str(item.value or "")
    if label:
        return label + "：" + text
    return text


def _section_text(section: ResumeSection) -> str:
    lines: list[str] = []
    for entry in section.entries:
        for item in entry.items:
            if isinstance(item, TextItem) and not item.hidden:
                lines.append(item.text)
            elif isinstance(item, FieldItem) and item.placement == "body":
                lines.append(str(item.value))
    return "\n".join(line for line in lines if line.strip())


def _inline_entries(section: ResumeSection, raw: dict[str, Any]) -> None:
    attr = "skills" if section.key == "skills" else "languages"
    rows: list[dict[str, Any]] = []
    for entry in section.entries:
        if entry.hidden:
            continue
        # 分析算法（内容相关提示等）按稳定 id 定位到条目：视图必须把它带出来。
        row: dict[str, Any] = {"id": entry.id} if entry.id else {}
        for item in entry.items:
            if isinstance(item, TextItem):
                continue
            if item.placement == "hidden":
                continue
            key = item.key
            if isinstance(item, ListItem):
                row[key] = "；".join(item.values)
            else:
                row[key] = item.value
        if row:
            rows.append(row)
    if rows:
        raw[attr] = rows


def _legacy_custom_section(section: ResumeSection) -> ResumeCustomSection | None:
    entries: list[ResumeCustomEntry] = []
    title = str(section.title or "").strip()
    key = str(section.key or "").strip()
    if not title or not key:
        return None
    for entry in section.entries:
        if entry.hidden:
            continue
        texts: list[str] = []
        lines: list[ResumeCustomLine] = []
        for item in entry.items:
            if isinstance(item, TextItem):
                if not item.hidden:
                    texts.append(item.text)
                continue
            if item.placement == "hidden":
                continue
            label = str(getattr(item, "label", "") or "").strip()
            if not label:
                continue
            value = (
                "；".join(item.values)
                if isinstance(item, ListItem)
                else str(getattr(item, "value", "") or "")
            )
            if value:
                lines.append(ResumeCustomLine(label=label, value=value))
        if not texts and not lines:
            continue
        entries.append(
            ResumeCustomEntry(
                entry_id=str(entry.id or "")[:32],
                text="\n".join(texts),
                lines=lines,
            )
        )
    if not entries:
        return None
    return ResumeCustomSection(key=key[:64], title=title[:40], entries=entries)
