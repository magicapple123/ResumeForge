# SPDX-License-Identifier: Apache-2.0
"""本地 embedding 设置流程：合并状态 / 下载 / 取消 / 删除 / 启用（写持久化配置）。

分工（契约 §3）：``start_local_setup`` 只负责下载/解包/校验；``activate_local`` 才在
"文件 + 运行时 + 自检编码"都通过后写 ``embedding_settings.write_embedding_config``
（enabled=True）。任一失败都停在可读错误上，**绝不显示为已启用**——生成链继续回退关键词。

状态映射（GET /status 的 local.state）：idle→not_downloaded；downloading/verifying/
extracting 原样；ready→ready；failed→failed；平台不支持→unsupported。
"""

from __future__ import annotations

import logging
from typing import Any

from . import rag_model_download as download
from .rag_asset_manifest import (
    AssetUnavailable,
    asset_total_bytes,
    local_supported,
    platform_label,
    select_assets,
    verify_file,
)
from .rag_runtime_loader import RuntimeUnavailable, assets_present, ensure_runtime, model_dir

logger = logging.getLogger(__name__)

_PROGRESS_STATES = {"downloading", "verifying", "extracting", "failed"}


class SetupError(RuntimeError):
    """本地设置流程失败；消息可直接展示（只写原因，不写引导语）。"""


def _manifest_assets() -> dict[str, Any]:
    try:
        return select_assets()
    except AssetUnavailable as exc:
        raise SetupError(str(exc)) from exc


def local_status() -> dict[str, Any]:
    """本地 provider 的状态块（GET /status 的 local 字段）。"""
    supported = local_supported()
    platform = platform_label()
    progress = download.read_progress()
    state = str(progress.get("state") or "idle")
    error = str(progress.get("error") or "")
    variant = model_id = runtime_version = ""
    download_bytes = 0
    if supported:
        try:
            assets = _manifest_assets()
        except SetupError as exc:
            supported, error = False, error or str(exc)
            assets = {}
        else:
            variant = str(assets.get("variant") or "")
            runtime_version = str(assets.get("ort_version") or "")
            model_id = str(dict(assets.get("model") or {}).get("id") or "")
            download_bytes = asset_total_bytes()
    if not supported:
        state = "unsupported"
    elif state == "idle":
        state = "ready" if assets_present() else "not_downloaded"
    if supported and state not in _PROGRESS_STATES and state not in {"ready", "not_downloaded"}:
        state = "not_downloaded"
    return {
        "supported": supported,
        "platform": platform,
        "variant": variant,
        "download_bytes": download_bytes,
        "state": state,
        "progress": float(progress.get("progress") or 0.0),
        "error": error,
        "model": model_id,
        "runtime_version": runtime_version,
    }


def start_local_setup() -> dict[str, Any]:
    """下载并安装本地模型 + 运行时（后台线程）；已就绪时直接返回 ready。"""
    if not local_supported():
        raise SetupError(f"该架构不支持本地模型（{platform_label()}）")
    if assets_present():
        return local_status()
    try:
        download.start_download()
    except download.DownloadError as exc:
        raise SetupError(str(exc)) from exc
    return local_status()


def cancel_local_setup() -> dict[str, Any]:
    """取消下载（幂等）；返回取消后的本地状态。"""
    download.cancel_download()
    return local_status()


def remove_local_assets() -> dict[str, Any]:
    """删除数据目录下的模型/运行时版本目录（只删这两个）。"""
    try:
        download.delete_assets()
    except download.DownloadError as exc:
        raise SetupError(str(exc)) from exc
    return local_status()


def _verify_model_files(assets: dict[str, Any]) -> None:
    """按清单逐个 sha256 校验模型文件（下载时已校验过，这里防"下载后文件被改/删"）。"""
    model = dict(assets.get("model") or {})
    directory = model_dir(str(assets.get("variant") or ""))
    files = [
        item for item in model.get("files") or [] if isinstance(item, dict) and item.get("target")
    ]
    if not files:
        raise SetupError("本地资产清单缺少模型文件表")
    for item in files:
        if not verify_file(directory / str(item["target"]), str(item.get("sha256") or "")):
            raise SetupError(f"本地模型文件校验失败（{str(item['target'])}）")


def _self_check(assets: dict[str, Any]) -> int:
    """真机自检：加载运行时 + 模型，编码一条短文本并核对维度。"""
    from ..llm.embeddings import EmbeddingModelSpec
    from ..llm.embeddings_local import LocalOnnxEmbeddingProvider

    model = dict(assets.get("model") or {})
    dim = int(model.get("dim") or 0)
    spec = EmbeddingModelSpec(
        provider="local-onnx",
        model=str(model.get("id") or ""),
        dim=dim,
        pooling=str(model.get("pooling") or "cls"),
        normalize=True,
    )
    provider = LocalOnnxEmbeddingProvider(
        spec, model_dir=model_dir(str(assets.get("variant") or ""))
    )
    actual = provider.self_check()
    if actual != dim:
        raise SetupError(f"本地模型输出维度与清单不符（{actual} != {dim}）")
    return actual


def _write_config(*, model: str, dim: int, variant: str) -> None:
    """写持久化配置（enabled=True）；保留已确认的远程 host，切本地后不必重新确认。"""
    try:
        from ..llm.embedding_settings import (
            EmbeddingProviderConfig,
            read_embedding_config,
            write_embedding_config,
        )
    except Exception as exc:  # noqa: BLE001 - 配置模块未就绪不应让进程崩
        raise SetupError("语义检索配置模块不可用") from exc
    previous = read_embedding_config()
    hosts = previous.confirmed_hosts if previous is not None else ()
    write_embedding_config(
        EmbeddingProviderConfig(
            provider="local-onnx",
            enabled=True,
            model=model,
            dim=dim,
            pooling="cls",
            normalize=True,
            variant=variant,
            allow_private=False,
            confirmed_hosts=hosts,
        )
    )


def activate_local() -> dict[str, Any]:
    """启用本地 provider：文件 + 运行时 + 自检编码全部通过后才写配置。"""
    if not local_supported():
        raise SetupError(f"该架构不支持本地模型（{platform_label()}）")
    assets = _manifest_assets()
    if not assets_present():
        raise SetupError("本地模型尚未下载完成")
    _verify_model_files(assets)
    try:
        ensure_runtime()
    except RuntimeUnavailable as exc:
        raise SetupError(str(exc)) from exc
    model = dict(assets.get("model") or {})
    dim = _self_check(assets)
    _write_config(
        model=str(model.get("id") or ""), dim=dim, variant=str(assets.get("variant") or "")
    )
    logger.info(
        "本地 embedding 已启用：model=%s variant=%s dim=%s",
        model.get("id"),
        assets.get("variant"),
        dim,
    )
    return local_status()


__all__ = [
    "SetupError",
    "activate_local",
    "cancel_local_setup",
    "local_status",
    "remove_local_assets",
    "start_local_setup",
]
