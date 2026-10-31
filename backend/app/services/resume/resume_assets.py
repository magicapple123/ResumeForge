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
from . import document_io
from .document_identity import ENTRY_FIELDS
from .document_phrase_ops import collect_document_text, insert_document_phrase
from .document_provenance import create_link, upsert_source
from .document_save import save_content

# 新条目的主文本字段（用于 entry_id 为空时追加一条新条目）。
# 没有要点数组的栏目：插入 = 新建一条条目，文本写到标量字段。

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
    # fields.get(...) 不能在同一表达式里调两次：`x if x.get(k) is not None else fallback`
    # 的窄化只作用于第一次调用，第二次仍是 Any|None。取一次再选。
    def _pick(key: str, fallback: Any) -> Any:
        value = fields.get(key)
        return value if value is not None else fallback

    text, kind, language, tags, note = _validate_phrase(
        text=_pick("text", phrase.text),
        kind=_pick("kind", phrase.kind),
        language=_pick("language", phrase.language),
        job_tags=_pick("job_tags", phrase.job_tags),
        quality_note=_pick("quality_note", phrase.quality_note),
    )
    phrase.text = text
    phrase.kind = kind
    phrase.language = language
    phrase.job_tags = tags
    phrase.quality_note = note
    db.commit()
    db.refresh(phrase)
    return phrase


def _collect_target(record: ResumeRecord, path: str) -> tuple[str, str | None, str | None, str]:
    text, object_id, point_id, field = collect_document_text(
        document_io.document_for_record(None, record)[0],
        path,
    )
    return text, object_id, point_id, _FIELD_KIND.get(field, PHRASE_KIND_CUSTOM)


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
    content = copy.deepcopy(document_io.document_for_record(db, record)[0])
    object_id, point_id, link_path = insert_document_phrase(
        content,
        section,
        entry_id,
        phrase.text,
        point_index,
        new_object_id,
    )
    outcome = save_content(
        db,
        record_id=record.id,
        content=document_io.prepare_document_for_save(
            content,
            language=record.language,
            format_config=record.format_config or {},
        ),
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
