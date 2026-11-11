# SPDX-License-Identifier: Apache-2.0
"""GitHub 接口不可用时的降级口径：一个异常类型 + 三组纯函数。

单独成模块的理由有两条：

1. ``update_check.py`` 已经贴着 500 行硬预算，而"把 403 / 429 翻译成用户能判断的下一
   步"是纯字符串处理，与 HTTP 抓取没有耦合，可以单独断言；
2. 「额度什么时候恢复」全靠 ``X-RateLimit-Reset``，这个字段的单位是 **UTC epoch 秒**
   （不是毫秒、也不是本地时间）。把换算放在一个只有几行的纯函数里，比散在调用点安全。

这里不 import httpx，也不发任何请求：入参是状态码 / 响应头 / 一个已经构造好的异常。
"""

from __future__ import annotations

import math
import time
from collections.abc import Mapping

# 不足一分钟按一分钟说：「约 0 分钟后恢复」是一句让人更困惑的话。
_MIN_RECOVERY_MINUTES = 1
# 超过一天基本可以确定拿到的不是限额重置时刻（GitHub 的窗口是小时级），
# 这时宁可不报数字，也不给用户一个"约 1439 分钟"的荒谬等待。
_MAX_RECOVERY_MINUTES = 24 * 60

# 兜底口径：既不是限额也不是已知状态码时用（例如响应体格式不符合预期）。
_GENERIC_RECOVERY = "GitHub 接口这次不可用，稍后重试会恢复完整说明"


class GitHubApiError(RuntimeError):
    """``api.github.com`` 返回了非 200 响应。

    继承 ``RuntimeError`` 是刻意的：调用方与既有用例都按 ``RuntimeError`` 捕获，
    这里只是把"状态码 / 是不是限额 / 何时恢复"三个字段带出来，捕获行为不变。
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 0,
        rate_limited: bool = False,
        reset_at: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.rate_limited = rate_limited
        # UTC epoch 秒（可能是 Decimal 化的字符串换来的），None = 不知道。
        self.reset_at = reset_at


def int_header(headers: Mapping[str, str] | None, name: str) -> int | None:
    """从响应头里取一个整数字段；缺失 / 非数字一律 ``None``（绝不抛）。

    httpx 的 ``Headers`` 大小写不敏感，但测试与其它调用方可能传普通 dict，所以两个
    常见写法都试一次。取不到就当没有，降级文案自己会退到"不给数字"的说法。
    """
    if not headers:
        return None
    for key in (name, name.lower()):
        try:
            raw = headers.get(key)
        except AttributeError:  # pragma: no cover - 传了不可订阅的东西
            return None
        if raw in (None, ""):
            continue
        try:
            return int(str(raw).strip())
        except (TypeError, ValueError):
            return None
    return None


def build_api_error(response: object, message: str) -> GitHubApiError:
    """把一次非 200 响应变成带上下文的 :class:`GitHubApiError`。

    限额的判定：429 一定算；403 要看 ``X-RateLimit-Remaining: 0``——同样是 403，
    "额度用完"和"网络里有人拦了 api.github.com"对用户意味着完全不同的事
    （前者等一会儿，后者等多久都没用）。
    """
    status = int(getattr(response, "status_code", 0) or 0)
    headers = getattr(response, "headers", None)
    remaining = int_header(headers, "x-ratelimit-remaining")
    reset_at = int_header(headers, "x-ratelimit-reset")
    retry_after = int_header(headers, "retry-after")
    rate_limited = status == 429 or (status == 403 and remaining == 0)
    if reset_at is None and retry_after:
        # 429 常给 Retry-After（相对秒数），换算出同一个绝对时刻。
        reset_at = int(time.time()) + retry_after
    return GitHubApiError(
        message,
        status_code=status,
        rate_limited=rate_limited,
        reset_at=float(reset_at) if reset_at else None,
    )


def recovery_minutes(reset_at: float | None, *, now: float | None = None) -> int | None:
    """``X-RateLimit-Reset`` → "还有几分钟恢复"；拿不到可信时刻时 ``None``。

    GitHub 给的是整数 epoch **秒**，和 ``time.time()`` 同一基准，直接相减即可——
    不要再套时区或乘 1000。
    """
    if not reset_at:
        return None
    remaining_seconds = float(reset_at) - (now if now is not None else time.time())
    minutes = math.ceil(remaining_seconds / 60)
    if minutes < _MIN_RECOVERY_MINUTES:
        return _MIN_RECOVERY_MINUTES
    if minutes > _MAX_RECOVERY_MINUTES:
        return None
    return minutes


def describe_failure(failure: object) -> str:
    """把主路径的失败压成一句"这是什么情况 + 什么时候能好"。"""
    if isinstance(failure, GitHubApiError):
        if failure.rate_limited:
            minutes = recovery_minutes(failure.reset_at)
            if minutes is not None:
                return f"GitHub 匿名额度已用完，约 {minutes} 分钟后恢复"
            return "GitHub 匿名额度已用完，稍后会自动恢复"
        if failure.status_code:
            return f"GitHub 接口返回 HTTP {failure.status_code}，稍后重试会恢复完整说明"
    return _GENERIC_RECOVERY


def degraded_available_message(*, latest: str, release_page: str, failure: object) -> str:
    """备用方式确认到新版本时的那句话：**结论在前**，原因与恢复时间在括号里。

    用户点「检查更新」首先要知道的是"到底有没有新版本"，所以第一句就是结论；
    "这次没取到更新说明 / 额度用完 / 约 N 分钟后恢复"全部后置，不用它盖住结论。

    「额度用完」与「换网络」必须分开说：前者等一会儿就好，后者等多久都没用，
    两种情况下用户的下一步动作完全不同。
    """
    return (
        f"已确认有新版 {latest}；这次没取到更新说明，可到 {release_page} 查看"
        f"（{describe_failure(failure)}；版本号是备用方式确认的）"
    )[:1000]


__all__ = [
    "GitHubApiError",
    "build_api_error",
    "degraded_available_message",
    "describe_failure",
    "int_header",
    "recovery_minutes",
]
