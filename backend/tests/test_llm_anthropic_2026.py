# SPDX-License-Identifier: Apache-2.0
"""T10：Anthropic 2026-10-21 协议分轨（自适应思考 + effort）的离线守卫。

没有官方 Key 也能验证的部分全部钉在这里：版本头怎么选、新代际请求体长什么样、
老代际与第三方网关是否逐字段保持现状、effort / max_tokens 下限怎么映射。
全部走 httpx.MockTransport 的假服务器；官方 Key 的真机请求本批**未验证**。

反向用例（任务书 §11/§13）：把 anthropic_api_version 的 host 判断故意改坏，
test_version_track_by_host_and_model_generation 必须精确变红（失败信息指向
expected/actual 两轨），复原后复绿；反证日志见证据目录 T10/reverse-proof.txt。
"""

import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.anthropic import (
    AnthropicProvider,
    adaptive_max_tokens_floor,
    is_off_switchless_model,
    map_effort_to_anthropic,
)
from app.services.llm.anthropic_messages import (
    ANTHROPIC_VERSION_2026,
    ANTHROPIC_VERSION_LEGACY,
    anthropic_api_version,
    is_adaptive_thinking_model,
    is_known_legacy_model,
)
from app.services.llm.connection_probe import connection_probe_config

OFFICIAL = "https://api.anthropic.com/v1"
# 第三方 Anthropic 兼容网关（任务书 T10 轨道表点名：MiniMax / GLM / Kimi / 自建）。
GATEWAY = "https://api.minimax.chat/v1"

_MESSAGES = [{"role": "user", "content": "hi"}]


def _config(**overrides) -> LLMConfig:
    base = dict(
        api_style="anthropic",
        base_url=OFFICIAL,
        api_key="sk-ant-test",
        model="claude-sonnet-5-5",
        temperature=0.2,
        max_tokens=2048,
    )
    base.update(overrides)
    return LLMConfig(**base)


def _provider(handler, **overrides) -> AnthropicProvider:
    return AnthropicProvider(_config(**overrides), transport=httpx.MockTransport(handler))


async def _chat_with_capture(provider: AnthropicProvider, *, thinking: bool = True) -> dict:
    """把 provider 的传输层换成会抓包的假服务器，发一次 chat，返回抓到的请求。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})

    provider._transport = httpx.MockTransport(handler)
    await provider.chat(_MESSAGES, thinking=thinking)
    return captured


# ===== 版本分轨判定（纯函数） =====


@pytest.mark.parametrize(
    ("base_url", "model", "expected"),
    [
        # 官方 host + 新代际 → 2026-10-21（任务书 §4 T10 新轨道）。
        (OFFICIAL, "claude-sonnet-5-5", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-opus-5-5", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-opus-4-7", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-opus-4-8", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-haiku-5-5", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-fable-5-1", ANTHROPIC_VERSION_2026),
        (OFFICIAL, "claude-mythos-1", ANTHROPIC_VERSION_2026),
        # 官方老代际 → 2023-06-01（行为保持不变）。
        (OFFICIAL, "claude-sonnet-4-5", ANTHROPIC_VERSION_LEGACY),
        (OFFICIAL, "claude-opus-4-6", ANTHROPIC_VERSION_LEGACY),
        (OFFICIAL, "claude-haiku-4-5", ANTHROPIC_VERSION_LEGACY),
        (OFFICIAL, "claude-3-7-sonnet-20250219", ANTHROPIC_VERSION_LEGACY),
        # 官方 host 上不认识的模型按新代际处理（宁可 adaptive，也不要发已移除的采样参数）。
        (OFFICIAL, "claude-x", ANTHROPIC_VERSION_2026),
        # 第三方 Anthropic 兼容网关：**即使模型名看起来新**也必须走 legacy。
        (GATEWAY, "claude-sonnet-5-5", ANTHROPIC_VERSION_LEGACY),
        (GATEWAY, "claude-sonnet-4-5", ANTHROPIC_VERSION_LEGACY),
        # 仿冒域名不是官方 host（严格相等，不走后缀匹配）。
        (
            "https://api.anthropic.com.evil.example/v1",
            "claude-sonnet-5-5",
            ANTHROPIC_VERSION_LEGACY,
        ),
    ],
)
def test_version_track_by_host_and_model_generation(base_url, model, expected):
    """host + 模型代际一起决定版本头：改坏任一条件这条会精确变红。"""
    config = _config(base_url=base_url, model=model)

    assert anthropic_api_version(config) == expected


@pytest.mark.parametrize(
    ("model", "adaptive", "legacy"),
    [
        ("claude-sonnet-5-5", True, False),
        ("claude-opus-4-7", True, False),
        ("claude-fable-5", True, False),
        ("claude-sonnet-4-5", False, True),
        ("claude-3-5-haiku-20241022", False, True),
        ("gpt-4o", False, False),
        ("", False, False),
    ],
)
def test_model_generation_predicates(model, adaptive, legacy):
    assert is_adaptive_thinking_model(model) is adaptive
    assert is_known_legacy_model(model) is legacy


def test_official_unknown_model_is_treated_as_new_generation():
    """官方 host 上不认识的模型按新代际：不发已被移除的采样参数比发错版本头更安全。"""
    assert anthropic_api_version(_config(model="claude-unreleased-9")) == ANTHROPIC_VERSION_2026


# ===== 新代际：头 + 请求体 =====


@pytest.mark.asyncio
async def test_new_generation_headers_adaptive_thinking_and_no_sampling_params():
    captured = await _chat_with_capture(
        AnthropicProvider(_config(), request_overrides={"reasoning_effort": "high"})
    )

    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_2026
    body = captured["body"]
    # 新协议移除了采样参数：请求体里一个都不许有（发任何一个都 400）。
    for removed in ("temperature", "top_p", "top_k"):
        assert removed not in body, f"新代际不得发送 {removed}"
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "high"}
    # high 档的 max_tokens 下限（避免思考把输出预算吃光）。
    assert body["max_tokens"] >= 16_384


@pytest.mark.asyncio
async def test_new_generation_settings_switch_maps_minimal_to_low():
    captured = await _chat_with_capture(
        _provider(
            lambda _request: httpx.Response(200, json={"content": []}),
            thinking_enabled=True,
            thinking_effort="minimal",
        )
    )

    # minimal 不是 Anthropic 的档位：映射到 low；其余同名直传（任务书 §4 T10-4）。
    assert captured["body"]["output_config"] == {"effort": "low"}
    assert captured["body"]["thinking"] == {"type": "adaptive"}
    assert "temperature" not in captured["body"]


@pytest.mark.asyncio
async def test_new_generation_thinking_off_omits_thinking_entirely():
    """adaptive 是 opt-in：省略 thinking 即不思考，普通模型不追发 disabled。"""
    captured = await _chat_with_capture(_provider(lambda _r: httpx.Response(200, json={})))

    assert "thinking" not in captured["body"]
    assert "output_config" not in captured["body"]
    for removed in ("temperature", "top_p", "top_k"):
        assert removed not in captured["body"]


@pytest.mark.asyncio
async def test_new_generation_structured_output_call_also_omits_thinking():
    """chat(thinking=False) 的结构化输出路径：同样一个字都不发。"""
    captured = await _chat_with_capture(
        _provider(lambda _r: httpx.Response(200, json={})), thinking=False
    )

    assert "thinking" not in captured["body"]
    assert "output_config" not in captured["body"]


@pytest.mark.asyncio
async def test_no_off_switch_models_lower_effort_instead_of_disabled():
    """Opus 5.5 / Fable 5.x 没有关闭开关：用户选「不思考」只降 effort 到 low。"""
    for model in ("claude-opus-5-5", "claude-fable-5-1"):
        captured = await _chat_with_capture(
            _provider(lambda _r: httpx.Response(200, json={}), model=model), thinking=False
        )

        assert captured["body"]["thinking"] == {"type": "adaptive"}
        assert captured["body"]["output_config"] == {"effort": "low"}


@pytest.mark.asyncio
async def test_new_generation_stream_uses_the_same_version_header():
    events = [
        {"type": "message_start", "message": {"usage": {"input_tokens": 3}}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "好"}},
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {"output_tokens": 1},
        },
    ]
    sse = "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})

    provider = _provider(handler)
    texts = [delta.text async for delta in provider.stream_chat_events(_MESSAGES)]
    assert "".join(texts) == "好"
    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_2026
    assert captured["body"]["stream"] is True
    assert "temperature" not in captured["body"]


# ===== effort / max_tokens 映射 =====


@pytest.mark.parametrize(
    ("effort", "expected"),
    [
        ("minimal", "low"),
        ("low", "low"),
        ("medium", "medium"),
        ("high", "high"),
        # 用户自己填的档位原样直传（UI 不新增这两档，但后端不拦）。
        ("xhigh", "xhigh"),
        ("max", "max"),
        ("  HIGH  ", "high"),
        # 认不得的词按 low：宁可想得浅一点，也不要发服务端不认识的档位吃 400。
        ("banana", "low"),
        ("", "low"),
    ],
)
def test_effort_mapping(effort, expected):
    assert map_effort_to_anthropic(effort) == expected


@pytest.mark.parametrize(
    ("effort", "floor"),
    [("low", 0), ("medium", 0), ("high", 16_384), ("xhigh", 65_536), ("max", 65_536)],
)
def test_adaptive_max_tokens_floors(effort, floor):
    assert adaptive_max_tokens_floor(effort) == floor


@pytest.mark.asyncio
async def test_high_effort_raises_max_tokens_floor_but_low_keeps_config_value():
    high = await _chat_with_capture(
        AnthropicProvider(_config(max_tokens=4_096), request_overrides={"reasoning_effort": "high"})
    )
    low = await _chat_with_capture(
        AnthropicProvider(_config(max_tokens=4_096), request_overrides={"reasoning_effort": "low"})
    )

    assert high["body"]["max_tokens"] == 16_384
    assert low["body"]["max_tokens"] == 4_096


def test_off_switchless_model_pattern_is_narrow():
    assert is_off_switchless_model("claude-opus-5-5") is True
    assert is_off_switchless_model("claude-fable-5-3") is True
    assert is_off_switchless_model("claude-sonnet-5-5") is False
    assert is_off_switchless_model("claude-opus-4-7") is False


# ===== 老代际：逐字段保持现状 =====


@pytest.mark.asyncio
async def test_legacy_generation_body_is_unchanged_when_thinking_is_off():
    """老模型默认路径与改动前逐字段一致（快照比对）。"""
    captured = await _chat_with_capture(
        _provider(lambda _r: httpx.Response(200, json={}), model="claude-sonnet-4-5")
    )

    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_LEGACY
    assert captured["body"] == {
        "model": "claude-sonnet-4-5",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
        "stream": False,
        "temperature": 0.2,
    }


@pytest.mark.asyncio
async def test_legacy_generation_keeps_budget_thinking_and_temperature():
    """老模型开思考：仍是 enabled + budget_tokens + temperature=1（现状）。"""
    captured = await _chat_with_capture(
        AnthropicProvider(
            _config(model="claude-sonnet-4-5"), request_overrides={"reasoning_effort": "high"}
        )
    )

    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_LEGACY
    body = captured["body"]
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 16_384}
    assert body["temperature"] == 1.0
    assert body["max_tokens"] > 16_384
    assert "output_config" not in body


@pytest.mark.asyncio
async def test_third_party_gateway_never_gets_the_new_version_header():
    """第三方 Anthropic 兼容网关即使模型名看起来新，也必须走 legacy（现状）。"""
    captured = await _chat_with_capture(
        AnthropicProvider(
            _config(base_url=GATEWAY, model="claude-sonnet-5-5"),
            request_overrides={"reasoning_effort": "high"},
        )
    )

    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_LEGACY
    assert captured["body"]["thinking"] == {"type": "enabled", "budget_tokens": 16_384}
    assert captured["body"]["temperature"] == 1.0
    assert "output_config" not in captured["body"]


# ===== 连接测试不会自打 400 =====


@pytest.mark.asyncio
async def test_connection_probe_on_new_generation_sends_no_thinking_or_sampling_params():
    """「测试连接」的剥思考配置在新代际下不产生任何会被拒的字段。"""
    probe = connection_probe_config(
        _config(thinking_enabled=True, thinking_effort="high", thinking_budget=8192)
    )
    captured = await _chat_with_capture(AnthropicProvider(probe))

    assert captured["headers"]["anthropic-version"] == ANTHROPIC_VERSION_2026
    assert captured["body"]["max_tokens"] == 64
    assert "thinking" not in captured["body"]
    assert "output_config" not in captured["body"]
    assert "temperature" not in captured["body"]


# ===== 400 文案：新老两条口径都能区分「参数不被支持」与普通 400 =====


@pytest.mark.asyncio
async def test_new_generation_400_message_points_at_effort_not_legacy_budget():
    provider = _provider(lambda _r: httpx.Response(400, json={"error": {"message": "bad"}}))

    with pytest.raises(Exception) as excinfo:
        await provider.chat(_MESSAGES)

    message = str(excinfo.value)
    assert "effort" in message
    assert "参数不被支持" in message
    assert "模型名称" in message
    # 老文案里的「思考预算」已经不存在于新协议，不能再把用户支去调它。
    assert "思考预算" not in message


@pytest.mark.asyncio
async def test_legacy_400_message_is_unchanged():
    provider = _provider(
        lambda _r: httpx.Response(400, json={"error": {"message": "bad"}}),
        model="claude-sonnet-4-5",
    )

    with pytest.raises(Exception) as excinfo:
        await provider.chat(_MESSAGES)

    message = str(excinfo.value)
    assert "检查模型名称" in message
    assert "思考预算" in message
