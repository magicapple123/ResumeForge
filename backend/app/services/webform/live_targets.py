"""网申专用浏览器页面的「点哪个填哪个」开关状态。

状态按 CDP target_id 隔离：新页面默认开启，用户关闭某页后只影响该页；
页面消失时清理状态，避免长期持有已关闭标签页。
"""
from __future__ import annotations

from threading import Lock

_lock = Lock()
_enabled: dict[str, bool] = {}


def is_enabled(target_id: str) -> bool:
    key = str(target_id or "").strip()
    with _lock:
        return _enabled.get(key, True)


def set_enabled(target_id: str, enabled: bool) -> bool:
    key = str(target_id or "").strip()
    if not key:
        return bool(enabled)
    with _lock:
        _enabled[key] = bool(enabled)
        return _enabled[key]


def sync(target_ids: set[str]) -> None:
    with _lock:
        for target_id in target_ids:
            _enabled.setdefault(target_id, True)
        for target_id in set(_enabled) - target_ids:
            _enabled.pop(target_id, None)


def snapshot(target_ids: set[str]) -> dict[str, bool]:
    sync(target_ids)
    with _lock:
        return {target_id: _enabled.get(target_id, True) for target_id in target_ids}


def reset() -> None:
    with _lock:
        _enabled.clear()


__all__ = ["is_enabled", "reset", "set_enabled", "snapshot", "sync"]
