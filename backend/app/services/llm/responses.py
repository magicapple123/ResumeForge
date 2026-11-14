# SPDX-License-Identifier: Apache-2.0
"""OpenAI Responses 协议的 provider（第三个 api_style；默认仍是 Chat Completions）。

协议差异（任务书 §4 T09 的表）：

- 端点 POST {base_url}/responses，请求体用 input items（转换见 responses_messages）；
- 工具定义扁平；思考走 reasoning.effort；输出上限字段叫 max_output_tokens；
- 流式是语义事件、以 response.completed 结束（解析见 responses_stream），**没有 [DONE]**；
- 用量是 input_tokens / output_tokens / input_tokens_details.cached_tokens，
  映射到既有的 prompt / completion / cache_hit 记账结构（reasoning_tokens 已含在
  output_tokens 里，现有账本没有独立列，不单列）。

**不发送** store / previous_response_id / background / parallel_tool_calls：
多数厂商没有这些能力，发了会被 400 或静默忽略（任务书 §4 T09 的硬规则）。
结构化输出槽位 text.format 本批不发送：项目现状没有任何调用发送 response_format
（见 capabilities.structured_output 的现状口径），不在这里提前引入第二套语义。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator

import httpx

from ...runtime.operation_budget import OperationCancelled
from ...schemas.setting import LLMConfig
from . import retry
from .base import (
    BaseLLMProvider,
    LLMDelta,
    LLMError,
    build_request_timeout,
    log_llm_failure,
)
from .client_pool import get_shared_client
from .context_length_error import with_context_length_flag
from .openai_compat import validated_base_url
from .payload import status_error
from .responses_messages import convert_messages, convert_tools
from .responses_stream import ResponsesStreamParser, clean_token
from .thinking import (
    DEFAULT_EFFORT,
    PROTOCOL_RESPONSES,
    disable_thinking_payload,
    host_of,
    normalize_effort,
    responses_off_effort,
)
from .usage import FINISH_CANCELLED, FINISH_ERROR, FINISH_LENGTH, FINISH_STOP

logger = logging.getLogger(__name__)

_MAX_CHAT_RESPONSE_BYTES = 2 * 1024 * 1024
_MIN_STREAM_CHARS = 64_000
_MAX_STREAM_CHARS = 2_000_000

# 已知**没有** Responses 能力的服务商：连接测试直接给可操作提示，而不是抛裸 404。
# 列表来自任务书 §4 T09/T09.1 的探测结论（Claude / Gemini / 硅基流动：官方文档未提供
# Responses 端点，硅基流动实测 404）。
# **MiniMax 于 2026-11-08 从名单移除**：官方已支持 ``POST /v1/responses``，这条是硬拦截
# （``api/settings.py`` 命中即直接返回失败、根本不发请求），留在表里等于用户永远测不通。
# 其余服务商不预判，一律以真实响应为准。
_UNSUPPORTED_RESPONSES_HOSTS: tuple[tuple[str, str], ...] = (
    ("api.anthropic.com", "Claude"),
    ("generativelanguage.googleapis.com", "Gemini"),
    ("api.siliconflow.cn", "硅基流动"),
)


def responses_unsupported_hint(base_url: str) -> str | None:
    """该地址是否是已知不支持 Responses 的服务商；是则返回给用户的可操作提示。"""
    host = host_of(base_url)
    for unsupported_host, name in _UNSUPPORTED_RESPONSES_HOSTS:
        if host == unsupported_host:
            return f"该服务商（{name}）可能不支持 Responses 协议，请切回 Chat Completions 后重试"
    return None


class ResponsesProvider(BaseLLMProvider):
    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        request_overrides: dict | None = None,
    ):
        super().__init__(config, request_overrides=request_overrides)
        self._transport = transport
        # 流式 usage/终态捕获：每次传输尝试开始时重置（见 stream_chat_events）。
        self._stream_prompt_tokens: int | None = None
        self._stream_completion_tokens: int | None = None
        self._stream_cache_hit_tokens: int | None = None
        self._stream_stop_reason: str | None = None

    # ===== 公共入口 =====

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        """一次性对话：input items 一次发完，返回完整正文。"""
        payload = self._build_payload(messages, stream=False, thinking=thinking)
        return await self._run_chat(payload)

    async def probe_chat(self) -> str:
        """「测试连接」专用最小请求：input 直接用字符串 "hi" + max_output_tokens=16。

        与 chat 走同一条传输/重试/用量路径，只是请求体最小化（任务书 §4 T09-7）。
        """
        return await self._run_chat(
            {
                "model": self.config.model,
                "input": "hi",
                "max_output_tokens": 16,
                "stream": False,
            }
        )

    async def stream_chat(self, messages: list[dict]) -> AsyncGenerator[str, None]:
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text

    async def stream_chat_events(
        self, messages: list[dict], tools: list[dict] | None = None
    ) -> AsyncGenerator[LLMDelta, None]:
        """流式对话：逐行喂给 ResponsesStreamParser，按语义事件产出 delta。

        429/5xx 只在状态码阶段（任何 delta 产出之前）重试；流中途的错误不重试
        （安全点规则，与两家既有 provider 同一口径）。终态看 response.completed /
        response.incomplete / response.failed，**不等 [DONE]**。
        """
        payload = self._build_payload(messages, stream=True, tools=tools)
        started = time.monotonic()
        gate = retry.StatusRetryGate(deadline_remaining_fn=self._deadline_remaining)
        finish_reason = FINISH_ERROR
        try:
            while True:
                self._stream_prompt_tokens = None
                self._stream_completion_tokens = None
                self._stream_cache_hit_tokens = None
                self._stream_stop_reason = None
                parser = ResponsesStreamParser()
                try:
                    async with self._attempt_deadline():
                        client = self._client()
                        async with client.stream(
                            "POST",
                            self._endpoint(),
                            json=payload,
                            headers=self._headers(),
                            timeout=self._timeout(),
                        ) as response:
                            if response.status_code != 200:
                                delay = gate.next_delay(
                                    response.status_code, response.headers.get("retry-after")
                                )
                                if delay is None:
                                    raise await with_context_length_flag(
                                        response,
                                        gate.final_error(
                                            response.status_code, self._http_error(response)
                                        ),
                                    )
                                logger.warning(
                                    "Responses 流式请求遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
                                    response.status_code,
                                    delay,
                                    gate.retries,
                                )
                                await retry.retry_sleep(delay)
                                continue
                            total_chars = 0
                            async for line in response.aiter_lines():
                                # yield 在 async with 内部：消费方中途 aclose 时由外层
                                # 生成器的 finally 兜底记录用量（与两家 provider 同构）。
                                for delta in parser.feed(line):
                                    total_chars += len(delta.text) + len(delta.reasoning)
                                    if total_chars > self._stream_char_limit():
                                        raise LLMError("模型流式输出过大，请调低最大输出长度")
                                    yield delta
                                if parser.finished:
                                    break
                    self._stream_prompt_tokens = parser.prompt_tokens
                    self._stream_completion_tokens = parser.completion_tokens
                    self._stream_cache_hit_tokens = parser.cache_hit_tokens
                    self._stream_stop_reason = parser.finish_reason
                    # 语义事件正常收尾；个别网关提前断流时按 stop 归一（与既有宽容口径一致）。
                    finish_reason = parser.finish_reason or FINISH_STOP
                    return
                except TimeoutError as exc:
                    log_llm_failure("timeout", "整请求预算到期（硬 deadline）")
                    raise self._translate_deadline_expiry(exc) from exc
                except httpx.TimeoutException as exc:
                    log_llm_failure("timeout", type(exc).__name__)
                    raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
                except httpx.RequestError as exc:
                    log_llm_failure("disconnect", type(exc).__name__)
                    raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc
        except OperationCancelled:
            finish_reason = self._cancelled_finish_reason()
            raise
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
                cache_hit_tokens=self._stream_cache_hit_tokens,
            )

    # ===== 非流式请求（chat / probe 共用一条路径） =====

    async def _run_chat(self, payload: dict) -> str:
        started = time.monotonic()
        gate = retry.StatusRetryGate(deadline_remaining_fn=self._deadline_remaining)
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        cache_hit_tokens: int | None = None
        finish_reason = FINISH_ERROR
        try:
            while True:
                try:
                    async with self._attempt_deadline():
                        client = self._client()
                        async with client.stream(
                            "POST",
                            self._endpoint(),
                            json=payload,
                            headers=self._headers(),
                            timeout=self._timeout(),
                        ) as response:
                            if response.status_code != 200:
                                delay = gate.next_delay(
                                    response.status_code, response.headers.get("retry-after")
                                )
                                if delay is None:
                                    raise await with_context_length_flag(
                                        response,
                                        gate.final_error(
                                            response.status_code, self._http_error(response)
                                        ),
                                    )
                                logger.warning(
                                    "Responses 调用遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
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
                except TimeoutError as exc:
                    log_llm_failure("timeout", "整请求预算到期（硬 deadline）")
                    raise self._translate_deadline_expiry(exc) from exc
                except httpx.TimeoutException as exc:
                    log_llm_failure("timeout", type(exc).__name__)
                    raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
                except httpx.RequestError as exc:
                    log_llm_failure("disconnect", type(exc).__name__)
                    raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc
                try:
                    data = json.loads(body)
                except (ValueError, UnicodeError) as exc:
                    log_llm_failure("protocol", "非流式响应 JSON 解析失败")
                    raise LLMError("模型返回了无法解析的响应格式") from exc
                if not isinstance(data, dict):
                    raise LLMError("模型返回了无法解析的响应格式")
                if data.get("status") == "failed":
                    self._raise_failed_response(data)
                usage = data.get("usage")
                if isinstance(usage, dict):
                    prompt_tokens = clean_token(usage.get("input_tokens"))
                    completion_tokens = clean_token(usage.get("output_tokens"))
                    input_details = usage.get("input_tokens_details")
                    if isinstance(input_details, dict):
                        cache_hit_tokens = clean_token(input_details.get("cached_tokens"))
                # 协议里 status=incomplete 表示输出被上限截断；其余按正常完成。
                finish_reason = FINISH_LENGTH if data.get("status") == "incomplete" else FINISH_STOP
                return self._extract_text(data)
        except OperationCancelled:
            finish_reason = self._cancelled_finish_reason()
            raise
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
                cache_hit_tokens=cache_hit_tokens,
            )

    # ===== 内部实现 =====

    def _build_payload(
        self,
        messages: list[dict],
        stream: bool,
        tools: list[dict] | None = None,
        *,
        thinking: bool = True,
    ) -> dict:
        """构造 Responses 请求体。只发任务书 §4 T09 列出的字段，外加用户显式写的 extra_body。"""
        payload: dict = {
            "model": self.config.model,
            "input": convert_messages(messages),
            "temperature": self.config.temperature,
            "stream": stream,
        }
        if not self.config.uses_unlimited_output:
            payload["max_output_tokens"] = self.config.max_tokens
        if self.config.top_p is not None:
            payload["top_p"] = self.config.top_p
        effort = self._thinking_effort(thinking=thinking)
        if effort != "":
            # **只有空串才不发**："none" 是有效取值，不是"没有"——它在 Responses 上就是
            # 关闭思考的唯一写法（清单 §10.3 实测 reasoning_tokens=0）。
            payload["reasoning"] = {"effort": effort}
        else:
            # effort 形态表达不了关闭时（豆包 Responses 的关闭写法是 thinking:{type:disabled}）
            # 合并完整片段；没有关闭入口 / 型号不可关闭时这里是空 dict，一个字都不发。
            #
            # reasoning.effort 形态**由 _thinking_effort 独占负责**，这里不再兜第二遍：
            # 兜了就等于把"none 被吞成空串"这个 bug 重新藏起来（反证会失效）。
            disable_payload = disable_thinking_payload(self.config, PROTOCOL_RESPONSES)
            disable_payload.pop("reasoning", None)
            payload.update(disable_payload)
        tool_payload = convert_tools(tools)
        if tool_payload:
            payload["tools"] = tool_payload
            payload["tool_choice"] = "auto"
        # 额外请求体：长尾参数出口（保留键已由 schema 校验层拦掉，这里原样合并）。
        extra = getattr(self.config, "extra_body", None)
        if isinstance(extra, dict):
            for key, value in extra.items():
                payload.setdefault(key, value)
        return payload

    def _thinking_effort(self, *, thinking: bool = True) -> str:
        """本次请求的 reasoning.effort；空串 = 不发 effort（关闭形态可能不是 effort）。

        优先级：请求级「思考强度」（助手页）> 设置页「思考模式」开关与档位。
        形态固定是 reasoning.effort——Responses 只认这一种写法；旧的 thinking_style
        字段对这条链路不生效（由 schema 注释与设置页说明体现实情）。

        **"none" 必须原样返回**：Responses 上关闭思考的唯一写法就是
        ``reasoning: {"effort": "none"}``——省略等于沿用服务商默认，DeepSeek / 智谱这类
        「不指定就思考」的厂商就等于没关。旧实现把 none 映射成空串，恰好把唯一关闭手段
        吞掉（清单 §10.3：A 行不发=437 输出/409 思考，C 行 none=29 输出/0 思考）。

        结构化输出类调用（``thinking=False``）同样要显式关：对默认思考的厂商，
        "不注入"和"关掉"不是一回事（第 10 条 P1：格式修复轮白花 64s 的教训）。
        """
        if not thinking:
            return responses_off_effort(self.config)
        effort = str(self.request_overrides.get("reasoning_effort") or "").strip()
        if effort:
            # 助手侧选「不思考」= 发 none；其余档位原样透传（自定义档位不做白名单过滤）。
            return "none" if effort.casefold() == "none" else effort
        if not getattr(self.config, "thinking_enabled", False):
            return responses_off_effort(self.config)
        return normalize_effort(self.config) or DEFAULT_EFFORT

    def _endpoint(self) -> str:
        base = validated_base_url(self.config.base_url)
        if base.endswith("/responses"):
            return base
        return f"{base}/responses"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _client(self) -> httpx.AsyncClient:
        # 与两家 provider 共享同一份连接池；超时按请求传入。
        return get_shared_client(transport=self._transport)

    def _timeout(self) -> httpx.Timeout:
        return build_request_timeout(self.config, self._deadline_remaining())

    def _stream_char_limit(self) -> int:
        if self.config.uses_unlimited_output:
            return _MAX_STREAM_CHARS
        return min(_MAX_STREAM_CHARS, max(_MIN_STREAM_CHARS, self.config.max_tokens * 8))

    @staticmethod
    def _extract_text(data: dict) -> str:
        """从 output 列表里取正文（type=message 的 output_text 内容块）。"""
        if not isinstance(data, dict):
            raise LLMError("模型返回了无法解析的响应格式")
        parts: list[str] = []
        output = data.get("output")
        if isinstance(output, list):
            for item in output:
                if not isinstance(item, dict) or item.get("type") != "message":
                    continue
                for block in item.get("content") or []:
                    if not isinstance(block, dict) or block.get("type") != "output_text":
                        continue
                    text = block.get("text")
                    if isinstance(text, str):
                        parts.append(text)
        if not parts:
            fallback = data.get("output_text")
            if isinstance(fallback, str):
                parts.append(fallback)
        if output is None and not isinstance(data.get("output_text"), str):
            raise LLMError("模型返回了无法解析的响应格式")
        return "".join(parts)

    @staticmethod
    def _raise_failed_response(data: dict) -> None:
        error = data.get("error")
        message = error.get("message") if isinstance(error, dict) else None
        raise LLMError(f"模型返回错误：{message or '未知错误'}")

    @staticmethod
    def _http_error(response: httpx.Response) -> LLMError:
        status = response.status_code
        logger.warning("Responses 调用失败 status=%s", status)
        if status == 404:
            # 多数服务商的 "不支持这个协议" 就表现成 404：给出可操作出口，别只甩状态码。
            return LLMError(
                "模型不存在或接口地址错误；也可能该服务商不支持 Responses 协议，"
                "请检查 Base URL 与模型名称，或切回 Chat Completions 后重试（HTTP 404）"
            )
        return status_error(status)


__all__ = ["ResponsesProvider", "responses_unsupported_hint"]
