# SPDX-License-Identifier: Apache-2.0
"""W17 私有表达资产服务：收藏 / 检索 / 更新 / 软删 / 插入简历。

边界（wave3 契约 §3 + AGENTS 隐私）：

- 资产默认个人私有、按数据集隔离：每份数据集独立 SQLite 库；检索与插入全在本地完成，
  **不调用模型、不自动外发**；资产正文不写日志（本模块没有 logger 调用）。
- 插入产生**新目标身份**（新 object_id / point_id）：两处引用同一 id 会让排序与来源串线。
- 插入走 document_save.save_content 的条件写（唯一实现）；失败/409 时正文一个字都不改。
- 插入成功后：usage_count += 1、last_used_at = now，并复用 W12 的来源结构记录
  "这个块来自这条资产"（resume_source.kind = phrase，external_ref = resume_phrase:<id>）。
- 资产被编辑不回写已插入的简历：需要更新走"先看差异再采纳"。
"""

from __future__ import annotations

import copy
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.phrase import (
    MAX_PHRASE_TAG_LENGTH,
    MAX_PHRASE_TAGS,
    MAX_PHRASE_TEXT,
    PHRASE_KIND_CUSTOM,
    PHRASE_KINDS,
    PHRASE_LANGUAGES,
    ResumePhrase,
)
from ...models.resume import ResumeRecord
from .document_identity import ENTRY_FIELDS, is_object_id
from .document_provenance import create_link, upsert_source
from .document_save import save_content

_MISSING = object()

# 新条目的主文本字段（用于 entry_id 为空时追加一条新条目）。
_SECTION_PRIMARY_FIELD: dict[str, str] = {
    "education": "achievements",
    "experience": "description",
    "campus_experience": "description",
    "projects": "description",
}
# 没有要点数组的栏目：插入 = 新建一条条目，文本写到标量字段。
_SECTION_SCALAR_FIELD: dict[str, str] = {"skills": "name", "awards": "description"}

# 从字段名推断表达类型（收藏时用，只做展示分类，不影响正文）。
_FIELD_KIND = {
    "achievements": "achievement",
    "description": "achievement",
    "highlights": "result",
    "courses": "method",
}


def new_object_id() -> str:
    """生成符合 W01 校验规则的稳定标识（12 位小写十六进制，8–32 位）。"""
    return secrets.token_hex(6)


def _clean_tags(job_tags: list[str] | None) -> list[str]:
    if not job_tags:
        return []
    cleaned: list[str] = []
    for raw in job_tags:
        tag = str(raw or "").strip()
        if not tag:
            continue
        if len(tag) > MAX_PHRASE_TAG_LENGTH:
            raise ValueError(f"岗位标签最长 {MAX_PHRASE_TAG_LENGTH} 个字符")
        if tag not in cleaned:
            cleaned.append(tag)
    if len(cleaned) > MAX_PHRASE_TAGS:
        raise ValueError(f"岗位标签最多 {MAX_PHRASE_TAGS} 个")
    return cleaned


def _validate_phrase(
    *,
    text: str,
    kind: str,
    language: str,
    job_tags: list[str] | None,
    quality_note: str,
) -> tuple[str, str, str, list[str], str]:
    cleaned_text = (text or "").strip()
    if not cleaned_text:
        raise ValueError("表达内容不能为空")
    if len(cleaned_text) > MAX_PHRASE_TEXT:
        raise ValueError(f"表达内容最长 {MAX_PHRASE_TEXT} 个字符")
    if kind not in PHRASE_KINDS:
        raise ValueError("表达类型不受支持")
    if language not in PHRASE_LANGUAGES:
        raise ValueError("语言不受支持")
    note = (quality_note or "").strip()[:256]
    return cleaned_text, kind, language, _clean_tags(job_tags), note


def phrase_brief(phrase: ResumePhrase) -> dict[str, Any]:
    return {
        "id": phrase.id,
        "text": phrase.text,
        "kind": phrase.kind,
        "language": phrase.language or "",
        "source_claim_id": phrase.source_claim_id,
        "source_resume_id": phrase.source_resume_id,
        "source_object_id": phrase.source_object_id,
        "job_tags": list(phrase.job_tags or []),
        "quality_note": phrase.quality_note or "",
        "usage_count": phrase.usage_count or 0,
        "last_used_at": phrase.last_used_at,
        "created_at": phrase.created_at,
        "updated_at": phrase.updated_at,
    }


def create_phrase(db: Session, **fields: Any) -> ResumePhrase:
    text, kind, language, tags, note = _validate_phrase(
        text=fields.get("text", ""),
        kind=fields.get("kind", PHRASE_KIND_CUSTOM),
        language=fields.get("language", ""),
        job_tags=fields.get("job_tags"),
        quality_note=fields.get("quality_note", ""),
    )
    phrase = ResumePhrase(
        text=text,
        kind=kind,
        language=language,
        source_claim_id=fields.get("source_claim_id"),
        source_resume_id=fields.get("source_resume_id"),
        source_object_id=fields.get("source_object_id"),
        job_tags=tags,
        quality_note=note,
    )
    db.add(phrase)
    db.commit()
    db.refresh(phrase)
    return phrase


def get_phrase(
    db: Session, phrase_id: int, *, include_deleted: bool = False
) -> ResumePhrase | None:
    phrase = db.get(ResumePhrase, phrase_id)
    if phrase is None:
        return None
    if phrase.deleted_at is not None and not include_deleted:
        return None
    return phrase


def list_phrases(
    db: Session,
    *,
    kind: str | None = None,
    language: str | None = None,
    tag: str | None = None,
    keyword: str | None = None,
    limit: int = 50,
    cursor: int | None = None,
) -> tuple[list[ResumePhrase], int | None]:
    """按类型/语言/标签/关键词过滤；cursor 为上一页最后一条 id（倒序翻页）。"""
    statement = select(ResumePhrase).where(ResumePhrase.deleted_at.is_(None))
    if kind:
        statement = statement.where(ResumePhrase.kind == kind)
    if language is not None:
        statement = statement.where(ResumePhrase.language == language)
    # 标签过滤在 Python 侧做：SQLAlchemy 的 JSON 序列化会把中文转成 \uXXXX，
    # 直接 LIKE 原始字节匹配不到；候选量受 limit/上限约束，代价可接受。
    python_tag = (tag or "").strip() or None
    if keyword:
        statement = statement.where(ResumePhrase.text.like(f"%{keyword}%"))
    if cursor is not None:
        statement = statement.where(ResumePhrase.id < cursor)
    safe_limit = max(1, min(int(limit), 100))
    fetch_limit = 200 if python_tag is not None else safe_limit + 1
    rows = list(
        db.execute(statement.order_by(ResumePhrase.id.desc()).limit(fetch_limit)).scalars().all()
    )
    if python_tag is not None:
        rows = [row for row in rows if python_tag in (row.job_tags or [])]
    next_cursor = None
    if len(rows) > safe_limit:
        rows = rows[:safe_limit]
        next_cursor = rows[-1].id
    return rows, next_cursor


def update_phrase(db: Session, phrase: ResumePhrase, **fields: Any) -> ResumePhrase:
    text, kind, language, tags, note = _validate_phrase(
        text=fields.get("text") if fields.get("text") is not None else phrase.text,
        kind=fields.get("kind") if fields.get("kind") is not None else phrase.kind,
        language=fields.get("language") if fields.get("language") is not None else phrase.language,
        job_tags=fields.get("job_tags") if fields.get("job_tags") is not None else phrase.job_tags,
        quality_note=fields.get("quality_note")
        if fields.get("quality_note") is not None
        else phrase.quality_note,
    )
    phrase.text = text
    phrase.kind = kind
    phrase.language = language
    phrase.job_tags = tags
    phrase.quality_note = note
    db.commit()
    db.refresh(phrase)
    return phrase


def _read_path(payload: Any, path: str) -> Any:
    current: Any = payload
    for segment in path.split("."):
        if isinstance(current, dict):
            if segment not in current:
                return _MISSING
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return _MISSING
        else:
            return _MISSING
    return current


def _collect_target(record: ResumeRecord, path: str) -> tuple[str, str | None, str, str]:
    """解析 data-resume-path → (文本, object_id, point_id, kind)；解析不到抛 ValueError。"""
    segments = [segment for segment in (path or "").split(".") if segment != ""]
    if len(segments) < 2 or segments[0] not in ENTRY_FIELDS:
        raise ValueError("路径不在可收藏的简历条目里")
    field = segments[0]
    try:
        index = int(segments[1])
    except ValueError as exc:
        raise ValueError("路径格式不正确") from exc
    entries = (record.content or {}).get(field) or []
    if not isinstance(entries, list) or not 0 <= index < len(entries):
        raise ValueError("路径对应的条目不存在")
    entry = entries[index]
    if not isinstance(entry, dict):
        raise ValueError("路径对应的条目不存在")
    value = _read_path(record.content, path)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("只能收藏一段非空文本")
    object_id = entry.get("id") if is_object_id(entry.get("id")) else None
    point_id: str | None = None
    if len(segments) == 4:
        key, raw_point = segments[2], segments[3]
        point_ids = entry.get("point_ids") or {}
        ids = point_ids.get(key) if isinstance(point_ids, dict) else None
        try:
            point_index = int(raw_point)
        except ValueError:
            point_index = -1
        if isinstance(ids, list) and 0 <= point_index < len(ids) and is_object_id(ids[point_index]):
            point_id = ids[point_index]
    kind = _FIELD_KIND.get(segments[2] if len(segments) >= 3 else "", PHRASE_KIND_CUSTOM)
    return value.strip(), object_id, point_id, kind


def collect_phrase(
    db: Session, *, resume_id: int, path: str, job_tags: list[str] | None = None
) -> ResumePhrase:
    record = db.get(ResumeRecord, resume_id)
    if record is None or record.deleted_at is not None:
        raise LookupError("简历记录不存在或已被删除")
    text, object_id, _point_id, kind = _collect_target(record, path)
    return create_phrase(
        db,
        text=text,
        kind=kind,
        job_tags=job_tags,
        source_resume_id=record.id,
        source_object_id=object_id,
    )


def _find_entry(content: dict[str, Any], section: str, entry_id: str) -> dict[str, Any] | None:
    entries = content.get(section) or []
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id") == entry_id:
            return entry
    return None


def _point_ids_for(entry: dict[str, Any], field: str, values: list[Any]) -> list[str]:
    """取/补齐某要点数组的 id 列表（缺 id 或长度不符时按当前内容重建，保证等长）。"""
    point_ids = entry.get("point_ids")
    if not isinstance(point_ids, dict):
        point_ids = {}
        entry["point_ids"] = point_ids
    existing = point_ids.get(field)
    if (
        isinstance(existing, list)
        and len(existing) == len(values)
        and all(is_object_id(item) for item in existing)
    ):
        return list(existing)
    rebuilt = [new_object_id() for _ in values]
    point_ids[field] = rebuilt
    return rebuilt


def _insert_into_existing_entry(
    content: dict[str, Any],
    section: str,
    entry_id: str,
    text: str,
    point_index: int | None,
) -> tuple[str, str, str]:
    entry = _find_entry(content, section, entry_id)
    if entry is None:
        raise ValueError("条目不在当前简历里")
    object_id = entry["id"]
    preview_fields = [name for name in ENTRY_FIELDS if name == section]
    if not preview_fields:  # pragma: no cover - 上方已保证 section 合法
        raise ValueError("栏目不支持插入")
    from .document_identity import POINT_FIELDS

    point_fields = POINT_FIELDS[section]
    if not point_fields:
        raise ValueError("这个栏目没有可插入的要点数组，请不指定 entry_id 以新建条目")
    field = "description" if "description" in point_fields else point_fields[0]
    values = entry.get(field)
    if not isinstance(values, list):
        values = []
        entry[field] = values
    ids = _point_ids_for(entry, field, values)
    index = len(values) if point_index is None else max(0, min(point_index, len(values)))
    values.insert(index, text)
    point_id = new_object_id()
    ids.insert(index, point_id)
    entry["point_ids"][field] = ids
    entry_index = content[section].index(entry)
    return object_id, point_id, f"{section}.{entry_index}.{field}.{index}"


def _append_new_entry(content: dict[str, Any], section: str, text: str) -> tuple[str, str, str]:
    object_id = new_object_id()
    if section in _SECTION_SCALAR_FIELD:
        content.setdefault(section, []).append(
            {"id": object_id, _SECTION_SCALAR_FIELD[section]: text}
        )
        return object_id, "", f"{section}.{len(content[section]) - 1}"
    primary = _SECTION_PRIMARY_FIELD.get(section)
    if primary is None:
        raise ValueError("栏目不支持插入")
    point_id = new_object_id()
    content.setdefault(section, []).append(
        {"id": object_id, primary: [text], "point_ids": {primary: [point_id]}}
    )
    return object_id, point_id, f"{section}.{len(content[section]) - 1}.{primary}.0"


def insert_phrase(
    db: Session,
    phrase: ResumePhrase,
    *,
    resume_id: int,
    section: str,
    entry_id: str | None,
    point_index: int | None,
    expected_revision: int | None,
) -> tuple[ResumeRecord, str, str | None]:
    """把资产插入简历：新目标身份 + 条件写；成功后才计数并记来源关联。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or record.deleted_at is not None:
        raise LookupError("简历记录不存在或已被删除")
    if section not in ENTRY_FIELDS:
        raise ValueError("栏目不受支持")
    content = copy.deepcopy(record.content or {})
    if not isinstance(content.get(section), list):
        content[section] = []
    if entry_id is not None:
        object_id, point_id, link_path = _insert_into_existing_entry(
            content, section, entry_id, phrase.text, point_index
        )
    else:
        object_id, point_id, link_path = _append_new_entry(content, section, phrase.text)
    outcome = save_content(
        db,
        record_id=record.id,
        content=content,
        expected_revision=expected_revision,
        mark_saved=True,
    )
    if outcome is None:
        raise LookupError("简历记录不存在或已被删除")
    # save_content 返回 SaveOutcome（内含提交后重新读回的记录），不是 ORM 记录本身。
    saved = outcome.record
    # 来源关联复用 W12 的结构（kind=phrase），不新建第二套关联表。
    snapshot = upsert_source(
        db,
        kind="phrase",
        external_ref=f"resume_phrase:{phrase.id}",
        title=phrase.text[:60],
        payload=phrase.text,
    )
    link_point = point_id or None
    try:
        create_link(
            db,
            record=saved,
            snapshot=snapshot,
            object_id=object_id,
            point_id=link_point,
        )
    except ValueError:
        # 身份解析失败（例如保存链路改写了 id）时退回路径关联：仍可追溯，且不猜身份。
        create_link(db, record=saved, snapshot=snapshot, path=link_path)
    phrase.usage_count = int(phrase.usage_count or 0) + 1
    phrase.last_used_at = datetime.now(UTC)
    db.commit()
    db.refresh(phrase)
    return saved, object_id, point_id or None


__all__ = [
    "collect_phrase",
    "create_phrase",
    "get_phrase",
    "insert_phrase",
    "list_phrases",
    "new_object_id",
    "phrase_brief",
    "update_phrase",
]
