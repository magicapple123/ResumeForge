# SPDX-License-Identifier: Apache-2.0
"""Embedding 能力：模型描述、基类、fake 与工厂（真实 provider 在独立模块）。

基类统一前缀/归一化/维度/异常/用量。两个真实 provider 在 RAG v3 接入产品运行时：

- ``local-onnx``：本地权重 + 隔离 onnxruntime 运行时（``embeddings_local``）；
- ``openai-http``：任意 OpenAI 兼容 /embeddings，含自定义端点模板（``embeddings_http``）。

持久化配置（设置页写的 provider/model/key 等）在 ``embedding_settings``；本模块的
``resolve_embedding_spec`` 以**持久化配置优先**，环境变量配置只作测试/老路径回退。
Fake 仍只供 CI 管道测试（不得用于质量指标），并受 ``RAG_EMBEDDING_ALLOW_FAKE`` 守卫。"""

from __future__ import annotations

import asyncio
import hashlib
import math
import os
import struct
import time
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, replace

import httpx

from ...config import Settings, get_settings
from ...runtime.operation_budget import OperationBudget, OperationCancelled
from ..net_policy import ADDRESS_INVALID, non_public_address_reason
from . import retry
from .base import LLMError
from .client_pool import get_shared_client
from .payload import validated_base_url
from .usage import FINISH_CANCELLED, FINISH_ERROR, FINISH_STOP, LLMUsage, build_usage

_DISABLED_PROVIDERS = frozenset({"", "none", "disabled"})


@dataclass(frozen=True)
class EmbeddingModelSpec:
    """换模型就会掉分的模型属性（§2.3）：任一项变化即视为新索引。"""

    provider: str
    model: str
    dim: int
    pooling: str
    query_prefix: str = ""
    doc_prefix: str = ""
    normalize: bool = True

    def fingerprint(self) -> str:
        """sha256（固定字段顺序与 \x1f 分隔）：任一变化都得到新指纹。"""
        head = "\x1f".join(("v1", self.provider, self.model, str(self.dim), self.pooling))
        tail = "\x1f".join((self.query_prefix, self.doc_prefix, str(int(self.normalize))))
        return hashlib.sha256(f"{head}\x1f{tail}".encode()).hexdigest()


class EmbeddingError(Exception):
    """embedding 调用失败；message 可直接展示，调用方应回退关键词链。"""


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: tuple[tuple[float, ...], ...]
    model: str
    dim: int
    elapsed_ms: int
    retries: int = 0


class BaseEmbeddingProvider(ABC):
    """embedding provider 基类：前缀/归一化/维度/异常/用量的唯一实现。"""

    def __init__(self, spec: EmbeddingModelSpec) -> None:
        self.spec = spec
        self.last_usage: LLMUsage | None = None

    async def embed_documents(
        self, texts: Sequence[str], *, budget: OperationBudget | None = None
    ) -> EmbeddingBatch:
        return await self._run("doc", list(texts), budget=budget)

    async def embed_query(
        self, text: str, *, budget: OperationBudget | None = None
    ) -> tuple[float, ...]:
        return (await self._run("query", [text], budget=budget)).vectors[0]

    @abstractmethod
    async def _embed_prefixed(
        self, texts: list[str], *, budget: OperationBudget | None = None
    ) -> EmbeddingBatch:
        raise NotImplementedError

    async def _run(
        self, kind: str, texts: list[str], *, budget: OperationBudget | None
    ) -> EmbeddingBatch:
        started = time.monotonic()
        finish_reason = FINISH_ERROR
        try:
            if budget is not None and (budget.is_cancelled() or budget.is_expired()):
                raise EmbeddingError(f"embedding 调用预算不足：{budget.expiry_reason()}")
            if not texts or any(not isinstance(t, str) or not t.strip() for t in texts):
                raise EmbeddingError("embedding 文本不能为空")
            prefix = self.spec.query_prefix if kind == "query" else self.spec.doc_prefix
            batch = await self._embed_prefixed([prefix + text for text in texts], budget=budget)
            if len(batch.vectors) != len(texts):
                raise EmbeddingError(f"embedding 返回条数不符：期望 {len(texts)} 条")
            dim = self.spec.dim
            vectors: list[tuple[float, ...]] = []
            for vector in batch.vectors:
                if len(vector) != dim:
                    raise EmbeddingError(f"embedding 维度不符：期望 {dim}，实际 {len(vector)}")
                values = tuple(float(value) for value in vector)
                norm = math.sqrt(sum(value * value for value in values))
                if not math.isfinite(norm) or (self.spec.normalize and norm <= 0.0):
                    raise EmbeddingError("embedding 向量为零向量或数值非法")
                if self.spec.normalize:
                    values = tuple(value / norm for value in values)
                vectors.append(values)
            finish_reason = FINISH_STOP
            elapsed = max(0, int((time.monotonic() - started) * 1000))
            return replace(
                batch, vectors=tuple(vectors), model=self.spec.model, dim=dim, elapsed_ms=elapsed
            )
        except asyncio.CancelledError:
            finish_reason = FINISH_CANCELLED  # 真正的取消原样传播，不吞成 EmbeddingError
            raise
        except OperationCancelled as exc:  # 预算取消只回退关键词链，不打断生成
            raise EmbeddingError(str(exc)) from exc
        except EmbeddingError:
            raise
        except Exception as exc:  # 任何实现异常都收敛为可展示错误（不回显正文）
            raise EmbeddingError(f"embedding 调用失败（{type(exc).__name__}）") from exc
        finally:
            duration = max(0, int((time.monotonic() - started) * 1000))
            self.last_usage = build_usage(
                self.spec.model, elapsed_ms=duration, finish_reason=finish_reason
            )


#: 仅测试用的 fake 编码延迟旋钮（单位毫秒，默认 0）。用于 E2E 验证"请求预算超时
#: 回退 + 后台预热"路径：fake provider 本身默认被 `rag_embedding_allow_fake` 守卫
#: 禁止进入生产排序，所以这个旋钮不改变任何生产行为，也不是配置项。
_FAKE_DELAY_ENV = "RAG_FAKE_EMBED_DELAY_MS"


def _fake_delay_seconds() -> float:
    try:
        raw = float(os.environ.get(_FAKE_DELAY_ENV, "0").strip() or 0)
    except ValueError:
        return 0.0
    return max(0.0, min(30_000.0, raw)) / 1000.0


class FakeEmbeddingProvider(BaseEmbeddingProvider):
    """确定性 hash 向量（SHAKE-256），供 CI 测试；**不得用于质量指标**（向量与语义无关）。

    `RAG_FAKE_EMBED_DELAY_MS`（测试旋钮，默认 0）只用于 E2E 验证请求预算/回退路径。
    """

    async def _embed_prefixed(
        self, texts: list[str], *, budget: OperationBudget | None = None
    ) -> EmbeddingBatch:
        delay = _fake_delay_seconds()
        if delay > 0:
            await asyncio.sleep(delay)
        vectors = tuple(_hash_vector(text, self.spec.dim) for text in texts)
        return EmbeddingBatch(vectors, self.spec.model, self.spec.dim, 0)


def _hash_vector(text: str, dim: int) -> tuple[float, ...]:
    digest = hashlib.shake_256(text.encode("utf-8")).digest(8 * dim)
    return tuple(value / float(1 << 63) - 1.0 for value in struct.unpack(f">{dim}Q", digest))


class HttpEmbeddingProvider(BaseEmbeddingProvider):
    """OpenAI 兼容 `POST {base_url}/embeddings`：能力已具备、仅离线测试，默认不接线。

    `client` 可注入（MockTransport 测试）；未注入时复用聊天链共享连接池。端点主机是 IP
    字面量时用 net_policy 拒绝非公网地址；主机名在本层不解析（DNS 与建连地址的绑定留给出网策略层）。
    """

    def __init__(
        self,
        spec: EmbeddingModelSpec,
        *,
        base_url: str,
        api_key: str = "",
        model: str | None = None,
        timeout: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(spec)
        if model is not None and model != spec.model:
            raise EmbeddingError("embedding 模型与能力声明不一致")
        try:
            self.base_url = validated_base_url(base_url)
        except LLMError as exc:
            raise EmbeddingError(str(exc)) from exc
        reason = non_public_address_reason(httpx.URL(self.base_url).host)
        if reason is not None and reason != ADDRESS_INVALID:
            raise EmbeddingError(f"embedding 服务地址不能指向非公网地址（{reason}）")
        self.api_key = api_key
        self.timeout = float(timeout) if timeout is not None else 10.0
        self._client = client

    async def _embed_prefixed(
        self, texts: list[str], *, budget: OperationBudget | None = None
    ) -> EmbeddingBatch:
        payload: dict[str, object] = {"model": self.spec.model, "input": list(texts)}
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else None
        remaining_fn = (lambda: budget.remaining()) if budget is not None else None
        gate = retry.StatusRetryGate(deadline_remaining_fn=remaining_fn)
        client = self._client or get_shared_client()
        while True:
            timeout = self.timeout
            if budget is not None:
                if budget.remaining() <= 0:
                    raise EmbeddingError(f"embedding 调用预算已耗尽：{budget.expiry_reason()}")
                timeout = min(timeout, budget.remaining())
            try:
                async with asyncio.timeout(timeout):
                    response = await client.post(
                        f"{self.base_url}/embeddings",
                        json=payload,
                        headers=headers,
                        timeout=timeout,
                    )
            except (TimeoutError, httpx.TimeoutException) as exc:
                raise EmbeddingError("embedding 服务响应超时，请稍后重试") from exc
            except httpx.RequestError as exc:
                raise EmbeddingError("无法连接 embedding 服务，请检查 Base URL 与网络状态") from exc
            if response.status_code == 200:
                break
            delay = gate.next_delay(response.status_code, response.headers.get("retry-after"))
            if delay is None:
                message = f"embedding 服务调用失败（HTTP {response.status_code}）"
                raise EmbeddingError(str(gate.final_error(response.status_code, LLMError(message))))
            await retry.retry_sleep(delay)
        try:
            items = response.json()["data"]
            if not isinstance(items, list) or len(items) != len(texts):
                raise ValueError("data/条数")
            vectors = tuple(tuple(float(value) for value in item["embedding"]) for item in items)
        except (ValueError, KeyError, TypeError) as exc:
            raise EmbeddingError("embedding 响应格式非法（缺 data/embedding 或条数不符）") from exc
        return EmbeddingBatch(vectors, self.spec.model, self.spec.dim, 0, gate.retries)


def resolve_embedding_spec(settings: Settings | None = None) -> EmbeddingModelSpec | None:
    """解析当前生效的 embedding 模型描述；未配置/关闭时返回 None。

    **持久化配置优先**（设置页启用的真实 provider），没有时才回退环境变量配置——
    后者是测试与 v2 老路径（fake）的入口。真实 provider 只在 enabled 且 model/dim
    齐备时生效：半配置态（如 provider=local-onnx 但权重没下）由工厂层回退，不在这里猜。
    """
    settings = settings or get_settings()
    from .embedding_settings import config_to_spec, read_embedding_config

    persisted = read_embedding_config(reveal_key=True)
    if (
        persisted is not None
        and persisted.enabled
        and persisted.provider in ("local-onnx", "openai-http")
        and persisted.model
        and persisted.dim > 0
    ):
        return config_to_spec(persisted)
    provider = (settings.rag_embedding_provider or "").strip().casefold()
    if provider in _DISABLED_PROVIDERS:
        return None
    return EmbeddingModelSpec(
        provider,
        (settings.rag_embedding_model or "").strip(),
        settings.rag_embedding_dim,
        (settings.rag_embedding_pooling or "").strip().casefold(),
        settings.rag_embedding_query_prefix or "",
        settings.rag_embedding_doc_prefix or "",
        bool(settings.rag_embedding_normalize),
    )


def create_embedding_provider(
    spec: EmbeddingModelSpec | None = None, *, client: httpx.AsyncClient | None = None
) -> BaseEmbeddingProvider | None:
    """按 spec.provider 造调用器；不可用（未配置/未下载/未确认）返回 None 或抛可展示错误。

    真实 provider 的连接参数（base_url/key/batch_size/端点模板/variant）全部来自
    持久化配置；环境变量配置只支持 fake。调用方（rag_service）把任何异常都收敛成
    "回退关键词链 + 空作用域"，这里只需要保证错误信息可读且不含密钥/完整 URL。
    """
    spec = spec or resolve_embedding_spec()
    if spec is None:
        return None
    provider_name = spec.provider.strip().casefold()
    if provider_name == "fake":
        return FakeEmbeddingProvider(spec)
    from .embedding_settings import is_host_confirmed, read_embedding_config

    persisted = read_embedding_config(reveal_key=True)
    if persisted is None or not persisted.enabled or persisted.provider.casefold() != provider_name:
        return None
    if provider_name == "local-onnx":
        try:
            from ..rag.rag_runtime_loader import RuntimeUnavailable, ensure_runtime, model_dir
            from .embeddings_local import LocalOnnxEmbeddingProvider

            try:
                ensure_runtime()
            except RuntimeUnavailable as exc:
                raise EmbeddingError(f"本地语义检索运行时不可用（{exc}）") from exc
            return LocalOnnxEmbeddingProvider(spec, model_dir=model_dir(persisted.variant))
        except EmbeddingError:
            raise
        except Exception as exc:  # noqa: BLE001 - 运行时不匹配/文件缺失都回退关键词链
            raise EmbeddingError(f"本地语义检索不可用（{type(exc).__name__}）") from exc
    if provider_name == "openai-http":
        if not is_host_confirmed(persisted):
            raise EmbeddingError("语义检索服务地址尚未确认外发范围")
        allow_private = bool(
            persisted.allow_private or get_settings().rag_embedding_allow_private_endpoint
        )
        try:
            from .embeddings_http import OpenAIHttpEmbeddingProvider, TemplateHttpEmbeddingProvider

            if persisted.endpoint_mode == "template":
                return TemplateHttpEmbeddingProvider(
                    spec, config=persisted, allow_private=allow_private, client=client
                )
            return OpenAIHttpEmbeddingProvider(
                spec,
                base_url=persisted.base_url,
                api_key=persisted.api_key,
                batch_size=persisted.batch_size,
                allow_private=allow_private,
                timeout=float(get_settings().rag_embedding_timeout_seconds),
                client=client,
            )
        except EmbeddingError:
            raise
        except Exception as exc:  # noqa: BLE001 - 任何构造失败都回退关键词链
            raise EmbeddingError(f"远程语义检索不可用（{type(exc).__name__}）") from exc
    return None
