# SPDX-License-Identifier: Apache-2.0
"""T09：Responses 协议的连接测试分支与"已知不支持"提示。

设置页的「测试连接」在 responses 协议下必须走最小请求（input:"hi" +
max_output_tokens:16），并在 Claude / Gemini / 硅基流动 / MiniMax 这些已知不支持
Responses 的服务商上给出「切回 Chat Completions」的出路，而不是裸 404。
"""

import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.responses import ResponsesProvider, responses_unsupported_hint
from app.services.llm.responses_stream import ResponsesStreamParser


def _config(**overrides) -> LLMConfig:
    base = dict(
        api_style="responses",
        base_url="https://api.example.com/v1",
        api_key="k",
        model="m1",
        temperature=0.2,
        max_tokens=2048,
    )
    base.update(overrides)
    return LLMConfig(**base)


def _chat_response() -> bytes:
    data = {
        "model": "m1",
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "正常"}]}],
        "usage": {"input_tokens": 3, "output_tokens": 2},
    }
    return json.dumps(data).encode("utf-8")


@pytest.mark.asyncio
async def test_provider_probe_chat_sends_minimal_input():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_chat_response())

    provider = ResponsesProvider(
        _config(base_url="https://api.deepseek.com"),
        transport=httpx.MockTransport(handler),
    )
    reply = await provider.probe_chat()

    assert reply == "正常"
    # 任务书 §4 T09-7：Responses 用 input:"hi" + max_output_tokens:16。
    assert captured["body"] == {
        "model": "m1",
        "input": "hi",
        "max_output_tokens": 16,
        "stream": False,
    }


def test_unsupported_host_hint_points_back_to_chat_completions():
    for base_url in (
        "https://api.anthropic.com/v1",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "https://api.siliconflow.cn/v1",
    ):
        hint = responses_unsupported_hint(base_url)
        assert hint is not None, base_url
        assert "Responses" in hint and "Chat Completions" in hint
    # 其余服务商不预判：以真实响应为准。
    assert responses_unsupported_hint("https://api.deepseek.com") is None
    # MiniMax 2026-11-08 官方已支持 POST /v1/responses，不再被硬拦截
    # （列在名单里时这里会直接返回失败、根本发不出请求）。
    for base_url in (
        "https://api.minimaxi.com/v1",
        "https://api.minimax.io/v1",
        "https://api.minimax.chat/v1",
    ):
        assert responses_unsupported_hint(base_url) is None, base_url


def test_settings_connection_probe_uses_the_responses_branch(client, monkeypatch):
    """设置页「测试连接」在 responses 协议下走 probe_chat（input:"hi" + 16 tokens）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=_chat_response())

    def fake_create_provider(resolved):
        return ResponsesProvider(resolved, transport=httpx.MockTransport(handler))

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=_config(base_url="https://api.deepseek.com").model_dump(),
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert captured["body"]["input"] == "hi"
    assert captured["body"]["max_output_tokens"] == 16


def test_settings_connection_probe_preflights_known_unsupported_hosts(client):
    response = client.post(
        "/api/settings/llm/test",
        json=_config(base_url="https://api.anthropic.com/v1").model_dump(),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["ok"] is False
    assert "不支持 Responses" in result["message"]
    assert "Chat Completions" in result["message"]


def test_parser_usage_is_none_when_missing():
    """没有 usage 帧就不臆造 token（与既有 provider 的"未知而不是 0"契约一致）。"""
    parser = ResponsesStreamParser()
    parser.feed(json.dumps({"type": "response.completed", "response": {"status": "completed"}}))

    assert parser.finished is True
    assert parser.prompt_tokens is None
    assert parser.completion_tokens is None
    assert parser.cache_hit_tokens is None


def test_settings_connection_probe_accepts_thinking_only_reply(client, monkeypatch):
    """探针预算被思考吃光（正文为空、HTTP 200）时按"连接成功"如实说明，不报失败。

    实测 DeepSeek Responses：16 max_output_tokens 全被 reasoning 用掉。报失败会让用户
    以为配置不可用——实际上配置完全可用，只是探针太短。
    """
    thinking_only = json.dumps(
        {
            "model": "deepseek-flash",
            "status": "incomplete",
            "output": [
                {
                    "type": "reasoning",
                    "content": [{"type": "reasoning_text", "text": "想一下"}],
                }
            ],
            "usage": {"input_tokens": 31, "output_tokens": 16},
        }
    ).encode()

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=thinking_only)

    def fake_create_provider(resolved):
        return ResponsesProvider(resolved, transport=httpx.MockTransport(handler))

    monkeypatch.setattr("app.api.settings.create_provider", fake_create_provider)
    response = client.post(
        "/api/settings/llm/test",
        json=_config(base_url="https://api.deepseek.com").model_dump(),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["ok"] is True
    assert "未返回正文" in result["message"]
    assert result["latency_ms"] is not None
