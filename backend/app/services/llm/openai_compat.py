# SPDX-License-Identifier: Apache-2.0
"""OpenAI Chat Completions 兼容协议实现。

覆盖 DeepSeek、豆包（火山方舟）、Kimi、智谱、OpenAI、Ollama 等
绝大多数大模型服务；直接用 httpx 实现，保持依赖精简与协议透明。
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator, AsyncIterator

import httpx

from ...runtime.operation_budget import OperationCancelled
from ...schemas.setting import LLMConfig
from . import payload as payload_rules
from . import retry
from .base import (
    BaseLLMProvider,
    LLMDelta,
    LLMError,
    build_request_timeout,
    log_llm_failure,
)
from .client_pool import get_shared_client

# 与"获取可用模型"接口（model_catalog）与 SearXNG 校验共用的请求侧规则：实现已
# 下沉到 payload 模块（见其模块说明），这里按原路径再导出，既有导入方零改动。
from .payload import (  # noqa: F401
    http_error_message as http_error_message,
)
from .payload import (
    is_loopback_host as is_loopback_host,
)
from .payload import (
    models_endpoint as models_endpoint,
)
from .payload import (
    validated_base_url as validated_base_url,
)
from .retry import StatusRetrySignal
from .thinking import wants_thinking
from .usage import (
    FINISH_CANCELLED,
    FINISH_ERROR,
    FINISH_STOP,
    merge_openai_stream_usage,
    openai_chat_outcome,
)

logger = logging.getLogger(__name__)


def _accumulate_tool_calls(pending: dict[int, dict], fragments: object) -> None:
    """把碎片化的 tool_calls 增量按 index 累积起来。

    协议里一个调用的 id / name / arguments 可能分散在多个帧里，帧与帧之间是
    **拼接**关系而不是覆盖关系；index 用来区分同一次响应里的多个并行调用。
    实测一个很短的 JSON 参数会用二十多帧、每帧一到两个字符地到达。
    """
    if not isinstance(fragments, list):
        return
    for fragment in fragments:
        if not isinstance(fragment, dict):
            continue
        try:
            index = int(fragment.get("index", 0))
        except (TypeError, ValueError):
            index = 0
        slot = pending.setdefault(
            index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
        )
        if isinstance(fragment.get("id"), str) and fragment["id"]:
            slot["id"] = fragment["id"]
        if isinstance(fragment.get("type"), str) and fragment["type"]:
            slot["type"] = fragment["type"]
        function = fragment.get("function")
        if isinstance(function, dict):
            if isinstance(function.get("name"), str):
                slot["function"]["name"] += function["name"]
            if isinstance(function.get("arguments"), str):
                slot["function"]["arguments"] += function["arguments"]


def _finalize_tool_calls(pending: dict[int, dict]) -> list[dict]:
    return [pending[index] for index in sorted(pending)]


def _extract_reasoning(delta: dict) -> str:
    """从流式帧里读出模型的思考内容片段。

    **没有一个统一的字段名**，各家的兼容端点各写各的，所以要逐个容忍：

    - ``reasoning_content``：DeepSeek 系（含自建/网关）的思考内容；
    - ``reasoning``：部分 OpenAI 系与第三方网关用的名字。

    两个都缺失就返回空串——**什么都不产出，绝不臆造**。这一点很关键：绝大多数普通
    模型和不开思考的请求本来就没有思考内容，缺失是常态而非异常，静默跳过即可。
    只有确实是字符串且非空时才返回。
    """
    for key in ("reasoning_content", "reasoning"):
        value = delta.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _status_error(status: int) -> LLMError:
    """状态码 → LLMError。实现下沉到 payload.status_error，保留为调用点。"""
    return payload_rules.status_error(status)


_CONNECT_TIMEOUT = 10.0  # 建连超时（秒），与业务超时分开配置
_MAX_CHAT_RESPONSE_BYTES = 2 * 1024 * 1024
_MIN_STREAM_CHARS = 64_000
_MAX_STREAM_CHARS = 2_000_000

# 状态码文案表（_STATUS_MESSAGES/http_error_message）、Base URL 规则与覆盖参数
# 白名单（_OVERRIDABLE_KEYS）均已下沉到 payload 模块（协议静态规则），见其模块说明。


class OpenAICompatProvider(BaseLLMProvider):
    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        request_overrides: dict | None = None,
    ):
        # request_overrides 必须转发给基类：`create_provider(..., request_overrides=...)`
        # 是文档化的入口，这里不接的话它会直接抛 TypeError，而调用方只能改成
        # 构造完再赋值属性——看起来能跑，实际绕过了工厂的契约。
        super().__init__(config, request_overrides=request_overrides)
        self._transport = transport
        # 流式 usage 帧捕获：__init__ 里先占位，保证任何路径上属性都存在；每次传输
        # 尝试开始时在 stream_chat_events 里重置（见那里的注释）。
        self._stream_prompt_tokens: int | None = None
        self._stream_completion_tokens: int | None = None
        # 帧级 finish_reason 捕获：收尾帧可能不产出任何 delta（无正文、无工具调用）。
        self._stream_stop_reason: str | None = None

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        """同步发一次 OpenAI 兼容 Chat Completions 请求，返回完整文本；错误统一转成 LLMError。

        429/5xx 在状态码阶段按 §2.4 重试（429 最多 2 次、5xx 最多 1 次，退避见
        ``retry.retry_backoff_seconds``）；非法输出/400/其余 4xx 不重试。用量经
        ``last_usage`` 暴露：返回前写入，异常路径也要有记录（finish_reason=error）。
        """
        payload = self._build_payload(messages, stream=False, thinking=thinking)
        started = time.monotonic()
        # 活预算（PR-07-2）：门在每次决策时经 _deadline_remaining() 重算剩余。
        gate = retry.StatusRetryGate(deadline_remaining_fn=self._deadline_remaining)
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
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
                            # 超时不烘进共享客户端，按请求传入（read 预算按调用收紧的语义不变）。
                            timeout=self._timeout(),
                        ) as response:
                            if response.status_code != 200:
                                # 429/5xx 只发生在 body 之前（安全点规则：首个 delta 之前）。
                                # 重试编排（计数/退避/终态文案）在 retry.StatusRetryGate。
                                delay = gate.next_delay(
                                    response.status_code, response.headers.get("retry-after")
                                )
                                if delay is not None:
                                    logger.warning(
                                        "LLM 调用遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
                                        response.status_code,
                                        delay,
                                        gate.retries,
                                    )
                                    await retry.retry_sleep(delay)
                                    continue
                                raise gate.final_error(
                                    response.status_code, self._http_error(response)
                                )
                            body = bytearray()
                            async for chunk in response.aiter_bytes():
                                if len(body) + len(chunk) > _MAX_CHAT_RESPONSE_BYTES:
                                    raise LLMError("模型返回内容过大，请调低最大输出长度")
                                body.extend(chunk)
                except TimeoutError as exc:
                    # 整请求硬 deadline（asyncio.timeout）到期：结果未知，不自动重放。
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
                # data 可能不是 dict（非法响应形态）：usage/finish_reason 的提取要容忍，
                # 真正的形态校验交给 _extract_content 抛 LLMError。
                prompt_tokens, completion_tokens, protocol_reason = openai_chat_outcome(data)
                finish_reason = protocol_reason or FINISH_STOP
                return self._extract_content(data)
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
            )

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text

    async def stream_chat_events(
        self, messages: list[dict], tools: list[dict] | None = None
    ) -> AsyncGenerator[LLMDelta, None]:
        """带工具调用的流式对话。

        工具调用的参数在协议里是**碎片化**到达的（实测一个短 JSON 会用二十多帧、
        每帧一两个字符），必须按 index 累积拼接；拼接结果才是可直接 json 解析的
        字符串，这一点由本方法保证，调用方不必关心。

        另外兜住两类"服务商不认这个参数"的降级（各自最多一次）：tools 与思考参数。
        都是 400 之后去掉参数重试一次——把"这个功能整个不可用"降级成"这一次少点东西"。

        重试治理（RF-14 §2.4）：429/5xx 只在**状态码阶段**（任何 delta 产出之前）按
        ``retry`` 的策略重试；流中途的错误一律不重试——此时可能已有 delta 发给调用方，
        重试会造成文本重复。用量在**所有路径**的 finally 中写入 ``last_usage``。
        """
        drop_tools = False
        drop_thinking = False
        started = time.monotonic()
        # 活预算（PR-07-2）：门在每次重试决策时经 _deadline_remaining() 重算剩余。
        gate = retry.StatusRetryGate(deadline_remaining_fn=self._deadline_remaining)
        finish_reason = FINISH_ERROR
        try:
            while True:
                last_finish_reason: str | None = None
                # 每次传输尝试重置"流式 usage 帧 / 帧级 finish_reason"的捕获：
                # provider 实例是单请求生命周期且不会并发发起两次流，用实例属性在
                # _stream_deltas 与 finally 之间传递是安全的（占位见 __init__）。
                self._stream_prompt_tokens = None
                self._stream_completion_tokens = None
                self._stream_stop_reason = None
                try:
                    async for delta in self._stream_deltas(
                        messages,
                        None if drop_tools else tools,
                        thinking=not drop_thinking,
                    ):
                        if delta.finish_reason:
                            last_finish_reason = delta.finish_reason
                        yield delta
                    # 流正常走到 [DONE]：端点不发 finish_reason 时按 stop 归一（§2.4）。
                    # finish_reason 可能出现在无内容的收尾帧（不产出 delta），所以除了
                    # delta 上携带的，还要看 _stream_deltas 捕获的帧级值。
                    finish_reason = last_finish_reason or self._stream_stop_reason or FINISH_STOP
                    return
                except StatusRetrySignal as signal:
                    # 状态码阶段（尚未产出任何 delta）的重试：编排在 retry.StatusRetryGate。
                    delay = gate.next_delay(signal.status, signal.retry_after)
                    if delay is not None:
                        logger.warning(
                            "流式请求遇到 HTTP %s，%.1fs 后自动重试（第 %s 次）",
                            signal.status,
                            delay,
                            gate.retries,
                        )
                        await retry.retry_sleep(delay)
                        continue
                    # 既有 400 降级语义原样保留：先判断是否"服务商不认参数"。
                    drop_tools, drop_thinking = self._degrade_for_rejected_parameter(
                        gate.final_error(signal.status, _status_error(signal.status)),
                        tools,
                        drop_tools=drop_tools,
                        drop_thinking=drop_thinking,
                    )
                    continue
                except LLMError as exc:
                    drop_tools, drop_thinking = self._degrade_for_rejected_parameter(
                        exc, tools, drop_tools=drop_tools, drop_thinking=drop_thinking
                    )
                    continue
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
            )

    def _degrade_for_rejected_parameter(
        self,
        error: LLMError,
        tools: list[dict] | None,
        *,
        drop_tools: bool,
        drop_thinking: bool,
    ) -> tuple[bool, bool]:
        """既有的 400 降级语义（行为与拆分前逐字一致）。

        判断这次失败是否像"服务商不认某个可选参数"：可以降级就返回更新后的
        ``(drop_tools, drop_thinking)`` 让调用方重试一次，不能降级就原样抛出。
        """
        if not payload_rules.looks_like_rejected_parameter(error):
            raise error
        # 不少 OpenAI 兼容端点（本地小模型等）不支持 tools，会直接返回 400。
        if tools and not drop_tools:
            logger.warning("模型不支持工具调用，已降级为普通对话：%s", error)
            return True, drop_thinking
        # 思考参数被拒同理：去掉它再试一次，而不是"设置页一开开关，所有 AI
        # 功能一起 400"。
        if not drop_thinking and self._wants_thinking():
            logger.warning("模型拒绝了思考参数，已去掉后重试：%s", error)
            return drop_tools, True
        raise error

    def _wants_thinking(self) -> bool:
        """这次请求会不会带上思考参数——**配置里的开关与请求级的强度都算**。

        只看配置会漏掉助手那条路：它的配置被 ``without_thinking()`` 剥过，思考强度走的是
        ``request_overrides``。漏掉的话，助手页选了不被上游接受的档位就只能报错，
        而这里本该降级成"这一次没有思考"。
        """
        effort = str(self.request_overrides.get("reasoning_effort") or "").strip()
        return bool(effort) or wants_thinking(self.config)

    async def _stream_deltas(
        self, messages: list[dict], tools: list[dict] | None, *, thinking: bool = True
    ) -> AsyncIterator[LLMDelta]:
        payload = self._build_payload(messages, stream=True, tools=tools, thinking=thinking)
        try:
            # 整次传输尝试包进硬墙钟（PR-07-3）：首字前静默、只发心跳的流也会被
            # asyncio.timeout 硬切；到期时 async with 退出即关闭 response。
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
                        # 状态码阶段（尚未产出任何 delta）：交给 stream_chat_events 的重试
                        # 循环决定退避重试或按既有语义转成 LLMError（含 400 降级）。
                        raise StatusRetrySignal(
                            response.status_code, response.headers.get("retry-after")
                        )
                    total_chars = 0
                    pending: dict[int, dict] = {}
                    finish_reason: str | None = None
                    emitted = False
                    async for line in response.aiter_lines():
                        # SSE 格式：每行 "data: {json}"，流结束标志 "data: [DONE]"
                        if not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if not chunk:
                            continue
                        if chunk == "[DONE]":
                            break
                        try:
                            data = json.loads(chunk)
                        except json.JSONDecodeError as exc:
                            log_llm_failure("protocol", "流式帧 JSON 解析失败")
                            raise LLMError("模型返回了无法解析的流式响应") from exc
                        if not isinstance(data, dict):
                            log_llm_failure("protocol", "流式帧不是 JSON 对象")
                            raise LLMError("模型返回了无法解析的流式响应")
                        # 服务商自带的 usage 帧（stream_options.include_usage 开启时或部分
                        # 端点最终 chunk 自带）：只读取、缺失不臆造（RF-14 §2.2-2）。
                        if "usage" in data:
                            (
                                self._stream_prompt_tokens,
                                self._stream_completion_tokens,
                            ) = merge_openai_stream_usage(
                                self._stream_prompt_tokens,
                                self._stream_completion_tokens,
                                data,
                            )
                        choices = data.get("choices") or []
                        if not isinstance(choices, list):
                            raise LLMError("模型返回了无法解析的流式响应")
                        if not choices:
                            continue
                        choice = choices[0]
                        if not isinstance(choice, dict):
                            raise LLMError("模型返回了无法解析的流式响应")
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
                            # 帧级捕获：收尾帧可能不产出 delta（无正文、无工具调用），
                            # stream_chat_events 据此归一 finish_reason。
                            self._stream_stop_reason = str(finish_reason)
                        delta = choice.get("delta") or {}
                        if not isinstance(delta, dict):
                            raise LLMError("模型返回了无法解析的流式响应")
                        text = delta.get("content")
                        if text is not None and not isinstance(text, str):
                            raise LLMError("模型返回了无法解析的流式响应")
                        if text:
                            total_chars += len(text)
                            if total_chars > self._stream_char_limit():
                                raise LLMError("模型流式输出过大，请调低最大输出长度")
                            yield LLMDelta(text=text)
                        # 思考内容与正文分开产出：它不是要展示给用户的回答，而是"模型
                        # 在想什么"。同样计入 total_chars——它是真实消耗的输出，且不受
                        # 限的话一条只会思考的流会无界增长。
                        reasoning = _extract_reasoning(delta)
                        if reasoning:
                            total_chars += len(reasoning)
                            if total_chars > self._stream_char_limit():
                                raise LLMError("模型流式输出过大，请调低最大输出长度")
                            yield LLMDelta(reasoning=reasoning)
                        _accumulate_tool_calls(pending, delta.get("tool_calls"))
                        # 有的端点不发 finish_reason 就结束，所以下面还要兜一次。
                        if finish_reason and pending and not emitted:
                            emitted = True
                            yield LLMDelta(
                                tool_calls=_finalize_tool_calls(pending),
                                finish_reason=finish_reason,
                            )
                    if pending and not emitted:
                        yield LLMDelta(tool_calls=_finalize_tool_calls(pending))
        except TimeoutError as exc:
            # 整请求硬 deadline（asyncio.timeout）到期：结果未知，不自动重放（安全点规则）。
            log_llm_failure("timeout", "整请求预算到期（硬 deadline）")
            raise self._translate_deadline_expiry(exc) from exc
        except httpx.TimeoutException as exc:
            # 流中途（已可能产出 delta）不重试：安全点规则（§2.4-2），只做文案转换。
            log_llm_failure("timeout", type(exc).__name__)
            raise LLMError("模型响应超时，请稍后重试或调大超时时间") from exc
        except httpx.RequestError as exc:
            # 流中途（已可能产出 delta）不重试：安全点规则（§2.4-2），只做文案转换。
            log_llm_failure("disconnect", type(exc).__name__)
            raise LLMError("无法连接模型服务，请检查 Base URL 与网络状态") from exc

    # ===== 内部工具 =====

    def _endpoint(self) -> str:
        """规范化接口地址：兼容用户填 Base URL 或完整接口地址两种情况。"""
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
        # 连接池共享（AI 提速）：同一事件循环 + 同一传输层的请求复用连接，
        # 省掉每次请求的 TCP/TLS 握手；超时按请求在 stream() 处传入。
        return get_shared_client(transport=self._transport)

    def _stream_char_limit(self) -> int:
        # 不限制输出时 max_tokens 为 0，按乘法派生会落到下界，反而成为最严格的
        # 限制；这种情况直接用允许的最大值。
        if self.config.uses_unlimited_output:
            return _MAX_STREAM_CHARS
        return min(
            _MAX_STREAM_CHARS,
            max(_MIN_STREAM_CHARS, self.config.max_tokens * 8),
        )

    def _timeout(self) -> httpx.Timeout:
        # 分项 read 的"下限保护 + 预算上限压缩"两家同构，实现下沉到 base.build_request_timeout；
        # 剩余按活预算重算（PR-07-1）：接了 OperationBudget 时 read 随时间递减。
        return build_request_timeout(self.config, self._deadline_remaining())

    def _build_payload(
        self,
        messages: list[dict],
        stream: bool,
        tools: list[dict] | None = None,
        *,
        thinking: bool = True,
    ) -> dict:
        # 请求体构造（含覆盖参数白名单与 stream_options 守门）下沉到 payload 模块：
        # 本方法保留为调用点，测试与调用方仍按 `_build_payload` 访问。
        return payload_rules.build_payload(
            self.config, self.request_overrides, messages, stream, tools, thinking=thinking
        )

    def _apply_request_overrides(self, payload: dict, *, thinking: bool = True) -> None:
        """合并单次请求的覆盖参数；实现下沉到 payload 模块，本方法保留为调用点。"""
        payload_rules._apply_request_overrides(self.request_overrides, payload, thinking=thinking)

    @staticmethod
    def _extract_content(data: dict) -> str:
        if not isinstance(data, dict):
            raise LLMError("模型返回了无法解析的响应格式")
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("模型返回了无法解析的响应格式") from exc
        if content is None:
            return ""
        if not isinstance(content, str):
            raise LLMError("模型返回了无法解析的响应格式")
        return content

    @staticmethod
    def _http_error(response: httpx.Response) -> LLMError:
        status = response.status_code
        # 上游正文可能回显请求或敏感资料，只记录状态码。
        logger.warning("LLM 调用失败 status=%s", status)
        return payload_rules.status_error(status)
