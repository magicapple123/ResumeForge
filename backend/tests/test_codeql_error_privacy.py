"""Regression probes use only synthetic secrets and PID-isolated test databases."""

import json
from pathlib import Path

from app.runtime import dataset_scope
from app.runtime.dataset_scope import DatasetScopeError
from app.schemas.resume import GenerateOptions
from app.services import storage_stats
from app.services.assistant.assistant_web_search import AssistantSearchError
from app.services.llm.base import LLMError
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_assistant import _configure_llm, _create_conversation, _events, _successful_provider
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
    _configure_llm(client)
    captured = {}
    _successful_provider(monkeypatch, captured)

    async def fail(_query, _config):
        raise AssistantSearchError(PRIVATE_ERROR)

    monkeypatch.setattr("app.api.assistant.aggregate_search", fail)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "搜索岗位", "web_search": True},
    )
    event = next(item for item in _events(response) if item["type"] == "sources")
    assert event["sources"] == [] and event["error"]
    assert PRIVATE_ERROR not in response.text
    assert PRIVATE_ERROR not in json.dumps(captured)
    history = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assert PRIVATE_ERROR not in json.dumps(history)


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
