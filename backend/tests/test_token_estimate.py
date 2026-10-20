# SPDX-License-Identifier: Apache-2.0
"""token 估算遥测（RF-14 §2.5）：区间断言（不是精确断言）+ 开关守门。

钉住的性质：
- 中英混合文本的估计值落在声明的常数区间；空文本 0、超长文本不抛异常；
- 开关关闭（默认）时行为与现状一致：用量里没有估算字段；
- 开启时估算字段存在且带 estimated_* 命名——与真实 tokens 明确分开，绝不冒充真实值。
"""
import json

from app.schemas.setting import LLMConfig
from app.services.llm.token_estimate import estimate_tokens


def _is_in_range(value: int, low: int, high: int) -> bool:
    return low <= value <= high


def test_pure_ascii_estimate():
    # 40 个 ASCII 字符 ≈ 40 / 4 = 10 token。
    text = "a" * 40
    assert _is_in_range(estimate_tokens(text), 8, 12)


def test_cjk_estimate():
    # 40 个汉字 ≈ 40 token（1 token/字）。
    text = "简" * 40
    assert _is_in_range(estimate_tokens(text), 38, 42)


def test_mixed_text_estimate():
    # 30 个汉字 + 40 个 ASCII 字符 ≈ 30 + 10 = 40。
    text = "简" * 30 + "a" * 40
    assert _is_in_range(estimate_tokens(text), 35, 45)


def test_empty_and_none_like_inputs():
    assert estimate_tokens("") == 0


def test_very_long_text_does_not_raise():
    text = ("简历通" * 10_000) + ("a" * 40_000)
    value = estimate_tokens(text)
    assert value > 0


def test_short_ascii_still_counts_as_one_token():
    assert estimate_tokens("a") == 1


# ===== 开关守门（走完整助手链路，离线假 Provider）=====


def _configure_llm(client) -> None:
    config = LLMConfig(
        base_url="https://api.example.com/v1", api_key="k", model="m1"
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def _send_message(client, monkeypatch):
    from tests.test_assistant import _create_conversation, _successful_provider

    _successful_provider(monkeypatch)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "你好"},
    )
    events = _events(response)
    done = next(event for event in events if event["type"] == "done")
    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assistant = detail["messages"][1]
    return done, assistant


def test_estimate_disabled_by_default_no_estimated_field(client, monkeypatch):
    """开关关闭（默认）：行为与现状一致，用量里没有估算字段。"""
    from app.config import get_settings

    _configure_llm(client)
    assert get_settings().llm_token_estimate_enabled is False
    _done, assistant = _send_message(client, monkeypatch)
    usage = assistant["context"].get("usage")
    assert usage is None or "estimated_prompt_tokens" not in usage


def test_estimate_enabled_adds_estimated_field_with_labelled_naming(client, monkeypatch):
    """开启：估算字段存在且带 estimated_* 命名；真实 tokens 字段不受影响。"""
    from app.api import assistant_budget

    class _Settings:
        assistant_stream_budget_seconds = 600
        llm_token_estimate_enabled = True

    # 估算开关的读取点在 assistant_budget.AssistantStreamBudget.estimate_prompt_tokens，
    # 锚点随实现下沉同步迁移（assistant_stream 命名空间已无 get_settings）。
    monkeypatch.setattr(assistant_budget, "get_settings", lambda: _Settings())

    _configure_llm(client)
    _done, assistant = _send_message(client, monkeypatch)
    usage = assistant["context"]["usage"]
    assert "estimated_prompt_tokens" in usage
    assert isinstance(usage["estimated_prompt_tokens"], int)
    assert usage["estimated_prompt_tokens"] > 0
    # 估算值与真实 tokens 明确分开命名：fake provider 没有真实用量，token 字段保持缺失。
    assert "prompt_tokens" not in usage or usage.get("prompt_tokens") is None
