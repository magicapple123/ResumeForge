# SPDX-License-Identifier: Apache-2.0
"""W16 语言变体：翻译候选（不落库）与逐项采纳（写入变体）。

契约要点（wave3 §2）：

- 翻译候选只在响应里；**采纳才写入**，取消/失败不改正文。
- 事实锁（W12）在候选生成与采纳两个环节都走服务端校验：锁定值被改动 → 该字段保留原文并
  记入 blocked_fields，绝不静默写库。
- 术语表 locked 词必须逐字出现在译文中；未出现且原文含该词 → 该字段保留原文并记 blocked。
- 人名/机构/时间/数字/邮箱等身份与事实字段**不参与翻译**（不送模型、不改写），
  因此不会被翻译路径改掉；"两份独立排版"由 variant.render_context 各自保存保证。
- 可译段按顺序**分块**送模型（单块 ≤24 段且 ≤4000 字符）：简历常有 20–60+ 段，
  逐段串行调用会让一次「生成翻译候选」远超浏览器请求预算。块响应条数/类型不合格时
  只把该块回退成原有的逐段 `translate()`——宁可多几次调用，也不让整单失败。
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from ...models.glossary import ResumeGlossaryTerm
from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant
from ..llm.base import BaseLLMProvider, LLMError
from ..llm.structured_output import parse_json_object
from . import document_io, fact_locks, resume_glossary
from .content_locks import entry_content_payload, validate_content_locks_for
from .document_identity import ENTRY_FIELDS, is_object_id
from .document_paths import read_document_value
from .document_variants import read_document_path, write_document_path
from .document_view import header_items, iter_entries
from .resume_delivery import canonical_content_sha256
from .resume_diff import build_resume_diff

# 私有名复用写作服务的"文本是不可信数据"系统声明与提示词加载：两条翻译路径必须
# 用同一句防护，各写一份迟早漂移成"一条路径松、一条严格"。
from .resume_writing import _UNTRUSTED_SYSTEM, _load_prompt, translate

logger = logging.getLogger(__name__)

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
    # A4 扩展栏目：科研项目有要点数组，论文/专利/证照没有（只登记键以使 role 等
    # 标量字段进入同一条翻译路径；空元组不产生任何要点路径）。
    "publications": (),
    "research_projects": ("description", "outcomes"),
    "patents": (),
    "credentials": (),
}

# 批量翻译的块尺寸：一份简历常见 20–60+ 个可译段，逐段一次模型调用是这次超时的根因。
# 24 段 / 4000 字符接近一次常规生成请求的长度——调用次数降一个数量级，单次输出又不至于
# 长到模型容易漏段；超过任一边界就切下一块（单段超长时它自己一块，走逐段路径）。
_BATCH_MAX_ITEMS = 24
_BATCH_MAX_CHARS = 4_000


class BilingualError(ValueError):
    """可直接展示给用户的翻译/采纳错误。"""


def _direction(source: str, target: str) -> str:
    if source == "zh-CN" and target == "en-US":
        return "zh2en"
    if source == "en-US" and target == "zh-CN":
        return "en2zh"
    raise BilingualError("源语言与目标语言必须是一中一英")


def _read_path(content: Any, path: str) -> Any:
    return read_document_value(content, path)


def _write_path(content: Any, path: str, value: str) -> bool:
    return write_document_path(content, path, value)


def translatable_paths(content: dict[str, Any]) -> list[str]:
    """列出参与翻译的文本路径（只含描述性文本；身份/机构/日期/数字不在内）。"""
    paths: list[str] = []
    if content.get("version") == 2:
        for item in header_items(content):
            if item.get("placement") == "subtitle" and item.get("value"):
                paths.append(f"header.{item['id']}")
        for section, entry in iter_entries(content):
            if entry.get("hidden"):
                continue
            for item in entry.get("items") or []:
                if item.get("hidden") or item.get("placement") == "hidden":
                    continue
                path = f"{section}.{entry['id']}.{item['id']}"
                kind, key = item.get("kind"), item.get("key")
                if (
                    kind == "text"
                    or kind == "field"
                    and (
                        key == "role"
                        or item.get("placement") == "body"
                        and key not in {"name", "title", "school", "company", "organization"}
                    )
                ):
                    paths.append(path)
                elif kind == "list" and key in _POINT_LIST_FIELDS.get(section, ()):
                    hidden = set(item.get("hidden_values") or [])
                    paths.extend(
                        f"{path}.{index}"
                        for index, value in enumerate(item.get("values") or [])
                        if value and value not in hidden
                    )
        return paths
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


def _chunk_segments(texts: list[str]) -> list[list[str]]:
    """按原顺序切块：每块 ≤_BATCH_MAX_ITEMS 段且 ≤_BATCH_MAX_CHARS 字符。"""
    chunks: list[list[str]] = []
    current: list[str] = []
    current_chars = 0
    for text in texts:
        if current and (
            len(current) >= _BATCH_MAX_ITEMS or current_chars + len(text) > _BATCH_MAX_CHARS
        ):
            chunks.append(current)
            current = []
            current_chars = 0
        current.append(text)
        current_chars += len(text)
    if current:
        chunks.append(current)
    return chunks


def _parse_batch_translations(raw: str, *, expected: int) -> list[str] | None:
    """批量响应 → 逐段译文；条数或类型不符返回 None，由调用方回退逐段翻译。

    这里刻意不"尽力挑出能用的部分"：条数/顺序对不上时，把第 N 段译文的错位风险
    摊到整份简历上，比多花几次模型调用糟糕得多。
    """
    try:
        data = parse_json_object(raw, label="批量翻译")
    except LLMError:
        return None
    items = data.get("translations")
    if not isinstance(items, list) or len(items) != expected:
        return None
    if not all(isinstance(item, str) and item.strip() for item in items):
        return None
    return [item.strip() for item in items]


async def _translate_chunk(
    provider: BaseLLMProvider, texts: list[str], direction: str
) -> list[str]:
    """一次调用翻译一块；解析/校验失败时该块回退逐段 translate()（正确性优先）。"""
    prompt = (
        _load_prompt("resume_translate_batch.md")
        .replace("{{ direction }}", direction)
        .replace("{{ count }}", str(len(texts)))
        .replace("{{ segments }}", json.dumps(texts, ensure_ascii=False))
    )
    raw = await provider.chat(
        [
            {"role": "system", "content": _UNTRUSTED_SYSTEM},
            {"role": "user", "content": prompt},
        ]
    )
    translations = _parse_batch_translations(raw, expected=len(texts))
    if translations is not None:
        return translations
    logger.warning("批量翻译响应不可用（%d 段），回退逐段翻译", len(texts))
    return [await translate(provider, text, direction) for text in texts]


async def _translate_segments(
    provider: BaseLLMProvider, texts: list[str], direction: str
) -> list[str]:
    """按顺序翻译全部可译段；单段直接走原有 translate()，多段按块批量翻译。"""
    if not texts:
        return []
    if len(texts) == 1:
        return [await translate(provider, texts[0], direction)]
    translations: list[str] = []
    for chunk in _chunk_segments(texts):
        if len(chunk) == 1:
            translations.append(await translate(provider, chunk[0], direction))
        else:
            translations.extend(await _translate_chunk(provider, chunk, direction))
    return translations


def _glossary_locked_translation(
    path: str,
    text: str,
    translated: str,
    glossary_terms: list[ResumeGlossaryTerm],
    *,
    blocked: list[str],
    glossary_hits: list[dict[str, str]],
) -> str | None:
    """套用术语锁定（与逐段路径同一套语义）：命中锁定词但译文里没有 → blocked。

    返回可写回候选的译文；None 表示该字段保留原文并已记入 blocked。
    """
    for term in glossary_terms:
        if term.source_term not in text:
            continue
        if term.target_term not in translated:
            blocked.append(path)
            return None
        glossary_hits.append({"source": term.source_term, "target": term.target_term})
        translated = translated.replace(term.source_term, term.target_term)
    return translated


async def build_translation_candidate(
    db: Session,
    provider: BaseLLMProvider,
    variant: ResumeVariant,
    *,
    target_language: str,
) -> dict[str, Any]:
    """生成翻译候选（不写库）：批量翻译 + 术语锁定 + 事实锁校验。"""
    if target_language not in _TARGET_LANGUAGES:
        raise BilingualError("目标语言不受支持")
    source = source_language_of(variant, target_language)
    if source == target_language:
        raise BilingualError("目标语言与当前变体语言相同")
    direction = _direction(source, target_language)
    original = document_io.ensure_document_version(
        variant.content,
        language=source,
        format_config=(variant.render_context or {}).get("format_config") or {},
    )
    candidate = copy.deepcopy(original)
    glossary_terms = resume_glossary.list_locked_terms(
        db, language_from=source, language_to=target_language
    )
    glossary_hits: list[dict[str, str]] = []
    blocked: list[str] = []
    # 先按 translatable_paths 的顺序收集全部可译段，再一次性按块翻译：顺序语义与逐段
    # 路径完全一致（同一个列表、同一个索引），只是把 N 次模型调用压成 1–3 次。
    segments: list[tuple[str, str]] = []
    for path in translatable_paths(original):
        text = _read_path(original, path)
        if isinstance(text, str) and text.strip():
            segments.append((path, text))
    translations = await _translate_segments(provider, [text for _, text in segments], direction)
    for (path, text), translated in zip(segments, translations, strict=True):
        locked = _glossary_locked_translation(
            path, text, translated, glossary_terms, blocked=blocked, glossary_hits=glossary_hits
        )
        if locked is not None:
            _write_path(candidate, path, locked)
    blocked.extend(_fact_lock_blocked(db, variant, candidate))
    blocked.extend(_restore_locked_entries(variant, candidate))
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
    # 候选出厂必须是 v2：前端拿到后既可直接预览，也会被采纳路径按 v2 路径写回。
    candidate_document = document_io.ensure_document_version(
        candidate,
        language=target_language,
        format_config=(variant.render_context or {}).get("format_config") or {},
    )
    return {
        "variant_id": variant.id,
        "source_language": source,
        "target_language": target_language,
        "candidate": candidate_document,
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


def _restore_locked_entries(variant: ResumeVariant, candidate: dict[str, Any]) -> list[str]:
    """正文锁在候选里也不展示改动：锁定条目整条回填原文，并记入 blocked_fields。

    基准是**变体自己的旧内容**（候选与采纳都写变体），不能用当前简历的 lock 标记：
    变体是独立表达对象，母版的锁/未锁状态与它无关。
    """
    if candidate.get("version") == 2:
        old_document = document_io.ensure_document_version(variant.content)
        blocked: list[str] = []
        for key, old_entry in iter_entries(old_document):
            if not old_entry.get("lock_content"):
                continue
            target = next(
                (
                    entry
                    for section, entry in iter_entries(candidate)
                    if section == key and entry.get("id") == old_entry.get("id")
                ),
                None,
            )
            if target is None:
                blocked.append(f"{key}.{old_entry['id']}")
                continue
            if entry_content_payload(old_entry) != entry_content_payload(target):
                blocked.append(f"{key}.{old_entry['id']}")
            target.clear()
            target.update(copy.deepcopy(old_entry))
        return blocked
    old_content = variant.content or {}
    blocked: list[str] = []
    for field in ENTRY_FIELDS:
        old_entries = old_content.get(field) or []
        new_entries = candidate.get(field)
        if not isinstance(old_entries, list) or not isinstance(new_entries, list):
            continue
        for index, old_entry in enumerate(old_entries):
            if not isinstance(old_entry, dict) or not old_entry.get("lock_content"):
                continue
            target_index: int | None = None
            object_id = old_entry.get("id")
            if is_object_id(object_id):
                for candidate_index, entry in enumerate(new_entries):
                    if isinstance(entry, dict) and entry.get("id") == object_id:
                        target_index = candidate_index
                        break
            if target_index is None and index < len(new_entries):
                candidate_entry = new_entries[index]
                other_id = candidate_entry.get("id") if isinstance(candidate_entry, dict) else None
                same_object = not (
                    is_object_id(object_id) and is_object_id(other_id) and other_id != object_id
                )
                if same_object:
                    target_index = index
            if target_index is None:
                continue
            if entry_content_payload(old_entry) != entry_content_payload(new_entries[target_index]):
                blocked.append(f"{field}.{target_index}")
            new_entries[target_index] = copy.deepcopy(old_entry)
    return blocked


def adopt_translation(
    db: Session, variant: ResumeVariant, items: list[dict[str, str]]
) -> tuple[ResumeVariant, list[str]]:
    """逐项采纳：只写列出的路径；任何一条不合法/触发事实锁/正文锁 → 整批不落库。

    锁校验的两个基准必须分开：事实锁挂在当前简历上（按路径比对锁定值），正文锁挂在
    **变体自己的旧内容**上（变体是独立表达对象，母版的 lock_content 标记与它无关）。
    """
    # 采纳写的是 v2 文档本身：路径支持 v2 item path（{section}.{entry}.{item} / header.{item}）
    # 与 v1 旧路径（映射到对应 item），未列出的 item（位置/版式/隐藏）一个都不动。
    content = document_io.ensure_document_version(
        variant.content or {},
        language=(variant.render_context or {}).get("language") or None,
        format_config=(variant.render_context or {}).get("format_config") or {},
    )
    applied: list[str] = []
    for item in items:
        path = str(item.get("path") or "").strip()
        text = item.get("text")
        if not path or not isinstance(text, str) or not text.strip():
            raise BilingualError("采纳项缺少路径或正文")
        current = read_document_path(content, path)
        if not isinstance(current, str):
            raise BilingualError(f"采纳路径不存在或不是文本：{path}")
        if not write_document_path(content, path, text.strip()):
            raise BilingualError(f"采纳路径写入失败：{path}")
        applied.append(path)
    # 锁校验两侧都折成 v1 分析视图（validate_content_locks_for 内部统一收口）。
    violations = validate_content_locks_for(variant.content or {}, content)
    record = db.get(ResumeRecord, variant.resume_id) if variant.resume_id else None
    if record is not None:
        violations = fact_locks.validate_fact_locks(db, record, content) + violations
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
