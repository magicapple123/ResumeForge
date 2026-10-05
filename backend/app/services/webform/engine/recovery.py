"""填充失败的**分类**与**重试阶梯**（纯函数；写入/回读副作用留在 FormEngine）。

原因码是闭环的：``ApplyOutcome.reason``、上报里的 ``reason_counts``、重试决策与
前端文案都从这一组常量取值——新增一种失败要同时想清楚这三件事，不要各写各的字符串。

重试纪律（每条都由既有边界推导，不因"重试"放松）：

- **不覆盖页面已有的值**：重试前先重读，值非空且不等于期望就停（那是用户或页面填的）；
- **单选/复选重试前先回读勾选态**：已经勾上的一律不再点击——再点一下会把它取消；
- **不模糊选选项**：``no_option`` 只允许"重读选项再严格匹配"（联动轮询、自定义下拉
  重开一次），永不退化成"最接近的那个"；
- **``no_control`` 不重试**：定位符找不到控件说明页面已经重渲染，重写只会再失败一次；
- 上限 ``MAX_RETRIES`` 轮，失败如实上报，不做无限重试。
"""
from __future__ import annotations

from dataclasses import dataclass

# ===== 原因码 =====
REASON_NO_SELECTOR = "no_selector"
REASON_WRITE_ERROR = "write_error"
REASON_NO_CONTROL = "no_control"
REASON_NO_OPTION = "no_option"
REASON_NOT_CHECKED = "not_checked"
REASON_VALUE_MISMATCH = "value_mismatch"
REASON_READBACK_ERROR = "readback_error"

MAX_RETRIES = 2


class OptionUnavailable(RuntimeError):
    """选项层面拿不到唯一匹配：联动下拉没加载出来、自定义下拉没有唯一项。

    单独成类是为了让"重试阶梯"能把它和写入异常区分开——它只该重读选项，
    不该换事件序列重写整框。
    """


@dataclass(frozen=True)
class RetryStrategy:
    """下一次尝试怎么写。"""

    # 补发 blur：少数站点把同步/校验挂在 onblur 上。只进重试路径——happy path 发
    # blur 会触发站点校验提示，个别站点还会在 onblur 里清掉未通过校验的值。
    full_events: bool = False
    # 强制点击单选/复选：重试前的探查已经确认过勾选态（没勾上才走到这里），而首次
    # 尝试用的快照 ``checked`` 可能已经过期——不强制的话"快照说已勾选、页面其实
    # 没勾"的框会永远点不下去。
    force_choice_click: bool = False


def retry_plan(previous_reason: str, attempt: int) -> RetryStrategy | None:
    """刚试完第 ``attempt`` 次（1 起），下一次要不要试、怎么写；``None`` = 就此打住。

    ``attempt`` 是**刚完成**的那次尝试的序号：``attempt > MAX_RETRIES`` 时不再重试，
    因此总尝试次数最多是 ``1 + MAX_RETRIES``。
    """
    if attempt > MAX_RETRIES:
        return None
    if previous_reason == REASON_NO_CONTROL:
        return None
    if previous_reason == REASON_NO_OPTION:
        # 重读选项 + 严格匹配；选择逻辑本身不做任何放宽。
        return RetryStrategy()
    if previous_reason == REASON_NOT_CHECKED:
        # 重新点击；调用方会先回读勾选态，已勾上的不会再点（返回 done）。
        return RetryStrategy(force_choice_click=True)
    if previous_reason in (REASON_VALUE_MISMATCH, REASON_WRITE_ERROR):
        return RetryStrategy(full_events=True)
    if previous_reason == REASON_READBACK_ERROR:
        # 可能只是回读通道抖了一下：重试前会先重读，值其实在的话直接判成功。
        # 只给一次机会——通道真坏了，多试几次也读不回来，不如尽早如实上报。
        return RetryStrategy() if attempt <= 1 else None
    return None


def classify_write_error(error: Exception) -> str:
    """写入阶段抛出的异常 → 原因码。"""
    if isinstance(error, OptionUnavailable):
        return REASON_NO_OPTION
    return REASON_WRITE_ERROR


__all__ = [
    "MAX_RETRIES",
    "OptionUnavailable",
    "REASON_NO_CONTROL",
    "REASON_NO_OPTION",
    "REASON_NO_SELECTOR",
    "REASON_NOT_CHECKED",
    "REASON_READBACK_ERROR",
    "REASON_VALUE_MISMATCH",
    "REASON_WRITE_ERROR",
    "RetryStrategy",
    "classify_write_error",
    "retry_plan",
]
