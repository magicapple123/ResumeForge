# SPDX-License-Identifier: Apache-2.0
"""面向用户排障的脱敏运行事件缓冲区。"""

from __future__ import annotations

import re
import threading
from collections import deque
from datetime import UTC, datetime
from typing import Any

from ..config import get_settings
from ..middleware import get_request_id

_MAX_EVENTS = 300
_MAX_TEXT_LENGTH = 160
_SENSITIVE_KEY = re.compile(r"(?:token|secret|password|passwd|api.?key|cookie|email|phone|value)", re.I)

# 内容级 PII 清洗（RF-20）：键名 denylist 之外，自由文本值（异常 message、
# 带查询参数的 path 等）可能携带个人信息，这里按内容模式兜底。模式集中一处、
# 可测试；命中即替换为 "<redacted>"，替换计数供审计事件使用（不含原值）。
_PII_TEXT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 18 位身份证号（含末位校验码 X）
    ("id_card", re.compile(r"(?<!\d)\d{17}[0-9Xx](?!\d)")),
    # 11 位手机号（1 开头第二位 3-9，前后不能还是数字）
    ("phone", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    # 邮箱地址
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")),
    # Authorization 头里的 Bearer 令牌
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")),
    # OpenAI 风格密钥前缀
    ("api_key", re.compile(r"\bsk-[A-Za-z0-9_-]{8,}")),
)
_PII_REPLACEMENT = "<redacted>"

_events: deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)
_lock = threading.Lock()


def sanitize_text(text: str) -> tuple[str, int]:
    """对自由文本做内容级 PII 清洗，返回 (清洗后文本, 命中次数)。"""
    hits = 0
    for _name, pattern in _PII_TEXT_PATTERNS:
        text, count = pattern.subn(_PII_REPLACEMENT, text)
        hits += count
    return text, hits


def _safe_value(key: str, value: Any, redactions: list[int]) -> Any:
    if _SENSITIVE_KEY.search(key):
        return "<redacted>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        text = value.replace("\r", " ").replace("\n", " ").strip()
        text, hits = sanitize_text(text)
        redactions[0] += hits
        return text[:_MAX_TEXT_LENGTH] + "…" if len(text) > _MAX_TEXT_LENGTH else text
    if isinstance(value, (list, tuple)):
        return [_safe_value(key, item, redactions) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(item_key): _safe_value(str(item_key), item_value, redactions)
            for item_key, item_value in value.items()
        }
    return str(value)[:_MAX_TEXT_LENGTH]


def _build_item(event: str, details: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """组装一条脱敏事件；返回 (事件对象, 内容级清洗命中数)。"""
    redactions = [0]
    clean_event, hits = sanitize_text(str(event))
    redactions[0] += hits
    clean_details = {key: _safe_value(key, value, redactions) for key, value in details.items()}
    item = {
        "at": datetime.now(UTC).isoformat(),
        "event": clean_event,
        "request_id": get_request_id(),
        "details": clean_details,
    }
    return item, redactions[0]


def _append_locked(item: dict[str, Any]) -> None:
    _events.append(item)


def record_event(event: str, **details: Any) -> None:
    """记录不含简历内容和表单值的用户可导出事件。

    键名 denylist 之外还会对自由文本做内容级 PII 清洗；有命中时补记一条
    ``diagnostics.sanitized`` 审计事件（只有计数、不含原值），便于导出方确认
    该包经过清洗。
    """
    item, redactions = _build_item(event, details)
    with _lock:
        _append_locked(item)
    if redactions:
        audit, _ = _build_item(
            "diagnostics.sanitized",
            {"event": event, "count": redactions},
        )
        # 审计事件引用的原始 event 名也要脱敏后再进缓冲区（上面 _build_item 已做）。
        with _lock:
            _append_locked(audit)


def diagnostic_snapshot(*, limit: int = 200) -> dict[str, Any]:
    """返回最近的脱敏事件，供用户导出后连同截图提交。"""
    with _lock:
        events = list(_events)[-max(1, min(int(limit), _MAX_EVENTS)) :]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "app_version": get_settings().app_version,
        "events": events,
    }


__all__ = ["diagnostic_snapshot", "record_event", "sanitize_text"]
