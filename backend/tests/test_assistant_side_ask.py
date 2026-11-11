# SPDX-License-Identifier: Apache-2.0
"""#27E 投投「顺便问」侧问端点：一次性问答，不落库、不进会话、不调工具。

守四件事：
- 回答直接返回，但 `chat_conversation` / `chat_message` 一行都不新增；
- 发给模型的只有 system + 当前这一问，没有历史、没有工具清单；
- 选中文本带"不可信数据"边界标记，随请求透传给模型；
- 未配置模型 / 模型报错 / 空回答分别给出 400 / 502 / 502，而不是 500。

**为什么单独起一个只装本 router 的 FastAPI 应用**：生产注册（`application_routers.py`）
由主理人统一合并，本线不直接改共享注册表；用独立应用可以在合入前就把端点行为测完。
LLM 配置仍通过主应用的 `PUT /api/settings/llm` 写入同一测试库，两边共用 `SessionLocal`。
"""

from __future__ import annotations

import pytest
from app.api import assistant_side_ask
from app.database import SessionLocal, get_db
from app.models.assistant import ChatConversation, ChatMessage
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMError
from fastapi import FastAPI
from fastapi.testclient import TestClient

ANSWER = "这条要求里你缺的是 A/B 测试经验，先用项目里的实验记录补一条。"
PATH = "/api/assistant/side-ask"


class _OneShotProvider(BaseLLMProvider):
    """只实现一次 chat() 的假 provider：记录真正发给模型的 messages。"""

    def __init__(self, _config=None, *, captured=None, reply=ANSWER, error=None):
        self.captured = captured
        self.reply = reply
        self.error = error
        self.chat_calls = 0

    async def chat(self, messages, *, thinking: bool = True):
        self.chat_calls += 1
        if self.captured is not None:
            self.captured["messages"] = messages
            self.captured["thinking"] = thinking
        if self.error is not None:
            raise self.error
        return self.reply

    async def stream_chat(self, messages):  # pragma: no cover - 侧问不走流式
        raise NotImplementedError
        yield ""


@pytest.fixture
def side_client():
    """只装侧问 router 的客户端：生产注册由主理人合并，这里先验端点契约。"""

    app = FastAPI()
    app.include_router(assistant_side_ask.router)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, client=("127.0.0.1", 50000)) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _configure_llm(client) -> None:
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="side-ask-secret",
        model="side-ask-model",
    )
    response = client.put("/api/settings/llm", json=config.model_dump())
    assert response.status_code == 200


def _patch_provider(monkeypatch, *, captured=None, reply=ANSWER, error=None):
    provider = _OneShotProvider(captured=captured, reply=reply, error=error)
    monkeypatch.setattr("app.api.assistant_side_ask.create_provider", lambda _config: provider)
    return provider


def _row_counts(db_session) -> tuple[int, int]:
    return (
        db_session.query(ChatConversation).count(),
        db_session.query(ChatMessage).count(),
    )


def test_side_ask_is_registered_on_the_production_app(client) -> None:
    """生产路由已由 lead 合并：真实 app 上打得到本模块的 handler（不是 404）。

    FastAPI 0.142 的 `include_router` 是惰性的（`_IncludedRouter` 占位），启动后才
    展开；所以这里用已启动的 `client`，断言"未配置模型 → 400 本模块文案"而不是
    "404 路由不存在"。
    """

    response = client.post("/api/assistant/side-ask", json={"question": "在吗"})

    assert response.status_code == 400, response.text
    assert "尚未配置大模型" in response.json()["detail"]


def test_side_ask_answers_without_writing_conversation_or_history(
    client, side_client, db_session, monkeypatch
):
    _configure_llm(client)
    captured: dict = {}
    provider = _patch_provider(monkeypatch, captured=captured)
    before = _row_counts(db_session)

    response = side_client.post(
        PATH,
        json={
            "question": "这条要求我够吗？",
            "selection": "熟悉 SQL，有 A/B 测试经验者优先。",
            "page": "岗位详情",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"] == ANSWER
    assert body["model"] == "side-ask-model"
    assert provider.chat_calls == 1
    db_session.expire_all()
    assert _row_counts(db_session) == before  # 不落库：会话 / 消息一行都没多

    messages = captured["messages"]
    assert [item["role"] for item in messages] == ["system", "user"]
    assert captured["thinking"] is False  # 侧问不烧思考预算
    user_text = messages[-1]["content"]
    assert "这条要求我够吗？" in user_text
    assert "岗位详情" in user_text
    assert "熟悉 SQL，有 A/B 测试经验者优先。" in user_text
    assert "不可信数据" in user_text
    # 不调工具：system 提示写明不调用工具，请求里也没有工具清单这一概念。
    assert "不调用任何工具" in messages[0]["content"]


def test_side_ask_does_not_require_a_selection(client, side_client, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch)

    response = side_client.post(PATH, json={"question": "简历还没保存会丢吗？"})

    assert response.status_code == 200, response.text
    assert response.json()["answer"] == ANSWER


def test_side_ask_rejects_blank_and_oversized_input(client, side_client, monkeypatch):
    _configure_llm(client)
    provider = _patch_provider(monkeypatch)

    assert side_client.post(PATH, json={"question": ""}).status_code == 422
    assert (
        side_client.post(PATH, json={"question": "问", "selection": "字" * 4001}).status_code == 422
    )
    assert side_client.post(PATH, json={"question": "问", "page": "页" * 201}).status_code == 422
    assert side_client.post(PATH, json={"question": "问", "unexpected": 1}).status_code == 422
    assert provider.chat_calls == 0  # 校验失败不烧模型调用


def test_side_ask_requires_llm_configuration(client, side_client, monkeypatch):
    provider = _patch_provider(monkeypatch)

    response = side_client.post(PATH, json={"question": "在吗"})

    assert response.status_code == 400
    assert "尚未配置大模型" in response.json()["detail"]
    assert provider.chat_calls == 0


def test_side_ask_maps_provider_error_to_502(client, side_client, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch, error=LLMError("余额不足"))

    response = side_client.post(PATH, json={"question": "在吗"})

    assert response.status_code == 502
    assert "侧问失败" in response.json()["detail"]


def test_side_ask_treats_empty_answer_as_failure(client, side_client, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch, reply="   ")

    response = side_client.post(PATH, json={"question": "在吗"})

    assert response.status_code == 502
    assert "没有返回内容" in response.json()["detail"]
