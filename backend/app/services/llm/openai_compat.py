"""OpenAI Chat Completions 兼容协议实现。

覆盖 DeepSeek、豆包（火山方舟）、Kimi、智谱、OpenAI、Ollama 等
绝大多数大模型服务；直接用 httpx 实现，保持依赖精简与协议透明。
"""
import json
import logging
from collections.abc import AsyncIterator

import httpx

from .base import BaseLLMProvider, LLMError

logger = logging.getLogger(__name__)

# HTTP 状态码 -> 面向用户的中文提示
_STATUS_MESSAGES = {
    400: "请求格式错误，请检查模型名称与参数设置",
    401: "API Key 无效或已过期，请到「设置」页检查",
    403: "无权限访问该模型，请检查账号权限",
    404: "模型不存在或接口地址错误，请检查 Base URL 与模型名称",
    429: "请求过于频繁或额度不足，请稍后重试",
    500: "模型服务内部错误，请稍后重试",
    502: "模型服务暂不可用，请稍后重试",
    503: "模型服务过载，请稍后重试",
}

_CONNECT_TIMEOUT = 10.0  # 建连超时（秒），与业务超时分开配置


class OpenAICompatProvider(BaseLLMProvider):
    async def chat(self, messages: list[dict]) -> str:
        payload = self._build_payload(messages, stream=False)
        try:
            async with httpx.AsyncClient(timeout=self._timeout()) as client:
                response = await client.post(self._endpoint(), json=payload, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
        except httpx.RequestError as exc:
            raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc
        if response.status_code != 200:
            raise self._http_error(response)
        return self._extract_content(response.json())

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        payload = self._build_payload(messages, stream=True)
        try:
            async with httpx.AsyncClient(timeout=self._timeout()) as client:
                async with client.stream(
                    "POST", self._endpoint(), json=payload, headers=self._headers()
                ) as response:
                    if response.status_code != 200:
                        raise self._http_error(response)
                    async for line in response.aiter_lines():
                        # SSE 格式：每行 "data: {json}"，流结束标志 "data: [DONE]"
                        if not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if chunk == "[DONE]":
                            break
                        try:
                            data = json.loads(chunk)
                        except json.JSONDecodeError:
                            continue  # 忽略无法解析的心跳/脏数据行
                        choices = data.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content")
                            if text:
                                yield text
        except httpx.TimeoutException as exc:
            raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
        except httpx.RequestError as exc:
            raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc

    # ===== 内部工具 =====

    def _endpoint(self) -> str:
        """规范化接口地址：兼容用户填 Base URL 或完整接口地址两种情况。"""
        base = self.config.base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}

    def _timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            connect=_CONNECT_TIMEOUT,
            read=self.config.timeout_seconds,
            write=30.0,
            pool=10.0,
        )

    def _build_payload(self, messages: list[dict], stream: bool) -> dict:
        return {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": stream,
        }

    @staticmethod
    def _extract_content(data: dict) -> str:
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("模型返回了无法解析的响应格式") from exc

    @staticmethod
    def _http_error(response: httpx.Response) -> LLMError:
        status = response.status_code
        message = _STATUS_MESSAGES.get(status, "模型调用失败")
        # 带出服务端错误详情，便于用户与提供商排查（截断防止刷屏）
        try:
            detail = response.text.strip()[:200]
        except Exception:  # noqa: BLE001 - 读取响应体失败不应影响报错
            detail = ""
        logger.warning("LLM 调用失败 status=%s detail=%s", status, detail)
        return LLMError(f"{message}（HTTP {status}）")
