# SPDX-License-Identifier: Apache-2.0
"""联网搜索设置（`global_settings.json` 顶层 `web_search`）：全局一份，跨数据集共用。

为什么全局：搜索来源、SearXNG 地址与 DeepSeek Key 描述的是"这台机器怎么上网查资料"，
与当前打开哪份数据集无关。旧版把 `search_config` / `search_deepseek_api_key` 存在
数据集自己的 AppSetting 里，切数据集就换一套来源与 Key——用一份数据集的 Key 去搜另一份
数据集的资料时，用户还得重新填一遍。

解析顺序（四个对外函数共用一条）：

1. 全局 `web_search` 存在 → 用它；
2. 否则把当前数据集的旧 AppSetting 一次性迁移到全局（`migrate_legacy_search_once`），
   迁移后再用全局那份；
3. 两者都没有 → `SearchConfig()` 默认值（Bing + DuckDuckGo）。

旧行保留不删：回退旧版时仍能读到升级前的配置（但升级后改的新值旧版看不到，见 CHANGELOG）。

存储形态与 `SearchConfig` 契约一致，密钥只存密文：

    "web_search": {
      "sources": ["bing", "duckduckgo"],
      "searxng_url": "",
      "depth": "standard",
      "max_results": 8,
      "deepseek_api_key": "<encrypted>",
      "tavily_api_key": "<encrypted>",
      "jina_api_key": "<encrypted>"
    }

`fetch_pages` 不落盘（已被 `depth` 取代，读旧块时由 `SearchConfig` 的 before-validator 折算）。

不提升 `GLOBAL_SETTINGS_VERSION`：`load_state()` 在版本不等于 2 时返回 None，
升版本会让主题与大模型配置一起读丢。新增顶层键不需要动版本号。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..schemas.setting import SearchConfig
from . import global_settings
from .api_key_crypto import decrypt_key, encrypt_key
from .llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

# 全局文件里的顶层键。**不叫 `search`**：那个名字留给本地全文检索（FTS）。
WEB_SEARCH_BLOCK = "web_search"
# 迁移来源：旧版把这两项存在当前数据集的 AppSetting 里。
_LEGACY_CONFIG_KEY = "search_config"
_LEGACY_KEY_KEY = "search_deepseek_api_key"
# 三个来源的密钥都只存密文，密钥列不参与 `SearchConfig` 的公开校验（见 `_config_from_block`）。
_SECRET_FIELDS = ("deepseek_api_key", "tavily_api_key", "jina_api_key")
# 落盘时**不写**的字段：`fetch_pages` 已被 `depth` 取代，双写会让"两套值各说一套"。
_LEGACY_ONLY_FIELDS = frozenset({"fetch_pages"})


def _block_of(state: dict[str, Any] | None) -> dict[str, Any] | None:
    block = (state or {}).get(WEB_SEARCH_BLOCK)
    return block if isinstance(block, dict) else None


def _config_from_block(block: dict[str, Any]) -> SearchConfig | None:
    """校验存量的公开字段；密钥列不参与校验（它们是密文，不是 `SearchConfig` 的明文值）。"""
    public = {key: value for key, value in block.items() if key not in _SECRET_FIELDS}
    try:
        return SearchConfig.model_validate(public)
    except ValidationError:
        logger.warning("联网搜索全局配置字段非法，已按默认值处理；请在设置页重新保存")
        return None


def _stored_block(config: SearchConfig) -> dict[str, Any]:
    """落盘形态：公开字段 + 加密后的密钥（`fetch_pages` 不写，只想留 `depth` 一份真值）。"""
    dumped = config.model_dump(exclude=set(_SECRET_FIELDS) | _LEGACY_ONLY_FIELDS)
    return {
        **dumped,
        **{field: encrypt_key((getattr(config, field) or "").strip()) for field in _SECRET_FIELDS},
    }


def _key_of(block: dict[str, Any] | None, field: str = "deepseek_api_key") -> str:
    """取出真实密钥（仅供运行时使用，**不得**回传前端）。未配置返回空串。"""
    if not block:
        return ""
    return decrypt_key(str(block.get(field) or ""))


def _legacy_config(db: Session) -> SearchConfig | None:
    """读当前数据集里的旧配置（迁移前形态）；没有或损坏返回 None。"""
    row = db.get(AppSetting, _LEGACY_CONFIG_KEY)
    if row is None:
        return None
    try:
        config = SearchConfig.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, TypeError, ValidationError):
        logger.warning("联网搜索设置数据损坏，已重置为默认值")
        return None
    # 旧 JSON 里只可能是掩码/空串；真实密钥在单独一行、加密存放。
    key_row = db.get(AppSetting, _LEGACY_KEY_KEY)
    encrypted = str(key_row.value) if key_row is not None and key_row.value else ""
    config.deepseek_api_key = decrypt_key(encrypted)
    return config


def migrate_legacy_search_once(db: Session) -> bool:
    """把当前数据集的旧搜索配置一次性搬进全局；返回本次是否真的写了。

    幂等：全局 `web_search` 已存在、或旧的 `search_config` 行不存在/损坏时不写。
    **只导入当前数据集的那一份**；其它数据集的旧配置留在原库但不再生效。
    """
    if _block_of(global_settings.load_state()) is not None:
        return False
    legacy = _legacy_config(db)
    if legacy is None:
        return False
    block = _stored_block(legacy)
    written = {"value": False}

    def _apply(state: dict[str, Any]) -> None:
        # 持锁后再判一次：两个请求同时读到"没有全局配置"时只有一个真正写入。
        if _block_of(state) is not None:
            return
        state[WEB_SEARCH_BLOCK] = block
        written["value"] = True

    global_settings.mutate_state(_apply)
    if written["value"]:
        logger.info("联网搜索设置已从数据集迁移到全局（所有数据集共用）")
    return written["value"]


def _ensure_block(db: Session) -> dict[str, Any] | None:
    """取当前生效的全局块；没有就先尝试迁移旧配置。"""
    block = _block_of(global_settings.load_state())
    if block is not None:
        return block
    if migrate_legacy_search_once(db):
        return _block_of(global_settings.load_state())
    return None


def resolve_search_deepseek_key(db: Session) -> str:
    """取真实密钥（仅供运行时调用，**不得**回传前端）。未配置返回空串。"""
    return _key_of(_ensure_block(db))


def get_search_config(db: Session) -> SearchConfig:
    """对外（设置页）读取：三个密钥字段只会是掩码或空串。"""
    block = _ensure_block(db)
    config = _config_from_block(block) if block is not None else None
    if block is None or config is None:
        return SearchConfig()
    for field in _SECRET_FIELDS:
        setattr(config, field, API_KEY_MASK if str(block.get(field) or "") else "")
    return config


def get_search_config_with_secrets(db: Session) -> SearchConfig:
    """运行时读取：把真实密钥解出来，供 `aggregate_search` 调各来源用。"""
    block = _ensure_block(db)
    config = _config_from_block(block) if block is not None else None
    if config is None:
        return SearchConfig()
    for field in _SECRET_FIELDS:
        setattr(config, field, _key_of(block, field))
    return config


def save_search_config(db: Session, config: SearchConfig) -> SearchConfig:
    """保存联网搜索配置：只写全局 `web_search`，**不再写旧 AppSetting**（避免第二份真相）。

    每个密钥字段的三种取值决定密钥怎么变——这是"值只能是掩码或引用"的落地点：

    - 空串：**清除**已保存的密钥（用户显式移除）；
    - 掩码（`********` 开头）：保持不变（前端回显的就是它，原样回传不应清空密钥）；
    - 其它：视为新密钥，加密后写入。

    落盘**只写 `depth`**（`fetch_pages` 被排除）：两套深度值同时存在时迟早各说一套。
    """
    block = _ensure_block(db)
    encrypted: dict[str, str] = {}
    for field in _SECRET_FIELDS:
        existing = str((block or {}).get(field) or "")
        incoming = (getattr(config, field) or "").strip()
        if incoming.startswith(API_KEY_MASK):
            encrypted[field] = existing
        elif incoming:
            encrypted[field] = encrypt_key(incoming)
        else:
            encrypted[field] = ""
    persisted = _stored_block(config.model_copy(update=dict.fromkeys(_SECRET_FIELDS, "")))
    persisted.update(encrypted)

    def _apply(state: dict[str, Any]) -> None:
        state[WEB_SEARCH_BLOCK] = persisted

    global_settings.mutate_state(_apply)
    return get_search_config(db)


__all__ = [
    "WEB_SEARCH_BLOCK",
    "get_search_config",
    "get_search_config_with_secrets",
    "migrate_legacy_search_once",
    "resolve_search_deepseek_key",
    "save_search_config",
]
