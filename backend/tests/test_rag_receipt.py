# SPDX-License-Identifier: Apache-2.0
"""#30 生成任务级 RAG 回执：进程内注册表、进度行文案、生成说明留痕与零迁移接线。

守三件事：
- 回执按任务 id 存取，过期/容量上限不泄漏（进程内注册表是"不加列"方案的代价）；
- 进度行文案五态各一条，且 off 不能报成"无命中"（配置状态 ≠ 使用状态）；
- 只在 hit / fallback 时往 rationale 里留一行，其余态不制造噪音。
"""

from __future__ import annotations

import asyncio

import pytest
from app.config import Settings
from app.services.rag import rag_receipt, rag_service
from app.services.rag.rag_seam import SelectionBoost
from app.services.rag.rag_visibility import RAG_STATE_FALLBACK, RAG_STATE_HIT
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)

_HIT = {
    "state": "hit",
    "hit_count": 2,
    "expanded_terms": 1,
    "reason": "",
    "impacts": [
        {"entry_id": "e1", "title": "订单服务改造", "section": "项目经历", "delta": 0.31},
        {"entry_id": "e2", "title": "支付重构", "section": "项目经历", "delta": 0.12},
    ],
}


@pytest.fixture(autouse=True)
def _reset_receipts():
    rag_receipt.clear_rag_receipts()
    yield
    rag_receipt.clear_rag_receipts()


class _Task:
    def __init__(self, task_id: int = 7) -> None:
        self.id = task_id
        self.message = ""


class _Session:
    def __init__(self) -> None:
        self.commits = 0

    def commit(self) -> None:
        self.commits += 1


def test_receipt_roundtrip_and_isolated_by_task() -> None:
    rag_receipt.record_rag_receipt(1, _HIT)
    assert rag_receipt.get_rag_receipt(1) == _HIT
    assert rag_receipt.get_rag_receipt(2) is None


def test_receipt_capacity_is_bounded() -> None:
    for task_id in range(100):
        rag_receipt.record_rag_receipt(task_id, _HIT)
    assert rag_receipt.get_rag_receipt(0) is None, "超过上限后最旧的回执必须被淘汰"
    assert rag_receipt.get_rag_receipt(99) == _HIT


def test_receipt_expires() -> None:
    rag_receipt.record_rag_receipt(3, _HIT)
    module = rag_receipt
    original = module._TTL_SECONDS
    module._TTL_SECONDS = -1
    try:
        assert rag_receipt.get_rag_receipt(3) is None
    finally:
        module._TTL_SECONDS = original


def test_message_for_each_state() -> None:
    assert "命中 2 条" in rag_receipt.rag_receipt_message(_HIT)
    assert "仅按关键词" in rag_receipt.rag_receipt_message({"state": "off"})
    assert "索引为空" in rag_receipt.rag_receipt_message({"state": "empty"})
    assert "无命中" in rag_receipt.rag_receipt_message({"state": "miss"})
    fallback = {"state": "fallback", "elapsed_ms": 153}
    message = rag_receipt.rag_receipt_message(fallback)
    assert "超时" in message and "153 ms" in message


def test_record_retrieval_writes_message_and_commits() -> None:
    task = _Task()
    session = _Session()
    rag_receipt.record_retrieval(task, session, _HIT)
    assert task.message == "语义检索：命中 2 条相关经历"
    assert session.commits == 1
    assert rag_receipt.get_rag_receipt(7) == _HIT


def test_append_note_only_for_hit_and_fallback() -> None:
    note = rag_receipt.append_rag_note("岗位强调性能。", payload=_HIT)
    assert note.startswith("岗位强调性能。")
    assert "订单服务改造" in note
    fallback = rag_receipt.append_rag_note(
        "岗位强调性能。", payload={"state": "fallback", "elapsed_ms": 80}
    )
    assert "回退关键词" in fallback and "80 ms" in fallback
    for quiet in ({"state": "off"}, {"state": "miss"}, {"state": "empty"}):
        assert rag_receipt.append_rag_note("岗位强调性能。", payload=quiet) == "岗位强调性能。"
    assert rag_receipt.append_rag_note("", payload=_HIT).startswith("语义检索：命中 2 条")


def test_on_retrieval_callback_gets_off_payload(monkeypatch) -> None:
    payloads: list[dict] = []
    settings = Settings(rag_retrieval_enabled=False)
    asyncio.run(
        rag_service.prepare_selection_boost(
            None, None, settings=settings, on_retrieval=payloads.append
        )
    )
    assert payloads and payloads[0]["state"] == "off"


def test_on_retrieval_callback_gets_hit_with_matching_impacts(monkeypatch) -> None:
    async def fake_retrieve(*args, **kwargs):
        return SelectionBoost(
            boost={"hash-a": 0.31, "hash-b": 0.12},
            impacts=tuple(_HIT["impacts"]),
        )

    monkeypatch.setattr(rag_service, "_retrieve", fake_retrieve)
    payloads: list[dict] = []
    settings = Settings(rag_retrieval_enabled=True)
    asyncio.run(
        rag_service.prepare_selection_boost(
            object(), object(), settings=settings, on_retrieval=payloads.append
        )
    )
    assert payloads[0]["state"] == RAG_STATE_HIT
    assert payloads[0]["hit_count"] == len(payloads[0]["impacts"]) == 2


def test_on_retrieval_callback_gets_fallback_elapsed(monkeypatch) -> None:
    async def slow_retrieve(*args, **kwargs):
        await asyncio.sleep(0.3)
        return SelectionBoost()

    monkeypatch.setattr(rag_service, "_retrieve", slow_retrieve)
    payloads: list[dict] = []
    # Settings 的硬下限是 0.1s（rag_service 里再 max(0.05, ...) 兜底），0.05 传不进来。
    settings = Settings(rag_retrieval_enabled=True, rag_request_budget_seconds=0.1)
    asyncio.run(
        rag_service.prepare_selection_boost(
            object(), object(), settings=settings, on_retrieval=payloads.append
        )
    )
    assert payloads[0]["state"] == RAG_STATE_FALLBACK
    assert payloads[0]["elapsed_ms"] >= 50


def test_task_poll_carries_rag_receipt_end_to_end(client, monkeypatch) -> None:
    """零迁移接线：runner 检索后写回执 → GET 任务轮询把 rag 带回来。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )
    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    assert final["rag"] is not None
    # 测试环境没配 embedding：必须是 off，而不是"无命中"（配置状态 ≠ 使用状态）。
    assert final["rag"]["state"] == "off"
    assert final["rag"]["hit_count"] == 0


def test_hit_is_persisted_into_generation_notes(client, monkeypatch) -> None:
    """命中要留痕（30C 持久段）：rationale 里带一行，导出/重开记录仍能审计。"""
    from app.services.rag.rag_visibility import rag_state_payload

    _seed_profile(client)
    _configure(client)
    job = _job(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: SuccessfulProvider(resolved),
    )

    async def fake_prepare(*args, on_retrieval=None, **kwargs):
        scope = SelectionBoost(
            boost={"hash-a": 0.31},
            impacts=(
                {"entry_id": "e1", "title": "订单服务改造", "section": "项目经历", "delta": 0.31},
            ),
        )
        if on_retrieval is not None:
            on_retrieval(rag_state_payload(scope, elapsed_ms=12))
        return scope

    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.prepare_selection_boost", fake_prepare
    )
    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"])
    assert final["status"] == "completed"
    assert final["rag"]["state"] == "hit"
    assert final["rag"]["hit_count"] == 1
    detail = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert "语义检索：命中 1 条相关经历" in detail["rationale"]
    assert "订单服务改造" in detail["rationale"]
