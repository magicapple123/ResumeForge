"""全局模型配置（R21）：存在 `data/global_settings.json`，与数据集无关。

为什么不能放进数据库：一份数据集就是一整个 SQLite 文件，"哪套模型"是**跨数据集**的
偏好——用户切到另一份数据（另一个求职方向）时，不该被迫重新填一遍 API Key。放库内
意味着每个数据集各存一份、彼此看不见。

与数据集内配置的关系（**显式，不猜**）：

- 全局配置有 ``enabled: true`` 且 ``base_url`` / ``model`` 都非空 → 所有数据集都用它；
- 否则沿用各数据集自己的配置（原有行为，升级后不变）。

文件里只放**加密后**的 API Key（与库内同一套 DPAPI/密钥机制），与数据集备份包不同：
这个文件不进任何导出包，也不会被"导出全部数据集"带走。

写入采用"临时文件 + 原子替换"：断电或崩溃时要么是旧文件、要么是新文件，不会留半个
JSON 让应用起不来。读失败（损坏、权限）一律降级为"没有全局配置"，不抛错。
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..config import DATA_DIR
from ..schemas.setting import LLMConfig
from .api_key_crypto import decrypt_key, encrypt_key

logger = logging.getLogger(__name__)

GLOBAL_SETTINGS_FILENAME = "global_settings.json"
GLOBAL_SETTINGS_VERSION = 1


def _path() -> Path:
    return Path(DATA_DIR) / GLOBAL_SETTINGS_FILENAME


@dataclass(frozen=True)
class GlobalLLM:
    """全局模型配置的**已解密**形态。"""

    enabled: bool
    config: LLMConfig


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


def read_global_llm() -> GlobalLLM | None:
    """读取全局模型配置；未配置、被关闭或数据损坏时返回 None。"""
    data = _read_raw()
    if not data or data.get("version") != GLOBAL_SETTINGS_VERSION:
        return None
    block = data.get("llm")
    if not isinstance(block, dict) or not block.get("enabled"):
        return None
    raw_config = block.get("config")
    if not isinstance(raw_config, dict):
        return None
    try:
        config = LLMConfig.model_validate(raw_config)
    except ValidationError:
        logger.warning("全局模型配置字段非法，已忽略；请在设置页重新保存")
        return None
    return GlobalLLM(
        enabled=True, config=config.model_copy(update={"api_key": decrypt_key(config.api_key)})
    )


def global_llm_summary() -> dict[str, Any]:
    """给界面用的摘要：只说"有没有、是不是开着、哪个模型"，**不回传密钥**。"""
    data = _read_raw()
    block = (data or {}).get("llm")
    if not isinstance(block, dict):
        return {"enabled": False, "configured": False, "provider": "", "model": "", "base_url": ""}
    raw_config = block.get("config") if isinstance(block.get("config"), dict) else {}
    return {
        "enabled": bool(block.get("enabled")),
        "configured": bool(raw_config.get("base_url") and raw_config.get("model")),
        "provider": str(raw_config.get("provider") or ""),
        "model": str(raw_config.get("model") or ""),
        "base_url": str(raw_config.get("base_url") or ""),
    }


def write_global_llm(config: LLMConfig, *, enabled: bool = True) -> None:
    """保存全局配置（密钥加密后落盘），原子替换。"""
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": GLOBAL_SETTINGS_VERSION,
        "llm": {
            "enabled": bool(enabled),
            "config": config.model_copy(
                update={"api_key": encrypt_key(config.api_key)}
            ).model_dump(),
        },
    }
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    # 只给当前用户读写：文件里有加密后的密钥，也不需要让同机其他人看见模型配置。
    with contextlib.suppress(OSError):
        os.chmod(temp, 0o600)
    temp.replace(path)
    logger.info("已保存全局模型配置 enabled=%s model=%s", enabled, config.model)


def clear_global_llm() -> None:
    """删除全局配置（回到"每个数据集各用各的"）。"""
    _path().unlink(missing_ok=True)
    logger.info("已清除全局模型配置")


__all__ = [
    "GLOBAL_SETTINGS_FILENAME",
    "GLOBAL_SETTINGS_VERSION",
    "GlobalLLM",
    "clear_global_llm",
    "global_llm_summary",
    "read_global_llm",
    "write_global_llm",
]
