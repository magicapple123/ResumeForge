# SPDX-License-Identifier: Apache-2.0
"""语义检索 embedding 的设置端点（本地 onnxruntime / 远程 OpenAI 兼容）。

状态机唯一来源：``GET /status``。设置页按它渲染，生成链按持久化配置构造 provider；
两者读同一份 ``global_settings.json``（``embedding`` 镜像 + ``embedding_profiles``）。

失败不得显示为已启用：只有本地校验 / 远程真实探测通过后 ``enabled`` 才为 true；
provider / 模型 / 维度切换时主动清空向量索引并记 ``rag event provider_switched``。

下载/探测/模板解析分别在 ``rag_local_setup`` / ``rag_remote_setup`` /
``rag_embedding_endpoint``；命名配置写端点拆在 ``settings_embedding_profiles``。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services.llm import embedding_activation, embedding_profiles, embedding_profiles_store
from ..services.llm.embedding_settings import (
    KEY_MASK,
    EmbeddingProviderConfig,
    clear_embedding_config,
    configured_hosts,
    endpoint_host,
    mark_host_confirmed,
    mask_embedding_config,
    read_embedding_config,
    replace_config,
    revoke_host_confirmed,
    write_active_embedding_config,
)
from ..services.rag.rag_index import get_rag_index

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/embedding", tags=["settings"])


class RemoteConfigIn(BaseModel):
    """远程 provider 的表单载荷（key 留空/掩码表示沿用已存密钥）。"""

    provider: str = Field(default="openai-http", max_length=32)
    base_url: str = Field(default="", max_length=512)
    model: str = Field(default="", max_length=128)
    api_key: str = Field(default="", max_length=8192)
    batch_size: int = Field(default=25, ge=1, le=2048)
    endpoint_mode: str = Field(default="openai", max_length=16)
    request_url: str = Field(default="", max_length=1024)
    headers: list[dict[str, str]] = Field(default_factory=list)
    body_template: str = Field(default="", max_length=16384)
    response_path: str = Field(default="data[*].embedding", max_length=512)
    allow_private: bool = False
    # 只从这条命名配置借已存密钥（测试连接编辑态用），不跨配置继承。
    profile_id: str = Field(default="", max_length=64)


class ConfirmIn(BaseModel):
    base_url: str = Field(min_length=1, max_length=512)


class RevokeIn(BaseModel):
    host: str = Field(min_length=1, max_length=255)


def _guard_loopback(request: Request) -> None:
    """密钥只从运行后端的本机读写（与全局模型配置同一守卫）。"""
    from .settings import _is_loopback_request

    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="语义检索配置只能在运行后端的本机修改")


def _local_api() -> Any:
    """本地 provider 的服务模块（延迟 import：组件缺失时状态页仍能打开）。"""
    from ..services.rag import rag_local_setup

    return rag_local_setup


def _remote_api() -> Any:
    from ..services.rag import rag_remote_setup

    return rag_remote_setup


def _runtime_api() -> Any:
    from ..services.rag import rag_runtime_loader

    return rag_runtime_loader


def _local_status() -> dict[str, Any]:
    try:
        status = _local_api().local_status()
        return status if isinstance(status, dict) else {}
    except Exception:  # noqa: BLE001 - 组件缺失时状态页仍要能打开（如实显示不可用）
        logger.info("语义检索本地组件不可用")
        return {
            "supported": False,
            "platform": "",
            "variant": "",
            "download_bytes": 0,
            "state": "unavailable",
            "progress": 0.0,
            "error": "",
            "model": "",
            "runtime_version": "",
        }


async def _probe_remote(config: EmbeddingProviderConfig) -> Any:
    return await _remote_api().probe_remote(config)


async def _fetch_remote_models(config: EmbeddingProviderConfig) -> list[str]:
    return await _remote_api().fetch_models(config)


def _validate_template(body_template: str, response_path: str) -> None:
    from ..services.rag.rag_embedding_endpoint import validate_template

    validate_template(body_template=body_template, response_path=response_path)


def _runtime_available(local: dict[str, Any]) -> bool:
    try:
        return bool(_runtime_api().runtime_ready())
    except Exception:  # noqa: BLE001 - 没有本地组件就是不可用
        return bool(local.get("state") == "ready")


def _compose_state(config: EmbeddingProviderConfig | None, local: dict[str, Any]) -> str:
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


def _remote_payload(config: EmbeddingProviderConfig | None) -> dict[str, Any]:
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


def _status_payload() -> dict[str, Any]:
    """设置页与生成链共用的唯一状态源；首次调用顺带把旧扁平配置迁移成命名配置。"""
    embedding_profiles_store.migrate_legacy_once()
    config = read_embedding_config()
    local = _local_status()
    # 本地已下载但还没启用过时也要有可激活的本地 profile（ready 态一键切换用）。
    embedding_profiles_store.ensure_local_profile(local)
    meta = embedding_profiles.active_meta()
    provider = config.provider if config is not None else ""
    return {
        "state": _compose_state(config, local),
        "provider": provider,
        "last_error": config.last_error if config is not None else "",
        "local": local,
        "remote": _remote_payload(config),
        "runtime": {"available": _runtime_available(local), "version": "1.31.1"},
        "config": mask_embedding_config(config) if config is not None else None,
        "profiles": embedding_profiles.list_profiles(),
        "active_profile_id": meta["active_profile_id"],
        "active_profile_updated_at": meta["active_profile_updated_at"],
        "local_profile_id": meta["local_profile_id"],
    }


def _log_switch(provider: str, model: str = "", dim: int = 0) -> None:
    get_rag_index().clear()
    logger.info("rag event provider_switched provider=%s model=%s dim=%s", provider, model, dim)


def _settings_allow_private() -> bool:
    return bool(get_settings().rag_embedding_allow_private_endpoint)


def _merge_remote(payload: RemoteConfigIn) -> EmbeddingProviderConfig:
    stored = read_embedding_config(reveal_key=True)
    base = (
        stored
        if stored is not None and stored.provider == "openai-http"
        else EmbeddingProviderConfig(provider="openai-http", pooling="server")
    )
    template = payload.endpoint_mode.strip().casefold() == "template"
    api_key = payload.api_key.strip()
    if not api_key or api_key == KEY_MASK:
        # 指定 profile_id 时只借那一条的已存密钥；否则沿用旧口径，绝不跨 profile。
        api_key = (
            embedding_profiles.profile_key(payload.profile_id)
            if payload.profile_id
            else base.api_key
        )
    headers = tuple(
        {"name": str(item.get("name") or ""), "value": str(item.get("value") or "")}
        for item in payload.headers
        if isinstance(item, dict)
    )
    return replace_config(
        base,
        provider="openai-http",
        model=payload.model.strip(),
        base_url=payload.base_url.strip(),
        api_key=api_key,
        batch_size=payload.batch_size,
        endpoint_mode="template" if template else "openai",
        request_url=payload.request_url.strip() if template else "",
        headers=headers if template else (),
        body_template=payload.body_template if template else "",
        response_path=(payload.response_path.strip() or "data[*].embedding")
        if template
        else "data[*].embedding",
        allow_private=bool(payload.allow_private),
        confirmed_hosts=base.confirmed_hosts or tuple(configured_hosts()),
        pooling="server",
        dim=base.dim,
        last_error="",
    )


def _validate_remote(config: EmbeddingProviderConfig) -> None:
    if config.endpoint_mode == "template":
        if not config.request_url:
            raise HTTPException(status_code=400, detail="高级端点缺少 URL")
        try:
            _validate_template(config.body_template, config.response_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        host = endpoint_host(config.request_url)
    else:
        if not config.base_url:
            raise HTTPException(status_code=400, detail="远程服务缺少 Base URL")
        host = endpoint_host(config.base_url)
    if not host:
        raise HTTPException(status_code=400, detail="服务地址不包含可识别的主机名")
    if not config.model:
        raise HTTPException(status_code=400, detail="远程服务缺少模型名")


@router.get("/status")
def read_embedding_status() -> dict[str, Any]:
    """设置页与生成链共用的唯一状态源。"""
    return _status_payload()


@router.post("/local/download")
def start_local_download(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    local = _local_status()
    if not local.get("supported"):
        raise HTTPException(status_code=400, detail="当前平台没有可用的本地语义检索运行时")
    try:
        _local_api().start_local_setup()
    except Exception as exc:  # noqa: BLE001 - 下载启动失败要可读，不能 500
        raise HTTPException(status_code=400, detail=str(exc) or "下载启动失败") from exc
    return _status_payload()


@router.get("/local/download")
def read_local_download() -> dict[str, Any]:
    try:
        return _local_api().local_status()
    except Exception:  # noqa: BLE001
        return _local_status()


@router.post("/local/download/cancel")
def cancel_local_download(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    try:
        _local_api().cancel_local_setup()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc) or "取消失败") from exc
    return _status_payload()


@router.post("/local/remove")
def remove_local_assets(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    try:
        _local_api().remove_local_assets()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc) or "删除本地模型失败") from exc
    config = read_embedding_config()
    was_local = config is not None and config.provider == "local-onnx"
    hosts = list(config.confirmed_hosts) if config is not None else []
    # 本地 profile 跟着资产一起删（否则 active 指向资源已不存在的本地配置）。
    embedding_profiles_store.remove_local_profile()
    if was_local:
        # 删除下载文件必须回到"未配置"：只置 enabled=False 会留下 provider=local-onnx
        # 半配置态。已确认的远程 host 保留，用户下次配远程时不必重新确认。
        clear_embedding_config()
        for host in hosts:
            mark_host_confirmed(host)
    _log_switch("disabled", "", 0)
    return _status_payload()


@router.post("/local/enable")
def enable_local_provider(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    try:
        _local_api().activate_local()
    except Exception as exc:  # noqa: BLE001 - 未下载/校验失败都要可读
        raise HTTPException(status_code=400, detail=str(exc) or "本地语义检索启用失败") from exc
    try:
        # 本地分支同步成 profile 并设为生效；之后切换一律走 profiles/{id}/activate。
        embedding_profiles_store.sync_local_profile_from_mirror()
    except embedding_profiles.ProfileError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "本地配置写入失败") from exc
    config = read_embedding_config()
    if config is None or config.provider != "local-onnx" or not config.enabled:
        raise HTTPException(status_code=400, detail="本地模型未通过校验，未启用")
    _log_switch(config.provider, config.model, config.dim)
    return _status_payload()


@router.post("/remote/confirm")
def confirm_remote_host(payload: ConfirmIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    host = endpoint_host(payload.base_url)
    if not host:
        raise HTTPException(status_code=400, detail="服务地址不包含可识别的主机名")
    mark_host_confirmed(host)
    return {"confirmed_hosts": configured_hosts(), "host": host}


@router.post("/remote/confirm/revoke")
def revoke_remote_host(payload: RevokeIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    host = endpoint_host(payload.host)
    remaining = revoke_host_confirmed(host)
    config = read_embedding_config()
    if config is not None and config.provider == "openai-http" and config.host() == host:
        write_active_embedding_config(replace_config(config, enabled=False))
        _log_switch("disabled", "", 0)
    return {"confirmed_hosts": remaining, "host": host}


@router.post("/remote/test")
async def test_remote_provider(payload: RemoteConfigIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    try:
        config = _merge_remote(payload)
    except embedding_profiles.ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _validate_remote(config)
    try:
        result = await _probe_remote(config)
    except Exception as exc:  # noqa: BLE001 - 探测失败要给可读原因
        raise HTTPException(status_code=400, detail=str(exc) or "远程服务校验失败") from exc
    ok = bool(getattr(result, "ok", False))
    return {
        "ok": ok,
        "dim": int(getattr(result, "dim", 0) or 0),
        "elapsed_ms": int(getattr(result, "elapsed_ms", 0) or 0),
        "model": str(getattr(result, "model", "") or config.model),
        "error": str(getattr(result, "error", "") or ""),
    }


@router.post("/remote/models")
async def list_remote_models(payload: RemoteConfigIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    try:
        config = _merge_remote(payload)
    except embedding_profiles.ProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not config.base_url or not endpoint_host(config.base_url):
        raise HTTPException(status_code=400, detail="远程服务缺少 Base URL")
    try:
        models = await _fetch_remote_models(config)
    except Exception:  # noqa: BLE001 - 模型列表只是辅助，拉不到就让用户手填
        models = []
    return {"models": list(models)[:1000]}


@router.post("/remote/enable")
async def enable_remote_provider(payload: RemoteConfigIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    config = _merge_remote(payload)
    _validate_remote(config)
    host = config.host()
    if host not in configured_hosts():
        raise HTTPException(
            status_code=400,
            detail=f"语义检索服务地址尚未确认外发范围：{host}",
        )
    allow_private = config.allow_private or _settings_allow_private()
    config = replace_config(config, allow_private=allow_private)
    try:
        result = await _probe_remote(config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc) or "远程服务校验失败") from exc
    if not getattr(result, "ok", False):
        # 失败不写 last_error：不能因为一次失败的启用把当前生效配置标成 failed。
        message = str(getattr(result, "error", "") or "远程服务校验未通过")
        raise HTTPException(status_code=400, detail=message)
    dim = int(getattr(result, "dim", 0) or 0)
    if dim <= 0:
        raise HTTPException(status_code=400, detail="远程服务没有返回可用的向量维度")
    try:
        # 旧入口兼容：upsert「默认配置」profile 再提交激活；常规切换走 activate。
        await embedding_activation.enable_remote_legacy(
            replace_config(
                config,
                enabled=True,
                dim=dim,
                pooling="server",
                normalize=True,
                last_error="",
            )
        )
    except embedding_profiles.ProfileError as exc:
        raise HTTPException(
            status_code=int(getattr(exc, "status_code", 400)), detail=str(exc)
        ) from exc
    _log_switch("openai-http", config.model, dim)
    return _status_payload()


@router.post("/disable")
def disable_embedding_provider(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    config = read_embedding_config()
    if config is not None:
        write_active_embedding_config(replace_config(config, enabled=False, last_error=""))
        _log_switch("disabled", "", 0)
    return _status_payload()


@router.post("/clear")
def clear_embedding_provider(request: Request) -> dict[str, Any]:
    # 兼容旧入口：清除当前生效配置的密钥并停用（「清除密钥」已改走 clear-key）。
    _guard_loopback(request)
    embedding_profiles_store.migrate_legacy_once()
    meta = embedding_profiles.active_meta()
    if meta["active_profile_id"]:
        try:
            embedding_profiles_store.clear_profile_key(meta["active_profile_id"])
        except embedding_profiles.ProfileError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    else:
        clear_embedding_config()
    _log_switch("disabled", "", 0)
    return _status_payload()


# 命名配置端点单独成模块（守住 500 行预算）；子模块只在函数内 import 本模块。
from .settings_embedding_profiles import router as _profiles_router  # noqa: E402

router.include_router(_profiles_router)

__all__ = ["router"]
