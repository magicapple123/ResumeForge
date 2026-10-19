"""全局模型配置（R21）：存在 `data/global_settings.json`，与数据集无关。

为什么不能放进数据库：一份数据集就是一整个 SQLite 文件，"哪套模型"是**跨数据集**的
偏好——用户切到另一份数据（另一个求职方向）时，不该被迫重新填一遍 API Key。放库内
意味着每个数据集各存一份、彼此看不见。

与数据集内配置的关系（**显式，不猜**）：

- 全局有启用中的 profile 且 ``base_url`` / ``model`` 都非空 → 所有数据集都用它；
- 否则沿用各数据集自己的配置（原有行为，升级后不变）。

schema v2（profiles）：``llm`` 下存 ``enabled`` + ``active_profile_id`` +
``profiles[]``，每个 profile 是一套独立配置（名称、模型/地址、可选模型清单）。
v1（单个 ``llm.config``）在读取时自动迁移成一个名为「默认配置」的 profile 并写回；
写回失败只记 warning，内存里仍按迁移后的结构继续读。

文件里只放**加密后**的 API Key（与库内同一套 DPAPI/密钥机制），与数据集备份包不同：
这个文件不进任何导出包，也不会被"导出全部数据集"带走。

写入采用"临时文件 + 原子替换"：断电或崩溃时要么是旧文件、要么是新文件，不会留半个
JSON 让应用起不来。所有写操作由进程内锁串行化，临时文件名带随机后缀，避免并发写
互相覆盖。读失败（损坏、权限）一律降级为"没有全局配置"，不抛错。
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..config import DATA_DIR
from ..schemas.setting import LLMConfig
from .api_key_crypto import decrypt_key, encrypt_key

logger = logging.getLogger(__name__)

GLOBAL_SETTINGS_FILENAME = "global_settings.json"
GLOBAL_SETTINGS_VERSION = 2
_LEGACY_VERSION = 1
_MAX_PROFILES = 50
_MAX_NAME_LENGTH = 64

# 所有写操作串行化：两个请求同时读-改-写会把对方的 profile 覆盖掉。
_write_lock = threading.Lock()


def _path() -> Path:
    return Path(DATA_DIR) / GLOBAL_SETTINGS_FILENAME


@dataclass(frozen=True)
class GlobalLLM:
    """全局模型配置的**已解密**形态。"""

    enabled: bool
    config: LLMConfig
    # 当前生效的 profile（v2 新增；v1 迁移后同样有值）。
    profile_id: str = ""
    name: str = ""


def _read_raw() -> dict[str, Any] | None:
    path = _path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        logger.warning("全局设置读取失败，按未配置处理：%s", exc)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 坏文件不删：用户可能手工编辑过，留着比默默丢掉更好排查。
        logger.warning("全局设置不是合法 JSON，已忽略：%s", path)
        return None
    return data if isinstance(data, dict) else None


def _write_state_unlocked(state: dict[str, Any]) -> None:
    """原子写；调用方必须持有 ``_write_lock``。"""
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # 随机后缀：两个进程/线程即使错过了锁，也不会写同一个临时文件。
    temp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    # 只给当前用户读写：文件里有加密后的密钥，也不需要让同机其他人看见模型配置。
    with contextlib.suppress(OSError):
        os.chmod(temp, 0o600)
    temp.replace(path)


def _new_profile_id() -> str:
    return f"p_{secrets.token_hex(6)}"


def _v1_to_v2(data: dict[str, Any]) -> dict[str, Any] | None:
    """v1（``llm.config``）→ v2（单 profile + active）。保留其他顶层键（如 theme）。"""
    block = data.get("llm")
    if not isinstance(block, dict):
        return None
    raw_config = block.get("config")
    if not isinstance(raw_config, dict):
        return None
    profile_id = _new_profile_id()
    model = raw_config.get("model")
    profile = {
        "id": profile_id,
        "name": "默认配置",
        "config": dict(raw_config),
        "models": [model] if isinstance(model, str) and model else [],
        "is_default": True,
    }
    return {
        **data,
        "version": GLOBAL_SETTINGS_VERSION,
        "llm": {
            "enabled": bool(block.get("enabled")),
            "active_profile_id": profile_id,
            "profiles": [profile],
        },
    }


def _load_state() -> dict[str, Any] | None:
    """读并归一化为 v2。v1 迁移后尽力写回；写回失败不影响本次读取。"""
    data = _read_raw()
    if not data:
        return None
    version = data.get("version")
    if version == GLOBAL_SETTINGS_VERSION:
        block = data.get("llm")
        if not isinstance(block, dict) or not isinstance(block.get("profiles"), list):
            return None
        return data
    if version == _LEGACY_VERSION:
        migrated = _v1_to_v2(data)
        if migrated is None:
            return None
        # 已经在写操作里（调用方持锁）：本次修改结束时会整体写回 v2，不必在这里抢锁。
        if _write_lock.locked():
            return migrated
        try:
            with _write_lock:
                _write_state_unlocked(migrated)
            logger.info("全局设置已从 v1 迁移到 v2")
        except OSError as exc:
            # 迁移失败不能导致"读不到配置"：本次仍用内存里的迁移结果。
            logger.warning("全局设置 v1→v2 写回失败，本次按迁移结果读取：%s", exc)
        return migrated
    return None


def _profiles(state: dict[str, Any]) -> list[dict[str, Any]]:
    block = state.get("llm")
    if not isinstance(block, dict):
        return []
    items = block.get("profiles")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id")]


def _active_profile(state: dict[str, Any]) -> dict[str, Any] | None:
    items = _profiles(state)
    if not items:
        return None
    active_id = str((state.get("llm") or {}).get("active_profile_id") or "")
    for item in items:
        if item.get("id") == active_id:
            return item
    # active 指向已删除的 id：回落到第一个，避免"配了却永远不生效"。
    return items[0]


def _find_profile(state: dict[str, Any], profile_id: str) -> dict[str, Any] | None:
    for item in _profiles(state):
        if item.get("id") == profile_id:
            return item
    return None


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("配置名称不能为空")
    return cleaned[:_MAX_NAME_LENGTH]


def _clean_models(models: Any) -> list[str]:
    if models is None:
        return []
    if not isinstance(models, list) or any(not isinstance(item, str) for item in models):
        raise ValueError("models 必须是字符串列表")
    return [item.strip() for item in models if item.strip()]


def _store_config(config: LLMConfig) -> dict[str, Any]:
    """加密密钥后落盘（其他字段原样保留）。"""
    return config.model_copy(update={"api_key": encrypt_key(config.api_key)}).model_dump()


def _decrypt_config(profile: dict[str, Any]) -> LLMConfig | None:
    raw_config = profile.get("config")
    if not isinstance(raw_config, dict):
        return None
    try:
        config = LLMConfig.model_validate(raw_config)
    except ValidationError:
        logger.warning("全局模型配置字段非法，已忽略；请在设置页重新保存")
        return None
    return config.model_copy(update={"api_key": decrypt_key(config.api_key)})


def read_global_llm() -> GlobalLLM | None:
    """读取当前生效 profile 的配置；未配置、被关闭或数据损坏时返回 None。"""
    state = _load_state()
    if state is None:
        return None
    block = state.get("llm")
    if not isinstance(block, dict) or not block.get("enabled"):
        return None
    profile = _active_profile(state)
    if profile is None:
        return None
    config = _decrypt_config(profile)
    if config is None:
        return None
    return GlobalLLM(
        enabled=True,
        config=config,
        profile_id=str(profile.get("id") or ""),
        name=str(profile.get("name") or ""),
    )


def global_llm_summary() -> dict[str, Any]:
    """给界面用的摘要：列表 + 当前生效项，**绝不回传密钥**。"""
    empty = {
        "enabled": False,
        "configured": False,
        "provider": "",
        "model": "",
        "base_url": "",
        "active_profile_id": "",
        "active_name": "",
        "profiles": [],
    }
    state = _load_state()
    if state is None:
        return empty
    block = state.get("llm")
    if not isinstance(block, dict):
        return empty
    items = _profiles(state)
    active = _active_profile(state)
    profiles: list[dict[str, Any]] = []
    for item in items:
        raw_config = item.get("config") if isinstance(item.get("config"), dict) else {}
        profiles.append(
            {
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or ""),
                "provider": str(raw_config.get("provider") or ""),
                "model": str(raw_config.get("model") or ""),
                "base_url": str(raw_config.get("base_url") or ""),
                "configured": bool(raw_config.get("base_url") and raw_config.get("model")),
                "is_default": bool(item.get("is_default")),
            }
        )
    active_config = (
        active.get("config")
        if isinstance(active, dict) and isinstance(active.get("config"), dict)
        else {}
    )
    return {
        "enabled": bool(block.get("enabled")),
        "configured": bool(active_config.get("base_url") and active_config.get("model")),
        "provider": str(active_config.get("provider") or ""),
        "model": str(active_config.get("model") or ""),
        "base_url": str(active_config.get("base_url") or ""),
        "active_profile_id": str((active or {}).get("id") or ""),
        "active_name": str((active or {}).get("name") or ""),
        "profiles": profiles,
    }


def _fresh_state() -> dict[str, Any]:
    return {
        "version": GLOBAL_SETTINGS_VERSION,
        "llm": {"enabled": False, "active_profile_id": "", "profiles": []},
    }


def _mutate_state(mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """统一「读-改-写」：合并顶层键而不是重建，保存模型不会抹掉 theme，反之亦然。"""
    with _write_lock:
        state = _load_state() or _fresh_state()
        mutate(state)
        _write_state_unlocked(state)
        return state


def write_global_llm(config: LLMConfig, *, enabled: bool = True) -> None:
    """兼容入口：更新**当前 active profile** 的配置；没有 profile 就新建一个。"""

    def _apply(state: dict[str, Any]) -> None:
        block = state.setdefault("llm", {"enabled": False, "active_profile_id": "", "profiles": []})
        profiles = _profiles(state)
        profile = _active_profile(state)
        if profile is None:
            profile = {
                "id": _new_profile_id(),
                "name": "默认配置",
                "config": {},
                "models": [],
                "is_default": True,
            }
            profiles.append(profile)
            block["profiles"] = profiles
            block["active_profile_id"] = profile["id"]
        profile["config"] = _store_config(config)
        if config.model:
            profile["models"] = [config.model]
        block["enabled"] = bool(enabled)

    _mutate_state(_apply)
    logger.info("已保存全局模型配置 enabled=%s model=%s", enabled, config.model)


def create_profile(name: str, config: LLMConfig, models: list[str] | None = None) -> dict[str, Any]:
    """新建一个 profile；第一个 profile 自动成为 active 与 default。"""
    cleaned_name = _clean_name(name)
    cleaned_models = _clean_models(models)
    with _write_lock:
        state = _load_state() or _fresh_state()
        block = state.setdefault("llm", {"enabled": False, "active_profile_id": "", "profiles": []})
        profiles = _profiles(state)
        if len(profiles) >= _MAX_PROFILES:
            raise ValueError(f"最多保存 {_MAX_PROFILES} 份全局模型配置")
        profile_id = _new_profile_id()
        profile = {
            "id": profile_id,
            "name": cleaned_name,
            "config": _store_config(config),
            "models": cleaned_models or ([config.model] if config.model else []),
            "is_default": not profiles,
        }
        profiles.append(profile)
        block["profiles"] = profiles
        if not block.get("active_profile_id"):
            block["active_profile_id"] = profile_id
        _write_state_unlocked(state)
    logger.info("已新建全局模型 profile id=%s", profile_id)
    return global_llm_summary()


def read_profile_config(profile_id: str) -> LLMConfig | None:
    """读某个 profile 的**已解密**配置（供端点合并"留空保留密钥"）。"""
    state = _load_state()
    if state is None:
        return None
    profile = _find_profile(state, profile_id)
    return _decrypt_config(profile) if profile is not None else None


def update_profile(
    profile_id: str,
    *,
    name: str | None = None,
    config: LLMConfig | None = None,
    models: list[str] | None = None,
    clear_api_key: bool = False,
) -> dict[str, Any]:
    """更新 profile；``config.api_key`` 为空表示保留原密钥，除非 ``clear_api_key``。"""
    cleaned_name = _clean_name(name) if name is not None else None
    cleaned_models = _clean_models(models) if models is not None else None
    with _write_lock:
        state = _load_state()
        profile = _find_profile(state, profile_id) if state is not None else None
        if profile is None:
            raise KeyError(profile_id)
        assert state is not None
        if cleaned_name is not None:
            profile["name"] = cleaned_name
        if config is not None:
            next_config = config
            if clear_api_key:
                next_config = next_config.model_copy(update={"api_key": ""})
            elif not next_config.api_key:
                previous = _decrypt_config(profile)
                if previous is not None:
                    next_config = next_config.model_copy(update={"api_key": previous.api_key})
            profile["config"] = _store_config(next_config)
            if next_config.model:
                profile["models"] = cleaned_models or [next_config.model]
        elif cleaned_models is not None:
            profile["models"] = cleaned_models
        _write_state_unlocked(state)
    logger.info("已更新全局模型 profile id=%s", profile_id)
    return global_llm_summary()


def delete_profile(profile_id: str) -> dict[str, Any]:
    """删除 profile；删掉 active 时切到剩下的第一个，最后一个删掉则关闭全局。"""
    with _write_lock:
        state = _load_state()
        profile = _find_profile(state, profile_id) if state is not None else None
        if profile is None or state is None:
            raise KeyError(profile_id)
        block = state["llm"]
        remaining = [item for item in _profiles(state) if item.get("id") != profile_id]
        block["profiles"] = remaining
        if not remaining:
            block["enabled"] = False
            block["active_profile_id"] = ""
        else:
            if not any(item.get("is_default") for item in remaining):
                remaining[0]["is_default"] = True
            if block.get("active_profile_id") == profile_id:
                block["active_profile_id"] = remaining[0]["id"]
        _write_state_unlocked(state)
    logger.info("已删除全局模型 profile id=%s", profile_id)
    return global_llm_summary()


def activate_profile(profile_id: str) -> dict[str, Any]:
    """切换当前 profile；用户显式选择即视为"对全部数据集生效"。"""
    with _write_lock:
        state = _load_state()
        profile = _find_profile(state, profile_id) if state is not None else None
        if profile is None or state is None:
            raise KeyError(profile_id)
        block = state["llm"]
        block["active_profile_id"] = profile_id
        block["enabled"] = True
        _write_state_unlocked(state)
    logger.info("已切换全局模型 profile id=%s", profile_id)
    return global_llm_summary()


_THEME_MODES = ("light", "dark", "system")


def read_theme() -> str | None:
    """顶层主题偏好；没存过、文件损坏或值不认识时返回 None（交给本地兜底）。"""
    state = _load_state()
    if state is None:
        return None
    mode = state.get("theme")
    return mode if mode in _THEME_MODES else None


def write_theme(mode: str) -> None:
    """保存主题偏好（跨数据集、跨浏览器）；非法值抛 ValueError。"""
    if mode not in _THEME_MODES:
        raise ValueError(f"主题只能是 {'/'.join(_THEME_MODES)}")

    def _apply(state: dict[str, Any]) -> None:
        state["theme"] = mode

    _mutate_state(_apply)
    logger.info("已保存全局主题 mode=%s", mode)


def clear_global_llm() -> None:
    """删除全局配置（回到"每个数据集各用各的"）。"""
    with _write_lock:
        _path().unlink(missing_ok=True)
    logger.info("已清除全局模型配置")


__all__ = [
    "GLOBAL_SETTINGS_FILENAME",
    "GLOBAL_SETTINGS_VERSION",
    "GlobalLLM",
    "activate_profile",
    "clear_global_llm",
    "create_profile",
    "delete_profile",
    "global_llm_summary",
    "read_global_llm",
    "read_profile_config",
    "read_theme",
    "update_profile",
    "write_global_llm",
    "write_theme",
]
