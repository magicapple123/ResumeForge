# SPDX-License-Identifier: Apache-2.0
"""远程 embedding provider 的 HTTP transport（RAG v3 任务书 §4.2/§4.4/§4.7）。

**两层拆分**（任务书 §4.7 路径 B）：transport（本模块）只负责造请求 / 解响应 / 批切片 /
重试 / 私网策略 / 探测；通用编排（分批、预算、维度、缓存指纹）在 embeddings.py 的
BaseEmbeddingProvider。非兼容厂商将来只需再写一个 transport，不复制编排。

两个具体 provider：

- OpenAIHttpEmbeddingProvider：POST {base_url}/embeddings，body 只有 model + input；
- TemplateHttpEmbeddingProvider：按用户模板渲染 request_url / headers / body，按
  response_path 解析（细节与上限在 rag_embedding_endpoint，本模块不重复实现）。

硬约束（任务书 §4.1/§8）：batch_size 默认 25（第 26 条必须另起一片）、每片独立重试
（切片失败只重试该片）、超时/429/5xx 复用 retry.py 与 OperationBudget、返回条数/维度
不符抛 EmbeddingError、404 对已知不提供 /embeddings 的厂商给可读文案。错误字符串只含
状态码/原因键/厂商展示名，不含完整 URL、Authorization 或 key。

隐私：渲染后的 header（可能含 API Key）只交给 httpx，不写日志、不进异常字符串；
私网端点放行时日志只记 endpoint_class 与 host，不记 URL。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping
from urllib.parse import urlsplit

import httpx

from ...runtime.operation_budget import OperationBudget
from ..net_policy import ADDRESS_INVALID, endpoint_class
from ..rag.rag_embedding_endpoint import (
    MAX_RESPONSE_BYTES,
    TemplateError,
    generic_404_hint,
    non_embedding_vendor,
    parse_response,
    render_body,
    render_headers,
    validate_template,
)
from . import retry
from .base import LLMError
from .client_pool import get_shared_client
from .embeddings import (
    BaseEmbeddingProvider,
    EmbeddingBatch,
    EmbeddingError,
    EmbeddingModelSpec,
    HttpEmbeddingProvider,
)
from .payload import http_error_message, validated_base_url

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 25
_CONTENT_TYPE = {"Content-Type": "application/json"}
_LOG_HOST_MAX = 64


def dimension_error_404(host: str) -> str:
    """404 时的可读文案：已知不提供 /embeddings 的厂商点名（函数名沿用契约）。"""
    vendor = non_embedding_vendor(host)
    if vendor is not None:
        return (
            f"{vendor} 不提供 embeddings 接口：请在设置里改用支持该接口的服务，或使用自定义端点模板"
        )
    return generic_404_hint()


def _status_error(status: int, host: str) -> str:
    if status == 404:
        return dimension_error_404(host)
    return http_error_message(status)


def _log_host(host: str) -> str:
    return str(host or "")[:_LOG_HOST_MAX]


def _validated_private_url(value: str) -> str | None:
    """显式允许私网时的放宽校验：只接受无凭据、无 query/fragment 的 http(s) URL。

    validated_base_url 的 HTTPS 限制是为公网地址定的；本机/内网服务常是 http，用户显式
    允许私有端点后应能连上。除该限制外其余规则（协议/凭据/query）原样保留。
    """
    cleaned = str(value or "").strip().rstrip("/")
    if not cleaned:
        return None
    try:
        parsed = urlsplit(cleaned)
    except ValueError:
        return None
    host = parsed.hostname or ""
    if parsed.scheme.lower() not in {"http", "https"} or not host:
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    if parsed.scheme.lower() == "http":
        reason = endpoint_class(host)
        if reason is None or reason == ADDRESS_INVALID:
            return None  # http 只对 loopback/私网等显式允许的地址放宽
    return cleaned


def validate_endpoint_url(value: str, *, allow_private: bool) -> str:
    """端点地址校验：标准路径复用 validated_base_url，显式私网时再放宽 http。"""
    try:
        return validated_base_url(value)
    except LLMError as exc:
        if allow_private:
            relaxed = _validated_private_url(value)
            if relaxed is not None:
                return relaxed
        raise EmbeddingError(str(exc)) from exc


class _HttpBatchProvider(HttpEmbeddingProvider):
    """批切片 + 重试 + 预算的公共编排；子类只提供请求构造与响应解析。

    刻意不调用父类 HttpEmbeddingProvider.__init__（它对非公网地址一律拒绝），改由
    _configure 统一实现：显式允许私有端点时放行，并只在日志里记 endpoint_class。
    """

    batch_size: int
    allow_private: bool

    def _configure(
        self,
        spec: EmbeddingModelSpec,
        endpoint_url: str,
        *,
        api_key: str,
        allow_private: bool,
        timeout: float | None,
        client: httpx.AsyncClient | None,
    ) -> None:
        cleaned = validate_endpoint_url(endpoint_url, allow_private=allow_private)
        host = httpx.URL(cleaned).host
        reason = endpoint_class(host)
        if reason is not None and reason != ADDRESS_INVALID:
            if not allow_private:
                raise EmbeddingError(
                    f"embedding 服务地址指向非公网地址（{reason}）："
                    "本机或内网服务需在设置里显式允许私有端点"
                )
            logger.info("embedding endpoint endpoint_class=%s host=%s", reason, _log_host(host))
        BaseEmbeddingProvider.__init__(self, spec)
        self.base_url = cleaned
        self.api_key = api_key
        self.timeout = float(timeout) if timeout is not None else 10.0
        self._client = client
        self.allow_private = allow_private

    # ---- 子类实现 ----
    def _request_parts(self, texts: list[str]) -> tuple[str, dict[str, str], str]:
        raise NotImplementedError

    def _parse_contents(self, content: bytes, *, expected: int) -> tuple[tuple[float, ...], ...]:
        raise NotImplementedError

    # ---- 公共编排 ----
    def _client_or_shared(self) -> httpx.AsyncClient:
        return self._client if self._client is not None else get_shared_client()

    async def aclose(self) -> None:
        """只关闭注入的客户端；共享连接池由进程级池管理（调用方勿关闭）。"""
        if self._client is not None:
            await self._client.aclose()

    async def _post(
        self, url: str, headers: Mapping[str, str], body: str, *, budget: OperationBudget | None
    ) -> tuple[httpx.Response, int]:
        host = httpx.URL(url.split("?", 1)[0]).host
        remaining_fn = (lambda: budget.remaining()) if budget is not None else None
        gate = retry.StatusRetryGate(deadline_remaining_fn=remaining_fn)
        client = self._client_or_shared()
        while True:
            timeout = self.timeout
            if budget is not None:
                if budget.remaining() <= 0:
                    raise EmbeddingError(f"embedding 调用预算已耗尽：{budget.expiry_reason()}")
                timeout = min(timeout, max(0.05, budget.remaining()))
            try:
                async with asyncio.timeout(timeout):
                    response = await client.post(
                        url, headers=dict(headers), content=body, timeout=timeout
                    )
            except (TimeoutError, httpx.TimeoutException) as exc:
                raise EmbeddingError("embedding 服务响应超时，请稍后重试") from exc
            except httpx.LocalProtocolError as exc:
                raise EmbeddingError(
                    "embedding 请求头不合法：请检查自定义 headers 的名称与取值"
                ) from exc
            except httpx.RequestError as exc:
                raise EmbeddingError("无法连接 embedding 服务，请检查 Base URL 与网络状态") from exc
            if response.status_code == 200:
                return response, gate.retries
            delay = gate.next_delay(response.status_code, response.headers.get("retry-after"))
            if delay is None:
                base = LLMError(_status_error(response.status_code, host))
                raise EmbeddingError(str(gate.final_error(response.status_code, base)))
            await retry.retry_sleep(delay)

    async def _embed_prefixed(
        self, texts: list[str], *, budget: OperationBudget | None = None
    ) -> EmbeddingBatch:
        size = max(1, int(self.batch_size))
        vectors: list[tuple[float, ...]] = []
        retries = 0
        for start in range(0, len(texts), size):
            chunk = texts[start : start + size]
            url, headers, body = self._request_parts(chunk)
            response, slice_retries = await self._post(url, headers, body, budget=budget)
            retries += slice_retries
            vectors.extend(self._parse_contents(response.content, expected=len(chunk)))
        return EmbeddingBatch(tuple(vectors), self.spec.model, self.spec.dim, 0, retries)

    async def probe_dim(
        self, text: str = "探测文本", *, budget: OperationBudget | None = None
    ) -> int:
        """自动探测维度：走底层 transport、不看 spec.dim（任务书 §4.2）。"""
        batch = await self._embed_prefixed([self.spec.doc_prefix + text], budget=budget)
        if not batch.vectors:
            raise EmbeddingError("embedding 探测没有返回向量")
        dim = len(batch.vectors[0])
        if dim <= 0 or any(len(vector) != dim for vector in batch.vectors):
            raise EmbeddingError("embedding 探测返回的向量维度不一致")
        return dim


class OpenAIHttpEmbeddingProvider(_HttpBatchProvider):
    """OpenAI 兼容 POST {base_url}/embeddings；body 只有 model + input。"""

    def __init__(
        self,
        spec: EmbeddingModelSpec,
        *,
        base_url: str,
        api_key: str = "",
        batch_size: int = DEFAULT_BATCH_SIZE,
        allow_private: bool = False,
        client: httpx.AsyncClient | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        if model is not None and model != spec.model:
            raise EmbeddingError("embedding 模型与能力声明不一致")
        self.batch_size = max(1, int(batch_size or DEFAULT_BATCH_SIZE))
        self._configure(
            spec,
            base_url,
            api_key=api_key,
            allow_private=allow_private,
            timeout=timeout,
            client=client,
        )
        self._endpoint_url = self.base_url.rstrip("/") + "/embeddings"

    def _request_parts(self, texts: list[str]) -> tuple[str, dict[str, str], str]:
        payload = {"model": self.spec.model, "input": list(texts)}
        headers = dict(_CONTENT_TYPE)
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return (
            self._endpoint_url,
            headers,
            json.dumps(payload, ensure_ascii=False),
        )

    def _parse_contents(self, content: bytes, *, expected: int) -> tuple[tuple[float, ...], ...]:
        if len(content) > MAX_RESPONSE_BYTES:
            raise EmbeddingError("embedding 响应体超过 16MB 上限")
        try:
            items = json.loads(content)["data"]
            if not isinstance(items, list) or len(items) != expected:
                raise ValueError("data/条数")
            vectors = tuple(tuple(float(value) for value in item["embedding"]) for item in items)
        except (ValueError, KeyError, TypeError) as exc:
            raise EmbeddingError("embedding 响应格式非法（缺 data/embedding 或条数不符）") from exc
        return vectors


class TemplateHttpEmbeddingProvider(_HttpBatchProvider):
    """按用户模板发请求：request_url + headers（{api_key}）+ body_template + response_path。"""

    def __init__(
        self,
        spec: EmbeddingModelSpec,
        *,
        config: object,
        allow_private: bool = False,
        client: httpx.AsyncClient | None = None,
        base_url: str | None = None,
        api_key: str = "",
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        del base_url  # 模板路径的地址来自 config.request_url
        if model is not None and model != spec.model:
            raise EmbeddingError("embedding 模型与能力声明不一致")
        request_url = str(getattr(config, "request_url", "") or "")
        if not request_url:
            raise EmbeddingError("自定义端点缺少 request_url")
        self.batch_size = max(
            1, int(getattr(config, "batch_size", DEFAULT_BATCH_SIZE) or DEFAULT_BATCH_SIZE)
        )
        self._headers = tuple(getattr(config, "headers", ()) or ())
        self._body_template = str(getattr(config, "body_template", "") or "")
        self._response_path = str(getattr(config, "response_path", "") or "data[*].embedding")
        try:
            validate_template(body_template=self._body_template, response_path=self._response_path)
            render_headers(self._headers, "")  # 校验 header 形状（换行/非 ASCII）
        except TemplateError as exc:
            raise EmbeddingError(str(exc)) from exc
        configured_key = str(getattr(config, "api_key", "") or "")
        self._configure(
            spec,
            request_url,
            api_key=configured_key or api_key,
            allow_private=allow_private,
            timeout=timeout,
            client=client,
        )
        self._endpoint_url = self.base_url

    def _request_parts(self, texts: list[str]) -> tuple[str, dict[str, str], str]:
        try:
            body = render_body(self._body_template, texts=texts, model=self.spec.model)
            headers = render_headers(self._headers, self.api_key)
        except TemplateError as exc:  # 渲染失败给可读错误，不回显模板/header
            raise EmbeddingError(str(exc)) from exc
        headers.setdefault("Content-Type", "application/json")
        return self._endpoint_url, headers, body

    def _parse_contents(self, content: bytes, *, expected: int) -> tuple[tuple[float, ...], ...]:
        if len(content) > MAX_RESPONSE_BYTES:
            raise EmbeddingError("embedding 响应体超过 16MB 上限")
        try:
            payload = json.loads(content)
        except ValueError as exc:
            raise EmbeddingError("embedding 响应不是合法 JSON") from exc
        try:
            return parse_response(payload, self._response_path, expected=expected)
        except TemplateError as exc:
            raise EmbeddingError(str(exc)) from exc


__all__ = [
    "DEFAULT_BATCH_SIZE",
    "OpenAIHttpEmbeddingProvider",
    "TemplateHttpEmbeddingProvider",
    "dimension_error_404",
    "validate_endpoint_url",
]
