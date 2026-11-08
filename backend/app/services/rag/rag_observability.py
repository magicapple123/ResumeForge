# SPDX-License-Identifier: Apache-2.0
"""RAG 运行日志的唯一出口：只允许标识 / 计数 / 枚举 / 哈希，没有自由文本字段。

计划 §5 规定日志只记 provider、模型版本、候选数量、命中来源、耗时、回退原因、
索引版本和哈希前缀，禁止完整 JD / 简历条目 / embedding 数组 / API Key / 私密字段。
本模块把这条纪律做成**结构**而不是约定：

- RagEvent 的 7 个字段只有标识、计数、枚举与哈希——类型里没有可放正文的位置，
  调用方想记 JD 原文也无处可放；
- sanitize_event 只认这 7 个键（未知键丢弃），字符串先脱敏再截断、哈希只留前缀、
  命中来源去重保序；传 dict 时同样只保留白名单键，防止"多塞一个字段"；
- log_rag_event 把每个字符串值都送进 runtime.log_redact.redact_sensitive_text
  （仓库唯一脱敏实现），误传 sk- 密钥只会留下 sk-***；
- hash_prefix 让归因只依赖指纹前缀，日志无法反推条目内容。
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, fields
from typing import Any, TypedDict

from ...runtime.log_redact import redact_sensitive_text

#: 回退原因常量族（计划 §5 / §8）：日志里只出现这些枚举值，不出现异常原文。
FALLBACK_REASONS: tuple[str, ...] = (
    "disabled",
    "not_configured",
    "timeout",
    "provider_error",
    "invalid_response",
    "index_missing",
    "empty_vectors",
    # 编排层真实会产出的几类：索引为空、未归类的实现异常、fake provider 被默认禁用、
    # 请求预算内来不及编码（仍只记枚举，不记原文）。
    "empty_index",
    "exception",
    "fake_provider",
    "budget_exceeded",
)

#: 字符串字段截断上限：provider/model 是外部输入位，截断封死"任意长文本进日志"。
_TEXT_MAX_CHARS = 64
#: 哈希前缀最大长度（16 个 hex = 64 bit：足够归因，不足以反推内容）。
HASH_PREFIX_MAX_CHARS = 16


@dataclass(frozen=True)
class RagEvent:
    """一次 RAG 运行的可记录事实。

    **刻意没有 query / text / jd / resume 等自由文本字段**：需要说明"为什么命中"
    时只填 hit_sources 与 hash_prefixes，原文与条目正文永远不进入这里。
    """

    provider: str
    model: str
    candidate_count: int
    hit_sources: tuple[str, ...] = ()
    elapsed_ms: float = 0.0
    fallback_reason: str = ""
    hash_prefixes: tuple[str, ...] = ()


class SanitizedRagEvent(TypedDict):
    """sanitize_event 的输出：RagEvent 的 7 个白名单键（已截断 / 取整 / 脱敏）。"""

    provider: str
    model: str
    candidate_count: int
    hit_sources: tuple[str, ...]
    elapsed_ms: int
    fallback_reason: str
    hash_prefixes: tuple[str, ...]


def hash_prefix(value: str, length: int = 12) -> str:
    """内容哈希前缀；同一内容稳定、不同内容不同，日志里无法反推原文。"""
    digest = hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()
    return digest[: min(max(int(length), 1), HASH_PREFIX_MAX_CHARS)]


def _redacted_text(value: Any, limit: int = _TEXT_MAX_CHARS) -> str:
    """先脱敏再截断：先截断会把跨边界的密钥切成正则认不出的残片，留下危险原文。"""
    return redact_sensitive_text(str(value or "")).strip()[:limit]


def _count(value: Any) -> int:
    """计数 / 耗时统一取非负整数；坏值按 0 记，不让日志因脏数据抛错。"""
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(number, 0)


def _unique_texts(value: Any, limit: int) -> tuple[str, ...]:
    """字符串列表：逐个脱敏截断、去空、去重保序。"""
    if isinstance(value, str):
        items: Iterable[Any] = (value,)
    elif isinstance(value, Iterable) and not isinstance(value, (bytes, bytearray, Mapping)):
        items = value
    else:
        return ()
    result: list[str] = []
    for item in items:
        text = _redacted_text(item, limit)
        if text and text not in result:
            result.append(text)
    return tuple(result)


def _joined(values: tuple[str, ...]) -> str:
    return ",".join(values) or "-"


def sanitize_event(event: RagEvent | Mapping[str, object]) -> SanitizedRagEvent:
    """把事件压成 7 个白名单键的安全表示（未知键直接丢弃）。"""
    raw: Mapping[str, object]
    if isinstance(event, Mapping):
        raw = event
    else:
        raw = {field.name: getattr(event, field.name, None) for field in fields(RagEvent)}
    return {
        "provider": _redacted_text(raw.get("provider")),
        "model": _redacted_text(raw.get("model")),
        "candidate_count": _count(raw.get("candidate_count")),
        "hit_sources": _unique_texts(raw.get("hit_sources"), _TEXT_MAX_CHARS),
        "elapsed_ms": _count(raw.get("elapsed_ms")),
        "fallback_reason": _redacted_text(raw.get("fallback_reason")),
        "hash_prefixes": _unique_texts(raw.get("hash_prefixes"), HASH_PREFIX_MAX_CHARS),
    }


def log_rag_event(logger: logging.Logger, event: RagEvent | Mapping[str, object]) -> None:
    """把事件打成一条 INFO 结构化日志（每个字符串值都过唯一脱敏实现）。"""
    payload = sanitize_event(event)
    line = (
        f"rag event provider={payload['provider'] or '-'}"
        f" model={payload['model'] or '-'}"
        f" candidates={payload['candidate_count']}"
        f" sources={_joined(payload['hit_sources'])}"
        f" elapsed_ms={payload['elapsed_ms']}"
        f" fallback={payload['fallback_reason'] or '-'}"
        f" hashes={_joined(payload['hash_prefixes'])}"
    )
    # 用单参数落盘：record.msg / record.args 里都不留未经清洗的原文。
    logger.info("%s", redact_sensitive_text(line))


__all__ = [
    "FALLBACK_REASONS",
    "HASH_PREFIX_MAX_CHARS",
    "RagEvent",
    "SanitizedRagEvent",
    "hash_prefix",
    "log_rag_event",
    "sanitize_event",
]
