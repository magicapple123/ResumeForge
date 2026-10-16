"""DeepSeek tool-message fields are scoped to its official protocol."""

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.tool_messages import assistant_tool_call_message


@pytest.mark.parametrize(
    ("base_url", "api_style", "model"),
    [
        ("https://api.example.com/v1", "openai", "deepseek-flash"),
        ("https://api.deepseek.com.example.org", "openai", "deepseek-flash"),
        ("https://api.deepseek.com", "anthropic", "deepseek-flash"),
        ("https://api.deepseek.com", "openai", "other-model"),
    ],
)
def test_other_protocols_do_not_receive_deepseek_reasoning(base_url, api_style, model):
    config = LLMConfig(base_url=base_url, api_style=api_style, model=model)
    assert "reasoning_content" not in assistant_tool_call_message(config, [], "private reasoning")


@pytest.mark.parametrize("reasoning", ["", "思考" * 20_001], ids=["empty", "long"])
def test_deepseek_reasoning_is_preserved_even_when_empty_or_above_display_limit(reasoning):
    config = LLMConfig(base_url="https://api.deepseek.com", model="deepseek-v4-flash")
    assert assistant_tool_call_message(config, [], reasoning)["reasoning_content"] == reasoning
