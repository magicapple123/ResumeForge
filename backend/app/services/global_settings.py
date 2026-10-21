# SPDX-License-Identifier: Apache-2.0
"""全局设置文件 `data/global_settings.json`：文件 IO、原子写、主题偏好。

为什么不能放进数据库：一份数据集就是一整个 SQLite 文件，"用哪套模型""界面什么主题"
都是**跨数据集**的偏好——用户切到另一份数据时，不该被迫重新填一遍 API Key，也不该
每次都被打回浅色。放库内意味着每个数据集各存一份、彼此看不见。

本模块只负责**文件这一层**：

- 读：坏 JSON / 权限错误一律降级为"没有全局设置"，不抛错（应用要能起来）；
- 写：临时文件 + 原子替换，断电或崩溃时要么旧文件、要么新文件；
- 结构迁移：v1（单个 `llm.config`）→ v2（`llm.profiles[]`）。

模型配置的语义（哪条生效、记录的增删改、从数据集一次性迁移）在
`services/global_llm_profiles.py`；主题在文件末尾。拆开是为了守住 500 行预算，
也让"文件怎么存"与"配置怎么用"各自可测。

文件里只放**加密后**的 API Key（与库内同一套 DPAPI/密钥机制）。LLM 配置（含密钥
策略）经备份包的 ``global_llm.json`` 成员随包导出、导入时合并回本机；**主题等其它
全局偏好不导出**——换个环境时"用哪条模型配置"值得带走，"界面是深色还是浅色"不值得。
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import secrets
import threading
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
MAX_PROFILES = 50
MAX_NAME_LENGTH = 64

# 所有写操作串行化：两个请求同时读-改-写会把对方的 profile 覆盖掉。
write_lock = threading.Lock()

_THEME_MODES = ("light", "dark", "system")


def path() -> Path:
    return Path(DATA_DIR) / GLOBAL_SETTINGS_FILENAME


def read_raw() -> dict[str, Any] | None:
    target = path()
    try:
        raw = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:
        logger.warning("全局设置读取失败，按未配置处理：%s", exc)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 坏文件不删：用户可能手工编辑过，留着比默默丢掉更好排查。
        logger.warning("全局设置不是合法 JSON，已忽略：%s", target)
        return None
    return data if isinstance(data, dict) else None


def write_state_unlocked(state: dict[str, Any]) -> None:
    """原子写；调用方必须持有 :data:`write_lock`。"""
    target = path()
    target.parent.mkdir(parents=True, exist_ok=True)
    # 随机后缀：两个进程/线程即使错过了锁，也不会写同一个临时文件。
    temp = target.with_name(f".{target.name}.{secrets.token_hex(4)}.tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    # 只给当前用户读写：文件里有加密后的密钥，也不需要让同机其他人看见模型配置。
    with contextlib.suppress(OSError):
        os.chmod(temp, 0o600)
    temp.replace(target)


def new_profile_id() -> str:
    return f"p_{secrets.token_hex(6)}"


def _v1_to_v2(data: dict[str, Any]) -> dict[str, Any] | None:
    """v1（``llm.config``）→ v2（单 profile + active）。保留其他顶层键（如 theme）。"""
    block = data.get("llm")
    if not isinstance(block, dict):
        return None
    raw_config = block.get("config")
    if not isinstance(raw_config, dict):
        return None
    profile_id = new_profile_id()
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
            # v1 的 enabled 保留为历史字段；v2 起"有 profile 即生效"，见 profiles 模块。
            "enabled": bool(block.get("enabled")),
            "active_profile_id": profile_id,
            "profiles": [profile],
        },
    }


def load_state() -> dict[str, Any] | None:
    """读并归一化为 v2。v1 迁移后尽力写回；写回失败不影响本次读取。"""
    data = read_raw()
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
        if write_lock.locked():
            return migrated
        try:
            with write_lock:
                write_state_unlocked(migrated)
            logger.info("全局设置已从 v1 迁移到 v2")
        except OSError as exc:
            # 迁移失败不能导致"读不到配置"：本次仍用内存里的迁移结果。
            logger.warning("全局设置 v1→v2 写回失败，本次按迁移结果读取：%s", exc)
        return migrated
    return None


def fresh_state() -> dict[str, Any]:
    return {
        "version": GLOBAL_SETTINGS_VERSION,
        "llm": {"enabled": False, "active_profile_id": "", "profiles": []},
    }


def mutate_state(mutate) -> dict[str, Any]:
    """统一「读-改-写」：合并顶层键而不是重建，保存模型不会抹掉 theme，反之亦然。"""
    with write_lock:
        state = load_state() or fresh_state()
        mutate(state)
        write_state_unlocked(state)
        return state


def profiles_of(state: dict[str, Any]) -> list[dict[str, Any]]:
    block = state.get("llm")
    if not isinstance(block, dict):
        return []
    items = block.get("profiles")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id")]


def active_profile_of(state: dict[str, Any]) -> dict[str, Any] | None:
    items = profiles_of(state)
    if not items:
        return None
    block = state.get("llm") or {}
    active_id = str(block.get("active_profile_id") or "")
    for item in items:
        if item.get("id") == active_id:
            return item
    # active 指向已删除的 id：回落到第一个，避免"配了却永远不生效"。
    return items[0]


def find_profile_by_name(state: dict[str, Any], name: str) -> dict[str, Any] | None:
    """按名称找记录（名称在本地唯一；导入合并依赖这条约束）。"""
    for item in profiles_of(state):
        if str(item.get("name") or "") == name:
            return item
    return None


def find_profile(state: dict[str, Any], profile_id: str) -> dict[str, Any] | None:
    for item in profiles_of(state):
        if item.get("id") == profile_id:
            return item
    return None


def clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("配置名称不能为空")
    return cleaned[:MAX_NAME_LENGTH]


def clean_models(models: Any) -> list[str]:
    if models is None:
        return []
    if not isinstance(models, list) or any(not isinstance(item, str) for item in models):
        raise ValueError("models 必须是字符串列表")
    return [item.strip() for item in models if item.strip()]


def store_config(config: LLMConfig) -> dict[str, Any]:
    """加密密钥后落盘（其他字段原样保留）。"""
    return config.model_copy(update={"api_key": encrypt_key(config.api_key)}).model_dump()


def decrypt_config(profile: dict[str, Any]) -> LLMConfig | None:
    raw_config = profile.get("config")
    if not isinstance(raw_config, dict):
        return None
    try:
        config = LLMConfig.model_validate(raw_config)
    except ValidationError:
        logger.warning("全局模型配置字段非法，已忽略；请在设置页重新保存")
        return None
    return config.model_copy(update={"api_key": decrypt_key(config.api_key)})


def read_theme() -> str | None:
    """顶层主题偏好；没存过、文件损坏或值不认识时返回 None（交给本地兜底）。"""
    state = load_state()
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

    mutate_state(_apply)
    logger.info("已保存全局主题 mode=%s", mode)


__all__ = [
    "GLOBAL_SETTINGS_FILENAME",
    "GLOBAL_SETTINGS_VERSION",
    "MAX_NAME_LENGTH",
    "MAX_PROFILES",
    "active_profile_of",
    "clean_models",
    "clean_name",
    "decrypt_config",
    "find_profile",
    "fresh_state",
    "load_state",
    "mutate_state",
    "new_profile_id",
    "path",
    "profiles_of",
    "read_raw",
    "read_theme",
    "store_config",
    "write_lock",
    "write_state_unlocked",
    "write_theme",
]
