"""思考模式：能力表、请求体片段、以及"实测探测"的判定。

上游没有统一标准（OpenAI 系是 ``reasoning_effort``、Claude 原生是 thinking 预算、智谱是
``thinking`` 对象、通义是 ``enable_thinking``），所以这里守两件事：

1. **形态翻译对了**——配置里存的是"意图"（开关 + 档位 + 形态），请求体里必须是各家认的
   那个写法；
2. **默认路径一个字都不加**——关着的时候请求体要与加这个功能之前完全一致，
   否则升级会把所有用户一起推到 400 上。
"""
import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm import base as llm_base
from app.services.llm.base import LLMDelta, LLMError
from app.services.llm.thinking import (
    DEFAULT_EFFORT,
    EFFORT_BUDGETS,
    normalize_effort,
    probe_thinking,
    resolve_style,
    thinking_budget,
    thinking_payload,
    thinking_support,
    wants_thinking,
)


def _config(**overrides) -> LLMConfig:
    base = {
        "base_url": "https://api.example.com/v1",
        "model": "some-model",
        "api_key": "secret",
    }
    base.update(overrides)
    return LLMConfig(**base)


# ===== 形态解析 =====


@pytest.mark.parametrize(
    ("api_style", "expected"),
    [("openai", "reasoning_effort"), ("anthropic", "budget")],
)
def test_auto_style_follows_the_protocol(api_style, expected):
    assert resolve_style(_config(api_style=api_style)) == expected


def test_an_explicit_style_beats_the_protocol_default():
    """用户可以手工指定形态（走中转站、自建网关时表猜不对）。"""
    config = _config(api_style="anthropic", thinking_style="thinking_object")

    assert resolve_style(config) == "thinking_object"
    enabled = config.model_copy(update={"thinking_enabled": True})
    assert thinking_payload(enabled) == {"thinking": {"type": "enabled"}}


def test_an_unknown_style_is_rejected_at_the_schema():
    """形态决定请求体长什么样，拼错不是"没效果"而是每次都 400，所以在入口就挡住。"""
    with pytest.raises(ValueError):
        LLMConfig(base_url="https://api.example.com/v1", thinking_style="banana")


# ===== 能力表（只影响设置页的选项与提示） =====


@pytest.mark.parametrize(
    ("base_url", "model", "style", "supported"),
    [
        ("https://api.openai.com/v1", "gpt-5.1", "reasoning_effort", True),
        ("https://api.openai.com/v1", "gpt-5.2", "reasoning_effort", True),
        ("https://api.openai.com/v1", "o3-mini", "reasoning_effort", True),
        ("https://api.openai.com/v1", "gpt-4o-mini", "reasoning_effort", False),
        ("https://open.bigmodel.cn/api/paas/v4", "glm-4.6", "thinking_object", True),
        ("https://open.bigmodel.cn/api/paas/v4", "glm-5.3", "thinking_object", True),
        ("https://open.bigmodel.cn/api/paas/v4", "glm-4-plus", "reasoning_effort", True),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3-max", "enable_thinking", True),
        # 预设里用的就是这个别名：钉版本号的正则会让它掉进"未收录"，而它的思考默认是开的。
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "enable_thinking", True),
        ("https://api.deepseek.com", "deepseek-v4-flash", "thinking_object", True),
        ("https://api.deepseek.com", "deepseek-v4-pro", "thinking_object", True),
        ("https://api.minimax.chat/v1", "MiniMax-M3", "thinking_object", True),
        ("https://api.moonshot.cn/v1", "kimi-k3", "thinking_object", False),
        ("https://api.moonshot.cn/v1", "kimi-k2.6", "reasoning_effort", True),
        ("https://openrouter.ai/api/v1", "openai/gpt-5", "reasoning_effort", True),
    ],
)
def test_the_vendor_table_picks_the_right_style(base_url, model, style, supported):
    support = thinking_support(_config(base_url=base_url, model=model))

    assert support.style == style, support
    assert support.supported is supported, support
    assert support.note, "每条判断都要有一句给人看的解释"


def test_the_openai_efforts_follow_the_generation():
    """GPT-5 各代的档位词汇不同，照旧写死会在新模型上直接 400。"""
    new_gen = thinking_support(_config(base_url="https://api.openai.com/v1", model="gpt-5.2"))
    old_gen = thinking_support(_config(base_url="https://api.openai.com/v1", model="gpt-5.1"))
    o_series = thinking_support(_config(base_url="https://api.openai.com/v1", model="o3-mini"))

    assert "xhigh" in new_gen.efforts and "none" in new_gen.efforts
    assert "minimal" in old_gen.efforts and "xhigh" not in old_gen.efforts
    assert o_series.efforts == ("low", "medium", "high")


def test_kimi_k3_says_thinking_cannot_be_turned_off():
    support = thinking_support(_config(base_url="https://api.moonshot.cn/v1", model="kimi-k3"))

    assert support.supported is False
    assert "常开" in support.note


@pytest.mark.parametrize(
    ("base_url", "model", "expected"),
    [
        # 不指定就思考的模型：省略等于开着，所以"关闭"必须显式发出去。
        ("https://api.deepseek.com", "deepseek-v4-flash", {"thinking": {"type": "disabled"}}),
        (
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "qwen3-max",
            {"enable_thinking": False},
        ),
    ],
)
def test_models_that_think_by_default_get_an_explicit_disable(base_url, model, expected):
    """**默认就思考的模型**：界面写着"关闭"、请求里却什么都没有，等于骗人。"""
    config = _config(base_url=base_url, model=model)

    assert thinking_payload(config) == expected


def test_switching_on_a_default_thinking_model_sends_the_enable_shape():
    config = _config(base_url="https://api.deepseek.com", model="deepseek-v4-flash")
    config = config.model_copy(update={"thinking_enabled": True})

    assert thinking_payload(config) == {"thinking": {"type": "enabled"}}


def test_a_stripped_config_leaves_even_a_default_thinking_model_alone():
    """助手拿到的配置是剥过的：那里**不许**顺手替它关思考。

    否则 DeepSeek、Qwen 这类"默认思考"的模型上，助手会因为你没在设置页开开关而失去思考
    ——而助手本来就只认自己那个单次请求级强度。
    """
    stripped = _config(
        base_url="https://api.deepseek.com", model="deepseek-v4-flash", thinking_enabled=True
    ).without_thinking()

    assert thinking_payload(stripped) == {}
    assert wants_thinking(stripped) is False


def test_the_openai_reasoning_models_offer_all_four_efforts():
    support = thinking_support(_config(base_url="https://api.openai.com/v1", model="gpt-5.1"))

    assert support.efforts == ("minimal", "low", "medium", "high")


def test_a_model_without_levels_offers_no_effort_options():
    """智谱/通义这类只有开关没有档位——界面据此把强度下拉收起来。"""
    support = thinking_support(
        _config(base_url="https://open.bigmodel.cn/api/paas/v4", model="glm-4.6")
    )

    assert support.efforts == ()


def test_an_unlisted_vendor_says_so_instead_of_guessing_silently():
    support = thinking_support(_config(base_url="https://api.moonshot.cn/v1", model="kimi-k2"))

    assert support.supported is True
    assert "没有收录" in support.note and "检测" in support.note


def test_an_explicit_style_also_reports_the_vendor_note():
    """手工指定形态时"支不支持"由用户负责，但表里的那句话仍要给他看。"""
    support = thinking_support(
        _config(
            base_url="https://api.deepseek.com",
            model="deepseek-v4-flash",
            thinking_style="thinking_object",
        )
    )

    assert support.style == "thinking_object"
    assert support.supported is True
    assert "DeepSeek" in support.note


# ===== 档位归一化 =====


def test_a_custom_effort_is_kept_and_only_normalized():
    """档位**不再按候选表过滤**：界面允许自定义（`xhigh`/`max`/`adaptive` 这类自创词）。

    "换了模型后残留的档位"和"用户自己填的词"在字符串上无法区分，所以用一个白名单去滤
    必然把自定义值一起吃掉。真发不出去时由上游 400 → 去掉思考参数重试一次兜底。
    """
    assert normalize_effort(_config(thinking_effort="  xhigh  ")) == "xhigh"
    assert normalize_effort(_config(thinking_effort="Minimal")) == "minimal"
    assert normalize_effort(_config(thinking_effort="")) == ""
    # 候选表里没有、服务商也未必认识的值照样保留——它可能就是用户端点支持的那个词。
    assert normalize_effort(_config(base_url="https://api.moonshot.cn/v1", thinking_effort="high")) == "high"


def test_a_numeric_custom_effort_becomes_the_budget():
    """自定义值填数字＝思考预算 tokens（原生协议要的正是这个数）。"""
    config = _config(api_style="anthropic", thinking_enabled=True, thinking_effort="4096")

    assert thinking_budget(config) == 4096
    assert thinking_payload(
        config.model_copy(update={"thinking_style": "budget"})
    ) == {"thinking": {"type": "enabled", "budget_tokens": 4096}}


def test_an_unknown_word_falls_back_to_the_default_depth():
    """认不得的词按**默认档**处理——静默变成"不思考"是最坏的结果。"""
    config = _config(api_style="anthropic", thinking_enabled=True, thinking_effort="xhigh")

    assert thinking_budget(config) == EFFORT_BUDGETS[DEFAULT_EFFORT]


# ===== 请求体片段 =====


def test_thinking_off_adds_nothing_at_all():
    """**兼容红线**：默认（关闭）时请求体里一个字都不能加。"""
    config = _config()

    assert thinking_payload(config) == {}
    assert thinking_budget(config) == 0
    assert wants_thinking(config) is False


def test_reasoning_effort_style_sends_the_effort():
    config = _config(
        base_url="https://api.openai.com/v1",
        model="gpt-5.1",
        thinking_enabled=True,
        thinking_effort="low",
    )

    assert thinking_payload(config) == {"reasoning_effort": "low"}


def test_reasoning_effort_style_without_an_effort_uses_the_default():
    """"开启了但没选档位"在 effort 形态下只能靠发一个档位表达。"""
    config = _config(
        base_url="https://api.openai.com/v1", model="gpt-5.1", thinking_enabled=True
    )

    assert thinking_payload(config) == {"reasoning_effort": DEFAULT_EFFORT}


def test_thinking_object_and_enable_thinking_styles():
    bigmodel = _config(
        base_url="https://open.bigmodel.cn/api/paas/v4", model="glm-4.6", thinking_enabled=True
    )
    qwen = _config(
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="qwen3-max",
        thinking_enabled=True,
    )

    assert thinking_payload(bigmodel) == {"thinking": {"type": "enabled"}}
    assert thinking_payload(qwen) == {"enable_thinking": True}


def test_the_budget_style_sends_a_budget_like_the_legacy_field_does():
    """显式选了预算形态时，写法与老的「思考预算」字段一致（Claude 系网关的方言）。"""
    config = _config(thinking_enabled=True, thinking_effort="high", thinking_style="budget")

    assert thinking_payload(config) == {
        "thinking": {"type": "enabled", "budget_tokens": EFFORT_BUDGETS["high"]}
    }


def test_the_native_protocol_maps_the_effort_to_a_budget():
    config = _config(api_style="anthropic", thinking_enabled=True, thinking_effort="low")

    assert thinking_budget(config) == EFFORT_BUDGETS["low"]
    assert thinking_budget(config.model_copy(update={"thinking_effort": ""})) == EFFORT_BUDGETS[
        DEFAULT_EFFORT
    ]


# ===== 实测探测 =====


class _FakeProvider:
    """按脚本产出流式帧；`error` 非空时改为抛错。"""

    def __init__(self, *, reasoning: str = "", text: str = "好", error: LLMError | None = None):
        self._reasoning = reasoning
        self._text = text
        self._error = error

    async def stream_chat_events(self, messages, tools=None):
        if self._error is not None:
            raise self._error
        if self._reasoning:
            yield LLMDelta(text="", reasoning=self._reasoning)
        if self._text:
            yield LLMDelta(text=self._text)


def _patch_provider(monkeypatch, provider) -> dict:
    seen: dict = {}

    def _factory(config, **kwargs):
        seen["config"] = config
        return provider

    monkeypatch.setattr("app.services.llm.create_provider", _factory)
    return seen


async def test_probe_reports_when_thinking_really_happened(monkeypatch):
    seen = _patch_provider(monkeypatch, _FakeProvider(reasoning="让我想想……"))

    result = await probe_thinking(_config())

    assert result.accepted is True and result.reasoning_seen is True
    assert "生效" in result.message
    # 探测必须**强制打开**开关：配置里通常还关着，否则探测永远测不出东西。
    assert seen["config"].thinking_enabled is True


async def test_probe_reports_silent_ignoring(monkeypatch):
    """服务商对不认识的参数常常是静默忽略的——这时要看得出"接受了但没效果"。"""
    _patch_provider(monkeypatch, _FakeProvider(text="好"))

    result = await probe_thinking(_config())

    assert result.accepted is True and result.reasoning_seen is False
    assert "没有产出思考内容" in result.message


async def test_probe_reports_a_rejection(monkeypatch):
    _patch_provider(monkeypatch, _FakeProvider(error=LLMError("请求格式错误（HTTP 400）")))

    result = await probe_thinking(_config())

    assert result.accepted is False
    assert "拒绝了" in result.message and "形态" in result.message


async def test_probe_reports_other_failures_as_themselves(monkeypatch):
    """超时/连不上不是"不支持思考"，别把它说成参数问题。"""
    _patch_provider(monkeypatch, _FakeProvider(error=LLMError("模型响应超时，请稍后重试")))

    result = await probe_thinking(_config())

    assert result.accepted is False
    assert "没能完成" in result.message and "超时" in result.message


async def test_probe_reports_an_error_raised_before_the_first_frame(monkeypatch):
    """地址非法之类的错误在**第一帧之前**就抛（构造 provider 时），也要如实回报。"""

    def _factory(*_args, **_kwargs):
        raise LLMError("请先填写有效的 Base URL")

    monkeypatch.setattr("app.services.llm.create_provider", _factory)

    result = await probe_thinking(_config())

    assert result.accepted is False
    assert "没能完成" in result.message and "Base URL" in result.message


async def test_probe_uses_the_cheapest_effort(monkeypatch):
    """探测要花钱，所以挑最便宜的那一档。"""
    seen = _patch_provider(monkeypatch, _FakeProvider(text="好"))

    await probe_thinking(_config(base_url="https://api.openai.com/v1", model="gpt-5.1"))

    assert seen["config"].thinking_effort == "minimal"


async def test_probe_goes_through_the_real_provider_factory(monkeypatch):
    """探测走的是真实请求路径（同一套 provider 与 payload），不是另写一条捷径。"""
    # 不 patch 工厂，改用 MockTransport 断言真实请求体。
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        payload = 'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=payload, headers={"content-type": "text/event-stream"})

    import app.services.llm as llm_package

    original = llm_package.create_provider

    def _factory(config, **kwargs):
        from app.services.llm.openai_compat import OpenAICompatProvider

        return OpenAICompatProvider(config, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(llm_package, "create_provider", _factory)
    try:
        result = await probe_thinking(
            _config(base_url="https://api.openai.com/v1", model="gpt-5.1")
        )
    finally:
        monkeypatch.setattr(llm_package, "create_provider", original)

    assert result.reasoning_seen is True
    assert bodies and bodies[0]["reasoning_effort"] == "minimal"


def test_probe_delta_shape_is_what_the_providers_produce():
    """探测依赖 ``LLMDelta.reasoning``；这条钉住字段本身还在（防止被改名）。"""
    assert hasattr(llm_base.LLMDelta, "__dataclass_fields__")
    assert "reasoning" in llm_base.LLMDelta.__dataclass_fields__
