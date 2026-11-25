# SPDX-License-Identifier: Apache-2.0
"""CR-06：联网搜索的 DeepSeek Key 为空时复用「AI 模型」里的那把。

边界（任务书 + §9）：

- 回落只在**当前模型确实指向 DeepSeek 官方端点**时发生：换一家服务商时把它的 Key
  发给 DeepSeek 一定 401，那不是"省一次填写"，而是把一次配置错误伪装成网络错误；
- 用户显式填了搜索 Key 时**永远**优先，回落不得覆盖；
- 「外部连接」页仍要如实显示"这一条**没有单独配置**"，并注明正在复用模型 Key——
  否则用户会以为搜索 Key 已经保存，改模型 Key 时不知道会连带影响搜索。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.llm_settings import save_llm_config
from app.services.web_search_settings import (
    get_search_config_with_secrets,
    model_key_fallback_active,
    resolve_search_deepseek_key,
    save_search_config,
)

MODEL_KEY = "sk-model-0123456789abcdef"
SEARCH_KEY = "sk-search-abcdef0123456789"


def _model_config(**overrides):
    from app.schemas.setting import LLMConfig

    base = {
        "provider": "deepseek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-flash",
        "api_key": MODEL_KEY,
    }
    base.update(overrides)
    return LLMConfig(**base)


def _items(client) -> dict[str, dict]:
    payload = client.get("/api/connections").json()
    return {item["id"]: item for group in payload["groups"] for item in group["items"]}


def test_empty_search_key_falls_back_to_the_model_key(db_session):
    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    save_llm_config(db_session, _model_config())

    assert get_search_config_with_secrets(db_session).deepseek_api_key == MODEL_KEY
    assert resolve_search_deepseek_key(db_session) == MODEL_KEY
    assert model_key_fallback_active(db_session) is True


def test_explicit_search_key_wins_over_the_model_key(db_session):
    save_search_config(db_session, SearchConfig(deepseek_api_key=SEARCH_KEY))
    save_llm_config(db_session, _model_config())

    assert get_search_config_with_secrets(db_session).deepseek_api_key == SEARCH_KEY
    assert resolve_search_deepseek_key(db_session) == SEARCH_KEY
    assert model_key_fallback_active(db_session) is False


def test_other_providers_never_fall_back(db_session):
    """把 OpenAI 的 Key 发给 DeepSeek 只会得到 401，所以不回落。"""
    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    save_llm_config(
        db_session,
        _model_config(base_url="https://api.openai.com/v1", provider="openai"),
    )

    assert get_search_config_with_secrets(db_session).deepseek_api_key == ""
    assert resolve_search_deepseek_key(db_session) == ""
    assert model_key_fallback_active(db_session) is False


def test_tavily_and_jina_have_no_fallback(db_session):
    """回落的依据是"同一个 DeepSeek 账户"，另外两把搜索 Key 没有这种关系。"""
    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    save_llm_config(db_session, _model_config())

    config = get_search_config_with_secrets(db_session)
    assert config.tavily_api_key == ""
    assert config.jina_api_key == ""


def test_connections_page_says_the_key_is_borrowed(client, db_session):
    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    save_llm_config(db_session, _model_config())

    item = _items(client)["web_search.deepseek"]

    # 没有单独配置：不能显示成"已保存"，也不能把模型 Key 的 hint 挂到这一行。
    assert item["key_configured"] is False
    assert item["hint"] == ""
    assert "复用" in item["detail"]
    assert item["status"] == "not_configured"
    assert "复用" in item["detail"]
    # 前端按这个布尔在行说明里加"正在复用"，不靠匹配中文 detail。
    assert item["borrowed_key"] is True


@pytest.fixture(autouse=True)
def _no_session_key():
    from app.services.api_key_session import clear_session_key

    clear_session_key()
    yield
    clear_session_key()
