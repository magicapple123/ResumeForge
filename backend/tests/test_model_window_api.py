# SPDX-License-Identifier: Apache-2.0
"""「模型窗口参考」接口：表要完整、链接可核对、当前模型能被标出来。

为什么单独测：这张表是用户手填窗口的**唯一参考**，错一条就会让人把窗口填错（填大直接
400）。所以除了"能返回"，还要钉住三点：条数与内置表一致、链接必须是 https、当前模型的
来源（命中参考值 / 手填 / 保守值）不能被含糊成同一个。
"""

import pytest
from app.schemas.setting import LLMConfig
from app.services.api_key_session import clear_session_key
from app.services.model_context_windows import DEFAULT_CONTEXT_WINDOW, MODEL_WINDOWS


@pytest.fixture(autouse=True)
def _clean_session_key():
    """会话密钥是模块级内存态：不清理会让 get_llm_config 带上别的用例留下的 key。"""
    clear_session_key()
    yield
    clear_session_key()


def _save(client, *, model: str = "test-model", **overrides) -> None:
    config = LLMConfig(
        base_url="https://api.example.com/v1", api_key="sk-test", model=model, **overrides
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def test_reference_lists_every_rule_with_https_links(client):
    response = client.get("/api/settings/model-windows")
    assert response.status_code == 200
    data = response.json()
    assert data["default_tokens"] == DEFAULT_CONTEXT_WINDOW
    assert len(data["entries"]) == len(MODEL_WINDOWS)
    assert [entry["label"] for entry in data["entries"]] == [rule.label for rule in MODEL_WINDOWS]
    assert all(entry["reference"].startswith("https://") for entry in data["entries"])
    assert all(entry["tokens"] > 0 for entry in data["entries"])


def test_current_model_reports_the_matched_reference_rule(client):
    _save(client, model="claude-sonnet-4-5-20250929")
    current = client.get("/api/settings/model-windows").json()["current"]
    assert current["label"] == "Claude Opus / Sonnet / Haiku 4.5"
    assert current["tokens"] == 200_000
    assert current["source"] == "reference"


def test_unknown_model_stays_conservative_and_says_so(client):
    _save(client, model="mystery-model-v9")
    current = client.get("/api/settings/model-windows").json()["current"]
    assert current["label"] is None
    assert current["tokens"] == DEFAULT_CONTEXT_WINDOW
    assert current["source"] == "fallback"


def test_manual_window_wins_but_the_matched_label_stays_visible(client):
    _save(client, model="gpt-4.1", context_window_tokens=64_000)
    current = client.get("/api/settings/model-windows").json()["current"]
    assert current["tokens"] == 64_000
    assert current["source"] == "manual"
    # 手填不改"这是哪个型号"：列表里仍要能告诉用户它属于哪一条参考。
    assert current["label"] == "GPT-4.1"
