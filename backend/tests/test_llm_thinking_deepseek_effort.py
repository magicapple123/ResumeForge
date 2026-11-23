# SPDX-License-Identifier: Apache-2.0
"""DeepSeek 的思考强度（T9-b）：thinking 对象**之外**还要发顶层 ``reasoning_effort``。

从 ``test_llm_thinking.py`` 拆出来的（那个文件顶到了 500 行预算）。这里只放"档位"这一件
事，因为它的失败形态和其它思考用例不同：不是"参数写错导致 400"，而是**设置页把选项放出来
了、请求体里却没有这个字段**——用户选了 max，实际跑的还是默认档，界面上看不出任何异常。

三条断言口径：

1. 规则表给出 low/high/max 三档，默认 high（设置页的档位选项就来自 ``support.efforts``）；
2. 用户选了什么，**请求体**里就得有什么——断言发出去的 JSON，不是 ``thinking_payload`` 的
   返回值。内部函数对了但没进请求体，正是这个缺陷的原始形态；
3. 官方字段表里没有 effort 的 thinking 对象厂商（智谱/豆包…）一个字都不能多发。

官方依据（2026-11-23 复核，摘录见 ``progress/T9.md`` 的「T9-b 协议结论」）：
https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
Chat Completions 用 ``{"thinking": {"type": "enabled/disabled"}}`` 开关思考，强度另有顶层
``{"reasoning_effort": "low/high/max"}``；「思考模式默认打开，且 effort 默认为 high」。
所以它的形态仍是 thinking 对象（关闭写的是 thinking 对象，不是 ``effort: none``），开启时
两个字段同时发。
"""

import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.thinking import thinking_payload, thinking_support


def _config(**overrides) -> LLMConfig:
    """本文件默认就是 DeepSeek 官方端点；要测别家时显式覆盖 base_url。"""
    base = {
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-flash",
        "api_key": "secret",
    }
    base.update(overrides)
    return LLMConfig(**base)


# ===== 规则表 → 设置页的选项 =====


@pytest.mark.parametrize("effort", ["low", "high", "max"])
def test_deepseek_offers_the_three_official_efforts(effort):
    """设置页的档位选项来自规则表的 ``efforts``：DeepSeek 必须是 low/high/max。"""
    support = thinking_support(_config())

    assert support.efforts == ("low", "high", "max")
    assert effort in support.efforts
    # 形态仍是 thinking 对象：DeepSeek 关思考发的是 thinking:{type:disabled}，不是 effort:none。
    assert support.style == "thinking_object"


@pytest.mark.parametrize("model", ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"])
def test_every_deepseek_model_in_the_presets_gets_the_three_efforts(model):
    """预设里的每个 DeepSeek 型号都得有档位：规则按主机命中、不限型号。"""
    assert thinking_support(_config(model=model)).efforts == ("low", "high", "max")


def test_switching_on_a_default_thinking_model_sends_the_enable_shape():
    """DeepSeek = thinking 对象 + 顶层 reasoning_effort **同时发**（T9-b）。

    两件事都必须出现在请求体里：只发开关不发档位，等于设置页的档位选择器骗人。
    """
    config = _config(model="deepseek-v4-flash", thinking_enabled=True)

    assert thinking_payload(config) == {
        "thinking": {"type": "enabled"},
        # 没选档位时显式发官方默认值 high（而不是省略）。
        "reasoning_effort": "high",
    }


@pytest.mark.parametrize("effort", ["low", "high", "max"])
def test_every_offered_effort_is_exactly_what_gets_sent(effort):
    """选项与请求体同源：给用户看的每一档，都必须原样出现在 ``thinking_payload`` 里。"""
    assert thinking_payload(_config(thinking_enabled=True, thinking_effort=effort)) == {
        "thinking": {"type": "enabled"},
        "reasoning_effort": effort,
    }


def test_a_thinking_object_vendor_without_efforts_sends_no_reasoning_effort():
    """只有开关、官方字段表里没有 effort 的厂商（智谱/豆包…）不能多发一个参数。

    多发一个它不认识的顶层字段，换来的是一次 400——比"没有档位可选"更糟。
    """
    config = _config(
        base_url="https://open.bigmodel.cn/api/paas/v4",
        model="glm-4.6",
        thinking_enabled=True,
        thinking_effort="max",
    )

    assert thinking_payload(config) == {"thinking": {"type": "enabled"}}


def test_none_effort_is_a_toggle_not_a_level():
    """``none`` 是"关闭"的意思，由 thinking 对象表达；不要再当成档位发一次。"""
    config = _config(thinking_enabled=True, thinking_effort="none")

    assert thinking_payload(config) == {"thinking": {"type": "enabled"}}


# ===== 真的进了请求体（T9-b 的核心） =====


async def _captured_chat_body(config: LLMConfig) -> dict:
    """走真实 provider 路径抓 Chat Completions 请求体（不打网络，用 MockTransport）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "好"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            },
        )

    provider = OpenAICompatProvider(config, transport=httpx.MockTransport(handler))
    await provider.chat([{"role": "user", "content": "hi"}], thinking=True)
    return captured["body"]


@pytest.mark.asyncio
async def test_choosing_max_really_puts_reasoning_effort_in_the_request_body():
    """T9-b 的核心断言：设置页选 max → **请求体**里带 ``reasoning_effort="max"``。

    断言的是发出去的 JSON，不是 ``thinking_payload`` 的返回值：内部函数对了但没进请求体，
    正是"只把选项放出来却不发参数"这个缺陷的原始形态。
    """
    body = await _captured_chat_body(_config(thinking_enabled=True, thinking_effort="max"))

    assert body["reasoning_effort"] == "max"
    assert body["thinking"] == {"type": "enabled"}


@pytest.mark.asyncio
async def test_not_choosing_an_effort_sends_the_official_default_high():
    """不选档位时按官方默认 high 发（文档原文：「effort 默认为 high」）。"""
    body = await _captured_chat_body(_config(thinking_enabled=True))

    assert body["reasoning_effort"] == "high"


@pytest.mark.asyncio
async def test_a_thinking_object_vendor_without_efforts_sends_no_field_in_the_body():
    """反面对照：智谱的请求体里**没有** ``reasoning_effort`` 这个键（多发即 400）。"""
    body = await _captured_chat_body(
        _config(
            base_url="https://open.bigmodel.cn/api/paas/v4",
            model="glm-4.6",
            thinking_enabled=True,
            thinking_effort="max",
        )
    )

    assert "reasoning_effort" not in body
    assert body["thinking"] == {"type": "enabled"}
