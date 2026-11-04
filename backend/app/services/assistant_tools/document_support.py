# SPDX-License-Identifier: Apache-2.0
"""简历文档工具的共用底座（#38）：取数、路径、人话标签、保存与撤销点。

拆出来是为了两个原因：``document_tools``（只读）与 ``document_write_tools``（写入）
都要用同一套"读记录 → 转 v2 → 解析路径 → 生成人话标签"的逻辑；而保存路径还要同时
做三件事（收口校验、留撤销点、条件写推进一版），写在一个地方才不会出现"某个写工具
忘了留档 / 忘了推进版本"。
"""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.versions import VERSION_SOURCE_ASSISTANT, ResumeVersion
from ...schemas.resume_document import new_object_id
from ...schemas.resume_generation import UNLIMITED_PAGE_LIMIT, mode_page_limit
from .. import trash
from ..resume import document_io
from ..resume.document_catalog import SECTION_CATALOG
from ..resume.document_paths import resolve_document_path
from ..resume.document_save import save_content
from ..resume.document_versions import layout_snapshot, params_sha256
from ..resume.document_view import entry_texts
from ..resume.resume_delivery import canonical_content_sha256, page_limit_or_default
from ..resume.resume_labels import (
    DEFAULT_RESUME_LANGUAGE,
    field_labels,
    normalize_language,
    section_title,
)
from ..resume.resume_record import record_format_config
from ..resume.resume_template_store import resolve_style_template
from ._shared import int_argument

# 分页报告的界面落点：工具结果必须指到**具体面板**（#38 判据），不能让模型自己猜。
PAGINATION_PANEL_NAME = "页面概览"
PAGINATION_PANEL_WHERE = "简历制作台左栏「版面」页签 → 点「获取分页报告」→「页面概览」"
MAX_VALUE_CHARS = 2_000
MAX_RESULT_CHARS = 6_000
ENTRY_LAYOUT_KEYS = ("head", "columns", "align", "gap", "start_on_new_page", "keep_together")


def record_or_error(db: Session, arguments: dict) -> ResumeRecord:
    resume_id = int_argument(arguments, "resume_id", "需要提供简历 id（可以先用 list_resumes 查）")
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        raise ValueError(f"简历 {resume_id} 不存在或已被删除")
    return record


def document_for(db: Session, record: ResumeRecord) -> dict:
    document, _report = document_io.document_for_record(db, record)
    return document


def render_settings(db: Session, record: ResumeRecord) -> dict:
    """助手工具看到的渲染设置。

    ``page_limit`` 在这里是**渲染上限**（``mode_page_limit`` 的结果，pdf_exporter 要一个
    正数 max_pages），``page_limit_is_unlimited`` 单独带出"用户选的是不限"这个语义：
    ``render_settings(record.page_limit or 1)`` 会把不限折成 1 页——助手于是告诉用户
    "上限 1 页"并把 PDF 真的裁到 1 页，这正好与用户的选择相反。
    """
    template, _html = resolve_style_template(db, record.template)
    page_limit_value = page_limit_or_default(record.page_limit)
    return {
        "template": template or record.template or "classic",
        "format_config": record_format_config(db, record) or {},
        "page_limit": mode_page_limit(page_limit_value, record.document_mode or "resume"),
        # 「不限篇幅」的语义（0）与折出来的渲染上限（10）是两件事，分开传。
        "page_limit_is_unlimited": page_limit_value == UNLIMITED_PAGE_LIMIT,
        "font_scale": record.font_scale or "standard",
        "language": normalize_language(record.language),
    }


def section_titles(document: dict) -> dict[str, str]:
    titles: dict[str, str] = {}
    for section in document.get("sections") or []:
        if not isinstance(section, dict):
            continue
        key = str(section.get("key") or "")
        title = str(section.get("title") or "")
        titles[key] = title or section_title(key, DEFAULT_RESUME_LANGUAGE)
    return titles


# 历史/兼容键：部分数据集里板块 key 是单数或带 custom_ 前缀（没有 title），
# 查标签时映射回标准键，免得工具结果里露出 "project" 这种内部 key。
_SECTION_KEY_ALIASES = {
    "project": "projects",
    "custom_campus": "campus_experience",
    "custom_awards": "awards",
    "custom_projects": "projects",
}


def section_label(titles: dict[str, str], key: str) -> str:
    # 板块的人话名：文档自带标题 → 标准键的语言包标题 → 兼容别名 → 原键。
    # resume_labels.section_title 对未知键会回落成键名本身，所以不能直接拿它的
    # 返回值判断"有没有查到"——否则 "project" 这类历史键会绕过别名映射、露出内部 key。
    title = str(titles.get(key) or "").strip()
    if title and title != key:
        return title
    label = section_title(key, DEFAULT_RESUME_LANGUAGE)
    if label and label != key:
        return label
    alias = _SECTION_KEY_ALIASES.get(key)
    if alias:
        alias_label = section_title(alias, DEFAULT_RESUME_LANGUAGE)
        if alias_label and alias_label != alias:
            return alias_label
    return key


def field_labels_for_tool() -> dict[str, str]:
    return field_labels(DEFAULT_RESUME_LANGUAGE)


def entry_label(entry: dict) -> str:
    """条目的人话简称：优先标题位置的字段值，其次第一个可见文本。"""
    for item in entry.get("items") or []:
        if isinstance(item, dict) and item.get("placement") == "title":
            value = item.get("value") or item.get("text") or ""
            if value:
                return str(value)[:40]
    texts = entry_texts(entry)
    return texts[0][:40] if texts else str(entry.get("id") or "")


def entry_index(document: dict, section_key: str, entry_id: str) -> int | None:
    """条目在本板块可见条目里的 1-based 序号（与用户看到的「第几条」一致）。"""
    for section in document.get("sections") or []:
        if not isinstance(section, dict) or section.get("key") != section_key:
            continue
        visible = [
            entry
            for entry in section.get("entries") or []
            if isinstance(entry, dict) and not entry.get("hidden")
        ]
        for index, entry in enumerate(visible, start=1):
            if entry.get("id") == entry_id:
                return index
    return None


def entry_layout(entry: dict) -> dict:
    layout = entry.get("layout")
    return dict(layout) if isinstance(layout, dict) else {}


def resolve_section(document: dict, raw: str) -> tuple[str, dict]:
    """把 section 参数（key 或标题）解析成文档里真实存在的板块。"""
    text = str(raw or "").strip()
    if not text:
        raise ValueError("需要提供 section（板块 key 或标题，如 education / 教育经历）")
    titles = section_titles(document)
    for section in document.get("sections") or []:
        if not isinstance(section, dict):
            continue
        key = str(section.get("key") or "")
        if key == text or titles.get(key) == text:
            return key, section
    available = "、".join(f"{key}（{title}）" for key, title in titles.items())
    raise ValueError(f"没有找到板块「{raw}」。可用板块：{available}")


def sample_paths(document: dict, limit: int = 6) -> list[str]:
    samples: list[str] = []
    for section in document.get("sections") or []:
        if not isinstance(section, dict):
            continue
        key = str(section.get("key") or "")
        for entry in section.get("entries") or []:
            if not isinstance(entry, dict) or entry.get("hidden"):
                continue
            samples.append(f"{key}.{entry.get('id')}")
            for item in entry.get("items") or []:
                if isinstance(item, dict) and not item.get("hidden"):
                    samples.append(f"{key}.{entry.get('id')}.{item.get('id')}")
            if len(samples) >= limit:
                return samples[:limit]
    return samples[:limit]


def require_path(document: dict, arguments: dict):
    path = str(arguments.get("path") or "").strip()
    if not path:
        raise ValueError(
            "需要提供 path（如 education.<条目id>.<字段id>，条目序号也可以：education.1）"
        )
    target = resolve_document_path(document, path)
    if target is None:
        samples = "、".join(sample_paths(document)) or "（这份简历还没有条目）"
        raise ValueError(f"找不到路径「{path}」。可参考的路径：{samples}")
    return path, target


def validate_value(value: object) -> object:
    if isinstance(value, str):
        if len(value) > MAX_VALUE_CHARS:
            raise ValueError(f"值超过 {MAX_VALUE_CHARS} 字符上限，请拆短后再改")
        return value
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise ValueError("value 只能是字符串，或字符串数组（列表字段）")


def make_field_item(section_key: str, key: str, value: object) -> dict:
    spec = SECTION_CATALOG.get(section_key)
    field = spec.field(key) if spec is not None else None
    if field is not None:
        placement, fmt = field.default_placement, field.fmt
        wrap, body_style = field.wrap, field.body_style
    elif key in {"start_date", "end_date"}:
        placement, fmt, wrap, body_style = "meta", "date", "none", "bullet"
    else:
        placement, fmt, wrap, body_style = "trail", "text", "none", "bullet"
    if fmt == "list":
        raise ValueError(f"字段 {key} 是列表字段，不能放进 fields；请先 get_entry 看现有条目")
    return {
        "kind": "field",
        "id": new_object_id("ob_it"),
        "key": key,
        "label": "",
        "value": str(value),
        "placement": placement,
        "format": fmt,
        "wrap": wrap,
        "show_label": placement in {"lead", "trail"},
        "solo": False,
        "source": None,
        "body_style": body_style,
    }


def make_text_item(text: str) -> dict:
    return {
        "kind": "text",
        "id": new_object_id("ob_it"),
        "style": "bullet",
        "text": str(text)[:MAX_VALUE_CHARS],
        "hidden": False,
    }


def normalized_entry_layout(raw: dict) -> dict:
    layout: dict = {"head": "split", "start_on_new_page": False, "keep_together": False}
    for key, value in raw.items():
        if key not in ENTRY_LAYOUT_KEYS:
            raise ValueError(f"不支持的条目布局项：{key}（可用：{'、'.join(ENTRY_LAYOUT_KEYS)}）")
        layout[key] = value
    return layout


def _snapshot_name() -> str:
    return f"助手修改前 {datetime.now():%Y-%m-%d %H:%M:%S}"


def create_undo_version(db: Session, record: ResumeRecord, summary: str) -> ResumeVersion:
    """在保存前把**当前**正文/版式冻结成一个命名版本（撤销点）。

    与正文保存放在同一事务（只 flush 不 commit），失败时一起回滚——不会出现
    "留档了但没改成功"的假快照。恢复入口在制作台「版本与变体 → 命名版本」。
    """
    context = layout_snapshot(db, record)
    content = copy.deepcopy(record.content or {})
    version = ResumeVersion(
        resume_id=record.id,
        name=_snapshot_name()[:256],
        change_summary=summary[:2000],
        job_id=record.job_id,
        job_title=(record.job_title or "")[:128],
        company=(record.company or "")[:128],
        content=content,
        render_context=context,
        content_sha256=canonical_content_sha256(content),
        params_sha256=params_sha256(context),
        source_revision=int(record.revision or 0),
        source=VERSION_SOURCE_ASSISTANT,
        context_snapshot=copy.deepcopy(record.context_snapshot),
    )
    db.add(version)
    db.flush()
    return version


def persist_document(
    db: Session, record: ResumeRecord, document: dict, *, change_summary: str
) -> tuple[int, ResumeVersion | None]:
    """保存正文：收口（转 v2 + 校验 id）→ 留撤销点 → 条件写推进一版。"""
    prepared = document_io.prepare_document_for_save(
        document,
        language=normalize_language(record.language),
        format_config=record.format_config or {},
        custom_fields=document_io.custom_field_definitions(db),
    )
    version = create_undo_version(db, record, change_summary)
    outcome = save_content(db, record_id=record.id, content=prepared, expected_revision=None)
    if outcome is None:
        raise ValueError(f"简历 {record.id} 已被删除，本次修改未写入")
    db.commit()
    return int(outcome.record.revision or 0), version


def undo_hint(version: ResumeVersion | None) -> str:
    if version is None:
        return ""
    return f"修改前的版本「{version.name}」已留档，可在简历制作台「版本」里的命名版本中恢复"


def same_value(before: object, after: object) -> bool:
    return (
        hashlib.sha256(
            json.dumps({"v": before}, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).digest()
        == hashlib.sha256(
            json.dumps({"v": after}, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).digest()
    )
