# SPDX-License-Identifier: Apache-2.0
"""思考参数：Responses 链路的关闭形态 + 逐家白名单（清单 §10 / §11）。

两部分：

1. **第 10 条**：Responses 端点关闭思考的唯一写法是 ``reasoning: {"effort": "none"}``
   （本机实测 reasoning_tokens=0）。旧实现把 "none" 映射成空串，恰好把唯一关闭手段吞掉，
   于是一次生成先烧掉 28.5k 输出 tokens、再花 64s 重来一轮。这里用 MockTransport 钉住
   **真实请求体**，不测内部函数返回值——内部函数对了但请求体没发出去，正是这个 bug 的
   原始形态（清单 §10.2/§10.3）。
2. **第 11 条**：规则表按「主机 + 型号白名单」逐家断言关闭形态；命中「不可关闭型号」时
   **一个字都不发**（发 none/disabled 会被上游 400，比"假装关掉"更糟）。同时做两个
   跨语言守卫：读前端的 ``config.ts`` 与 ``llmProtocol`` 语言包，保证前端新增预设 /
   矩阵文案与后端表同步——这是"新增一家必须同时补这行"的机械检查。
"""

import json
import re
from pathlib import Path

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.responses import ResponsesProvider
from app.services.llm.thinking import (
    can_disable_thinking,
    disable_thinking_payload,
    responses_off_effort,
    thinking_payload,
    thinking_support,
    wants_thinking,
)
from app.services.llm.thinking_vendor_table import match_rule
from app.services.llm.thinking_vendors import FORCED_THINKING_MODELS

REPO_ROOT = Path(__file__).resolve().parents[2]
PRESETS_TS = REPO_ROOT / "frontend" / "src" / "config.ts"
MATRIX_I18N = (
    REPO_ROOT / "frontend" / "src" / "i18n" / "messages" / "zh-CN.llmProtocol.ts",
    REPO_ROOT / "frontend" / "src" / "i18n" / "messages" / "en-US.llmProtocol.ts",
)

_MESSAGES = [{"role": "user", "content": "hi"}]


def _config(**overrides) -> LLMConfig:
    base = {
        "api_style": "responses",
        "base_url": "https://api.example.com/v1",
        "api_key": "k",
        "model": "m1",
    }
    base.update(overrides)
    return LLMConfig(**base)


async def _captured_body(
    config: LLMConfig | None = None,
    *,
    thinking: bool = True,
    request_overrides: dict | None = None,
    **overrides,
) -> dict:
    """走真实 provider 路径抓请求体（不是直接调 ``_build_payload`` 的捷径）。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"status": "completed", "output": []})

    provider = ResponsesProvider(
        config or _config(**overrides),
        transport=httpx.MockTransport(handler),
        request_overrides=request_overrides,
    )
    await provider.chat(_MESSAGES, thinking=thinking)
    return captured["body"]


# ===== 第 10 条：Responses 链路真的关掉思考 =====


@pytest.mark.asyncio
async def test_responses_thinking_off_sends_effort_none():
    """默认就思考的厂商（DeepSeek）：关闭时必须显式发 none，而不是"什么都省掉"。"""
    body = await _captured_body(base_url="https://api.deepseek.com", model="deepseek-flash")

    assert body["reasoning"] == {"effort": "none"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("base_url", "model"),
    [
        ("https://open.bigmodel.cn/api/v1", "glm-4.6"),
        ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
        ("https://maas-api.cn-huabei-1.xf-yun.com/v1", "spark-x2.6"),
    ],
)
async def test_responses_thinking_off_covers_every_default_on_vendor(base_url, model):
    """不是只有 DeepSeek：凡是「不指定就思考」的 Responses 端点都要显式关。"""
    body = await _captured_body(base_url=base_url, model=model)

    assert body["reasoning"] == {"effort": "none"}, base_url


@pytest.mark.asyncio
async def test_responses_thinking_off_adds_nothing_for_an_unknown_host():
    """**兼容红线**：未收录的端点一个思考字段都不加（发错参数会直接 400）。"""
    body = await _captured_body()

    assert "reasoning" not in body and "thinking" not in body


@pytest.mark.asyncio
async def test_responses_thinking_on_sends_the_configured_effort():
    configured = await _captured_body(
        base_url="https://api.deepseek.com",
        model="deepseek-flash",
        thinking_enabled=True,
        thinking_effort="high",
    )
    default = await _captured_body(
        base_url="https://api.deepseek.com", model="deepseek-flash", thinking_enabled=True
    )

    assert configured["reasoning"] == {"effort": "high"}
    # "开着但没选档位"在 effort 形态下只能靠发一个档位表达（medium 是 OpenAI 文档的默认值）。
    assert default["reasoning"] == {"effort": "medium"}


@pytest.mark.asyncio
async def test_responses_assistant_none_is_sent_instead_of_omitted():
    """助手侧选「不思考」（request_overrides=none）同样必须真的发 none。"""
    stripped = _config(
        base_url="https://api.deepseek.com", model="deepseek-flash", thinking_enabled=True
    ).without_thinking()

    body = await _captured_body(stripped, request_overrides={"reasoning_effort": "none"})

    assert body["reasoning"] == {"effort": "none"}


@pytest.mark.asyncio
async def test_structured_calls_also_close_the_default_thinking():
    """结构化输出类调用（thinking=False）：对默认思考的厂商"不注入"不等于"关掉"。"""
    body = await _captured_body(
        thinking=False, base_url="https://api.deepseek.com", model="deepseek-flash"
    )
    plain = await _captured_body(thinking=False)

    assert body["reasoning"] == {"effort": "none"}
    assert "reasoning" not in plain


@pytest.mark.asyncio
async def test_doubao_responses_uses_its_own_thinking_object():
    """豆包在 Responses 上主推的关闭写法仍是 thinking 对象（不是 reasoning.effort）。"""
    body = await _captured_body(
        base_url="https://ark.cn-beijing.volces.com/api/v1",
        model="doubao-seed-2-1-pro-260915",
    )

    assert body["thinking"] == {"type": "disabled"}
    assert "reasoning" not in body


def test_the_chat_completions_chain_is_untouched():
    """**不要动 openai_compat**：它那条链路的关闭写法本来就是对的，改了会连累别的供应商。"""
    config = LLMConfig(base_url="https://api.deepseek.com", model="deepseek-flash", api_key="k")

    payload = OpenAICompatProvider(config)._build_payload(_MESSAGES, stream=False)

    assert payload["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in payload and "reasoning" not in payload


# ===== 第 11 条：逐家白名单（22 个预设 × chat / responses） =====

# 清单 §11.5-B 的逐家期望：provider → 协议 → 关闭片段。`{}` = 一个字都不发（没有关闭
# 入口 / 型号不可关闭 / 证据不足按保守方案）。这是**手工核对过的期望**，不是从代码反推的
# ——否则表写错时测试会一起错。空的两条（kimi=k3 常开等）在 FORCED 用例里另有断言。
EXPECTED_DISABLE: dict[str, dict[str, dict]] = {
    "deepseek": {
        "chat": {"thinking": {"type": "disabled"}},
        "responses": {"reasoning": {"effort": "none"}},
    },
    "qwen": {
        "chat": {"enable_thinking": False},
        "responses": {"reasoning": {"effort": "none"}},
    },
    "doubao": {
        "chat": {"thinking": {"type": "disabled"}},
        "responses": {"thinking": {"type": "disabled"}},
    },
    "zhipu": {"chat": {}, "responses": {}},  # 预设是 glm-5.3：强制思考
    "siliconflow": {"chat": {"enable_thinking": False}, "responses": {}},  # 无 Responses 入口
    "kimi": {"chat": {}, "responses": {}},  # 预设是 kimi-k3：常开
    "hunyuan": {"chat": {}, "responses": {}},  # TokenHub 关闭行为未实测 → 保守不发
    "openai": {"chat": {}, "responses": {}},  # 预设是 gpt-6-astra：不支持 none
    "anthropic": {"chat": {}, "responses": {}},  # 原生 Messages 不进这张表
    "gemini": {"chat": {}, "responses": {}},  # 没有 none 档
    "qianfan": {"chat": {}, "responses": {}},  # 默认不思考
    "spark": {
        "chat": {"thinking": {"type": "disabled"}},
        "responses": {"reasoning": {"effort": "none"}},
    },
    "minimax": {"chat": {}, "responses": {}},  # 预设是 M3.1-Flash：强制思考
    "openrouter": {"chat": {}, "responses": {}},  # mandatory 上游禁止 none → 保守不发
    "stepfun": {"chat": {}, "responses": {}},  # 没有关闭入口
    "ollama": {"chat": {}, "responses": {}},  # 本机端点默认值取决于模型 metadata
    "xai": {"chat": {}, "responses": {}},  # 预设是 grok-4.7：不可关闭
    "mistral": {"chat": {}, "responses": {}},  # 预设是 large-4：不接受 none
    "lmstudio": {"chat": {}, "responses": {}},
    "groq": {"chat": {}, "responses": {}},  # 预设是 GPT-OSS：恒思考
    "together": {"chat": {}, "responses": {}},
    "perplexity": {"chat": {}, "responses": {}},  # 无「=关闭」官方原文 → 保守不发
}

_PRESET_RE = re.compile(
    r'provider: "(?P<provider>[a-z0-9_]+)",\s*\n\s*base_url: "(?P<base_url>[^"]+)",'
    r'\s*\n\s*model: "(?P<model>[^"]+)"'
)


def _frontend_presets() -> dict[str, tuple[str, str]]:
    """从前端 config.ts 读 22 个预设（跨语言守卫的输入）。

    读前端源码是刻意为之，与 ``test_version_consistency.py`` 读 package.json 同一个
    理由：两处"同一事实"分居两种语言，只能靠读源码把它们钉在一起。
    """
    presets = {
        match.group("provider"): (match.group("base_url"), match.group("model"))
        for match in _PRESET_RE.finditer(PRESETS_TS.read_text(encoding="utf-8"))
    }
    assert len(presets) == len(EXPECTED_DISABLE), (
        f"前端预设数 {len(presets)} 与期望表 {len(EXPECTED_DISABLE)} 不一致："
        "新增/删除一家预设必须同时补后端规则表与本文件的 EXPECTED_DISABLE"
    )
    return presets


def test_every_frontend_preset_has_an_audited_disable_payload():
    presets = _frontend_presets()
    assert set(presets) == set(EXPECTED_DISABLE)

    for provider, (base_url, model) in presets.items():
        config = LLMConfig(base_url=base_url, model=model)
        for protocol, expected in EXPECTED_DISABLE[provider].items():
            assert disable_thinking_payload(config, protocol) == expected, (provider, protocol)


def test_every_preset_endpoint_is_covered_by_the_vendor_table():
    """没被表收录的端点只能落进兜底 reasoning_effort：形态发错、关闭时一个字不发。"""
    presets = _frontend_presets()

    uncovered = [
        provider
        for provider, (base_url, model) in presets.items()
        # Claude 原生协议的思考由 anthropic.py 的"预算/自适应"两代自己决定，不进这张表。
        if provider != "anthropic" and match_rule(LLMConfig(base_url=base_url, model=model)) is None
    ]

    assert uncovered == []


@pytest.mark.parametrize(("display_name", "base_url", "model"), FORCED_THINKING_MODELS)
def test_a_forced_thinking_model_never_receives_a_disable_parameter(display_name, base_url, model):
    """强制思考的型号：一个关闭参数都不许发（发了会 400），并在设置页置灰。"""
    config = LLMConfig(base_url=base_url, model=model)

    assert can_disable_thinking(config, "chat") is False, display_name
    assert can_disable_thinking(config, "responses") is False, display_name
    assert thinking_payload(config) == {}, display_name
    assert responses_off_effort(config) == "", display_name
    assert wants_thinking(config) is False, display_name
    support = thinking_support(config)
    assert support.supported is False, display_name
    assert "强制思考" in support.note, display_name


def test_only_the_audited_models_are_marked_forced_thinking():
    """邻近型号不能被误伤：GLM-5.2 能关、GLM-5.3 不能；GPT-5.2 能关、Astra 不能。"""
    glm52 = LLMConfig(base_url="https://open.bigmodel.cn/api/paas/v4", model="glm-5.2")
    assert can_disable_thinking(glm52) is True
    assert thinking_payload(glm52) == {"thinking": {"type": "disabled"}}

    gpt52 = LLMConfig(base_url="https://api.openai.com/v1", model="gpt-5.2")
    assert can_disable_thinking(gpt52) is True
    assert thinking_payload(gpt52) == {"reasoning_effort": "none"}
    assert disable_thinking_payload(gpt52, "responses") == {"reasoning": {"effort": "none"}}


def test_the_close_form_differs_between_protocols_for_the_same_vendor():
    """同一个 DeepSeek：chat 收 thinking 对象、responses 只认 reasoning.effort（§10.3 B 行）。"""
    config = LLMConfig(base_url="https://api.deepseek.com", model="deepseek-flash")

    assert disable_thinking_payload(config, "chat") == {"thinking": {"type": "disabled"}}
    assert disable_thinking_payload(config, "responses") == {"reasoning": {"effort": "none"}}


def test_an_unknown_protocol_is_rejected():
    """anthropic 不在这套抽象里（两代写法由 anthropic.py 决定），传错必须炸而不是静默。"""
    config = LLMConfig(base_url="https://api.deepseek.com", model="deepseek-flash")

    with pytest.raises(ValueError, match="协议"):
        disable_thinking_payload(config, "anthropic")


_FOOTNOTE_RE = re.compile(
    r'"llmProtocol\.matrix\.footnote":\s*(?:"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\')'
)


def _matrix_footnote(path: Path) -> str:
    """从语言包里抽出矩阵表尾那段文案（zh 用双引号、en 用单引号，都要认）。"""
    match = _FOOTNOTE_RE.search(path.read_text(encoding="utf-8"))
    assert match is not None, f"{path.name} 找不到矩阵表尾文案"
    return match.group(1) or match.group(2) or ""


def test_the_protocol_matrix_copy_lists_every_forced_thinking_model():
    """跨语言守卫：前端矩阵表尾文案必须与 FORCED_THINKING_MODELS 的显示名逐字一致。

    只认**表尾那一段**：别的说明里也提到 GLM-5.3（比如 Together 托管），拿整份文件做
    子串匹配等于给这条守卫开后门。
    """
    for path in MATRIX_I18N:
        footnote = _matrix_footnote(path)
        for display_name, _base_url, _model in FORCED_THINKING_MODELS:
            assert display_name in footnote, f"{path.name} 表尾少了强制思考型号：{display_name}"
