# SPDX-License-Identifier: Apache-2.0
"""W16 数据集级术语表服务：CRUD / 导入 / 软删（回收站第 18 类）。

术语表不存 resume_id（同一数据集内所有简历共享译法）；数据集隔离由独立库保证。
locked=True 的词在翻译路径上必须逐字出现 target_term（校验在 bilingual_variants）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, cast, or_, select
from sqlalchemy.orm import Session

from ...models.glossary import (
    GLOSSARY_CATEGORIES,
    GLOSSARY_LANGUAGES,
    MAX_TERM_LENGTH,
    MAX_TERM_NOTE,
    ResumeGlossaryTerm,
)
from .. import trash


def _clean(value: str, *, name: str, limit: int) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError(f"{name}不能为空")
    if len(cleaned) > limit:
        raise ValueError(f"{name}最长 {limit} 个字符")
    return cleaned


def _validate(fields: dict[str, Any], *, allow_missing_languages: bool = False) -> dict[str, Any]:
    source = _clean(fields.get("source_term", ""), name="原文词", limit=MAX_TERM_LENGTH)
    target = _clean(fields.get("target_term", ""), name="译名", limit=MAX_TERM_LENGTH)
    language_from = str(fields.get("language_from") or "")
    language_to = str(fields.get("language_to") or "")
    if not allow_missing_languages or language_from or language_to:
        if language_from not in GLOSSARY_LANGUAGES or language_to not in GLOSSARY_LANGUAGES:
            raise ValueError("语言必须是 zh-CN 或 en-US")
        if language_from == language_to:
            raise ValueError("原文语言与译名语言不能相同")
    category = str(fields.get("category") or "term")
    if category not in GLOSSARY_CATEGORIES:
        raise ValueError("术语类别不受支持")
    note = (fields.get("note") or "").strip()[:MAX_TERM_NOTE]
    locked = fields.get("locked")
    return {
        "source_term": source,
        "target_term": target,
        "language_from": language_from,
        "language_to": language_to,
        "category": category,
        "locked": True if locked is None else bool(locked),
        "note": note,
    }


def term_brief(term: ResumeGlossaryTerm) -> dict[str, Any]:
    return {
        "id": term.id,
        "source_term": term.source_term,
        "target_term": term.target_term,
        "language_from": term.language_from,
        "language_to": term.language_to,
        "category": term.category,
        "locked": term.locked,
        "note": term.note,
        "created_at": term.created_at,
        "updated_at": term.updated_at,
    }


def list_terms(
    db: Session,
    *,
    language_to: str | None = None,
    category: str | None = None,
    keyword: str | None = None,
    limit: int = 200,
) -> list[ResumeGlossaryTerm]:
    statement = select(ResumeGlossaryTerm).where(ResumeGlossaryTerm.deleted_at.is_(None))
    if language_to:
        statement = statement.where(ResumeGlossaryTerm.language_to == language_to)
    if category:
        statement = statement.where(ResumeGlossaryTerm.category == category)
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(
            or_(
                ResumeGlossaryTerm.source_term.like(pattern),
                ResumeGlossaryTerm.target_term.like(pattern),
                cast(ResumeGlossaryTerm.note, String).like(pattern),
            )
        )
    safe_limit = max(1, min(int(limit), 500))
    return list(
        db.execute(statement.order_by(ResumeGlossaryTerm.id.desc()).limit(safe_limit))
        .scalars()
        .all()
    )


def get_term(db: Session, term_id: int) -> ResumeGlossaryTerm | None:
    term = db.get(ResumeGlossaryTerm, term_id)
    if term is None or term.deleted_at is not None:
        return None
    return term


def find_live_by_key(db: Session, source_term: str, language_to: str) -> ResumeGlossaryTerm | None:
    return db.execute(
        select(ResumeGlossaryTerm).where(
            ResumeGlossaryTerm.source_term == source_term,
            ResumeGlossaryTerm.language_to == language_to,
            ResumeGlossaryTerm.deleted_at.is_(None),
        )
    ).scalar_one_or_none()


def create_term(db: Session, fields: dict[str, Any]) -> ResumeGlossaryTerm:
    cleaned = _validate(fields)
    if find_live_by_key(db, cleaned["source_term"], cleaned["language_to"]) is not None:
        raise ValueError("这条术语已存在（同一原文词 + 目标语言）")
    term = ResumeGlossaryTerm(**cleaned)
    db.add(term)
    db.commit()
    db.refresh(term)
    return term


def update_term(
    db: Session, term: ResumeGlossaryTerm, fields: dict[str, Any]
) -> ResumeGlossaryTerm:
    merged = {
        "source_term": term.source_term,
        "target_term": fields.get("target_term", term.target_term),
        "language_from": term.language_from,
        "language_to": term.language_to,
        "category": fields.get("category", term.category),
        "locked": fields.get("locked", term.locked),
        "note": fields.get("note", term.note),
    }
    if fields.get("source_term") is not None:
        merged["source_term"] = fields["source_term"]
    cleaned = _validate(merged)
    duplicate = find_live_by_key(db, cleaned["source_term"], cleaned["language_to"])
    if duplicate is not None and duplicate.id != term.id:
        raise ValueError("这条术语已存在（同一原文词 + 目标语言）")
    for key, value in cleaned.items():
        setattr(term, key, value)
    db.commit()
    db.refresh(term)
    return term


def delete_term(db: Session, term: ResumeGlossaryTerm) -> None:
    """软删进回收站（第 18 类）；trash.soft_delete 不 commit，调用方决定事务边界。"""
    trash.soft_delete(db, "glossary_term", term)


def import_terms(db: Session, items: list[dict[str, Any]]) -> dict[str, Any]:
    """批量导入/更新：同 (source_term, language_to) 更新译名与属性，否则新建。"""
    cleaned_items = [_validate(item) for item in items]
    created = 0
    updated = 0
    results: list[ResumeGlossaryTerm] = []
    for cleaned in cleaned_items:
        existing = find_live_by_key(db, cleaned["source_term"], cleaned["language_to"])
        if existing is None:
            term = ResumeGlossaryTerm(**cleaned)
            db.add(term)
            created += 1
            results.append(term)
            continue
        existing.target_term = cleaned["target_term"]
        existing.category = cleaned["category"]
        existing.locked = cleaned["locked"]
        existing.note = cleaned["note"]
        updated += 1
        results.append(existing)
    db.commit()
    for term in results:
        db.refresh(term)
    return {
        "created": created,
        "updated": updated,
        "items": [term_brief(term) for term in results],
    }


def list_locked_terms(
    db: Session, *, language_from: str, language_to: str
) -> list[ResumeGlossaryTerm]:
    return list(
        db.execute(
            select(ResumeGlossaryTerm).where(
                ResumeGlossaryTerm.deleted_at.is_(None),
                ResumeGlossaryTerm.locked.is_(True),
                ResumeGlossaryTerm.language_from == language_from,
                ResumeGlossaryTerm.language_to == language_to,
            )
        )
        .scalars()
        .all()
    )
