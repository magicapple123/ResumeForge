# SPDX-License-Identifier: Apache-2.0
"""Search failure messages permitted in SSE, persisted history and model context."""

# RSS 解析到 **0 条**时的提示（P4-08）。微软已于 2025-08-11 退役 Bing Search API，
# RSS 端点没有 SLA——"0 条"更可能是端点结构变了，而不是"这次真的没搜到"。
# 混成一句话会让用户以为是关键词问题，反复换词重试。
BING_RSS_EMPTY_MESSAGE = (
    "Bing RSS 可能已变更：这次没有解析到任何结果。可以在设置页换用其它搜索来源"
    "（DuckDuckGo / Tavily / Jina），或稍后重试。"
)

# 配置类失败的专用文案（CR-02）。聚合层在「所有来源都失败且失败原因是 config」时
# 抛这两句之一，而不是「没有找到公开来源」——后者会让用户反复换关键词，实际要去改 Key。
# 两句都是**静态整句**（白名单按整串相等匹配，带变量就会退化成兜底话术）。
SEARCH_KEY_MISSING_MESSAGE = (
    "还没有配置联网搜索的 API Key。到「设置 → 助手行为 → 联网搜索」填一把。"
)
SEARCH_KEY_INVALID_MESSAGE = (
    "联网搜索用的 API Key 无效或无权限。到「设置 → 助手行为 → 联网搜索」更换"
    "——它和「AI 模型」里的 Key 是分开配置的。"
)

_PUBLIC_MESSAGES = {
    message: message
    for message in (
        "联网搜索返回了不安全的响应格式",
        "联网搜索返回了无法解析的响应",
        "联网搜索服务暂时不可用，请稍后重试",
        "联网搜索返回内容过大，已停止读取",
        "联网搜索响应超时，请稍后重试",
        "无法连接联网搜索服务，请检查网络状态",
        "请先输入要搜索的内容",
        "没有找到与当前问题直接相关的公开来源。可以换成更具体的公司名、岗位名或技术方向再搜一次。",
        # 它定义在本模块正是为了进这张白名单；否则用户只看到兜底那句
        # 「联网搜索服务暂时不可用」，看不出该去换来源。
        BING_RSS_EMPTY_MESSAGE,
        SEARCH_KEY_MISSING_MESSAGE,
        SEARCH_KEY_INVALID_MESSAGE,
    )
}


class AssistantSearchError(Exception):
    """Unknown exception text never becomes response or model-context content."""

    def __init__(self, message: str = "") -> None:
        super().__init__(message)
        self.public_message = _PUBLIC_MESSAGES.get(message, "联网搜索服务暂时不可用，请稍后重试")
