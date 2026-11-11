# SPDX-License-Identifier: Apache-2.0
"""链接抓取的错误类型与用户可见文案。

抓取失败的原因（超时、被站点拒绝、返回类型不对、浏览器没启动…）会进三个地方：前端
提示、助手工具结果（模型上下文）、日志。统一成一个异常类型 + 面向用户的 message，
调用方不需要理解底层 httpx/CDP 的异常类型，也不会把内部堆栈带出去。
"""

from __future__ import annotations


class WebFetchError(Exception):
    """抓取失败；str(exc) 是**可直接展示**的中文原因。"""


class WebExtractError(Exception):
    """抽取失败（页面抓到了，但没有可用的岗位结构）；str(exc) 同样可直接展示。"""


__all__ = ["WebExtractError", "WebFetchError"]
