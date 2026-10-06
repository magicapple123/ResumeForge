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
_events: deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)
_lock = threading.Lock()


def _safe_value(key: str, value: Any) -> Any:
    if _SENSITIVE_KEY.search(key):
        return "<redacted>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        text = value.replace("\r", " ").replace("\n", " ").strip()
        return text[:_MAX_TEXT_LENGTH] + "…" if len(text) > _MAX_TEXT_LENGTH else text
    if isinstance(value, (list, tuple)):
        return [_safe_value(key, item) for item in value[:20]]
    if isinstance(value, dict):
        return {str(item_key): _safe_value(str(item_key), item_value) for item_key, item_value in value.items()}
    return str(value)[:_MAX_TEXT_LENGTH]


def record_event(event: str, **details: Any) -> None:
    """记录不含简历内容和表单值的用户可导出事件。"""
    item = {
        "at": datetime.now(UTC).isoformat(),
        "event": str(event),
        "request_id": get_request_id(),
        "details": {key: _safe_value(key, value) for key, value in details.items()},
    }
    with _lock:
        _events.append(item)


def diagnostic_snapshot(*, limit: int = 200) -> dict[str, Any]:
    """返回最近的脱敏事件，供用户导出后连同截图提交。"""
    with _lock:
        events = list(_events)[-max(1, min(int(limit), _MAX_EVENTS)) :]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "app_version": get_settings().app_version,
        "events": events,
    }


__all__ = ["diagnostic_snapshot", "record_event"]
