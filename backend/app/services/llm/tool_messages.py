"""Provider-specific assistant envelopes for tool continuations."""

from ...schemas.setting import LLMConfig
from .thinking import host_of


def assistant_tool_call_message(
    config: LLMConfig | None, calls: list[dict], reasoning: str
) -> dict:
    """Keep DeepSeek's reasoning in its protocol field, never in answer content.

    DeepSeek's thinking-mode tool protocol requires reasoning_content alongside
    tool_calls. Only the official OpenAI-compatible endpoint is opted in; other
    providers and native Messages keep their existing envelopes.
    """
    message = {"role": "assistant", "content": None, "tool_calls": calls}
    if (
        config is not None
        and config.api_style == "openai"
        and host_of(config.base_url) == "api.deepseek.com"
        and config.model.casefold().startswith("deepseek-")
    ):
        message["reasoning_content"] = reasoning
    return message
