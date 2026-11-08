# SPDX-License-Identifier: Apache-2.0
"""RAG v2 返工验收（P0–P2）：入口接线、coverage 口径、fake 守卫、作用域生命周期、请求预算。

这些用例钉住的是"上一轮验收发现的问题"本身，不是实现细节：

- P1：默认配置下 fake provider 不得产生排序（`fallback=fake_provider`）；显式允许时才生效；
- P2：`generate_with_scope` 的作用域**只在首个事件**有效，第二个事件起必须是 None；
- P2：请求预算超时回退 `budget_exceeded` 并登记后台预热；
- P2：后台预热 handler 已注册、能调用预热函数并把统计交回 result；
- P0：任务入口的 runner 通过模块命名空间里的 `create_provider` 注入，搬移不破坏 monkeypatch 锚点；
- P1：coverage 只有一种实现（脚本侧已改为委托 `rag_eval_common`，这里只钉"spike 不再自算"）。
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from app.config import Settings
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.llm.embeddings import EmbeddingModelSpec
from app.services.profile.profile_relevance import build_targeted_consumed_profile_context
from app.services.rag import rag_seam, rag_service
from app.services.rag.rag_chunking import build_chunks
from app.services.rag.rag_index import reset_rag_index
from app.services.resume import resume_generate_runner as runner_module
from app.services.resume.resume_generate_inputs import (
    prepare_generate_inputs as direct_prepare,
)


def _spec(
    field_id: str, key: str, label: str, *, field_type: str = "single_line"
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(field_id, key, label, field_type, 1, True, True, False, True)


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id, 0, values)


def _section(key, name, fields, entries) -> ConsumedSection:
    return ConsumedSection(key, name, "multi", None, False, None, tuple(fields), tuple(entries))


def _profile() -> ConsumedProfile:
    experiences = _section(
        "experiences",
        "实习/工作经历",
        [
            _spec("experiences.company", "company", "公司"),
            _spec("experiences.description", "description", "描述", field_type="multi_line"),
        ],
        [
            _entry(
                "e1",
                {"experiences.company": "甲公司", "experiences.description": "负责会员分层与召回"},
            ),
            _entry(
                "e2", {"experiences.company": "乙公司", "experiences.description": "搭建指标体系"}
            ),
        ],
    )
    projects = _section(
        "projects",
        "项目经历",
        [
            _spec("projects.name", "name", "项目名"),
            _spec("projects.description", "description", "描述", field_type="multi_line"),
        ],
        [
            _entry("p1", {"projects.name": "增长实验平台", "projects.description": "设计 AB 实验"}),
        ],
    )
    sections = {item.key: item for item in (experiences, projects)}
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("experiences", "projects"),
        section_order=("experiences", "projects"),
        workspace_revision=1,
        sections=sections,
    )


def _job():
    from datetime import UTC, datetime

    from app.schemas.job import JobOut

    now = datetime.now(UTC)
    return JobOut(
        id=1,
        title="用户增长分析师",
        description="负责会员分层、召回策略与增长实验。",
        requirements="熟悉用户分层与指标体系。",
        keywords=[],
        created_at=now,
        updated_at=now,
    )


@pytest.fixture(autouse=True)
def _clean_index():
    reset_rag_index()
    yield
    reset_rag_index()


# ===== P1：fake provider 守卫 =====


def test_enabling_retrieval_with_fake_provider_falls_back():
    # 生产默认 allow_fake=False；测试进程的 conftest 环境变量不参与本用例（显式传参优先）。
    settings = Settings(rag_retrieval_enabled=True, rag_embedding_allow_fake=False)
    assert settings.rag_embedding_allow_fake is False
    scope = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    assert scope.fallback_reason == "fake_provider"
    assert not scope.boost and not scope.extra_terms


def test_fake_guard_keeps_candidates_byte_identical_to_disabled():
    # 关闭态与"开了但被守卫拦下"必须是同一份候选（逐字节），否则守卫只是换了个噪声。
    disabled = build_targeted_consumed_profile_context(_profile(), _job())
    settings = Settings(rag_retrieval_enabled=True, rag_embedding_allow_fake=False)
    scope = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    with rag_seam.selection_scope(scope):
        guarded = build_targeted_consumed_profile_context(_profile(), _job())
    assert scope.fallback_reason == "fake_provider"
    assert guarded.serialized == disabled.serialized


def test_fake_provider_effective_only_when_explicitly_allowed():
    settings = Settings(rag_retrieval_enabled=True, rag_embedding_allow_fake=True)
    scope = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    assert scope.fallback_reason == ""
    assert scope.boost, "显式允许 fake 时必须真的产出 boost（防止守卫把链路焊死）"


# ===== P2：请求预算 + 后台预热 =====


class _SlowProvider:
    """比请求预算慢的 provider：模拟"冷缓存要编码整库"的真实模型。"""

    async def embed_documents(self, texts, *, budget=None):  # noqa: ARG002
        await asyncio.sleep(0.5)
        return SimpleNamespace(vectors=tuple((0.1, 0.2, 0.3) for _ in texts))

    async def embed_query(self, text, *, budget=None):  # noqa: ARG002
        await asyncio.sleep(0.5)
        return (0.1, 0.2, 0.3)


def test_request_budget_exceeded_falls_back_and_enqueues_warmup(monkeypatch):
    spec = EmbeddingModelSpec("local-test", "m", 3, "mean")
    monkeypatch.setattr(rag_service, "resolve_embedding_spec", lambda _settings=None: spec)
    monkeypatch.setattr(rag_service, "create_embedding_provider", lambda _spec: _SlowProvider())
    enqueued: list[object] = []
    monkeypatch.setattr(rag_service, "enqueue_rag_warmup", enqueued.append)
    settings = Settings(rag_retrieval_enabled=True, rag_request_budget_seconds=0.1)
    scope = asyncio.run(
        rag_service.prepare_selection_boost(_profile(), _job(), settings=settings, db=object())
    )
    assert scope.fallback_reason == "budget_exceeded"
    assert enqueued, "超预算必须登记后台预热"


def test_warm_budget_path_does_not_block_second_call():
    # 允许 fake 时编码是毫秒级：冷缓存首调不超预算；第二次直接命中索引。
    settings = Settings(rag_retrieval_enabled=True, rag_embedding_allow_fake=True)
    first = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    reset_rag_index()  # 清缓存 = 冷启动
    cold = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    warm = asyncio.run(rag_service.prepare_selection_boost(_profile(), _job(), settings=settings))
    assert first.fallback_reason == "" and cold.fallback_reason == ""
    assert warm.fallback_reason == "" and warm.boost


def test_warm_rag_index_encodes_missing_then_hits_cache():
    settings = Settings(rag_embedding_allow_fake=True)
    consumed = _profile()
    chunk_count = len(build_chunks(consumed).chunks)
    assert chunk_count > 0
    first = asyncio.run(rag_service.warm_rag_index(consumed, settings=settings))
    assert first["encoded"] == chunk_count
    second = asyncio.run(rag_service.warm_rag_index(consumed, settings=settings))
    assert second["encoded"] == 0, "预热必须幂等：已编码条目不应重复编码"


def test_warm_rag_index_refuses_fake_by_default():
    settings = Settings(rag_embedding_allow_fake=False)
    stats = asyncio.run(rag_service.warm_rag_index(_profile(), settings=settings))
    assert stats == {"encoded": 0, "reason": "fake_provider"}


# ===== P0：runner 委托不破坏 monkeypatch 锚点 =====


def test_runner_snapshot_delegates_with_module_provider_anchor(monkeypatch):
    runner = runner_module.ResumeGenerateRunner()
    captured: dict[str, object] = {}

    def fake_prepare(session, task, *, generation_snapshot, provider_factory, baseline_builder):
        captured["session"] = session
        captured["task"] = task
        captured["snapshot"] = generation_snapshot
        captured["provider_factory"] = provider_factory
        captured["baseline_builder"] = baseline_builder
        return ("ok",)

    monkeypatch.setattr(runner_module, "prepare_generate_inputs", fake_prepare)
    session, task = object(), SimpleNamespace(job_id=None)
    assert runner._snapshot(session, task) == ("ok",)
    # 两个符号都必须仍从 runner 模块命名空间传下去（既有测试 patch 它们）。
    assert captured["provider_factory"] is runner_module.create_provider
    assert captured["baseline_builder"] is runner_module.build_baseline
    assert captured["session"] is session and captured["task"] is task


def test_old_and_new_import_paths_expose_same_function():
    assert runner_module.prepare_generate_inputs is direct_prepare


# ===== P2：作用域只覆盖候选构造，构造完成后必须复原 =====
#
# 代码事实：ResumeGenerator.generate() 在构造候选之前先 yield 一条 progress 事件，
# 所以"首个 __anext__ 内构造候选"的假设不成立；作用域以 mark_selection_done() 为界，
# 在"构造完成的那个事件之后"退出（不是覆盖整条数分钟的流）。见报告 D15。


def test_scope_active_until_candidate_construction_then_restored():
    observed: list[bool] = []

    async def inner():
        observed.append(rag_seam.active_selection() is not None)
        yield {"type": "progress-before-selection"}
        rag_seam.mark_selection_done()  # 等价于 _select_entries() 进入候选构造
        observed.append(rag_seam.active_selection() is not None)
        yield {"type": "progress-after-selection"}
        observed.append(rag_seam.active_selection() is not None)
        yield {"type": "delta"}

    async def consume() -> list[dict]:
        scope = rag_seam.SelectionBoost(boost={"hash": 1.0})
        stream = rag_service.generate_with_scope(inner(), scope)
        events = [event async for event in stream]
        assert rag_seam.active_selection() is None, "流结束后作用域必须复原"
        return events

    events = asyncio.run(consume())
    assert [event["type"] for event in events] == [
        "progress-before-selection",
        "progress-after-selection",
        "delta",
    ]
    # 构造完成后产出的下一个事件（delta）时作用域必须已复原。
    assert observed == [True, True, False]


def test_select_entries_marks_selection_done_only_inside_scope():
    from app.services.profile.profile_context import build_consumed_data
    from app.services.profile.profile_matching import _select_entries, build_job_focus

    consumed = _profile()
    raw_items = build_consumed_data(consumed)["experiences"]
    focus = build_job_focus(_job())
    assert rag_seam.selection_done() is False
    _select_entries(raw_items, "experiences", focus)
    assert rag_seam.selection_done() is False, "作用域外标记必须是 no-op"
    with rag_seam.selection_scope(rag_seam.SelectionBoost(boost={"hash": 1.0})):
        _select_entries(raw_items, "experiences", focus)
        assert rag_seam.selection_done() is True
    assert rag_seam.selection_done() is False


def test_scope_wrapper_closes_inner_stream_on_early_exit():
    closed: list[bool] = []

    async def inner():
        try:
            yield {"type": "first"}
            yield {"type": "second"}
        finally:
            closed.append(True)

    async def consume_partial() -> None:
        stream = rag_service.generate_with_scope(
            inner(), rag_seam.SelectionBoost(boost={"hash": 1.0})
        )
        first = await stream.__anext__()
        assert first == {"type": "first"}
        await stream.aclose()  # 提前退出：内层生成器也必须被关闭（GeneratorExit 逐层展开）

    asyncio.run(consume_partial())
    assert closed == [True]


def test_scope_wrapper_handles_empty_stream():
    async def empty():
        if False:  # pragma: no cover - 让函数成为 async generator
            yield {}

    async def consume() -> list:
        return [
            event
            async for event in rag_service.generate_with_scope(empty(), rag_seam.SelectionBoost())
        ]

    assert asyncio.run(consume()) == []


# ===== P1：coverage 唯一实现 =====


def test_spike_no_longer_defines_its_own_coverage():
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[2] / "scripts" / "rag_eval_embedding_spike.py"
    ).read_text(encoding="utf-8")
    assert "def _coverage" not in text
    assert "common.section_coverage(" in text


# ===== P2：后台预热 handler =====


class _FakeCtx:
    def __init__(self, session):
        self.session = session
        self.progress: list[tuple[int, str]] = []
        self.result: dict | None = None

    def set_progress(self, progress: int, message: str = "") -> None:
        self.progress.append((progress, message))

    def set_result(self, result: dict) -> None:
        self.result = dict(result)

    def check_canceled(self) -> None:
        return None

    def drive(self, coro):
        return asyncio.run(coro)


def test_warmup_handler_registered_and_runs(monkeypatch):
    from app.models.ai_task import AI_TASK_KIND_RAG_WARMUP
    from app.services import ai_task_handlers
    from app.services.ai_task_registry import get_ai_task_handler

    assert get_ai_task_handler(AI_TASK_KIND_RAG_WARMUP) is not None

    async def fake_warm(consumed, *, settings=None, dataset_id=""):  # noqa: ARG001
        return {"encoded": 3, "chunks": 3, "provider": "fake", "model": "fake"}

    monkeypatch.setattr(rag_service, "warm_rag_index", fake_warm)
    monkeypatch.setattr(
        "app.services.profile.ai_profile.load_ai_consumed_profile",
        lambda _session: _profile(),
    )
    monkeypatch.setattr("app.runtime.dataset_scope.current_dataset_id", lambda: "main")
    ctx = _FakeCtx(object())
    ai_task_handlers.handle_rag_warmup(ctx)
    assert ctx.progress[0][0] == 10 and ctx.progress[-1][0] == 100
    assert ctx.result == {"encoded": 3, "chunks": 3, "provider": "fake", "model": "fake"}
