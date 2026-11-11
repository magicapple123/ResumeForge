# SPDX-License-Identifier: Apache-2.0
"""来源状态与失败分类（P4-02 / P4-09 / P4-10 共用）。

``error_kind`` 只有四种，且**必须**只有四种——它是给用户看的措辞选择依据：

====================  ==========================================================
``config``            配置问题：没配 Key、Key 无效（401/403）、余额不足（402）。
                      用户要做的是"去设置页改"，不是"等一会儿再试"。
``rate``              限流/上游故障：429、5xx。用户要做的是"稍后重试"。
``network``           连不上、超时、被丢弃。用户要做的是"检查网络"。
``parse``             响应不是预期格式（HTML 登录页、坏 JSON）。用户做不了什么，
                      但排查时要能和"网络不通"分开（对应 Bing RSS 结构变更那条）。
====================  ==========================================================

``ok`` 的条目不带 ``error_kind``（空串），避免前端出现"成功了但错误类型是 X"这种自相矛盾。
"""

from __future__ import annotations

from typing import Any

import httpx

CONFIG = "config"
RATE = "rate"
NETWORK = "network"
PARSE = "parse"
ERROR_KINDS = frozenset({CONFIG, RATE, NETWORK, PARSE})

#: 各 provider 内部用的失败标记 → 统一分类（DeepSeek/Tavily/Jina 共用同一张表）。
_FAILURE_KINDS = {
    "missing_key": CONFIG,
    "empty_query": CONFIG,
    "unauthorized": CONFIG,
    "forbidden": CONFIG,
    "insufficient_balance": CONFIG,
    "rate_limited": RATE,
    "network": NETWORK,
    "timeout": NETWORK,
    "bad_json": PARSE,
    "bad_format": PARSE,
}


def error_kind_for_status(status: int) -> str:
    """HTTP 状态码 → ``error_kind``。"""
    if status in {401, 402, 403, 400, 404, 422}:
        return CONFIG
    if status == 429 or status >= 500:
        return RATE
    return NETWORK


def error_kind_for_failure(failure: str | None) -> str:
    """provider 内部的失败标记 → ``error_kind``；未登记的按 ``network`` 兜底。"""
    label = str(failure or "").strip().casefold()
    if not label:
        return ""
    if label in _FAILURE_KINDS:
        return _FAILURE_KINDS[label]
    if label.startswith("http_"):
        try:
            return error_kind_for_status(int(label[len("http_") :]))
        except ValueError:
            return NETWORK
    return NETWORK


def classify_exception(exc: BaseException) -> str:
    """未预料异常 → ``error_kind``（``gather`` 里 ``return_exceptions`` 的那条兜底）。"""
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return NETWORK
    if isinstance(exc, httpx.HTTPStatusError):
        return error_kind_for_status(exc.response.status_code)
    if isinstance(exc, (httpx.RequestError, httpx.HTTPError, OSError)):
        return NETWORK
    if isinstance(exc, ValueError):
        return PARSE
    return NETWORK


def status_entry(source: str, *, ok: bool, elapsed_ms: int, error_kind: str = "") -> dict[str, Any]:
    """``source_status`` 的一条：``{source, ok, elapsed_ms, error_kind}``。"""
    return {
        "source": source,
        "ok": bool(ok),
        "elapsed_ms": int(elapsed_ms),
        "error_kind": "" if ok else (error_kind or NETWORK),
    }


def summarize(status: list[dict[str, Any]]) -> str:
    """给日志用的单行摘要：``bing ok 820ms; deepseek config``。"""
    parts = []
    for item in status:
        source = str(item.get("source") or "?")
        if item.get("ok"):
            parts.append(f"{source} ok {item.get('elapsed_ms')}ms")
        else:
            parts.append(f"{source} {item.get('error_kind') or NETWORK}")
    return "; ".join(parts)


__all__ = [
    "CONFIG",
    "ERROR_KINDS",
    "NETWORK",
    "PARSE",
    "RATE",
    "classify_exception",
    "error_kind_for_failure",
    "error_kind_for_status",
    "status_entry",
    "summarize",
]
