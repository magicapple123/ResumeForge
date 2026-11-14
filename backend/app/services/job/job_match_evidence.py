# SPDX-License-Identifier: Apache-2.0
"""从 ``job_match`` 拆出：模型结论的**证据核对**（防虚构护栏，纯函数）。

把每条判断的 ``jd_quote`` / ``evidence`` 拿去和招聘原文、资料/简历文本逐字核对：
整段命中即放行，否则按子句拆开做字符 3-gram 容错（容纳模型轻度改写）。
``job_match.py`` 的模块命名空间里 re-export ``validate_evidence``。
"""

from __future__ import annotations

import re

from ...schemas.job_match import JobMatchResult
from ..llm.base import LLMError

_NO_EVIDENCE_HINTS = ("未提供", "无相关", "资料中未", "简历中未")


# 证据核对的子句级容错参数：实质子句的字符 3-gram 包含率需不低于该阈值。
_CLAUSE_SPLIT_RE = re.compile(r"[。；;！!？?，,、]")
_MIN_CLAUSE_CHARS = 6
_NGRAM_SIZE = 3
_INCLUSION_THRESHOLD = 0.7


def _normalize(value: str) -> str:
    return "".join(str(value).split()).casefold()


def _has_no_evidence_hint(evidence: str) -> bool:
    return any(hint in evidence for hint in _NO_EVIDENCE_HINTS)


def _char_ngrams(text: str, n: int = _NGRAM_SIZE) -> set[str]:
    """字符 n-gram 集合；长度不足 n 时退回整体作为一个 gram，便于短串也参与核对。"""
    if not text:
        return set()
    if len(text) < n:
        return {text}
    return {text[i : i + n] for i in range(len(text) - n + 1)}


def _clause_inclusion_ok(clause: str, normalized_source: str, threshold: float) -> bool:
    """单个实质子句能否在来源里核对到：先整段子串，再退到字符 3-gram 包含率。"""
    if not clause or not normalized_source:
        return False
    if clause in normalized_source:
        return True
    clause_grams = _char_ngrams(clause)
    source_grams = _char_ngrams(normalized_source)
    if not clause_grams or not source_grams:
        return False
    return len(clause_grams & source_grams) / len(clause_grams) >= threshold


def _candidate_in_sources(
    normalized_candidate: str, normalized_sources: list[str], threshold: float
) -> bool:
    """判断候选片段（证据 / 招聘原文摘录）能否在来源里核对到。

    防虚构护栏保留，但放宽匹配方式：整段子串命中即放行；否则按子句拆分，对每个
    实质子句用字符 3-gram 包含率容错（容纳模型轻度改写）。任一实质子句核对不上仍拒绝。
    """
    if not normalized_candidate:
        return True
    if any(normalized_candidate in source for source in normalized_sources):
        return True
    clauses = [
        clause
        for clause in re.split(_CLAUSE_SPLIT_RE, normalized_candidate)
        if len(clause) >= _MIN_CLAUSE_CHARS
    ]
    probes = clauses or [normalized_candidate]
    for probe in probes:
        if not any(_clause_inclusion_ok(probe, source, threshold) for source in normalized_sources):
            return False
    return True


def validate_evidence(result: JobMatchResult, jd_source: str, personal_source: str) -> None:
    """核对每条判断的出处：JD 原文片段必须在 JD 里，证据必须在资料/简历里或是"未提供"。"""
    normalized_jd = _normalize(jd_source)
    normalized_personal = _normalize(personal_source)
    conditions = [*result.hard_conditions, *result.core_abilities, *result.bonus_items]
    for condition in conditions:
        quote = condition.jd_quote.strip()
        if quote and not _candidate_in_sources(
            _normalize(quote), [normalized_jd], _INCLUSION_THRESHOLD
        ):
            raise LLMError("模型返回的匹配结论缺少招聘原文依据，请重试", retryable=True)
        evidence = condition.evidence.strip()
        if not evidence:
            continue
        if _has_no_evidence_hint(evidence):
            continue
        if not _candidate_in_sources(
            _normalize(evidence),
            [normalized_personal, normalized_jd],
            _INCLUSION_THRESHOLD,
        ):
            raise LLMError("模型返回的匹配证据无法在资料或简历中核对，请重试", retryable=True)
