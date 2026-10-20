# SPDX-License-Identifier: Apache-2.0
"""LLM Provider 抽象层。

新增模型提供商只需继承 BaseLLMProvider 并实现 chat / stream_chat，
业务代码（简历生成等）只依赖本抽象，不感知具体协议。
"""

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import httpx

from ...runtime.operation_budget import OperationBudget, OperationCancelled
from ...schemas.setting import LLMConfig
from .usage import FINISH_BUDGET_EXHAUSTED, FINISH_CANCELLED, LLMUsage, build_usage

logger = logging.getLogger(__name__)


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


def log_llm_failure(category: str, detail: str) -> None:
    """传输层失败的结构化分类日志（审计 PR-07-7）。

    category 取值：timeout | disconnect | protocol | cancelled。只记类别与简述，
    绝不记录 prompt/response 内容与密钥（隐私边界）；任务维度的 request_id /
    task_id / dataset_id 上下文由 runtime.log_context 的绑定日志自动附带。
    """
    logger.warning("LLM 传输失败类别=%s：%s", category, detail)


@dataclass
class LLMDelta:
    """流式响应的一帧。

    一帧要么是正文片段，要么是一组**已经拼接完整**的工具调用（协议里工具调用的
    参数是碎片化到达的，拼接由 provider 负责，调用方拿到的一定是可直接 json 解析
    的字符串），要么是模型的**思考内容**片段。

    ``reasoning`` 单独成字段、默认空串，是为了保持向后兼容：不支持思考内容的服务商
    与测试里的假 Provider 都只产出 ``text``，行为与新增该字段之前完全一致。思考内容
    单独展示、存档，不混入正文。DeepSeek 等明确要求回传的工具协议由适配层处理，
    其余服务商不额外携带思考内容。
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
        # 请求级**活预算**（审计 PR-07）：调用方注入 :class:`OperationBudget`（整链
        # 总预算或 child 段），每次传输尝试/重试决策前用 ``remaining()`` 重算剩余——
        # 与上面静态秒数不同，它会随时间递减。``remaining <= 0`` 时不发起新请求；
        # 每次尝试用 ``asyncio.timeout(剩余)`` 包出整请求硬墙钟（read timeout 只是
        # 段间上限，切不断首字前静默/只发心跳的流）。None 表示未接预算。
        self.request_budget: OperationBudget | None = None

    def _deadline_remaining(self) -> float | None:
        """本次决策的剩余预算秒数（PR-07-1：活预算每次重算）；未接预算时为 None。

        重试治理（``StatusRetryGate``）与整请求硬墙钟都用它；接了活预算时返回
        ``budget.remaining()``，否则退回静态 ``request_deadline_seconds``。
        """
        if self.request_budget is not None:
            return self.request_budget.remaining()
        return self.request_deadline_seconds

    def _raise_if_budget_exhausted(self) -> None:
        """发起一次传输尝试前的硬检查：``remaining <= 0`` 绝不发起新请求（PR-07-1）。"""
        remaining = self._deadline_remaining()
        if remaining is None or remaining > 0:
            return
        budget = self.request_budget
        if budget is not None:
            raise OperationCancelled(budget.expiry_reason())
        raise LLMError("请求预算已耗尽，不再发起新的模型请求")

    @asynccontextmanager
    async def _attempt_deadline(self):
        """整次传输尝试的硬墙钟上限（审计 PR-07-3）。

        httpx 分项 read timeout 只是"两段数据之间的等待上限"：首字前静默、只发
        心跳帧的流不会被它切断。这里把本次尝试包进 ``asyncio.timeout(剩余预算)``，
        到期即取消本次 await——response 由调用方的 ``async with client.stream``
        在异常展开时关闭，外层异步迭代器由调用方按 aclosing 纪律显式 aclose。

        **这不是重放机制**：超时/取消后请求结果未知，按仓库现有约束（协作式同步
        写操作、结果未知的传输不自动重放）只做错误分类上报，重发是调用方的显式
        决策（重试治理只覆盖"响应未开始"的状态码阶段）。
        """
        remaining = self._deadline_remaining()
        if remaining is None:
            yield  # 未接预算：行为与引入硬墙钟之前逐字节一致
            return
        self._raise_if_budget_exhausted()
        async with asyncio.timeout(remaining):
            yield

    def _translate_deadline_expiry(self, exc: BaseException) -> Exception:
        """``asyncio.timeout`` 到期（TimeoutError）的统一转换（PR-07-3）。

        预算已耗尽 → 按预算语义上报（:class:`OperationCancelled`，message 区分
        取消/超时）；否则按既有超时文案转 :class:`LLMError`（read timeout 的
        语义不变，这里只兜"硬 deadline 先于 read timeout 生效"的窗口）。
        """
        budget = self.request_budget
        if budget is not None and budget.is_expired():
            return OperationCancelled(budget.expiry_reason())
        return LLMError("模型响应超时，请稍后重试或调大超时时间")

    def _cancelled_finish_reason(self) -> str:
        """取消类结束原因：用户取消 → cancelled；预算到期 → budget_exhausted。"""
        budget = self.request_budget
        if budget is not None and budget.is_cancelled():
            return FINISH_CANCELLED
        return FINISH_BUDGET_EXHAUSTED

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
    ) -> AsyncGenerator[LLMDelta, None]:
        """带工具调用的流式对话。

        默认实现忽略 tools、退化成纯文本流：不支持工具调用的服务商与测试里的假
        Provider 都能继续工作，代价是不会产出 tool_calls。真正支持的 provider
        覆盖本方法。返回类型是异步生成器：助手流式链路要在浏览器断开时显式
        ``aclose()`` 内层流（AsyncIterator 声明没有这个方法），让生成器 finally
        里的清理逻辑（cancel_pending_assistant_message 等）有机会执行。
        """
        async for chunk in self.stream_chat(messages):
            yield LLMDelta(text=chunk)
