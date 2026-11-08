# SPDX-License-Identifier: Apache-2.0
"""语义检索 embedding provider 的设置端点（本地 onnxruntime / 远程 OpenAI 兼容）。

状态机只有一份来源：``GET /status``。设置页按它渲染，生成链按持久化配置构造 provider；
两者读同一份 ``global_settings.json`` 的 ``embedding`` 段（见 ``embedding_settings``）。

**失败不得显示为已启用**：``enabled`` 只在本地下载校验通过 / 远程真实探测通过后由
本模块写入；下载失败、401、维度不符都落 ``last_error`` 并在状态里可见。

**清理索引**：provider / 模型 / 维度切换后旧向量既不会被命中又会占着有界 LRU，所以
enable / disable / clear 都主动 ``get_rag_index().clear()`` 并记一条
``rag event provider_switched``（与 ``rag_service`` 的兜底检测互补）。

本模块只做 HTTP 编排与错误翻译；下载/探测/模板解析分别在
``rag_local_setup`` / ``rag_remote_setup`` / ``rag_embedding_endpoint``。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import get_settings
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
    set_embedding_error,
    write_embedding_config,
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
    config = read_embedding_config()
    local = _local_status()
    provider = config.provider if config is not None else ""
    return {
        "state": _compose_state(config, local),
        "provider": provider,
        "last_error": config.last_error if config is not None else "",
        "local": local,
        "remote": _remote_payload(config),
        "runtime": {"available": _runtime_available(local), "version": "1.31.1"},
        "config": mask_embedding_config(config) if config is not None else None,
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
        api_key = base.api_key
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
    if config is not None and config.provider == "local-onnx":
        # 删除下载文件必须回到"未配置"：只置 enabled=False 会留下 provider=local-onnx
        # 的半配置态，之后每次生成都会先尝试本地 provider 再回退。已确认的远程 host
        # 保留下来，用户下次配远程时不必重新确认。
        hosts = list(config.confirmed_hosts)
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
        write_embedding_config(replace_config(config, enabled=False))
        _log_switch("disabled", "", 0)
    return {"confirmed_hosts": remaining, "host": host}


@router.post("/remote/test")
async def test_remote_provider(payload: RemoteConfigIn, request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    config = _merge_remote(payload)
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
    config = _merge_remote(payload)
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
        message = str(getattr(result, "error", "") or "远程服务校验未通过")
        if read_embedding_config() is not None:
            set_embedding_error(message)
        raise HTTPException(status_code=400, detail=message)
    dim = int(getattr(result, "dim", 0) or 0)
    if dim <= 0:
        raise HTTPException(status_code=400, detail="远程服务没有返回可用的向量维度")
    write_embedding_config(
        replace_config(
            config,
            enabled=True,
            dim=dim,
            pooling="server",
            normalize=True,
            last_error="",
        )
    )
    _log_switch("openai-http", config.model, dim)
    return _status_payload()


@router.post("/disable")
def disable_embedding_provider(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    config = read_embedding_config()
    if config is not None:
        write_embedding_config(replace_config(config, enabled=False, last_error=""))
        _log_switch("disabled", "", 0)
    return _status_payload()


@router.post("/clear")
def clear_embedding_provider(request: Request) -> dict[str, Any]:
    _guard_loopback(request)
    clear_embedding_config()
    _log_switch("disabled", "", 0)
    return _status_payload()


__all__ = ["router"]
