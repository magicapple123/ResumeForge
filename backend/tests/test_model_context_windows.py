# SPDX-License-Identifier: Apache-2.0
"""模型窗口表：带 provider 前缀也能命中、版本形似不能用家族规则误判、未收录一律保守值。

重点在"看起来像"的陷阱：`gpt-4.1` 不能被 `gpt-4o` 的家族规则抢走，`-preview` 后缀也不能
被当成另一个型号。用户手填的窗口优先级最高。
"""

from types import SimpleNamespace

import pytest
from app.services.model_context_windows import (
    ModelWindow,
    configured_model_window,
    resolve_model_window,
)


@pytest.mark.parametrize(
    ("model", "tokens"),
    [
        ("openai/gpt-4.1-2025-04-14", 1_047_576),
        ("openrouter/openai/gpt-4o-mini", 128_000),
        ("provider/GPT-6-ASTRA", 1_050_000),
        ("gpt-6-sol", 1_050_000),
        ("anthropic/claude-sonnet-4-5-20250929", 200_000),
        ("claude-opus-4.5", 200_000),
        ("claude-haiku-4-5", 200_000),
        ("provider/claude-opus-4-8", 1_000_000),
        ("claude-sonnet-4-6", 1_000_000),
        ("google/gemini-3.8-flash", 1_048_576),
        ("google/gemini-4-carbon", 1_000_000),
        ("deepseek/deepseek-flash", 1_000_000),
        ("deepseek-v4-pro-0813", 1_000_000),
        ("deepseek-v4-pro", 1_000_000),
        ("qwen/qwen3.7-plus", 1_000_000),
        ("qwen3.8-max", 1_000_000),
        ("zai/glm-5.3", 1_000_000),
        ("kimi-k3.1-pro", 1_000_000),
        ("minimax/minimax-m3", 1_000_000),
        ("xai/grok-4.7", 500_000),
    ],
)
def test_verified_model_window_searches_past_provider_prefix(model, tokens):
    assert resolve_model_window(model) == ModelWindow(tokens, "reference")


@pytest.mark.parametrize(
    "model",
    [
        "",
        "unknown",
        "gpt-4.10",
        "claude-opus-4-60",
        "glm-5.30",
        "kimi-k2.6",
        "minimax-m2.7",
        "doubao-seed-2.1",
    ],
)
def test_unverified_or_version_lookalike_uses_128k(model):
    assert resolve_model_window(model) == ModelWindow(128_000, "fallback")


def test_explicit_window_wins_over_reference_and_fallback():
    assert resolve_model_window("gpt-4.1", 200_000) == ModelWindow(200_000, "manual")
    assert resolve_model_window("unknown", 500_000) == ModelWindow(500_000, "manual")
    assert configured_model_window(SimpleNamespace(model="gpt-4o")) == ModelWindow(
        128_000, "reference"
    )
