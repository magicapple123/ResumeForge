# SPDX-License-Identifier: Apache-2.0
"""语义检索状态载荷、模板校验与切换副作用（设置页与命名配置共用的读/副作用收口）。

从 api/settings_embedding.py 搬来（后端补完·环）：命名配置写端点的每个响应都要
重算同一份 /status 载荷、同一套模板校验与同一条切换日志，而这些实现只依赖 services
（embedding_settings / embedding_profiles* / rag_embedding_endpoint / rag_index）。
放在服务层后，两个 api 模块不再互为实现依赖——api 侧保留同名薄壳，只为保住既有
monkeypatch 落点：_local_status / _runtime_available / get_rag_index 等锚点由父模块
注入，行为与响应形状不变。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..rag import rag_embedding_endpoint
from . import embedding_profiles, embedding_profiles_store
from .embedding_settings import (
    EmbeddingProviderConfig,
    configured_hosts,
    mask_embedding_config,
    read_embedding_config,
)

logger = logging.getLogger(__name__)


def compose_state(config: EmbeddingProviderConfig | None, local: dict[str, Any]) -> str:
    """按持久化配置 + 本地组件状态推导设置页状态机的 state 值（GET /status 的唯一口径）。"""
    supported = bool(local.get("supported"))
    local_state = str(local.get("state") or "")
    if config is None or not config.provider:
        return "not_configured"
    if config.provider == "local-onnx":
        if not supported:
            return "unsupported"
        if config.enabled:
            if local_state == "ready":
                return "ready"
            if local_state in {"downloading", "verifying", "extracting"}:
                return "downloading"
            if local_state == "failed" or config.last_error:
                return "failed"
            return "not_downloaded"
        return "disabled" if local_state == "ready" else "not_downloaded"
    if config.provider == "openai-http":
        if not config.enabled:
            return "disabled"
        return "failed" if config.last_error else "ready"
    return "disabled" if config.enabled else "not_configured"


def remote_payload(config: EmbeddingProviderConfig | None) -> dict[str, Any]:
    """远程 provider 的回显段：未配置时也给完整默认形状（前端不需要判空）。"""
    hosts = list(config.confirmed_hosts) if config is not None else configured_hosts()
    if config is not None and config.provider == "openai-http":
        return {
            "configured": True,
            "enabled": config.enabled,
            "host": config.host(),
            "model": config.model,
            "dim": config.dim,
            "endpoint_mode": config.endpoint_mode,
            "batch_size": config.batch_size,
            "confirmed_hosts": hosts,
            "pending_host": "",
            "error": config.last_error,
        }
    return {
        "configured": False,
        "enabled": False,
        "host": "",
        "model": "",
        "dim": 0,
        "endpoint_mode": "openai",
        "batch_size": 25,
        "confirmed_hosts": hosts,
        "pending_host": "",
        "error": "",
    }


def status_payload(
    *,
    local_status: Callable[[], dict[str, Any]],
    runtime_available: Callable[[dict[str, Any]], bool],
) -> dict[str, Any]:
    """设置页与生成链共用的唯一状态源；首次调用顺带把旧扁平配置迁移成命名配置。

    local_status / runtime_available 由接口层注入：这两处在既有用例里被 monkeypatch
    （锚点在 app.api.settings_embedding），保留注入才能让打桩继续生效。
    """
    embedding_profiles_store.migrate_legacy_once()
    config = read_embedding_config()
    local = local_status()
    # 本地已下载但还没启用过时也要有可激活的本地 profile（ready 态一键切换用）。
    embedding_profiles_store.ensure_local_profile(local)
    meta = embedding_profiles.active_meta()
    provider = config.provider if config is not None else ""
    return {
        "state": compose_state(config, local),
        "provider": provider,
        "last_error": config.last_error if config is not None else "",
        "local": local,
        "remote": remote_payload(config),
        "runtime": {"available": runtime_available(local), "version": "1.31.1"},
        "config": mask_embedding_config(config) if config is not None else None,
        "profiles": embedding_profiles.list_profiles(),
        "active_profile_id": meta["active_profile_id"],
        "active_profile_updated_at": meta["active_profile_updated_at"],
        "local_profile_id": meta["local_profile_id"],
    }


def validate_template(body_template: str, response_path: str) -> None:
    """高级端点模板校验（服务层唯一实现；接口层只负责把 ValueError 映射成 400）。"""
    rag_embedding_endpoint.validate_template(
        body_template=body_template, response_path=response_path
    )


def log_switch(
    provider: str,
    model: str = "",
    dim: int = 0,
    *,
    clear_index: Callable[[], Any],
) -> None:
    """provider/模型切换后的副作用：清空向量索引 + 记结构化事件。

    clear_index 由接口层注入：get_rag_index 在既有用例里被 monkeypatch，绑定到调用期
    解析才能让打桩继续生效（等价于原先的 get_rag_index().clear()）。
    """
    clear_index()
    logger.info("rag event provider_switched provider=%s model=%s dim=%s", provider, model, dim)


__all__ = [
    "compose_state",
    "log_switch",
    "remote_payload",
    "status_payload",
    "validate_template",
]
