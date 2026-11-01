# SPDX-License-Identifier: Apache-2.0
"""#33：美化三档必须**在生成参数上**也可度量不同。

判据来自返工清单 #33：「字数/条数/篇幅上限已不同，但 temperature 三档相同」。
本文件守两件事：
1. 档位 → temperature 的映射单调且三档互不相等（默认 0.1 时为 0.05/0.1/0.2）；
2. 只有开启美化（enhance=True）才改本次生成的 provider 配置副本，且**不改**
   用户保存的配置对象（关闭美化时请求体与改动前逐一字节一致）。
"""

from __future__ import annotations

from app.schemas.resume import GenerateOptions
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.resume.resume_generation_levels import (
    apply_enhancement_temperature,
    enhancement_temperature,
    generation_token_budget,
)


class _StubProvider(BaseLLMProvider):
    """只用于读取 config，不发请求。"""

    async def chat(self, messages, *, thinking=True):  # pragma: no cover - 不发请求
        return ""

    async def stream_chat(self, messages, *, thinking=True):  # pragma: no cover
        yield ""


def _provider(temperature: float = 0.1) -> _StubProvider:
    return _StubProvider(
        LLMConfig(base_url="http://127.0.0.1:9", model="stub", temperature=temperature)
    )


def test_temperature_differs_by_level() -> None:
    values = [enhancement_temperature(0.1, level) for level in ("light", "balanced", "strong")]
    assert values == [0.05, 0.1, 0.2]
    assert len(set(values)) == 3


def test_temperature_respects_user_base_and_clamps() -> None:
    # 用户把 creativity 调高时，档位相对缩放；夹在协议允许的 [0, 2] 内。
    assert enhancement_temperature(0.7, "light") == 0.35
    assert enhancement_temperature(0.7, "strong") == 1.4
    assert enhancement_temperature(1.5, "strong") == 2.0
    assert enhancement_temperature(0.1, "unknown-level") == 0.1


def test_apply_only_when_enhance_enabled_and_keeps_saved_config() -> None:
    provider = _provider()
    saved = provider.config
    off = GenerateOptions(enhance=False, enhancement_level="strong")
    assert apply_enhancement_temperature(provider, off) is None
    assert provider.config is saved
    assert provider.config.temperature == 0.1

    on = GenerateOptions(enhance=True, enhancement_level="strong")
    assert apply_enhancement_temperature(provider, on) == 0.2
    assert provider.config.temperature == 0.2
    # 配置对象是副本：用户保存的全局配置不被本次请求改写。
    assert saved.temperature == 0.1
    assert provider.config is not saved


def test_generation_token_budget_tracks_page_and_level() -> None:
    base = GenerateOptions(page_limit=1, enhancement_level="balanced")
    assert generation_token_budget(base) == 2360
    larger = GenerateOptions(page_limit=2, enhancement_level="balanced")
    assert generation_token_budget(larger) > generation_token_budget(base)
    light = GenerateOptions(page_limit=1, enhancement_level="light")
    strong = GenerateOptions(page_limit=1, enhancement_level="strong")
    assert (
        generation_token_budget(light)
        < generation_token_budget(base)
        < generation_token_budget(strong)
    )
