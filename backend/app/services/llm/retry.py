"""传输层重试治理（RF-14 §2.4）：纯函数与可重试信号，两家 provider 共用。

分类处理（§2.4-1）：**429** 可重试，退避 1s → 2s（最多 2 次重试，共 3 次请求），
服务商提供 ``Retry-After`` 头时取 ``min(Retry-After, 8s)``（测试注入时钟，不真睡）；
**5xx（500/502/503）** 可重试，最多 1 次，退避 1s；**非法输出**（JSON 解析失败/空
回复）传输层不重试——generator 已有格式修复/质量重试段（受 §2.1.a child 约束），
provider 层再重试等于烧双倍 token 制造第二套重试语义；**400** 保持现有"参数拒绝降级"路径（provider 的降级逻辑），不并入本机制；**4xx 其余（401/403/404）**
不重试（用户配置问题，重试无意义）。

安全点规则（钉成测试的硬性不变式，§2.4-2）：重试只允许发生在**本次调用首个 delta
产出之前**。429/5xx 表现为响应状态码，天然在 body 之前，安全；流中途的传输错误
**不重试**（此时可能已有 delta 发给调用方，重试会造成文本重复）。
"""
from __future__ import annotations

import asyncio

from .base import LLMError

# 可重试状态码与其重试上限。
RETRYABLE_STATUSES = frozenset({429, 500, 502, 503})
MAX_RETRIES_BY_STATUS: dict[int, int] = {429: 2, 500: 1, 502: 1, 503: 1}

# 429 无 Retry-After 时的基础退避阶梯（按已完成的重试次数取位）。
_BASE_BACKOFF_429: tuple[float, ...] = (1.0, 2.0)
# 5xx 的固定退避。
_BACKOFF_5XX = 1.0
# Retry-After 封顶：不信任服务商用一个天文数字把请求挂死。
_RETRY_AFTER_CAP_SECONDS = 8.0
# 所在请求的剩余预算不足 1s 时不再重试——预算耗尽优先于重试（§2.4-4）。
_MIN_DEADLINE_REMAINING = 1.0


class StatusRetrySignal(Exception):
    """响应状态码阶段抛出的可重试信号。

    provider 在**尚未读取任何 body/delta** 的状态码检查点抛出本信号，由调用方的
    重试循环决定退避重试，或（无法重试时）转回 :class:`LLMError`——400 的"参数
    拒绝降级"语义在那里原样保留。
    """

    def __init__(self, status: int, retry_after: str | None = None):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.retry_after = retry_after


def is_retryable_status(status: int) -> bool:
    return status in RETRYABLE_STATUSES


def parse_retry_after(value: str | None) -> float | None:
    """解析 ``Retry-After`` 头（只认秒数形式），并按 8s 封顶。

    HTTP-Date 形式不支持：它依赖本地时钟且极罕见；解析失败返回 None（调用方回退到
    基础退避阶梯），不臆造。
    """
    try:
        seconds = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if seconds < 0:
        return None
    return min(seconds, _RETRY_AFTER_CAP_SECONDS)


def retry_backoff_seconds(
    status: int,
    attempt: int,
    retry_after: str | None = None,
    *,
    deadline_remaining: float | None = None,
) -> float | None:
    """计算本次应退避的秒数；返回 ``None`` 表示不重试。

    ``attempt`` 是**已完成**的重试次数（从 0 起算）。``deadline_remaining`` 是所在
    请求的剩余预算秒数（``None`` = 未接预算，见 ``BaseLLMProvider.request_deadline_seconds``）。
    """
    if status not in RETRYABLE_STATUSES:
        return None
    if attempt >= MAX_RETRIES_BY_STATUS[status]:
        return None
    if deadline_remaining is not None and deadline_remaining < _MIN_DEADLINE_REMAINING:
        return None
    if status == 429:
        parsed = parse_retry_after(retry_after)
        if parsed is not None:
            return parsed
        return _BASE_BACKOFF_429[min(attempt, len(_BASE_BACKOFF_429) - 1)]
    return _BACKOFF_5XX


async def retry_sleep(seconds: float) -> None:
    """退避等待。独立成函数是为了让测试能注入时钟（monkeypatch 本模块属性），不真睡。"""
    await asyncio.sleep(seconds)


class StatusRetryGate:
    """一次调用内的状态码阶段重试编排（两家 provider 共用）。

    provider 在响应状态码检查点调用 :meth:`next_delay`——返回退避秒数就 sleep 后
    重发，返回 None 就用 :meth:`final_error` 构造终态错误（重试过的话消息带
    「（已自动重试 N 次）」，``LLMUsage.retries`` 直接取 ``retries``）。重试只发生
    在状态码阶段——首个 delta 产出之前，模型根本没机会返回 tool_calls，工具不可
    能被执行两次（§2.4-5）。
    """

    def __init__(self, *, deadline_remaining: float | None = None):
        self.retries = 0
        self._attempt = 0
        self._deadline_remaining = deadline_remaining

    def next_delay(self, status: int, retry_after: str | None = None) -> float | None:
        """返回本次应退避的秒数（内部完成计数）；None 表示不重试。"""
        delay = retry_backoff_seconds(
            status, self._attempt, retry_after, deadline_remaining=self._deadline_remaining
        )
        if delay is None:
            return None
        self.retries += 1
        self._attempt += 1
        return delay

    def final_error(self, status: int, error: LLMError) -> LLMError:
        """终态错误：重试过的可重试状态码追加次数尾巴，其余原样返回。"""
        if self.retries and is_retryable_status(status):
            return LLMError(f"{error}（已自动重试 {self.retries} 次）")
        return error


__all__ = [
    "MAX_RETRIES_BY_STATUS",
    "RETRYABLE_STATUSES",
    "StatusRetryGate",
    "StatusRetrySignal",
    "is_retryable_status",
    "parse_retry_after",
    "retry_backoff_seconds",
    "retry_sleep",
]
