# SPDX-License-Identifier: Apache-2.0
"""W12 来源正文只读解析（GET /api/provenance/sources/{id}/revision-text）。

背景：来源表按设计只存标题/摘要/指纹，**不复制用户正文**；而"来源更新 → 采纳写正文"
需要用户先看到来源原文。本模块按 `external_ref` 现场解析业务表里的正文，只读、不写库、
不写日志、不缓存：

| external_ref | 解析 | 说明 |
| --- | --- | --- |
| `claim_record:<id>` | 事实台账 | 优先"简历表述"(candidate_wording)，回退"原始事实"(source_fact)；删除条目按不存在 |
| `material:<id>` | 资料箱 | 正文 content，空则 note；删除条目按不存在 |
| `profile:<field>` | 个人资料 | 只接受 UserProfile 上的字符串字段（photo/section_order 等非文本字段不可解析） |
| `resume_phrase:<id>` | 表达资产 | 资产 text（W17 来源关联同构） |
| 其它/手工来源 | - | 不可解析：manual_source_has_no_body / external_ref_unresolvable |

为什么返回"候选列表"而不是单一正文：历史来源的指纹可能是用"简历表述"也可能是用
"原始事实"算出来的（建立关联时由调用方决定 payload），这里按所选修订的指纹挑最匹配的
一条，并如实报告 fingerprint_matched；都不匹配时回退首个候选，仍由指纹字段让前端提示。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.provenance import ResumeSource, ResumeSourceRevision
from .document_provenance import canonical_fingerprint

MAX_SOURCE_TEXT_CHARS = 20_000

REASON_MANUAL = "manual_source_has_no_body"
REASON_UNRESOLVABLE = "external_ref_unresolvable"
REASON_NOT_FOUND = "source_body_not_found"
REASON_TOO_LARGE = "source_body_too_large"
REASON_NO_REVISION = "no_revision"


@dataclass(frozen=True)
class SourceTextLookup:
    """一次来源正文解析的结果：candidates 为空时 reason 说明为什么不可解析。"""

    candidates: tuple[str, ...] = field(default_factory=tuple)
    reason: str = ""

    @property
    def resolvable(self) -> bool:
        return bool(self.candidates)


def _split_external_ref(external_ref: str | None) -> tuple[str, str] | None:
    if not external_ref:
        return None
    ref = external_ref.strip()
    if ":" not in ref:
        return None
    prefix, _, remainder = ref.partition(":")
    return prefix.strip().lower(), remainder.strip()


def _claim_texts(db: Session, claim_id: str) -> tuple[str, ...] | None:
    from ..claims import claim_or_none

    try:
        numeric_id = int(claim_id)
    except ValueError:
        return None
    record = claim_or_none(db, numeric_id)
    if record is None:
        return None
    texts = [record.candidate_wording or "", record.source_fact or ""]
    return tuple(text.strip() for text in texts if text.strip())


def _material_texts(db: Session, material_id: str) -> tuple[str, ...] | None:
    from ..materials import material_or_none

    try:
        numeric_id = int(material_id)
    except ValueError:
        return None
    record = material_or_none(db, numeric_id)
    if record is None:
        return None
    texts = [record.content or "", record.note or ""]
    return tuple(text.strip() for text in texts if text.strip())


def _profile_texts(db: Session, field_name: str) -> tuple[str, ...] | None:
    from ...models.profile import UserProfile

    # 不用 get_or_create_profile：读取端点不允许因为"还没有资料行"而写库。
    profile = db.query(UserProfile).first()
    if profile is None:
        return None
    if not field_name or not hasattr(profile, field_name):
        return None
    if field_name in {"photo", "section_order"}:
        return None
    value = getattr(profile, field_name)
    if not isinstance(value, str) or not value.strip():
        return None
    return (value.strip(),)


def _phrase_texts(db: Session, phrase_id: str) -> tuple[str, ...] | None:
    from .resume_assets import get_phrase

    try:
        numeric_id = int(phrase_id)
    except ValueError:
        return None
    phrase = get_phrase(db, numeric_id)
    if phrase is None:
        return None
    text = (phrase.text or "").strip()
    return (text,) if text else None


def resolve_source_texts(db: Session, source: ResumeSource) -> SourceTextLookup:
    """按来源 kind + external_ref 解析原文候选；不可解析时给稳定 reason。"""
    parsed = _split_external_ref(source.external_ref)
    if parsed is None:
        if source.kind == "manual":
            return SourceTextLookup(reason=REASON_MANUAL)
        return SourceTextLookup(reason=REASON_UNRESOLVABLE)
    prefix, remainder = parsed
    texts: tuple[str, ...] | None
    if source.kind == "claim" and prefix in {"claim_record", "claim"}:
        texts = _claim_texts(db, remainder)
    elif source.kind == "material" and prefix in {"material", "material_record"}:
        texts = _material_texts(db, remainder)
    elif source.kind == "profile" and prefix == "profile":
        texts = _profile_texts(db, remainder)
    elif source.kind == "phrase" and prefix in {"resume_phrase", "phrase"}:
        texts = _phrase_texts(db, remainder)
    else:
        return SourceTextLookup(reason=REASON_UNRESOLVABLE)
    if texts is None:
        return SourceTextLookup(reason=REASON_NOT_FOUND)
    if any(len(text) > MAX_SOURCE_TEXT_CHARS for text in texts):
        return SourceTextLookup(reason=REASON_TOO_LARGE)
    return SourceTextLookup(candidates=texts)


def pick_text_for_fingerprint(lookup: SourceTextLookup, fingerprint: str) -> tuple[str, bool]:
    """按修订指纹挑候选正文；返回 (正文, 是否指纹吻合)。"""
    if not lookup.candidates:
        return "", False
    for text in lookup.candidates:
        if fingerprint and canonical_fingerprint(text) == fingerprint:
            return text, True
    return lookup.candidates[0], False


def resolve_current_source_text(db: Session, source: ResumeSource) -> str | None:
    """当前可解析正文（优先与来源当前指纹吻合的候选），供采纳兜底校验使用。"""
    lookup = resolve_source_texts(db, source)
    if not lookup.candidates:
        return None
    text, _matched = pick_text_for_fingerprint(lookup, source.current_fingerprint or "")
    return text


REASON_HISTORICAL = "historical_revision_not_stored"


def list_revisions(db: Session, source_id: int) -> list[ResumeSourceRevision]:
    """一条来源的全部修订（revision_no 升序）；端点据此定位"最新/某一版"。"""
    return list(
        db.execute(
            select(ResumeSourceRevision)
            .where(ResumeSourceRevision.source_id == source_id)
            .order_by(ResumeSourceRevision.revision_no)
        )
        .scalars()
        .all()
    )


__all__ = [
    "MAX_SOURCE_TEXT_CHARS",
    "REASON_HISTORICAL",
    "REASON_MANUAL",
    "REASON_NOT_FOUND",
    "REASON_NO_REVISION",
    "REASON_TOO_LARGE",
    "REASON_UNRESOLVABLE",
    "SourceTextLookup",
    "list_revisions",
    "pick_text_for_fingerprint",
    "resolve_current_source_text",
    "resolve_source_texts",
]
