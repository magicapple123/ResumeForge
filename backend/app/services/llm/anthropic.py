"""Anthropic Claude 的 Messages 原生协议实现。

为什么值得单独写一个 provider（而不是只用 Anthropic 的 OpenAI 兼容层）：

- system 在 Messages 协议里是**独立字段**，兼容层要被塞进 messages 里；
- 扩展思考（``thinking``）与思考预算只在原生协议下暴露；
- 工具调用是 ``tool_use`` / ``tool_result`` 内容块，和 OpenAI 的
  ``tool_calls`` 不是同一种结构，转换放在这里比塞进兼容层更清楚。

协议要点（按 2026-09 的官方文档口径）：
- 端点 ``POST {base_url}/messages``，鉴权头 ``x-api-key``，另有
  ``anthropic-version: 2023-06-01``；部分第三方网关只认 ``Authorization: Bearer``，
  所以两个头都发（官方会忽略多余的那个）。
- ``max_tokens`` 必填。用户选了「不限制」时用一个足够大的默认值，而不是省略。
- 开启扩展思考时 ``temperature`` 必须为 1，且预算要小于 ``max_tokens``。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ...schemas.setting import LLMConfig
from . import retry
from .anthropic_messages import (
    ANTHROPIC_VERSION as ANTHROPIC_VERSION,
)
from .anthropic_messages import (
    _convert_messages as _convert_messages,
)
from .anthropic_messages import (
    _convert_tools as _convert_tools,
)
from .anthropic_messages import (
    _has_tool_history as _has_tool_history,
)
from .base import BaseLLMProvider, LLMDelta, LLMError, build_request_timeout
from .openai_compat import http_error_message, validated_base_url
from .thinking import DEFAULT_EFFORT, EFFORT_BUDGETS, thinking_budget
from .usage import FINISH_CANCELLED, FINISH_ERROR, FINISH_STOP

logger = logging.getLogger(__name__)

# 「不限制输出」时使用的兜底上限：Messages 协议必须给这个字段。
_FALLBACK_MAX_TOKENS = 8192

_MAX_CHAT_RESPONSE_BYTES = 2 * 1024 * 1024
_MIN_STREAM_CHARS = 64_000
_MAX_STREAM_CHARS = 2_000_000

# Messages 协议的 stop_reason → OpenAI 侧归一口径（RF-14 §2.2-4）；未收录的原样透传。
_STOP_REASON_MAP = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


def _normalize_stop_reason(stop_reason: str | None) -> str | None:
    if not stop_reason:
        return None
    return _STOP_REASON_MAP.get(stop_reason, stop_reason)

# 思考强度 → 思考预算（tokens）的映射只有一份，在 `thinking.py`：设置页的「思考模式」
# 与助手页的「思考强度」在原生协议下走的是同一张表。

class AnthropicProvider(BaseLLMProvider):
    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        request_overrides: dict | None = None,
    ):
        super().__init__(config, request_overrides=request_overrides)
        self._transport = transport
        # 流式 usage/stop_reason 捕获（见 stream_chat_events 的说明）。
        self._stream_prompt_tokens: int | None = None
        self._stream_completion_tokens: int | None = None
        self._stream_stop_reason: str | None = None

    # ===== 公共入口 =====

    async def chat(self, messages: list[dict]) -> str:
        """同步发一次 Anthropic 消息请求，返回完整文本；超时/连接/解析错误统一转成 LLMError。

        429/5xx 在状态码阶段按 §2.4 重试（与 OpenAI 兼容层同一份 ``retry`` 策略）；
        用量经 ``last_usage`` 暴露：返回前写入，异常路径也要有记录（finish_reason=error）。
        """
        payload = self._build_payload(messages, stream=False)
        started = time.monotonic()
        gate = retry.StatusRetryGate(deadline_remaining=self._deadline_remaining())
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        finish_reason = FINISH_ERROR
        try:
            while True:
                try:
                    async with self._client() as client, client.stream(
                        "POST", self._endpoint(), json=payload, headers=self._headers()
                    ) as response:
                        if response.status_code != 200:
                            # 429/5xx 只发生在 body 之前（安全点规则：首个 delta 之前）；重试编排（计数/退避/终态文案）在 retry.StatusRetryGate。
                            delay = gate.next_delay(
                                response.status_code, response.headers.get("retry-after")
                            )
                            if delay is None:
                                raise gate.final_error(
                                    response.status_code, self._http_error(response, messages)
                                )
                            logger.warning(
                                "Anthropic 调用遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
                                response.status_code,
                                delay,
                                gate.retries,
                            )
                            await retry.retry_sleep(delay)
                            continue
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(body) + len(chunk) > _MAX_CHAT_RESPONSE_BYTES:
                                raise LLMError("模型返回内容过大，请调低最大输出长度")
                            body.extend(chunk)
                except httpx.TimeoutException as exc:
                    raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
                except httpx.RequestError as exc:
                    raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc
                try:
                    data = json.loads(body)
                except (ValueError, UnicodeError) as exc:
                    raise LLMError("模型返回了无法解析的响应格式") from exc
                usage = data.get("usage") if isinstance(data, dict) else None
                if isinstance(usage, dict):
                    input_tokens = usage.get("input_tokens")
                    output_tokens = usage.get("output_tokens")
                    prompt_tokens = (
                        input_tokens
                        if isinstance(input_tokens, int) and not isinstance(input_tokens, bool)
                        else None
                    )
                    completion_tokens = (
                        output_tokens
                        if isinstance(output_tokens, int) and not isinstance(output_tokens, bool)
                        else None
                    )
                stop_reason = data.get("stop_reason") if isinstance(data, dict) else None
                finish_reason = _normalize_stop_reason(
                    str(stop_reason) if stop_reason else None
                ) or FINISH_STOP
                return self._extract_text(data)
        except asyncio.CancelledError:
            finish_reason = FINISH_CANCELLED
            raise
        except Exception:
            finish_reason = FINISH_ERROR
            raise
        finally:
            self._record_usage(
                started=started,
                finish_reason=finish_reason,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                retries=gate.retries,
            )

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text

    async def stream_chat_events(
        self, messages: list[dict], tools: list[dict] | None = None
    ) -> AsyncIterator[LLMDelta]:
        """流式发消息请求，逐块产出 LLMDelta（支持工具调用）。

        重试治理（RF-14 §2.4）：429/5xx 只在**状态码阶段**（任何 delta 产出之前）按
        ``retry`` 的策略重试；流中途的错误一律不重试（安全点规则）。``message_start`` /
        ``message_delta`` 自带的 usage 与 stop_reason 被捕获进 ``last_usage``，缺失不臆造。
        """
        payload = self._build_payload(messages, stream=True, tools=tools)
        started = time.monotonic()
        gate = retry.StatusRetryGate(deadline_remaining=self._deadline_remaining())
        finish_reason = FINISH_ERROR
        try:
            while True:
                self._stream_prompt_tokens = None
                self._stream_completion_tokens = None
                self._stream_stop_reason = None
                try:
                    async with self._client() as client, client.stream(
                        "POST", self._endpoint(), json=payload, headers=self._headers()
                    ) as response:
                        if response.status_code != 200:
                            # 状态码阶段（尚未产出任何 delta）：交给重试循环处理；编排在 retry.StatusRetryGate。
                            delay = gate.next_delay(
                                response.status_code, response.headers.get("retry-after")
                            )
                            if delay is None:
                                raise gate.final_error(
                                    response.status_code, self._http_error(response, messages)
                                )
                            logger.warning(
                                "Anthropic 流式请求遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
                                response.status_code,
                                delay,
                                gate.retries,
                            )
                            await retry.retry_sleep(delay)
                            continue
                        async for delta in self._iter_sse(response):
                            yield delta
                        finish_reason = _normalize_stop_reason(self._stream_stop_reason) or FINISH_STOP
                        return
                except httpx.TimeoutException as exc:
                    # 流中途（已可能产出 delta）不重试：安全点规则（§2.4-2），只做文案转换。
                    raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
                except httpx.RequestError as exc:
                    raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc
        except (asyncio.CancelledError, GeneratorExit):
            finish_reason = FINISH_CANCELLED
            raise
        except Exception:
            finish_reason = FINISH_ERROR
            raise
        finally:
            self._record_usage(
                started=started,
                finish_reason=finish_reason,
                prompt_tokens=self._stream_prompt_tokens,
                completion_tokens=self._stream_completion_tokens,
                retries=gate.retries,
            )

    # ===== 内部实现 =====

    async def _iter_sse(self, response: httpx.Response) -> AsyncIterator[LLMDelta]:
        """解析 Messages 协议的 SSE 事件流。

        文本来自 ``text_delta``；思考内容来自 ``thinking_delta``；工具调用由
        ``content_block_start``（拿到 id 与 name）与 ``input_json_delta``（分片 JSON
        拼接）组成，在块结束时产出。
        """
        total_chars = 0
        pending: dict[int, dict[str, Any]] = {}
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if not chunk:
                continue
            try:
                event = json.loads(chunk)
            except json.JSONDecodeError as exc:
                raise LLMError("模型返回了无法解析的流式响应") from exc
            if not isinstance(event, dict):
                raise LLMError("模型返回了无法解析的流式响应")
            event_type = event.get("type")

            if event_type == "message_start":
                # usage 遥测（RF-14 §2.2-3）：message_start 自带 input_tokens。缺失不臆造。
                message = event.get("message")
                usage = message.get("usage") if isinstance(message, dict) else None
                if isinstance(usage, dict):
                    input_tokens = usage.get("input_tokens")
                    if isinstance(input_tokens, int) and not isinstance(input_tokens, bool):
                        self._stream_prompt_tokens = input_tokens
                continue

            if event_type == "message_delta":
                # message_delta 自带 output_tokens 与 stop_reason（流收尾时到达）。
                usage = event.get("usage")
                if isinstance(usage, dict):
                    output_tokens = usage.get("output_tokens")
                    if isinstance(output_tokens, int) and not isinstance(output_tokens, bool):
                        self._stream_completion_tokens = output_tokens
                delta_info = event.get("delta")
                if isinstance(delta_info, dict) and delta_info.get("stop_reason"):
                    self._stream_stop_reason = str(delta_info["stop_reason"])
                continue

            if event_type == "error":
                detail = event.get("error") or {}
                message = detail.get("message") if isinstance(detail, dict) else ""
                raise LLMError(f"模型返回错误：{message or '未知错误'}")

            if event_type == "content_block_start":
                block = event.get("content_block") or {}
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    index = int(event.get("index") or 0)
                    pending[index] = {
                        "id": str(block.get("id") or ""),
                        "type": "function",
                        "function": {
                            "name": str(block.get("name") or ""),
                            "arguments": "",
                        },
                    }
                continue

            if event_type == "content_block_delta":
                delta = event.get("delta") or {}
                if not isinstance(delta, dict):
                    continue
                delta_type = delta.get("type")
                if delta_type == "text_delta":
                    text = delta.get("text")
                    if isinstance(text, str) and text:
                        total_chars += len(text)
                        if total_chars > self._stream_char_limit():
                            raise LLMError("模型流式输出过大，请调低最大输出长度")
                        yield LLMDelta(text=text)
                elif delta_type == "thinking_delta":
                    # extended thinking 的思考内容：字段名固定是 ``thinking``。
                    # 与正文分开产出，同样计入 total_chars（它是真实输出，且不设限时
                    # 一条只会思考的流会无界增长）。
                    thinking = delta.get("thinking")
                    if isinstance(thinking, str) and thinking:
                        total_chars += len(thinking)
                        if total_chars > self._stream_char_limit():
                            raise LLMError("模型流式输出过大，请调低最大输出长度")
                        yield LLMDelta(reasoning=thinking)
                elif delta_type == "signature_delta":
                    # 每个 thinking 块尾部会跟一个 ``signature_delta``，它是**加密签名**，
                    # 不是给人看的内容。它唯一的作用是原样回传给下一轮（见 ``_convert_messages``
                    # 顶部关于 extended thinking 多轮工具的说明）。我们当前不回传
                    # thinking 块，所以这里**刻意不采集**签名——采集了也没处用，反而会
                    # 在 context 里留一段无法解释的密文。显式写出来，避免以后有人以为漏了。
                    continue
                elif delta_type == "input_json_delta":
                    index = int(event.get("index") or 0)
                    slot = pending.get(index)
                    if slot is not None:
                        slot["function"]["arguments"] += str(delta.get("partial_json") or "")
                continue

            if event_type == "content_block_stop":
                index = int(event.get("index") or 0)
                slot = pending.pop(index, None)
                if slot is not None:
                    yield LLMDelta(tool_calls=[slot])
                continue

        # 兜底：少数网关不发 content_block_stop。
        if pending:
            yield LLMDelta(tool_calls=[pending[index] for index in sorted(pending)])

    def _endpoint(self) -> str:
        base = validated_base_url(self.config.base_url)
        if base.endswith("/messages"):
            return base
        return f"{base}/messages"

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
        }
        if self.config.api_key:
            headers["x-api-key"] = self.config.api_key
            # 第三方网关多数只认 Bearer；官方会忽略它。
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self._timeout(), transport=self._transport)

    def _timeout(self) -> httpx.Timeout:
        # 与 openai_compat._timeout 同一契约（RF-14 §2.1.c）：分项 read 的"下限保护 +
        # 预算上限压缩"两家同构，实现下沉到 base.build_request_timeout。
        return build_request_timeout(self.config, self.request_deadline_seconds)

    def _stream_char_limit(self) -> int:
        if self.config.uses_unlimited_output:
            return _MAX_STREAM_CHARS
        return min(_MAX_STREAM_CHARS, max(_MIN_STREAM_CHARS, self.config.max_tokens * 8))

    def _max_tokens(self) -> int:
        """Messages 协议必须给 max_tokens；「不限制」时用一个较大的兜底值。

        注意这不是"真的无限"——协议没有"省略即不限"的写法，只能给一个足够大的数。
        """
        if self.config.uses_unlimited_output:
            return _FALLBACK_MAX_TOKENS
        return self.config.max_tokens

    def _thinking_budget(self) -> int:
        """本次请求的思考预算。

        优先级：请求级「思考强度」（助手页）> 配置里显式填的「思考预算」> 设置页的
        「思考模式」开关（按档位换算）> 不发。中间那层是**老字段**，显式填过就以它为准——
        加新开关不能改写老用户的既有行为。

        **自定义档位**（用户自己填的词）在这里有两种归宿：填的是数字就当思考预算
        （原生协议要的正是 tokens 数），填的是别的词（如 `xhigh`）则按默认档处理——
        静默变成"不思考"是最坏的结果，宁可给一个默认深度。
        """
        effort = str(self.request_overrides.get("reasoning_effort") or "").strip()
        if effort:
            if effort == "none":
                return 0
            budget = EFFORT_BUDGETS.get(effort)
            if budget:
                return budget
            if effort.isdigit():
                return int(effort)
            return EFFORT_BUDGETS[DEFAULT_EFFORT]
        configured = getattr(self.config, "thinking_budget", None)
        if configured is not None:
            return int(configured)
        return thinking_budget(self.config)

    def _build_payload(
        self, messages: list[dict], stream: bool, tools: list[dict] | None = None
    ) -> dict[str, Any]:
        system_text, converted = _convert_messages(messages)
        max_tokens = self._max_tokens()
        payload: dict[str, Any] = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "messages": converted,
            "stream": stream,
        }
        if system_text:
            payload["system"] = system_text[:60_000]

        budget = self._thinking_budget()
        if budget > 0:
            # 协议要求：开启思考时 temperature 必须为 1，预算要小于 max_tokens。
            payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
            if max_tokens <= budget:
                payload["max_tokens"] = budget + 4_096
            payload["temperature"] = 1.0
        else:
            payload["temperature"] = self.config.temperature
            if str(self.request_overrides.get("reasoning_effort") or "") == "none":
                payload["thinking"] = {"type": "disabled"}

        if self.config.top_p is not None:
            payload["top_p"] = self.config.top_p
        if self.config.top_k is not None:
            payload["top_k"] = self.config.top_k
        if self.config.stop:
            payload["stop_sequences"] = list(self.config.stop)
        # 「额外请求体」在原生协议下同样有效（用户自己知道目标服务支持什么）。
        extra = getattr(self.config, "extra_body", None)
        if isinstance(extra, dict):
            for key, value in extra.items():
                payload.setdefault(key, value)

        tool_payload = _convert_tools(tools)
        if tool_payload:
            payload["tools"] = tool_payload
        return payload

    @staticmethod
    def _extract_text(data: dict) -> str:
        if not isinstance(data, dict):
            raise LLMError("模型返回了无法解析的响应格式")
        blocks = data.get("content")
        if not isinstance(blocks, list):
            raise LLMError("模型返回了无法解析的响应格式")
        parts = [
            str(block.get("text", ""))
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "".join(parts)

    def _http_error(
        self, response: httpx.Response, messages: list[dict] | None = None
    ) -> LLMError:
        status = response.status_code
        logger.warning("Anthropic 调用失败 status=%s", status)
        if status == 400:
            # 原生协议的 400 有两类，先区分再给提示。**开了思考又在多轮工具调用中**时，
            # 400 几乎必然是"上一轮的 thinking 块没原样回传"（官方对 extended thinking 的
            # 硬要求，本实现尚未支持，见 ``_convert_messages``）。此时若回通用文案
            # （"检查模型名 / max_tokens / 预算"），会把用户支去改一堆无关参数、白忙一场，
            # 所以这里指向真正的原因与出路。**只在这一组合下改文案，其它 400 仍走通用提示。**
            if self._thinking_budget() > 0 and _has_tool_history(messages):
                return LLMError(
                    "请求格式错误：本轮是「原生 Anthropic 接口 + 思考强度 + 工具调用」的组合，"
                    "官方要求把上一轮的思考块原样回传，当前版本尚未支持（HTTP 400）。"
                    "请把「思考强度」调回「关闭」，或改用 OpenAI 兼容协议的服务商后重试。"
                )
            # 其它情况最常见的 400 是模型名或参数问题，保留更通用的提示。
            return LLMError(
                "请求格式错误：请检查模型名称、max_tokens 与思考预算设置（HTTP 400）"
            )
        return LLMError(f"{http_error_message(status)}（HTTP {status}）")

__all__ = ["AnthropicProvider"]
