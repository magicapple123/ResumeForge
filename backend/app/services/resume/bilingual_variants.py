# SPDX-License-Identifier: Apache-2.0
"""W16 语言变体：翻译候选（不落库）与逐项采纳（写入变体）。

契约要点（wave3 §2）：

- 翻译候选只在响应里；**采纳才写入**，取消/失败不改正文。
- 事实锁（W12）在候选生成与采纳两个环节都走服务端校验：锁定值被改动 → 该字段保留原文并
  记入 blocked_fields，绝不静默写库。
- 术语表 locked 词必须逐字出现在译文中；未出现且原文含该词 → 该字段保留原文并记 blocked。
- 人名/机构/时间/数字/邮箱等身份与事实字段**不参与翻译**（不送模型、不改写），
  因此不会被翻译路径改掉；"两份独立排版"由 variant.render_context 各自保存保证。
"""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant
from ..llm.base import BaseLLMProvider
from . import fact_locks, resume_glossary
from .resume_delivery import canonical_content_sha256
from .resume_diff import build_resume_diff
from .resume_writing import translate

_TARGET_LANGUAGES = ("zh-CN", "en-US")
# 顶层可翻译字段（身份/联系方式/照片等绝不在此列）。
_TOP_LEVEL_FIELDS = ("summary", "job_intent")
# 条目的标量字段：只翻"角色"，机构/公司/学校名交给术语表与用户决定，不在翻译里自动改写。
_ENTRY_SCALAR_FIELDS = ("role",)
# 条目的要点数组字段。
_POINT_LIST_FIELDS = {
    "education": ("achievements", "courses"),
    "experience": ("description",),
    "campus_experience": ("description",),
    "projects": ("tech_stack", "description", "highlights"),
}


class BilingualError(ValueError):
    """可直接展示给用户的翻译/采纳错误。"""


def _direction(source: str, target: str) -> str:
    if source == "zh-CN" and target == "en-US":
        return "zh2en"
    if source == "en-US" and target == "zh-CN":
        return "en2zh"
    raise BilingualError("源语言与目标语言必须是一中一英")


def _read_path(content: Any, path: str) -> Any:
    current: Any = content
    for segment in path.split("."):
        if isinstance(current, dict):
            if segment not in current:
                return None
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def _write_path(content: Any, path: str, value: str) -> bool:
    segments = path.split(".")
    current: Any = content
    for segment in segments[:-1]:
        if isinstance(current, dict):
            if segment not in current:
                return False
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return False
        else:
            return False
    leaf = segments[-1]
    if isinstance(current, dict) and leaf in current and isinstance(current[leaf], str):
        current[leaf] = value
        return True
    if isinstance(current, list):
        try:
            index = int(leaf)
        except ValueError:
            return False
        if 0 <= index < len(current) and isinstance(current[index], str):
            current[index] = value
            return True
    return False


def translatable_paths(content: dict[str, Any]) -> list[str]:
    """列出参与翻译的文本路径（只含描述性文本；身份/机构/日期/数字不在内）。"""
    paths: list[str] = []
    for field in _TOP_LEVEL_FIELDS:
        if isinstance(content.get(field), str) and content[field].strip():
            paths.append(field)
    for section in _POINT_LIST_FIELDS:
        entries = content.get(section) or []
        if not isinstance(entries, list):
            continue
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            for field in _ENTRY_SCALAR_FIELDS:
                if isinstance(entry.get(field), str) and entry[field].strip():
                    paths.append(f"{section}.{index}.{field}")
            for field in _POINT_LIST_FIELDS[section]:
                values = entry.get(field)
                if not isinstance(values, list):
                    continue
                for point_index, value in enumerate(values):
                    if isinstance(value, str) and value.strip():
                        paths.append(f"{section}.{index}.{field}.{point_index}")
    return paths


def source_language_of(variant: ResumeVariant, target: str) -> str:
    language = (variant.language or "").strip()
    if language in _TARGET_LANGUAGES and language != target:
        return language
    return "zh-CN" if target == "en-US" else "en-US"


async def build_translation_candidate(
    db: Session,
    provider: BaseLLMProvider,
    variant: ResumeVariant,
    *,
    target_language: str,
) -> dict[str, Any]:
    """生成翻译候选（不写库）：逐字段翻译 + 术语锁定 + 事实锁校验。"""
    if target_language not in _TARGET_LANGUAGES:
        raise BilingualError("目标语言不受支持")
    source = source_language_of(variant, target_language)
    if source == target_language:
        raise BilingualError("目标语言与当前变体语言相同")
    direction = _direction(source, target_language)
    original = copy.deepcopy(variant.content or {})
    candidate = copy.deepcopy(original)
    glossary_terms = resume_glossary.list_locked_terms(
        db, language_from=source, language_to=target_language
    )
    glossary_hits: list[dict[str, str]] = []
    blocked: list[str] = []
    for path in translatable_paths(original):
        text = _read_path(original, path)
        if not isinstance(text, str) or not text.strip():
            continue
        translated = await translate(provider, text, direction)
        for term in glossary_terms:
            if term.source_term not in text:
                continue
            if term.target_term not in translated:
                blocked.append(path)
                break
            glossary_hits.append({"source": term.source_term, "target": term.target_term})
            translated = translated.replace(term.source_term, term.target_term)
        else:
            _write_path(candidate, path, translated)
    blocked.extend(_fact_lock_blocked(db, variant, candidate))
    for path in blocked:
        original_value = _read_path(original, path)
        if isinstance(original_value, str):
            _write_path(candidate, path, original_value)
    diff = build_resume_diff(
        variant.id,
        variant.name,
        original,
        0,
        "翻译候选",
        candidate,
    )
    return {
        "variant_id": variant.id,
        "source_language": source,
        "target_language": target_language,
        "candidate": candidate,
        "diff": diff,
        "glossary_hits": glossary_hits,
        "blocked_fields": sorted(set(blocked)),
    }


def _fact_lock_blocked(db: Session, variant: ResumeVariant, candidate: dict[str, Any]) -> list[str]:
    record = db.get(ResumeRecord, variant.resume_id) if variant.resume_id else None
    if record is None:
        return []
    violations = fact_locks.validate_fact_locks(db, record, candidate)
    return [item.path for item in violations]


def adopt_translation(
    db: Session, variant: ResumeVariant, items: list[dict[str, str]]
) -> tuple[ResumeVariant, list[str]]:
    """逐项采纳：只写列出的路径；任何一条不合法/触发事实锁 → 整批不落库。"""
    content = copy.deepcopy(variant.content or {})
    applied: list[str] = []
    for item in items:
        path = str(item.get("path") or "").strip()
        text = item.get("text")
        if not path or not isinstance(text, str) or not text.strip():
            raise BilingualError("采纳项缺少路径或正文")
        current = _read_path(content, path)
        if not isinstance(current, str):
            raise BilingualError(f"采纳路径不存在或不是文本：{path}")
        if not _write_path(content, path, text.strip()):
            raise BilingualError(f"采纳路径写入失败：{path}")
        applied.append(path)
    record = db.get(ResumeRecord, variant.resume_id) if variant.resume_id else None
    if record is not None:
        violations = fact_locks.validate_fact_locks(db, record, content)
        if violations:
            raise fact_locks.FactLockError(violations)
    variant.content = content
    variant.content_sha256 = canonical_content_sha256(content)
    db.commit()
    db.refresh(variant)
    return variant, applied


def patch_variant(
    db: Session,
    variant: ResumeVariant,
    *,
    name: str | None = None,
    language: str | None = None,
    variant_group_id: int | None = None,
) -> ResumeVariant:
    if name is not None:
        cleaned = name.strip()
        if not cleaned:
            raise BilingualError("变体名称不能为空")
        variant.name = cleaned[:256]
    if language is not None:
        if language not in ("", "zh-CN", "en-US"):
            raise BilingualError("语言标签不受支持")
        variant.language = language
    if variant_group_id is not None:
        variant.variant_group_id = variant_group_id
    db.commit()
    db.refresh(variant)
    return variant


__all__ = [
    "BilingualError",
    "adopt_translation",
    "build_translation_candidate",
    "patch_variant",
    "source_language_of",
    "translatable_paths",
]
