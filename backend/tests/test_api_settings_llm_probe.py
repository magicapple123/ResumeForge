# SPDX-License-Identifier: Apache-2.0
"""测试连接探针的短输出契约：max_tokens 压到 64，连通性检查不陪跑长生成。

用户反馈"快模型测连接也要等很久"：探针原本继承用户配置的输出上限（或不限制），
一次最小对话也要等模型把完整长度跑完。压缩后探针只验证"模型回话了"。
"""

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.payload import build_payload


def test_probe_caps_max_tokens(client, db_session, monkeypatch):
    captured: dict[str, int] = {}

    class FakeProvider:
        async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
            return "正常"

    def fake_create_provider(resolved):
        captured["max_tokens"] = resolved.max_tokens
        return FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=LLMConfig(
            base_url="https://api.example.com/v1", api_key="k", model="m", max_tokens=4096
        ).model_dump(),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["max_tokens"] == 64


def test_probe_caps_unlimited_output_too(client, db_session, monkeypatch):
    captured: dict[str, int] = {}

    class FakeProvider:
        async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
            return "正常"

    def fake_create_provider(resolved):
        captured["max_tokens"] = resolved.max_tokens
        return FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=LLMConfig(
            base_url="https://api.example.com/v1", api_key="k", model="m", max_tokens=0
        ).model_dump(),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["max_tokens"] == 64


@pytest.mark.parametrize("reply", ["", " \n\t "])
def test_probe_rejects_empty_reply(client, monkeypatch, reply):
    class FakeProvider:
        async def chat(self, messages, *, thinking=True):
            return reply

    monkeypatch.setattr("app.api.settings.create_provider", lambda _: FakeProvider())
    response = client.post(
        "/api/settings/llm/test",
        json=LLMConfig(base_url="https://api.example.com/v1", model="m").model_dump(),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["ok"] is False
    assert "没有返回正文" in result["message"]
    assert result["latency_ms"] >= 0


@pytest.mark.parametrize(
    ("base_url", "model", "expected"),
    [
        ("https://api.deepseek.com", "deepseek-flash", {"thinking": {"type": "disabled"}}),
        ("https://api.deepseek.com/v1", "deepseek-v4-flash", {"thinking": {"type": "disabled"}}),
        ("https://api.deepseek.com", "deepseek-v4-pro", {"thinking": {"type": "disabled"}}),
        (
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "qwen-plus",
            {"enable_thinking": False},
        ),
        ("https://api.example.com/v1", "m", {}),
        ("https://api.openai.com/v1", "gpt-4o-mini", {}),
        ("https://api.deepseek.com.example.org/v1", "deepseek-flash", {}),
    ],
)
def test_probe_disables_only_known_default_thinking_models(
    client, monkeypatch, base_url, model, expected
):
    captured = {}

    class FakeProvider:
        async def chat(self, messages, *, thinking=True):
            return "正常"

    def create_probe(config):
        captured.update(build_payload(config, {}, [], False))
        return FakeProvider()

    monkeypatch.setattr("app.api.settings.create_provider", create_probe)
    config = LLMConfig(
        base_url=base_url,
        model=model,
        thinking_enabled=True,
        thinking_style="budget",
        thinking_budget=8192,
        thinking_effort="high",
        extra_body={
            "thinking": {"type": "enabled"},
            "enable_thinking": True,
            "reasoning_effort": "high",
            "top_k": 8,
        },
    )
    response = client.post("/api/settings/llm/test", json=config.model_dump())

    assert response.json()["ok"] is True
    thinking_keys = {"thinking", "enable_thinking", "reasoning_effort"}
    assert {key: captured[key] for key in thinking_keys if key in captured} == expected
    assert captured["max_tokens"] == 64
    assert captured["top_k"] == 8
    assert config.thinking_enabled is True
    assert config.thinking_budget == 8192
