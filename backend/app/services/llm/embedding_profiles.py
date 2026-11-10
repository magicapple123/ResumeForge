# SPDX-License-Identifier: Apache-2.0
"""语义检索的命名配置列表：存储结构与读取（清单第 1/16 条）。

存储分工（为什么是两个键）：

- ``embedding``：**当前生效配置的扁平镜像**。旧版只认这一块，回滚后仍能照常读取
  当前生效配置；它**不是**第二真相源。
- ``embedding_profiles``：多份命名配置 + ``active_profile_id``。新版以它为准。

镜像与 profiles 必须在**同一次** ``mutate_state`` 里写（见 ``_commit_remote_activation`` /
``_commit_local_activation``），中途失败不会留下两套不一致的状态。
``GLOBAL_SETTINGS_VERSION`` **不提升**——``load_state()`` 在 version != 2 时返回 None，
升版本会把主题与大模型配置一起读丢（清单 §1.2）。

安全规则：空密钥只沿用**同一条 profile** 的旧密钥，绝不跨 profile 继承（这条同时修掉
"先配阿里云、再选 OpenAI 且 key 留空时把阿里云 key 发到 api.openai.com"的缺陷）；
显式清除用 ``__clear__`` 哨兵。名称去空格后 ≤64 字、全局唯一（重名 409），最多
``MAX_EMBEDDING_PROFILES`` 条远程配置。

本模块放**存储结构与读取**；写操作在 ``embedding_profiles_store``，激活/探测在
``embedding_activation``（拆分只为守住 500 行预算）。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ..global_settings import active_profile_of, find_profile, load_state, mutate_state, profiles_of
from .embedding_settings import (
    EMBEDDING_SECTION,
    REMOTE_PRESETS,
    EmbeddingProviderConfig,
    _clean_headers,
    _clean_hosts,
    _decode_section,
    sanitize_url,
)

logger = logging.getLogger(__name__)

PROFILES_KEY = "embedding_profiles"
SECTION_VERSION = 1
MAX_EMBEDDING_PROFILES = 20
MAX_NAME_CHARS = 64
DEFAULT_PROFILE_NAME = "默认配置"
LOCAL_PROFILE_NAME = "本地模型"
CLEAR_SENTINEL = "__clear__"
LOCAL_PROVIDER = "local-onnx"
REMOTE_PROVIDER = "openai-http"


class ProfileError(ValueError):
    """语义检索配置的服务层错误；``status_code`` 供路由翻译成 HTTP 状态码。"""

    status_code = 400


class ProfileNotFoundError(ProfileError):
    status_code = 404


class ProfileConflictError(ProfileError):
    status_code = 409


class ProfileActivationError(ProfileError):
    """激活失败（host 未确认 / 探测失败 / 本地未下载）；当前生效项不变。"""

    status_code = 400


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _empty_block() -> dict[str, Any]:
    return {
        "section_version": SECTION_VERSION,
        "active_profile_id": "",
        "active_profile_updated_at": "",
        "profiles": [],
    }


def _block(state: dict[str, Any]) -> dict[str, Any] | None:
    value = state.get(PROFILES_KEY)
    if not isinstance(value, dict):
        return None
    if not isinstance(value.get("profiles"), list):
        value["profiles"] = []
    return value


def _require_block(state: dict[str, Any]) -> dict[str, Any]:
    block = _block(state)
    if block is None:
        block = _empty_block()
        state[PROFILES_KEY] = block
    return block


def _provider_of(profile: dict[str, Any]) -> str:
    raw = profile.get("config")
    if not isinstance(raw, dict):
        return REMOTE_PROVIDER
    return str(raw.get("provider") or REMOTE_PROVIDER).strip().casefold()


def _config_of(profile: dict[str, Any]) -> dict[str, Any]:
    raw = profile.get("config")
    return dict(raw) if isinstance(raw, dict) else {}


def _local_profile(state: dict[str, Any]) -> dict[str, Any] | None:
    for item in profiles_of(state, PROFILES_KEY):
        if _provider_of(item) == LOCAL_PROVIDER:
            return item
    return None


def _remote_profiles(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        item for item in profiles_of(state, PROFILES_KEY) if _provider_of(item) != LOCAL_PROVIDER
    ]


def _profile_config(profile: dict[str, Any], *, reveal_key: bool) -> EmbeddingProviderConfig | None:
    section = _config_of(profile)
    if not section:
        return None
    section.setdefault("provider", REMOTE_PROVIDER)
    try:
        return _decode_section(section, reveal_key=reveal_key)
    except Exception:  # noqa: BLE001 - 单条损坏不影响其它配置列出，逐条隔离
        logger.warning("语义检索配置解析失败，已跳过 id=%s", profile.get("id"))
        return None


def _preset_of(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    for preset_id, preset in REMOTE_PRESETS.items():
        if str(preset.get("base_url") or "").rstrip("/") == normalized:
            return preset_id
    return "custom"


def _as_int(value: Any, default: int, *, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))


def _config_dict(
    config: EmbeddingProviderConfig, *, encrypted_key: str, updated_at: str
) -> dict[str, Any]:
    """EmbeddingProviderConfig → 落盘用的字典（profile config 与扁平镜像同构）。"""
    return {
        "provider": config.provider,
        "model": config.model[:128],
        "dim": _as_int(config.dim, 0, low=0, high=8192),
        "pooling": config.pooling[:32] or "server",
        "normalize": bool(config.normalize),
        "variant": config.variant[:64],
        "base_url": sanitize_url(config.base_url)[:512],
        "api_key": encrypted_key,
        "batch_size": _as_int(config.batch_size, 25, low=1, high=2048),
        "endpoint_mode": "template" if config.endpoint_mode == "template" else "openai",
        "request_url": sanitize_url(config.request_url)[:1024],
        "headers": [dict(item) for item in _clean_headers(config.headers)],
        "body_template": config.body_template[:16384],
        "response_path": config.response_path[:512] or "data[*].embedding",
        "allow_private": bool(config.allow_private),
        "updated_at": updated_at,
    }


def active_meta() -> dict[str, Any]:
    """``GET /status`` 需要的生效信息：active id / 更新于 / 本地 profile id。"""
    state = load_state()
    if state is None:
        return {"active_profile_id": "", "active_profile_updated_at": "", "local_profile_id": ""}
    block = _block(state) or {}
    local = _local_profile(state)
    return {
        "active_profile_id": str(block.get("active_profile_id") or ""),
        "active_profile_updated_at": str(block.get("active_profile_updated_at") or ""),
        "local_profile_id": str((local or {}).get("id") or ""),
    }


def overlay_active_profile(state: dict[str, Any], mirror: dict[str, Any]) -> dict[str, Any]:
    """当前生效配置 → 交给 ``_decode_section`` 的段；没有 profiles 时回退旧扁平段。

    ``enabled`` / ``last_error`` / ``confirmed_hosts`` 是**生效状态**而非配置，继续取镜像。
    若镜像 provider 与 active profile 不一致，说明旧版写入改过镜像——按未启用处理
    （回退关键词检索；用户点「使用」可重新激活），不让两套状态互相污染。
    """
    block = _block(state)
    if block is None:
        return mirror
    profile = active_profile_of(state, PROFILES_KEY)
    if profile is None:
        return mirror
    raw = _config_of(profile)
    if not raw:
        return mirror
    merged = {**mirror, **raw}
    same_provider = (
        str(mirror.get("provider") or "").strip().casefold()
        == str(raw.get("provider") or REMOTE_PROVIDER).strip().casefold()
    )
    merged["enabled"] = bool(mirror.get("enabled")) and same_provider
    merged["last_error"] = str(mirror.get("last_error") or "") if same_provider else ""
    merged["confirmed_hosts"] = mirror.get("confirmed_hosts") or []
    return merged


def _mirror_section(
    *, profile_config: dict[str, Any], mirror: dict[str, Any], enabled: bool, last_error: str = ""
) -> dict[str, Any]:
    """profile 配置 → 扁平镜像（保留全局 confirmed_hosts，供旧版与隐私闸门读取）。"""
    section = {**profile_config}
    section["version"] = SECTION_VERSION
    section["enabled"] = bool(enabled)
    section["last_error"] = (last_error or "")[:500]
    section["confirmed_hosts"] = list(_clean_hosts(mirror.get("confirmed_hosts")))
    return section


def _public_profile(profile: dict[str, Any]) -> dict[str, Any] | None:
    """对外的脱敏配置卡数据（不含密钥/密文，只给 key_configured）。"""
    if _provider_of(profile) == LOCAL_PROVIDER:
        return None
    raw = _config_of(profile)
    config = _profile_config(profile, reveal_key=False)
    if config is None:
        return None
    return {
        "id": str(profile.get("id") or ""),
        "name": str(profile.get("name") or ""),
        "preset_id": str(profile.get("preset_id") or "custom"),
        "base_url": config.base_url,
        "model": config.model,
        "dim": config.dim,
        "batch_size": config.batch_size,
        "endpoint_mode": config.endpoint_mode,
        "host": config.host(),
        "key_configured": bool(raw.get("api_key")),
        "updated_at": config.updated_at,
    }


def list_profiles() -> list[dict[str, Any]]:
    """远程命名配置列表（脱敏：不含明文、密文或掩码占位符）。"""
    state = load_state()
    if state is None:
        return []
    items = [item for item in (_public_profile(p) for p in _remote_profiles(state)) if item]
    items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return items


def profile_key(profile_id: str) -> str:
    """读取某条配置的**明文**密钥（仅进程内探测用；HTTP 响应绝不回传）。"""
    state = load_state()
    profile = find_profile(state, profile_id, PROFILES_KEY) if state is not None else None
    if profile is None:
        raise ProfileNotFoundError("配置不存在或已被删除")
    config = _profile_config(profile, reveal_key=True)
    return config.api_key if config is not None else ""


def _commit_remote_activation(
    profile_id: str,
    *,
    dim: int,
    allow_private: bool,
    pooling: str = "server",
    normalize: bool = True,
) -> None:
    """远程激活的**唯一**写路径：profiles 与扁平镜像在同一次 mutate_state 里写。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _require_block(state)
        profile = find_profile(state, profile_id, PROFILES_KEY)
        if profile is None:
            raise ProfileNotFoundError("配置不存在或已被删除")
        raw = _config_of(profile)
        raw["provider"] = REMOTE_PROVIDER
        raw["dim"] = max(0, int(dim))
        raw["pooling"] = pooling
        raw["normalize"] = bool(normalize)
        raw["allow_private"] = bool(allow_private)
        raw["updated_at"] = _now()
        profile["config"] = raw
        mirror = state.get(EMBEDDING_SECTION)
        state[EMBEDDING_SECTION] = _mirror_section(
            profile_config=raw,
            mirror=dict(mirror) if isinstance(mirror, dict) else {},
            enabled=True,
        )
        block["active_profile_id"] = profile_id
        block["active_profile_updated_at"] = raw["updated_at"]

    mutate_state(_apply)
    logger.info("语义检索已切换到远程配置 id=%s dim=%s", profile_id, dim)


def _commit_local_activation(profile_id: str) -> None:
    """本地激活的**唯一**写路径：profiles 与扁平镜像在同一次 mutate_state 里写。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _require_block(state)
        profile = find_profile(state, profile_id, PROFILES_KEY)
        if profile is None:
            raise ProfileNotFoundError("配置不存在或已被删除")
        raw = _config_of(profile)
        raw["provider"] = LOCAL_PROVIDER
        raw["updated_at"] = str(raw.get("updated_at") or "") or _now()
        profile["config"] = raw
        mirror = state.get(EMBEDDING_SECTION)
        state[EMBEDDING_SECTION] = _mirror_section(
            profile_config=raw,
            mirror=dict(mirror) if isinstance(mirror, dict) else {},
            enabled=True,
        )
        block["active_profile_id"] = profile_id
        block["active_profile_updated_at"] = raw["updated_at"]

    mutate_state(_apply)
    logger.info("语义检索已切换到本地配置 id=%s", profile_id)


def _local_state() -> str:
    try:
        from ..rag.rag_local_setup import local_status

        return str(local_status().get("state") or "")
    except Exception:  # noqa: BLE001 - 组件缺失按未就绪处理，激活给出可读原因
        return ""


def _local_config_from_assets() -> EmbeddingProviderConfig | None:
    """从本地资产清单推导一份本地配置（下载完成但还没启用时也用得上）。"""
    try:
        from ..rag.rag_asset_manifest import select_assets
        from ..rag.rag_runtime_loader import assets_present

        if not assets_present():
            return None
        assets = select_assets()
    except Exception:  # noqa: BLE001 - 资产清单缺失/unavailable 都按"未下载"
        return None
    model = dict(assets.get("model") or {})
    dim = _as_int(model.get("dim"), 0, low=1, high=8192)
    if not model.get("id") or dim <= 0:
        return None
    return EmbeddingProviderConfig(
        provider=LOCAL_PROVIDER,
        enabled=True,
        model=str(model.get("id") or ""),
        dim=dim,
        pooling=str(model.get("pooling") or "cls"),
        normalize=True,
        variant=str(assets.get("variant") or ""),
    )


__all__ = [
    "CLEAR_SENTINEL",
    "DEFAULT_PROFILE_NAME",
    "LOCAL_PROFILE_NAME",
    "MAX_EMBEDDING_PROFILES",
    "MAX_NAME_CHARS",
    "PROFILES_KEY",
    "ProfileActivationError",
    "ProfileConflictError",
    "ProfileError",
    "ProfileNotFoundError",
    "REMOTE_PROVIDER",
    "SECTION_VERSION",
    "_as_int",
    "_commit_local_activation",
    "_commit_remote_activation",
    "_config_dict",
    "_config_of",
    "_local_config_from_assets",
    "_local_profile",
    "_local_state",
    "_mirror_section",
    "_now",
    "_preset_of",
    "_profile_config",
    "_provider_of",
    "_public_profile",
    "_remote_profiles",
    "_require_block",
    "active_meta",
    "list_profiles",
    "overlay_active_profile",
    "profile_key",
]
