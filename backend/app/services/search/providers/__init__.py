# SPDX-License-Identifier: Apache-2.0
"""需要 API Key 的第三方搜索来源（Tavily / Jina）。

与 ``services/search/duckduckgo.py`` 这类"公开端点"分开一个包，是因为它们的失败语义
不一样：公开端点失败只是"这个来源没结果"，而带 Key 的来源要说清楚"是配置错了
（401）、被限流了（429），还是响应格式变了"，用户才知道该改设置还是等一会儿。

两个模块都不抛异常，统一返回带 ``.failure`` 的列表（与 ``deepseek.DeepSeekResults``
同构），由聚合层用 ``services/search/status.py`` 分类成 ``config``/``rate``/
``network``/``parse`` 四种 ``error_kind``。
"""

__all__: list[str] = []
