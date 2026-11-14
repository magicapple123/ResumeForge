# SPDX-License-Identifier: Apache-2.0
"""OpenAI 兼容 provider 的传输层：端点 / 请求头 / 超时 / 共享连接池。

为什么单独一层：OpenAI、DeepSeek、自建网关的差别只在 base_url 与 key，"怎么连、超时怎么
算、连接池怎么复用"必须完全一致，否则同一次批量分析会在不同 provider 上表现出不同的
超时行为。

``_endpoint`` 容忍 base_url 里已经写了 ``/chat/completions``：历史配置两种写法都有，
不加判断会拼成 ``.../chat/completions/chat/completions``。
"""

import httpx

from .base import BaseLLMProvider, build_request_timeout
from .client_pool import get_shared_client
from .payload import validated_base_url


class OpenAITransport(BaseLLMProvider):
    _transport: httpx.AsyncBaseTransport | None = None

    def _endpoint(self) -> str:
        # 两种历史写法都要认：base_url 可能已经带 /chat/completions。
        base = self._validated_base_url()
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"

    def _validated_base_url(self) -> str:
        return validated_base_url(self.config.base_url)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _client(self) -> httpx.AsyncClient:
        return get_shared_client(transport=self._transport)

    def _timeout(self) -> httpx.Timeout:
        return build_request_timeout(self.config, self._deadline_remaining())
