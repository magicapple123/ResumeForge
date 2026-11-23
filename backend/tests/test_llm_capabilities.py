# SPDX-License-Identifier: Apache-2.0
"""Provider capability 声明（RF-14 §2.3）与默认请求体快照守卫。

钉住的性质：
- 能力表与 thinking_support 权威一致（reasoning 委托，对拍测试）；
- capability 只做声明与查询：resolve 不改变任何请求构造；
- **默认配置下 _build_payload 的输出与改动前逐字节一致**（stream_options /
  response_format 等新字段一律由默认关闭的配置守门）。
"""

import json

import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.anthropic import AnthropicProvider
from app.services.llm.capabilities import resolve_capabilities
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.thinking import thinking_support


def _config(base_url: str, model: str) -> LLMConfig:
    return LLMConfig(base_url=base_url, api_key="k", model=model)


# ===== 表格驱动的 resolve 用例 =====


@pytest.mark.parametrize(
    ("base_url", "model", "vision"),
    [
        # DeepSeek 2026-11-23 官方模型表：Flash（V4.1-Flash）支持图像理解，V4 Pro 仅文本；
        # 旧名 v4-flash / v4-flash-vision-exp 由 Flash 承接，同样按支持图像处理。
        ("https://api.deepseek.com/v1", "deepseek-flash", True),
        ("https://api.deepseek.com/v1", "deepseek-v4-flash", True),
        ("https://api.deepseek.com/v1", "deepseek-v4-flash-vision-exp", True),
        ("https://api.deepseek.com/v1", "deepseek-v4-pro", False),
        ("https://api.deepseek.com/v1", "deepseek-chat", False),
        ("https://api.moonshot.cn/v1", "kimi-k3", False),
        ("https://api.moonshot.cn/v1", "kimi-k3.1-pro", True),
        ("https://open.bigmodel.cn/api/paas/v4", "glm-5", False),
        # 官方《文本生成与视觉理解》：Plus / Max / Flash 同一个模型即可接收文本、图像与视频。
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", True),
        # F18 起 vision 按 host + 型号声明：支持图像输入的型号为 True。
        ("https://api.openai.com/v1", "gpt-5.2", True),
        ("https://api.openai.com/v1", "gpt-6.2-astra", True),
        ("https://openrouter.ai/api/v1", "some/model", True),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-vl-max", True),
        # 2026-11-23 补齐的当前预设型号：官方模型表/模型卡都标了图像输入。
        ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-4-hydrogen", True),
        ("https://api.minimax.io/v1", "MiniMax-M3.1-Flash", True),
        ("https://ark.cn-beijing.volces.com/api/v3", "doubao-seed-2-1-pro-260915", True),
        ("https://tokenhub.tencentmaas.com/v1", "hy4", True),
        ("https://tokenhub.tencentmaas.com/v1", "hy3", False),
        ("https://api.stepfun.com/v1", "step-5-preview", True),
        ("https://api.mistral.ai/v1", "mistral-large-4", True),
        ("https://api.x.ai/v1", "grok-4.7", True),
        ("https://qianfan.baidubce.com/v2", "ernie-5.1", True),
        # 混合推理的文本模型不能被上面几条顺手带成 vision。
        ("https://api.mistral.ai/v1", "mistral-small-4", False),
        ("https://api.x.ai/v1", "grok-4.3", False),
        ("http://localhost:11434/v1", "llama3", False),
        # 预设默认的本地模型：Qwen3.5 开源权重带视觉，其余本机型号仍按文本处理。
        ("http://localhost:11434/v1", "qwen3.5:9b", True),
        ("http://localhost:1234/v1", "qwen/qwen3.5-9b", True),
        ("https://unknown.gateway.example/v1", "whatever", False),
    ],
)
def test_resolve_is_pure_declaration_and_matches_thinking_authority(base_url, model, vision):
    config = _config(base_url, model)
    capabilities = resolve_capabilities(config)

    # 现状口径（§2.3 表格）：stream 恒 True；structured_output 默认 False；
    # tools unknown 默认 True——不因 (host, model) 不同而漂移。
    assert capabilities.stream is True
    assert capabilities.structured_output is False
    assert capabilities.vision is vision
    assert capabilities.tools is True

    # reasoning 委托 thinking_support 现有权威实现：对拍一致（不另立第二张思考表）。
    assert capabilities.reasoning == thinking_support(config).supported


def test_resolve_deepseek_reasoning_matches_authority():
    config = _config("https://api.deepseek.com/v1", "deepseek-flash")
    assert resolve_capabilities(config).reasoning is True
    assert thinking_support(config).supported is True


def test_resolve_gpt4_reasoning_matches_authority():
    config = _config("https://api.openai.com/v1", "gpt-4o")
    assert resolve_capabilities(config).reasoning is False
    assert thinking_support(config).supported is False


def test_resolve_never_touches_request_construction():
    """查询接口存在且不改变请求构造：resolve 前后 payload 逐字节一致。"""
    config = _config("https://api.deepseek.com/v1", "deepseek-v4-flash")
    provider = OpenAICompatProvider(config)
    messages = [{"role": "user", "content": "hi"}]
    before = json.dumps(provider._build_payload(messages, stream=True), ensure_ascii=False)
    resolve_capabilities(config)
    after = json.dumps(provider._build_payload(messages, stream=True), ensure_ascii=False)
    assert before == after


# ===== 默认请求体快照守卫（RF-14 §4-2 的建议条款）=====


def test_openai_default_payload_is_byte_identical():
    """默认配置下请求体与改动前逐字节一致：一个多余的字节都不允许出现。"""
    config = _config("https://api.example.com/v1", "m1")
    provider = OpenAICompatProvider(config)
    messages = [{"role": "user", "content": "hi"}]

    assert provider._build_payload(messages, stream=True) == {
        "model": "m1",
        "messages": messages,
        "temperature": 0.1,
        "stream": True,
    }
    # 快照的序列化形态也钉住（键序即插入序，防止"内容相同但字节不同"的漂移）。
    assert json.dumps(provider._build_payload(messages, stream=True)) == json.dumps(
        {"model": "m1", "messages": messages, "temperature": 0.1, "stream": True}
    )
    assert provider._build_payload(messages, stream=False) == {
        "model": "m1",
        "messages": messages,
        "temperature": 0.1,
        "stream": False,
    }


def test_openai_stream_options_is_gated_by_default_off_config(monkeypatch):
    """stream_options.include_usage 只有配置显式开启才发送（默认关闭 → 不在请求体里）。"""
    from app.services.llm import payload as payload_rules

    config = _config("https://api.example.com/v1", "m1")
    provider = OpenAICompatProvider(config)
    messages = [{"role": "user", "content": "hi"}]

    class _Off:
        llm_stream_include_usage = False

    class _On:
        llm_stream_include_usage = True

    # stream_options 守门随请求体构造下沉到了 payload 模块（锚点同步迁移）。
    monkeypatch.setattr(payload_rules, "get_settings", lambda: _Off())
    assert "stream_options" not in provider._build_payload(messages, stream=True)

    monkeypatch.setattr(payload_rules, "get_settings", lambda: _On())
    payload = provider._build_payload(messages, stream=True)
    assert payload["stream_options"] == {"include_usage": True}
    # 非流式请求永远不带这个字段。
    assert "stream_options" not in provider._build_payload(messages, stream=False)


def test_anthropic_default_payload_has_no_new_fields():
    """Anthropic 原生协议的默认 payload 同样不接受任何新增字段。

    模型名必须写成**已知老代际**（claude-sonnet-4-5）：官方 host 上未知模型自 T10 起
    按新代际处理（2026-10-21，不发 temperature），那条轨道另有专门用例。
    """
    config = _config("https://api.anthropic.com", "claude-sonnet-4-5").model_copy(
        update={"api_style": "anthropic"}
    )
    provider = AnthropicProvider(config)
    payload = provider._build_payload([{"role": "user", "content": "hi"}], stream=True)
    assert set(payload) == {
        "model",
        "max_tokens",
        "messages",
        "stream",
        "temperature",
    }
