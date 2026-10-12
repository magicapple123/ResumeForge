"""LLM Provider 抽象层。

新增模型提供商只需继承 BaseLLMProvider 并实现 chat / stream_chat，
业务代码（简历生成等）只依赖本抽象，不感知具体协议。
"""

import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

from ...schemas.setting import LLMConfig
from .usage import LLMUsage, build_usage


def build_request_timeout(
    config: LLMConfig, request_deadline_seconds: float | None
) -> httpx.Timeout:
    """两家 provider 共用的分项 timeout 构造（RF-14 §2.1.c）。

    分项 read timeout 是"单请求不挂死"的**下限**保护（现状，保留）；总预算是整链
    **上限**：``request_deadline_seconds`` 由调用方按所在 child 段剩余注入——deadline
    只能收紧、不能放宽配置值。connect/write/pool 两家协议取同一组值。
    """
    read = config.timeout_seconds
    if request_deadline_seconds is not None:
        read = max(1.0, min(read, request_deadline_seconds))
    return httpx.Timeout(connect=10.0, read=read, write=30.0, pool=10.0)


class LLMError(Exception):
    """对外暴露的模型调用错误，message 为可直接展示给用户的中文提示。"""


@dataclass
class LLMDelta:
    """流式响应的一帧。

    一帧要么是正文片段，要么是一组**已经拼接完整**的工具调用（协议里工具调用的
    参数是碎片化到达的，拼接由 provider 负责，调用方拿到的一定是可直接 json 解析
    的字符串），要么是模型的**思考内容**片段。

    ``reasoning`` 单独成字段、默认空串，是为了保持向后兼容：不支持思考内容的服务商
    与测试里的假 Provider 都只产出 ``text``，行为与新增该字段之前完全一致。思考内容
    是"给用户看的解释"，**不参与后续对话**（见 stream 层与 provider 的说明）——把它
    当正文回灌给模型会让它把自己的草稿当成事实，还可能超长。
    """

    text: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    finish_reason: str | None = None
    reasoning: str = ""


class BaseLLMProvider(ABC):
    def __init__(self, config: LLMConfig, *, request_overrides: dict | None = None):
        self.config = config
        # 请求级覆盖参数（如助手页选择的思考强度）：只作用于本次调用，不写回配置。
        # provider 负责按白名单过滤，避免覆盖 model/messages/stream 这些关键字段。
        self.request_overrides = dict(request_overrides or {})
        # 最后一次调用的用量记录（RF-14 §2.2）：chat() 返回前写入；流式在**所有路径**
        # 的 finally 中写入（中断也要有记录）。只保留最后一次调用，跨轮累计是调用方
        # 责任。注意：测试假 Provider 可能不经本构造器、也从不写它——读取方必须容忍
        # 属性缺失（用 getattr 兜底），缺用量展示「未知」。
        self.last_usage: LLMUsage | None = None
        # 请求级 read deadline（RF-14 §2.1.c）：调用方在发起前设置为"本次请求允许的
        # read 上限秒数"（如格式修复段的 child 剩余），_timeout() 取
        # min(配置值, 本值)——deadline 只能收紧、不能放宽配置值。None 表示未接预算。
        # 调用方负责在 finally 中复位为 None（provider 实例不复用，复位是防御性纪律）。
        self.request_deadline_seconds: float | None = None

    def _deadline_remaining(self) -> float | None:
        """本次请求的剩余预算秒数；未接预算时为 None（重试治理用它做"剩余不足不重试"）。"""
        return self.request_deadline_seconds

    def _record_usage(
        self,
        *,
        started: float,
        finish_reason: str,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        retries: int = 0,
    ) -> None:
        """写入最后一次调用的用量记录（``last_usage`` 约定见构造器注释）。"""
        self.last_usage = build_usage(
            self.config.model,
            elapsed_ms=max(0, int((time.monotonic() - started) * 1000)),
            finish_reason=finish_reason,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            retries=retries,
        )

    @abstractmethod
    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        """一次性对话，返回完整回复。

        ``thinking=False`` 供**结构化输出类**调用（识别/解析/评分/题目生成等）显式
        关闭思考模式：这类请求要的是严格 JSON，思考对准确率几乎没有增益，却会让
        快模型也慢上几倍。创作与对话类调用保持默认（跟随用户设置）。
        """

    @abstractmethod
    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        """流式对话，逐段产出回复文本。"""
        yield ""  # pragma: no cover - 抽象方法的占位实现，声明它是异步生成器

    async def stream_chat_events(
        self, messages: list[dict], tools: list[dict] | None = None
    ) -> AsyncIterator[LLMDelta]:
        """带工具调用的流式对话。

        默认实现忽略 tools、退化成纯文本流：不支持工具调用的服务商与测试里的假
        Provider 都能继续工作，代价是不会产出 tool_calls。真正支持的 provider
        覆盖本方法。
        """
        async for chunk in self.stream_chat(messages):
            yield LLMDelta(text=chunk)
