# SPDX-License-Identifier: Apache-2.0
"""批次执行的节流：岗位之间的可打断等待。

单独成模块的原因很实际——``task_apply`` 的行数预算已经贴线（496/500），而这段逻辑
与"投递语义"无关，只与"跑批时能不能被暂停/停止打断"有关。``task_apply`` 仍按原名
``interruptible_sleep`` 再导出，``task_runner._interruptible_sleep`` 与测试的 patch
落点因此保持不变。
"""

from __future__ import annotations

import random
from typing import Any


def interruptible_sleep(runner: Any, interval: int, jitter: int) -> bool:
    """岗位间限速等待；暂停可恢复，停止可即时打断。

    返回 ``False`` 表示"等待期间被停止"（调用方据此收尾），``True`` 表示正常等完。

    等待被切成 ≤0.2s 的片段轮询停止信号：整段 ``sleep(interval)`` 会让「停止」按钮
    在 3 秒内像失灵一样——用户会连点几次，然后以为程序卡死了。
    """
    total = max(0, interval)
    if jitter:
        total += random.uniform(0, jitter)
    if total <= 0:
        return True
    end = runner._clock() + total
    while True:
        if runner._stop.is_set():
            return False
        if not runner._resume.is_set() and not runner._wait_resume_or_stop():
            return False
        remaining = end - runner._clock()
        if remaining <= 0:
            return True
        runner._sleeper(min(0.2, remaining))


__all__ = ["interruptible_sleep"]
