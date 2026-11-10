# SPDX-License-Identifier: Apache-2.0
"""语义检索配置的写操作（清单第 1 条）：保存/删除/清密钥、本地分支同步、旧配置迁移。

写入口只有这些：

- ``save_profile``：新建/更新一条命名配置（名称唯一，重名 409；最多 20 条）；
- ``delete_profile``：删除；删的是生效项时回落到剩余第一条（回落激活走
  ``embedding_activation.activate_profile``，因此只在函数内惰性 import，避免循环依赖）；
- ``clear_profile_key``：只清一条的密钥；若它是生效项则一并停用；
- ``ensure_local_profile`` / ``sync_local_profile_from_mirror`` / ``remove_local_profile``：
  本地分支的 profile 生命周期（下载完成 / 启用 / 删除资产时调用）；
- ``migrate_legacy_once``：旧扁平 ``embedding`` 段 → 一条命名 profile（幂等，持写锁）。

密钥规则见 ``embedding_profiles`` 模块文档：空 key 只沿用**同一条** profile 的旧 key。
"""

from __future__ import annotations

import logging
from typing import Any

from ..global_settings import (
    clean_name,
    find_profile,
    find_profile_by_name,
    load_state,
    mutate_state,
    new_profile_id,
    profiles_of,
)
from .embedding_profiles import (
    CLEAR_SENTINEL,
    DEFAULT_PROFILE_NAME,
    LOCAL_PROFILE_NAME,
    LOCAL_PROVIDER,
    MAX_EMBEDDING_PROFILES,
    MAX_NAME_CHARS,
    PROFILES_KEY,
    REMOTE_PROVIDER,
    SECTION_VERSION,
    ProfileConflictError,
    ProfileError,
    ProfileNotFoundError,
    _as_int,
    _block,
    _config_dict,
    _config_of,
    _local_config_from_assets,
    _local_profile,
    _mirror_section,
    _now,
    _preset_of,
    _provider_of,
    _remote_profiles,
    _require_block,
)
from .embedding_settings import (
    EMBEDDING_SECTION,
    KEY_MASK,
    EmbeddingProviderConfig,
    _clean_hosts,
    _decode_section,
    encrypt_secret,
    endpoint_host,
)

logger = logging.getLogger(__name__)

# 从扁平镜像搬进 profile config 时要带的字段。enabled / last_error / confirmed_hosts 是
# 「生效状态」而不是「配置」：它们留在镜像里，由激活流程写。
_CONFIG_KEYS = (
    "provider",
    "model",
    "dim",
    "pooling",
    "query_prefix",
    "doc_prefix",
    "normalize",
    "variant",
    "base_url",
    "batch_size",
    "endpoint_mode",
    "request_url",
    "headers",
    "body_template",
    "response_path",
    "allow_private",
)


def ensure_local_profile(local: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """本地引擎就绪时保证有一条本地 profile（供 ready 态一键切换激活）。

    返回本地 profile（已存在或本次创建）；资源不就绪时返回 None。
    ``GET /status`` 调它把 ``local_profile_id`` 交给前端——前端据此调
    ``POST /profiles/{id}/activate``，而不是再走"关闭→重新启用"。
    """
    state = load_state()
    if state is not None:
        existing = _local_profile(state)
        if existing is not None:
            return existing
    if local is not None and str(local.get("state") or "") != "ready":
        return None
    config = _local_config_from_assets()
    if config is None:
        return None
    created: dict[str, Any] = {}

    def _apply(state2: dict[str, Any]) -> None:
        block = _require_block(state2)
        current = _local_profile(state2)
        if current is not None:
            created["profile"] = current
            return
        profile = {
            "id": new_profile_id(),
            "name": LOCAL_PROFILE_NAME,
            "preset_id": "local",
            "config": _config_dict(config, encrypted_key="", updated_at=_now()),
        }
        block["profiles"].append(profile)
        created["profile"] = profile

    mutate_state(_apply)
    return created.get("profile")


def save_profile(
    *,
    profile_id: str = "",
    name: str,
    preset_id: str = "",
    config: dict[str, Any],
) -> dict[str, Any]:
    """新建或更新一条远程配置；名称唯一（重名 409），最多 20 条。

    ``api_key`` 留空/掩码 = 保留**本条**旧密钥（新建时为空）；``__clear__`` = 显式清除。
    """
    raw_name = (name or "").strip()
    if not raw_name:
        raise ProfileError("配置名称不能为空")
    if len(raw_name) > MAX_NAME_CHARS:
        raise ProfileError(f"配置名称不能超过 {MAX_NAME_CHARS} 字")
    cleaned = clean_name(raw_name)
    preset = (preset_id or "custom").strip()[:32] or "custom"
    incoming = config or {}
    saved: dict[str, Any] = {}

    def _apply(state: dict[str, Any]) -> None:
        block = _require_block(state)
        existing = find_profile(state, profile_id, PROFILES_KEY) if profile_id else None
        if profile_id and existing is None:
            raise ProfileNotFoundError("配置不存在或已被删除")
        if existing is not None and _provider_of(existing) == LOCAL_PROVIDER:
            raise ProfileError("本地配置不能手动编辑")
        duplicate = find_profile_by_name(state, cleaned, PROFILES_KEY)
        existing_id = str((existing or {}).get("id") or "")
        if duplicate is not None and str(duplicate.get("id") or "") != existing_id:
            raise ProfileConflictError("配置名称已存在")
        if existing is None and len(_remote_profiles(state)) >= MAX_EMBEDDING_PROFILES:
            raise ProfileError(f"最多保存 {MAX_EMBEDDING_PROFILES} 份语义检索配置")
        previous = _config_of(existing) if existing is not None else {}
        new_config = _build_remote_config(incoming, previous)
        if existing is None:
            profile = {
                "id": new_profile_id(),
                "name": cleaned,
                "preset_id": preset,
                "config": new_config,
            }
            block["profiles"].append(profile)
            saved.update(profile)
        else:
            existing["name"] = cleaned
            existing["preset_id"] = preset
            existing["config"] = new_config
            saved.update(existing)

    mutate_state(_apply)
    from .embedding_profiles import _public_profile

    public = _public_profile(saved)
    if public is None:
        raise ProfileError("配置内容不合法")
    logger.info("已保存语义检索配置 name=%s id=%s", public["name"], public["id"])
    return public


def _build_remote_config(incoming: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    endpoint_mode = (
        "template"
        if str(incoming.get("endpoint_mode") or "openai").strip().casefold() == "template"
        else "openai"
    )
    raw_key = str(incoming.get("api_key") or "").strip()
    if raw_key == CLEAR_SENTINEL:
        encrypted = ""
    elif not raw_key or raw_key == KEY_MASK:
        # 只沿用同一条配置的旧密钥；新建配置 previous 为空 → 没有密钥。
        encrypted = str(previous.get("api_key") or "")
    else:
        encrypted = encrypt_secret(raw_key)
    base_url = str(incoming.get("base_url") or "").strip()
    request_url = (
        str(incoming.get("request_url") or "").strip() if endpoint_mode == "template" else ""
    )
    model = str(incoming.get("model") or "").strip()
    host = endpoint_host(request_url if endpoint_mode == "template" else base_url)
    if not host:
        raise ProfileError("服务地址不包含可识别的主机名")
    if not model:
        raise ProfileError("远程服务缺少模型名")
    headers = incoming.get("headers")
    config = EmbeddingProviderConfig(
        provider=REMOTE_PROVIDER,
        enabled=True,
        model=model,
        dim=_as_int(previous.get("dim"), 0, low=0, high=8192),
        pooling="server",
        normalize=True,
        base_url=base_url,
        batch_size=_as_int(incoming.get("batch_size"), 25, low=1, high=2048),
        endpoint_mode=endpoint_mode,
        request_url=request_url,
        headers=tuple(
            {"name": str(item.get("name") or ""), "value": str(item.get("value") or "")}
            for item in headers
            if isinstance(item, dict)
        )
        if isinstance(headers, list)
        else (),
        body_template=str(incoming.get("body_template") or "")[:16384]
        if endpoint_mode == "template"
        else "",
        response_path=str(incoming.get("response_path") or "data[*].embedding")[:512]
        if endpoint_mode == "template"
        else "data[*].embedding",
        allow_private=bool(incoming.get("allow_private")),
        updated_at="",
    )
    return _config_dict(config, encrypted_key=encrypted, updated_at=_now())


async def delete_profile(profile_id: str) -> None:
    """删除一条配置；删的是生效项时自动激活剩余第一条，没有剩余则停用并清空镜像。"""
    state = load_state()
    # Narrow at the read boundary: without global state every later step below is
    # meaningless, and leaving it Optional leaks None into _block/profiles_of/state.get.
    if state is None:
        raise ProfileNotFoundError("配置不存在或已被删除")
    profile = find_profile(state, profile_id, PROFILES_KEY)
    if profile is None:
        raise ProfileNotFoundError("配置不存在或已被删除")
    block = _block(state) or {}
    was_active = str(block.get("active_profile_id") or "") == profile_id
    remaining = [item for item in profiles_of(state, PROFILES_KEY) if item.get("id") != profile_id]
    mirror = dict(state.get(EMBEDDING_SECTION) or {})
    if not was_active:
        # 删的是非生效配置：只把它从列表里拿掉，当前生效项与镜像一律不动。

        def _remove_only(target: dict[str, Any]) -> None:
            _require_block(target)["profiles"] = remaining

        mutate_state(_remove_only)
        logger.info("已删除语义检索配置 id=%s（非生效项）", profile_id)
        return
    fallback = remaining[0] if remaining else None
    if fallback is None:
        hosts = list(_clean_hosts(mirror.get("confirmed_hosts")))

        def _clear(target: dict[str, Any]) -> None:
            block2 = _require_block(target)
            block2["profiles"] = remaining
            block2["active_profile_id"] = ""
            block2["active_profile_updated_at"] = ""
            target[EMBEDDING_SECTION] = {"confirmed_hosts": hosts}

        mutate_state(_clear)
        logger.info("已删除语义检索配置 id=%s（无剩余配置）", profile_id)
        return

    def _fallback(target: dict[str, Any]) -> None:
        block2 = _require_block(target)
        block2["profiles"] = remaining
        block2["active_profile_id"] = str(fallback.get("id") or "")
        block2["active_profile_updated_at"] = ""
        target[EMBEDDING_SECTION] = _mirror_section(
            profile_config=_config_of(fallback), mirror=mirror, enabled=False
        )

    mutate_state(_fallback)
    logger.info("已删除语义检索配置 id=%s，回落到 id=%s", profile_id, fallback.get("id"))
    # 惰性 import：激活模块反过来依赖本模块的存储原语，顶层互引会循环。
    from .embedding_activation import activate_profile

    try:
        await activate_profile(str(fallback.get("id") or ""))
    except ProfileError as exc:
        # 回落项探测失败/本地资源缺失：保持停用（不污染剩余配置），用户可稍后手动启用。
        logger.info("删除生效配置后回落项未能自动启用：%s", exc)


def clear_profile_key(profile_id: str) -> None:
    """只清这一条的密钥；若它是生效项则一并停用（不删除配置）。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _require_block(state)
        profile = find_profile(state, profile_id, PROFILES_KEY)
        if profile is None:
            raise ProfileNotFoundError("配置不存在或已被删除")
        raw = _config_of(profile)
        raw["api_key"] = ""
        raw["updated_at"] = _now()
        profile["config"] = raw
        if str(block.get("active_profile_id") or "") == profile_id:
            mirror = dict(state.get(EMBEDDING_SECTION) or {})
            state[EMBEDDING_SECTION] = _mirror_section(
                profile_config=raw, mirror=mirror, enabled=False
            )

    mutate_state(_apply)
    logger.info("已清除语义检索密钥 id=%s", profile_id)


def sync_local_profile_from_mirror() -> str:
    """``/local/enable`` 写镜像后调用：把本地分支同步成一条本地 profile 并设为生效。"""
    state = load_state()
    mirror = state.get(EMBEDDING_SECTION) if state is not None else None
    if not isinstance(mirror, dict):
        raise ProfileError("本地配置写入失败")
    config = _decode_section(mirror, reveal_key=False)
    if config is None or config.provider != LOCAL_PROVIDER:
        raise ProfileError("本地配置写入失败")
    profile_id = ""

    def _apply(target: dict[str, Any]) -> None:
        nonlocal profile_id
        block = _require_block(target)
        profile = _local_profile(target)
        raw = _config_dict(
            config, encrypted_key="", updated_at=str(mirror.get("updated_at") or "") or _now()
        )
        if profile is None:
            profile = {
                "id": new_profile_id(),
                "name": LOCAL_PROFILE_NAME,
                "preset_id": "local",
                "config": raw,
            }
            block["profiles"].append(profile)
        else:
            profile["config"] = raw
        block["active_profile_id"] = str(profile.get("id") or "")
        block["active_profile_updated_at"] = str(raw.get("updated_at") or "")
        target[EMBEDDING_SECTION] = _mirror_section(
            profile_config=raw, mirror=dict(target.get(EMBEDDING_SECTION) or {}), enabled=True
        )
        profile_id = str(profile.get("id") or "")

    mutate_state(_apply)
    return profile_id


def remove_local_profile() -> None:
    """删除本地 profile（删下载文件时调用）；若它是生效项则清空 active。"""
    state = load_state()
    if state is None or _local_profile(state) is None:
        return

    def _apply(target: dict[str, Any]) -> None:
        block = _require_block(target)
        local = _local_profile(target)
        if local is None:
            return
        block["profiles"] = [
            item for item in profiles_of(target, PROFILES_KEY) if item.get("id") != local.get("id")
        ]
        if str(block.get("active_profile_id") or "") == str(local.get("id") or ""):
            block["active_profile_id"] = ""
            block["active_profile_updated_at"] = ""

    mutate_state(_apply)


def migrate_legacy_once() -> None:
    """旧扁平 ``embedding`` 段 → 一条命名 profile（首次 /status 调用时执行）。

    幂等：``embedding_profiles`` 键存在即视为已迁移（即使 profiles 为空——用户删光了
    也不该下次打开设置页又被"复活"一遍）。旧本地配置只生成**本地** profile，不生成远程。
    """
    state = load_state()
    if state is None:
        return
    if isinstance(state.get(PROFILES_KEY), dict):
        return
    legacy = state.get(EMBEDDING_SECTION)
    if not isinstance(legacy, dict) or not legacy:
        return
    config = _decode_section(legacy, reveal_key=False)
    profile: dict[str, Any] | None = None
    if config is not None and config.provider in {REMOTE_PROVIDER, LOCAL_PROVIDER}:
        raw = {key: legacy[key] for key in _CONFIG_KEYS if key in legacy}
        raw["provider"] = config.provider
        raw["api_key"] = str(legacy.get("api_key") or "")
        raw["updated_at"] = str(legacy.get("updated_at") or "") or _now()
        local = config.provider == LOCAL_PROVIDER
        profile = {
            "id": new_profile_id(),
            "name": LOCAL_PROFILE_NAME if local else DEFAULT_PROFILE_NAME,
            "preset_id": "local" if local else _preset_of(config.base_url),
            "config": raw,
        }
    active_id = str((profile or {}).get("id") or "")
    updated_at = str(((profile or {}).get("config") or {}).get("updated_at") or "")

    def _apply(target: dict[str, Any]) -> None:
        target[PROFILES_KEY] = {
            "section_version": SECTION_VERSION,
            "active_profile_id": active_id,
            "active_profile_updated_at": updated_at if active_id else "",
            "profiles": [profile] if profile is not None else [],
        }

    mutate_state(_apply)
    logger.info("语义检索旧配置已迁移为命名配置 id=%s", active_id)


__all__ = [
    "ensure_local_profile",
    "migrate_legacy_once",
    "save_profile",
    "delete_profile",
    "clear_profile_key",
    "sync_local_profile_from_mirror",
    "remove_local_profile",
    "_build_remote_config",
]
