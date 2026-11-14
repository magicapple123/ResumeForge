"""校验 AI 给出的"这个框可能是什么字段"建议，同时保留旧的 tuple 调用方式。

为什么要校验：模型返回的是自由 JSON——``index`` 可能是 bool（``True`` 会被当成 1）、
``confidence`` 可能是 NaN 或越界、``field`` 可能是字段目录里没有的键。这里只放行
"索引在本次页面里、字段在目录里、置信度有限且 0~1"的项，每个 index 最多留 3 个候选。

``FieldCandidates`` 继承 tuple：老调用方按下标/元组比较仍然成立，但置信度与证据挂在
``assessments`` 上。**元数据里永远不放字段值**，避免把用户资料带进日志或提示词回显。
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

MAX_CANDIDATES = 3
MIN_AI_CONFIDENCE = 0.7
MAX_EVIDENCE_CHARS = 160


@dataclass(frozen=True)
class AiAssessment:
    confidence: float | None = None
    evidence: str = ""


class FieldCandidates(tuple[str, ...]):
    """Ranked keys compare like legacy tuples; metadata never contains values."""

    assessments: dict[str, AiAssessment]

    def __new__(cls, fields: Iterable[str], assessments: dict[str, AiAssessment]):
        instance = super().__new__(cls, fields)
        instance.assessments = assessments
        return instance


def parse_matches(
    raw: Any, allowed: set[int], allowed_fields: Iterable[str]
) -> dict[int, tuple[str, ...]]:
    if not isinstance(raw, list):
        return {}
    known = frozenset(allowed_fields)
    ranked: dict[int, dict[str, AiAssessment]] = {}
    for item in raw:
        if not isinstance(item, dict) or isinstance(item.get("index"), bool):
            continue
        try:
            index = int(item["index"])
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        field = str(item.get("field") or "").strip()
        if index not in allowed or field not in known:
            continue
        confidence = item.get("confidence")
        if confidence is not None:
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                continue
            if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                continue
            confidence = float(confidence)
        evidence = item.get("evidence")
        evidence = evidence.strip()[:MAX_EVIDENCE_CHARS] if isinstance(evidence, str) else ""
        bucket = ranked.setdefault(index, {})
        if field not in bucket and len(bucket) < MAX_CANDIDATES:
            bucket[field] = AiAssessment(confidence=confidence, evidence=evidence)
    return {index: FieldCandidates(fields, fields) for index, fields in ranked.items()}
