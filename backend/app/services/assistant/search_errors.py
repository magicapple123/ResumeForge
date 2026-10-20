# SPDX-License-Identifier: Apache-2.0
"""Search failure messages permitted in SSE, persisted history and model context."""

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
    )
}


class AssistantSearchError(Exception):
    """Unknown exception text never becomes response or model-context content."""

    def __init__(self, message: str = "") -> None:
        super().__init__(message)
        self.public_message = _PUBLIC_MESSAGES.get(message, "联网搜索服务暂时不可用，请稍后重试")
