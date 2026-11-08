# SPDX-License-Identifier: Apache-2.0
"""远程 embedding 的设置期服务：探测维度、拉模型列表、组装 /status.remote（RAG v3 §4.2）。

为什么单独成模块：设置页只依赖这里的函数，不 import provider 内部；探测走底层
transport（provider.probe_dim），不依赖 config.dim——dim 是探测出来的，不是用户填的
（任务书 §4.2：界面上不出现该字段，探测失败才允许高级手填）。

失败语义：所有函数都不向路由抛异常。probe/fetch 失败返回 ok=False + 可读 error（不含
key、完整 URL、Authorization）；remote_status 不抛异常、不返回密钥。错误字符串里只允许
host / 原因键 / 状态码 / 厂商展示名。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from ...config import Settings, get_settings
from ..llm.client_pool import get_shared_client
from ..llm.embeddings import EmbeddingError, EmbeddingModelSpec
from ..llm.embeddings_http import (
    OpenAIHttpEmbeddingProvider,
    TemplateHttpEmbeddingProvider,
    validate_endpoint_url,
)

PROBE_TEXT = "语义检索连接探测"
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_MODELS = 200


@dataclass(frozen=True)
class ProbeResult:
    """一次"测试连接"的结果；ok=False 时 error 可直接展示。"""

    ok: bool
    dim: int
    elapsed_ms: int
    model: str
    error: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))


def _settings() -> Settings | None:
    try:
        return get_settings()
    except Exception:  # noqa: BLE001 - 配置读取失败按默认超时/未允许私网处理
        return None


def _timeout_seconds() -> float:
    settings = _settings()
    try:
        value = float(settings.rag_embedding_timeout_seconds) if settings else 0.0
    except (TypeError, ValueError):
        value = 0.0
    return value if value > 0 else DEFAULT_TIMEOUT_SECONDS


def _allow_private(config: Any) -> bool:
    """用户显式允许私有端点（设置项）或环境变量开关；两者任一为真即放行。"""
    explicit = bool(getattr(config, "allow_private", False))
    settings = _settings()
    return explicit or bool(getattr(settings, "rag_embedding_allow_private_endpoint", False))


def _spec_from_config(config: Any) -> EmbeddingModelSpec:
    """探测用的模型描述：dim=1 只是占位，probe_dim 不依赖它。"""
    return EmbeddingModelSpec(
        provider=str(getattr(config, "provider", "") or "openai-http"),
        model=str(getattr(config, "model", "") or ""),
        dim=1,
        pooling=str(getattr(config, "pooling", "") or "server"),
        query_prefix=str(getattr(config, "query_prefix", "") or ""),
        doc_prefix=str(getattr(config, "doc_prefix", "") or ""),
        normalize=bool(getattr(config, "normalize", True)),
    )


def build_provider(config: Any, *, client: httpx.AsyncClient | None = None) -> Any:
    """按配置构造远程 provider（设置期探测与运行期共用同一构造逻辑）。"""
    spec = _spec_from_config(config)
    timeout = _timeout_seconds()
    allow_private = _allow_private(config)
    mode = str(getattr(config, "endpoint_mode", "openai") or "openai").strip().casefold()
    if mode == "template":
        return TemplateHttpEmbeddingProvider(
            spec, config=config, allow_private=allow_private, client=client, timeout=timeout
        )
    if mode != "openai":
        raise EmbeddingError("不支持的端点模式")
    base_url = str(getattr(config, "base_url", "") or "")
    if not base_url:
        raise EmbeddingError("请先填写 Base URL")
    return OpenAIHttpEmbeddingProvider(
        spec,
        base_url=base_url,
        api_key=str(getattr(config, "api_key", "") or ""),
        batch_size=max(1, int(getattr(config, "batch_size", 25) or 25)),
        allow_private=allow_private,
        client=client,
        timeout=timeout,
    )


async def probe_remote(config: Any, *, client: httpx.AsyncClient | None = None) -> ProbeResult:
    """发 1 条短文本探测真实端点，返回维度/耗时/可读错误（不依赖 config.dim）。

    client 仅供测试注入 MockTransport；路由不传。探测失败不抛异常给路由——这就是
    "测试连接"的语义。
    """
    started = time.perf_counter()
    model = str(getattr(config, "model", "") or "")
    provider: Any = None
    try:
        provider = build_provider(config, client=client)
        dim = await provider.probe_dim(PROBE_TEXT)
        return ProbeResult(True, dim, _elapsed_ms(started), model, "")
    except EmbeddingError as exc:
        return ProbeResult(False, 0, _elapsed_ms(started), model, str(exc))
    except Exception as exc:  # noqa: BLE001 - 配置缺字段/模板内部错误都收敛成可读失败
        return ProbeResult(
            False, 0, _elapsed_ms(started), model, f"探测失败（{type(exc).__name__}）"
        )
    finally:
        closer = getattr(provider, "aclose", None) if provider is not None else None
        if closer is not None:
            await closer()


async def fetch_models(config: Any, *, client: httpx.AsyncClient | None = None) -> list[str]:
    """GET {base_url}/models 拉可用模型；任何失败返回 []（界面退回手填模型名）。"""
    mode = str(getattr(config, "endpoint_mode", "openai") or "openai").strip().casefold()
    if mode == "template":
        return []  # 模板端点没有统一的模型列表协议
    raw_base = str(getattr(config, "base_url", "") or "")
    if not raw_base:
        return []
    try:
        base = validate_endpoint_url(raw_base, allow_private=_allow_private(config))
    except EmbeddingError:
        return []
    url = base.rstrip("/") + "/models"
    headers: dict[str, str] = {}
    api_key = str(getattr(config, "api_key", "") or "")
    if api_key and api_key != "********":
        headers["Authorization"] = f"Bearer {api_key}"
    client = client or get_shared_client()
    try:
        async with asyncio.timeout(_timeout_seconds()):
            response = await client.get(url, headers=headers, timeout=_timeout_seconds())
        if response.status_code != 200:
            return []
        payload = response.json()
    except Exception:  # noqa: BLE001 - 拉列表失败只是"退回手填"，绝不影响设置页
        return []
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    models: list[str] = []
    for item in items:
        model_id = item.get("id") if isinstance(item, dict) else None
        if isinstance(model_id, str) and model_id.strip() and model_id not in models:
            models.append(model_id.strip())
        if len(models) >= MAX_MODELS:
            break
    return models


def _fallback_host(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw if "://" in raw else "//" + raw)
        return (parsed.hostname or "").strip(".").casefold()
    except ValueError:
        return ""


def _config_host(config: Any) -> str:
    """与 Lead 的 endpoint_host 同一口径（host 级确认按它记录）。"""
    mode = str(getattr(config, "endpoint_mode", "openai") or "openai")
    value = (
        str(getattr(config, "request_url", "") or "")
        if mode == "template"
        else str(getattr(config, "base_url", "") or "")
    )
    try:
        from ..llm.embedding_settings import endpoint_host

        return endpoint_host(value)
    except Exception:  # noqa: BLE001 - 配置模块不可用时退回本地解析（同口径）
        return _fallback_host(value)


def _read_persisted_config() -> Any | None:
    try:
        from ..llm.embedding_settings import read_embedding_config

        return read_embedding_config(reveal_key=False)
    except Exception:  # noqa: BLE001 - 未落盘/模块不可用都按"未配置"
        return None


def remote_status(config: Any | None = None) -> dict[str, Any]:
    """GET /status 的 remote 段（字段名固定，见契约 §3）；不抛异常、不含密钥。

    config 可显式传入（测试/调用方已读好）；缺省时从持久化配置读取。
    """
    empty: dict[str, Any] = {
        "configured": False,
        "enabled": False,
        "host": "",
        "model": "",
        "dim": 0,
        "endpoint_mode": "openai",
        "batch_size": 25,
        "confirmed_hosts": [],
        "pending_host": "",
        "error": "",
    }
    if config is None:
        config = _read_persisted_config()
    if config is None:
        return empty
    if str(getattr(config, "provider", "") or "").casefold() != "openai-http":
        return empty
    host = _config_host(config)
    confirmed = [str(item) for item in (getattr(config, "confirmed_hosts", ()) or ())]
    try:
        dim = max(0, int(getattr(config, "dim", 0) or 0))
    except (TypeError, ValueError):
        dim = 0
    try:
        batch_size = max(1, int(getattr(config, "batch_size", 25) or 25))
    except (TypeError, ValueError):
        batch_size = 25
    return {
        "configured": True,
        "enabled": bool(getattr(config, "enabled", False)),
        "host": host,
        "model": str(getattr(config, "model", "") or ""),
        "dim": dim,
        "endpoint_mode": "template"
        if str(getattr(config, "endpoint_mode", "") or "") == "template"
        else "openai",
        "batch_size": batch_size,
        "confirmed_hosts": confirmed,
        # 已配置但 host 还没确认 → 界面据此弹隐私确认（换 host 要重新确认）。
        "pending_host": host if host and host not in confirmed else "",
        "error": str(getattr(config, "last_error", "") or ""),
    }


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_MODELS",
    "PROBE_TEXT",
    "ProbeResult",
    "build_provider",
    "fetch_models",
    "probe_remote",
    "remote_status",
]
