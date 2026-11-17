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


# ---------------------------------------------------------------------------
# T01：`?model=` 可选参数（设置弹窗里型号可能还没保存）
# ---------------------------------------------------------------------------


def test_explicit_model_answers_from_the_reference_table(client):
    """④ 带参只问「表里这个型号多少」：当前配置是别的型号也不影响结果。"""
    _save(client, model="mystery-model-v9")
    data = client.get("/api/settings/model-windows", params={"model": "gpt-4.1"}).json()
    current = data["current"]
    assert current["model"] == "gpt-4.1"
    assert current["label"] == "GPT-4.1"
    assert current["tokens"] == 1_047_576
    assert current["source"] == "reference"
    # 表本身不因带参变化：条数与保守值原样。
    assert len(data["entries"]) == len(MODEL_WINDOWS)
    assert data["default_tokens"] == DEFAULT_CONTEXT_WINDOW


def test_explicit_unknown_model_says_fallback(client):
    """④ 未知型号 → 128,000 / fallback（不是静默的用户手填值）。"""
    _save(client, model="gpt-4.1")
    current = client.get(
        "/api/settings/model-windows", params={"model": "mystery-model-v9"}
    ).json()["current"]
    assert current["label"] is None
    assert current["tokens"] == DEFAULT_CONTEXT_WINDOW
    assert current["source"] == "fallback"


def test_explicit_model_ignores_the_saved_manual_value(client):
    """带参问的是参考表：手填值不掺进来（不带参时手填仍然优先，见上一条用例）。"""
    _save(client, model="gpt-4.1", context_window_tokens=64_000)
    assert client.get("/api/settings/model-windows").json()["current"]["source"] == "manual"

    explicit = client.get("/api/settings/model-windows", params={"model": "gpt-4.1"}).json()
    assert explicit["current"]["tokens"] == 1_047_576
    assert explicit["current"]["source"] == "reference"


def test_empty_model_param_behaves_exactly_like_no_param(client):
    """④ 不带参（或空串）与改前逐字一致：按当前生效配置解析。"""
    _save(client, model="claude-sonnet-4-5-20250929", context_window_tokens=64_000)
    plain = client.get("/api/settings/model-windows").json()
    blank = client.get("/api/settings/model-windows", params={"model": "   "}).json()
    assert blank == plain
    assert plain["current"]["source"] == "manual"


# ---------------------------------------------------------------------------
# T01 ③：记录卡上的「窗口 …（…）」——窗口与来源由后端算好随记录下发
# ---------------------------------------------------------------------------


def _create_record(client, name: str, **overrides) -> dict:
    payload = {
        "name": name,
        "base_url": "https://api.example.com/v1",
        "api_key": "sk-test",
        "model": "gpt-4.1",
        **overrides,
    }
    response = client.post("/api/settings/llm/records", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_records_carry_the_resolved_window_and_its_source(client):
    """③ 手填 / 参考表 / 保守值三种来源都要能分辨，前端不复制型号正则。"""
    manual = _create_record(client, "手填", model="gpt-4.1", context_window_tokens=64_000)
    reference = _create_record(client, "参考表", model="claude-sonnet-4-5-20250929")
    fallback = _create_record(client, "未知", model="mystery-model-v9")

    assert (manual["window_tokens"], manual["window_source"]) == (64_000, "manual")
    assert (reference["window_tokens"], reference["window_source"]) == (200_000, "reference")
    assert (fallback["window_tokens"], fallback["window_source"]) == (
        DEFAULT_CONTEXT_WINDOW,
        "fallback",
    )

    # 列表接口与创建接口的形态一致（卡片拿到的是同一份数据）。
    listed = {item["id"]: item for item in client.get("/api/settings/llm/records").json()}
    assert listed[reference["id"]]["window_tokens"] == 200_000
    assert listed[reference["id"]]["window_source"] == "reference"
