# SPDX-License-Identifier: Apache-2.0
"""语义检索配置的激活与探测（清单第 16 条：切换 = 激活另一条 profile）。

``activate_profile`` 是切换的**唯一写入口**：远程走「host 已确认闸门 → 真实探测 →
同一次写 profiles 与镜像」；本地要求引擎资源就绪。**失败不改当前生效项**
（不写 last_error、不覆盖镜像），避免一次失败的切换把本来可用的配置弄坏。

``test_profile`` 用「该条已存 key + 草稿覆盖」探测且不落盘；空 key 只借**这一条**的
旧 key，绝不跨 profile 继承。``enable_remote_legacy`` 只服务旧版
``POST /remote/enable`` 兼容入口（upsert「默认配置」+ 提交激活，不重复探测）。
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from ..global_settings import (
    find_profile,
    find_profile_by_name,
    load_state,
    mutate_state,
    new_profile_id,
)
from .embedding_profiles import (
    CLEAR_SENTINEL,
    DEFAULT_PROFILE_NAME,
    LOCAL_PROVIDER,
    MAX_EMBEDDING_PROFILES,
    PROFILES_KEY,
    REMOTE_PROVIDER,
    ProfileActivationError,
    ProfileError,
    ProfileNotFoundError,
    _as_int,
    _commit_local_activation,
    _commit_remote_activation,
    _config_dict,
    _config_of,
    _local_config_from_assets,
    _local_state,
    _now,
    _preset_of,
    _profile_config,
    _remote_profiles,
    _require_block,
    active_meta,
)
from .embedding_settings import (
    KEY_MASK,
    EmbeddingProviderConfig,
    configured_hosts,
    encrypt_secret,
    endpoint_host,
)

logger = logging.getLogger(__name__)


async def _probe(config: EmbeddingProviderConfig) -> Any:
    from ..rag.rag_remote_setup import probe_remote

    return await probe_remote(config)


def _allow_private(config: EmbeddingProviderConfig) -> bool:
    try:
        from ...config import get_settings

        return bool(config.allow_private or get_settings().rag_embedding_allow_private_endpoint)
    except Exception:  # noqa: BLE001 - 配置读取失败按用户显式设置处理
        return bool(config.allow_private)


def _validate_remote_config(config: EmbeddingProviderConfig) -> None:
    if config.endpoint_mode == "template":
        if not config.request_url:
            raise ProfileActivationError("高级端点缺少 URL")
        host = endpoint_host(config.request_url)
    else:
        if not config.base_url:
            raise ProfileActivationError("远程服务缺少 Base URL")
        host = endpoint_host(config.base_url)
    if not host:
        raise ProfileActivationError("服务地址不包含可识别的主机名")
    if not config.model:
        raise ProfileActivationError("远程服务缺少模型名")


def _apply_draft(config: EmbeddingProviderConfig, draft: dict[str, Any]) -> EmbeddingProviderConfig:
    """草稿覆盖已存配置；**空密钥只借这一条自己的**，不跨 profile（安全红线）。"""
    raw_key = str(draft.get("api_key") or "").strip()
    if raw_key == CLEAR_SENTINEL:
        api_key = ""
    elif not raw_key or raw_key == KEY_MASK:
        api_key = config.api_key
    else:
        api_key = raw_key
    endpoint_mode = (
        "template"
        if str(draft.get("endpoint_mode") or "openai").strip().casefold() == "template"
        else "openai"
    )
    headers = tuple(
        {"name": str(item.get("name") or ""), "value": str(item.get("value") or "")}
        for item in draft.get("headers") or []
        if isinstance(item, dict)
    )
    return replace(
        config,
        base_url=str(draft.get("base_url") or config.base_url),
        model=str(draft.get("model") or config.model)[:128],
        api_key=api_key,
        batch_size=_as_int(draft.get("batch_size"), config.batch_size, low=1, high=2048),
        endpoint_mode=endpoint_mode,
        request_url=str(draft.get("request_url") or "") if endpoint_mode == "template" else "",
        headers=headers if endpoint_mode == "template" else (),
        body_template=str(draft.get("body_template") or "") if endpoint_mode == "template" else "",
        response_path=str(draft.get("response_path") or "data[*].embedding")
        if endpoint_mode == "template"
        else "data[*].embedding",
        allow_private=bool(draft.get("allow_private", config.allow_private)),
        pooling="server",
        normalize=True,
    )


async def activate_profile(profile_id: str) -> dict[str, Any]:
    """激活一条配置（切换 = 激活另一条）。

    远程：校验 → host 已确认闸门 → 真实探测 → 同一次写 profiles 与镜像；
    **失败不改当前生效项**（清单 §16.3）。本地：要求引擎资源已就绪，不自检编码。
    """
    state = load_state()
    profile = find_profile(state, profile_id, PROFILES_KEY) if state is not None else None
    if profile is None:
        raise ProfileNotFoundError("配置不存在或已被删除")
    config = _profile_config(profile, reveal_key=True)
    if config is None:
        raise ProfileActivationError("配置内容不完整，请重新编辑保存")
    if config.provider == LOCAL_PROVIDER:
        if _local_state() != "ready":
            raise ProfileActivationError("本地模型尚未下载完成")
        if config.dim <= 0 or not config.model:
            fresh = _local_config_from_assets()
            if fresh is None:
                raise ProfileActivationError("本地模型尚未下载完成")
            _update_local_profile(profile_id, fresh)
        _commit_local_activation(profile_id)
        return active_meta()
    _validate_remote_config(config)
    if not config.api_key:
        raise ProfileActivationError("先填写 API 密钥")
    host = config.host()
    if host not in configured_hosts():
        raise ProfileActivationError(f"语义检索服务地址尚未确认外发范围：{host}")
    allow_private = _allow_private(config)
    result = await _probe(replace(config, allow_private=allow_private))
    if not bool(getattr(result, "ok", False)):
        raise ProfileActivationError(str(getattr(result, "error", "") or "远程服务校验未通过"))
    dim = _as_int(getattr(result, "dim", 0), 0, low=0, high=8192)
    if dim <= 0:
        raise ProfileActivationError("远程服务没有返回可用的向量维度")
    _commit_remote_activation(profile_id, dim=dim, allow_private=allow_private)
    return active_meta()


def _update_local_profile(profile_id: str, config: EmbeddingProviderConfig) -> None:
    def _apply(state: dict[str, Any]) -> None:
        profile = find_profile(state, profile_id, PROFILES_KEY)
        if profile is None:
            raise ProfileNotFoundError("配置不存在或已被删除")
        profile["config"] = _config_dict(
            config,
            encrypted_key="",
            updated_at=str(_config_of(profile).get("updated_at") or "") or _now(),
        )

    mutate_state(_apply)


async def test_profile(profile_id: str, draft: dict[str, Any] | None = None) -> dict[str, Any]:
    """用「该 profile 已存 key + 草稿覆盖」探测，不落盘（清单 §1.4）。"""
    state = load_state()
    profile = find_profile(state, profile_id, PROFILES_KEY) if state is not None else None
    if profile is None:
        raise ProfileNotFoundError("配置不存在或已被删除")
    config = _profile_config(profile, reveal_key=True)
    if config is None:
        raise ProfileActivationError("配置内容不完整，请重新编辑保存")
    if config.provider != REMOTE_PROVIDER:
        raise ProfileActivationError("本地配置不支持连接测试")
    if draft:
        config = _apply_draft(config, draft)
    _validate_remote_config(config)
    result = await _probe(replace(config, allow_private=_allow_private(config)))
    return {
        "ok": bool(getattr(result, "ok", False)),
        "dim": _as_int(getattr(result, "dim", 0), 0, low=0, high=8192),
        "elapsed_ms": _as_int(getattr(result, "elapsed_ms", 0), 0, low=0, high=600000),
        "model": str(getattr(result, "model", "") or config.model),
        "error": str(getattr(result, "error", "") or ""),
    }


async def enable_remote_legacy(config: EmbeddingProviderConfig) -> None:
    """旧版 ``POST /remote/enable`` 的兼容路径：upsert「默认配置」后提交激活。

    调用方已完成探测（dim 已拿到），这里不再重复探测；但**仍只走**
    ``_commit_remote_activation`` 这一条写路径，保证 profiles 与镜像同批写。
    """
    profile_id = ""

    def _apply(state: dict[str, Any]) -> None:
        nonlocal profile_id
        block = _require_block(state)
        profile = find_profile_by_name(state, DEFAULT_PROFILE_NAME, PROFILES_KEY)
        if profile is None:
            if len(_remote_profiles(state)) >= MAX_EMBEDDING_PROFILES:
                raise ProfileError(f"最多保存 {MAX_EMBEDDING_PROFILES} 份语义检索配置")
            profile = {
                "id": new_profile_id(),
                "name": DEFAULT_PROFILE_NAME,
                "preset_id": _preset_of(config.base_url),
                "config": {},
            }
            block["profiles"].append(profile)
        profile["config"] = _config_dict(
            config, encrypted_key=encrypt_secret(config.api_key), updated_at=_now()
        )
        profile_id = str(profile.get("id") or "")

    mutate_state(_apply)
    _commit_remote_activation(profile_id, dim=config.dim, allow_private=config.allow_private)


__all__ = [
    "activate_profile",
    "enable_remote_legacy",
    "test_profile",
    "_apply_draft",
    "_validate_remote_config",
]
