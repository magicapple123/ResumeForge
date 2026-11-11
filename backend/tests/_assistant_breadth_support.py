# SPDX-License-Identifier: Apache-2.0
"""18A/18B/18C/18E 定向测试共用的假 provider 与助手请求 helper。

只放"每个文件都要手抄一遍"的机械部分（脚本化 provider / SSE 解析 / 建会话 / 发消息）。
刻意不 import test_assistant：那是一个 450+ 行、正被其它批次改动的文件，依赖它的私有
helper 会让本批测试跟着它的改动变红。这里各写一份最小实现，行为与它一致。
"""

from __future__ import annotations

import json
from typing import Any

from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMDelta


class FakeProvider(BaseLLMProvider):
    """测试假 provider：继承基类拿到默认的纯文本流实现。"""

    def __init__(self, _config: Any = None) -> None:
        pass

    async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
        raise NotImplementedError


class ScriptedProvider(FakeProvider):
    """按预设脚本逐轮返回；脚本耗尽后重复最后一轮（与 test_assistant 的同名替身同义）。"""

    def __init__(self, rounds: list[list[LLMDelta]]) -> None:
        super().__init__()
        self.rounds = rounds
        self.requests: list[dict[str, Any]] = []

    async def stream_chat_events(self, messages, tools=None):
        self.requests.append({"messages": list(messages), "tools": tools})
        index = min(len(self.requests) - 1, len(self.rounds) - 1)
        for delta in self.rounds[index]:
            yield delta

    async def stream_chat(self, messages):
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text


def configure_llm(client) -> None:
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model="assistant-model",
    )
    response = client.put("/api/settings/llm", json=config.model_dump())
    assert response.status_code == 200, response.text


def patch_provider(monkeypatch, provider) -> None:
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)


def create_conversation(client, title: str = "") -> dict:
    response = client.post("/api/assistant/conversations", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


def send(client, conversation_id: int, content: str, **extra: Any):
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": content, **extra},
    )
    assert response.status_code == 200, response.text
    return response


def events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def tool_call(name: str, arguments: dict, call_id: str = "call_1") -> LLMDelta:
    return LLMDelta(
        tool_calls=[
            {
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": json.dumps(arguments, ensure_ascii=False),
                },
            }
        ],
        finish_reason="tool_calls",
    )


def register_task_tools(monkeypatch) -> None:
    """把 18A 的三条工具临时并入注册表，让端到端路径在本批合并前也能测。

    主 agent 把 _registry.py 的 import + spread 合并后，这段自动变成空操作
    （已有同名工具就不重复追加），不需要改测试。
    """
    from app.services.assistant_tools import _registry
    from app.services.assistant_tools._tools_specs_tasks import TASK_TOOLS

    if any(tool.name == "task_create" for tool in _registry._TOOLS):
        return
    monkeypatch.setattr(_registry, "_TOOLS", (*_registry._TOOLS, *TASK_TOOLS))


__all__ = [
    "FakeProvider",
    "ScriptedProvider",
    "configure_llm",
    "create_conversation",
    "events",
    "patch_provider",
    "register_task_tools",
    "send",
    "tool_call",
]
