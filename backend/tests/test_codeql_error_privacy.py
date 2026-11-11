# SPDX-License-Identifier: Apache-2.0
"""Regression probes use only synthetic secrets and PID-isolated test databases."""

import json
from pathlib import Path

from app.runtime import dataset_scope
from app.runtime.dataset_scope import DatasetScopeError
from app.schemas.resume import GenerateOptions
from app.services import storage_stats
from app.services.assistant.assistant_web_search import AssistantSearchError
from app.services.llm.base import LLMDelta, LLMError
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_assistant import (
    _configure_llm,
    _create_conversation,
    _ScriptedProvider,
    _tool_call,
)
from tests.test_resume_generator import FakeProvider, collect_events, make_job, make_profile

PRIVATE_ERROR = "SYNTHETIC_PRIVATE_EXCEPTION_TOKEN_DO_NOT_ECHO"


async def test_json_repair_error_does_not_return_provider_response_payload():
    class LeakingProvider(FakeProvider):
        async def chat(self, _messages, *, thinking=True):
            raise LLMError(PRIVATE_ERROR)

    provider = LeakingProvider(stream_text="not JSON")
    events = await collect_events(
        ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions())
    )
    assert any(event["type"] == "error" for event in events)
    assert PRIVATE_ERROR not in json.dumps(events)


def test_storage_warning_does_not_return_raw_os_error(tmp_path, monkeypatch):
    real_scandir = storage_stats.os.scandir

    def deny(path):
        if isinstance(path, (str, Path)) and Path(path) == tmp_path:
            raise OSError(PRIVATE_ERROR)
        return real_scandir(path)

    monkeypatch.setattr(storage_stats.os, "scandir", deny)
    warnings = []
    assert storage_stats._scan_tree(tmp_path, "datasets", None, warnings) == {}
    assert warnings and "无法读取目录" in warnings[0]
    assert PRIVATE_ERROR not in json.dumps(warnings)


def test_search_error_does_not_enter_sse_history_or_model_context(client, monkeypatch):
    """联网搜索失败的**异常原文**不得进入 SSE、模型上下文或落库历史。

    R08 之后联网只有 ``web_search`` 工具一个入口（不再有打开开关就自动预搜那一步），
    所以这条从工具失败这条真实路径验：工具结果会进模型上下文与历史，异常原文一旦漏出去
    就会被写进数据库、也会被回显给模型。只有白名单化的 ``public_message`` 允许出现。
    """
    _configure_llm(client)

    # 桩必须跟随 `aggregate_search` 的真实签名（`limit` 位置参数 + `depth` 仅关键字）：
    # 工具调用会把两者都传进来，签名落后会在调用处炸出 TypeError，把这条隐私守卫变成
    # 一条"桩签名过期"的假红。
    async def fail(_query, _config, limit=None, *, depth=None):
        raise AssistantSearchError(PRIVATE_ERROR)

    monkeypatch.setattr("app.services.search.aggregate_search", fail)
    provider = _ScriptedProvider(
        [
            [_tool_call("web_search", {"query": "岗位 招聘"})],
            [LLMDelta(text="没能搜到。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "搜索岗位", "web_search": True},
    )
    assert response.status_code == 200
    # 工具失败仍以可读文案回给模型（换关键词重试比整轮中断有用）。
    assert any(
        "联网搜索服务暂时不可用" in str(message.get("content", ""))
        for request in provider.requests
        for message in request["messages"]
    )
    assert PRIVATE_ERROR not in response.text
    assert PRIVATE_ERROR not in json.dumps(provider.requests, ensure_ascii=False)
    history = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assert PRIVATE_ERROR not in json.dumps(history, ensure_ascii=False)


def test_generate_lease_error_does_not_return_raw_exception(client, monkeypatch):
    original = dataset_scope.acquire_lease

    def fail(owner):
        if owner == "resume-generate-sse":
            raise DatasetScopeError(PRIVATE_ERROR)
        return original(owner)

    monkeypatch.setattr(dataset_scope, "acquire_lease", fail)
    response = client.post("/api/resumes/generate", json={"options": {}})
    assert response.status_code == 200
    assert "error" in response.text
    assert PRIVATE_ERROR not in response.text
