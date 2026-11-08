# SPDX-License-Identifier: Apache-2.0
"""RAG v2 集成验收（计划 §8「集成测试」清单）。

六条性质都是"RAG 只决定哪些条目进入候选、不碰 prompt 字节"的集成层守卫：

1. 冻结快照后切换资料组，检索与候选逐条不漂移（freeze_generation_snapshot + 租约身份）；
2. 改一条内容只让那一条缓存失效，其余继续命中（RagIndex.stats 可断言）；
3. filter_by_job=True 的自建板块能被 boost 召回；False 的板块顺序/取舍不变；
4. fusion/boost 生效时 selected_counts / omitted_counts / entry_names / fallback_sections
   语义仍正确（用户可见诊断不能因换排序而失真）；
5. 数据集 A 的索引键/作用域不会命中数据集 B；
6. 同一输入连续两次候选逐条一致。

全部使用 fake embedding provider：不联网、不调真实 LLM、不读写 data/**。单元级性质
（RRF 定点化、chunk 去重、模型指纹）由 test_rag_chunking / test_rag_hybrid /
test_rag_policy 守住，这里不重复。
"""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

from app.config import Settings
from app.runtime import dataset_scope
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent
from app.services.llm.embeddings import resolve_embedding_spec
from app.services.profile import entry_store, group_store, workspace_bootstrap
from app.services.profile.group_scope import resolve_current_group_scope
from app.services.profile.profile_context import build_consumed_data
from app.services.profile.profile_matching import _score_item
from app.services.profile.profile_reader import load_consumed_profile
from app.services.profile.profile_relevance import build_targeted_consumed_profile_context
from app.services.rag.rag_chunking import build_chunks
from app.services.rag.rag_index import RagIndex, build_index_key
from app.services.rag.rag_policy import is_same_scope
from app.services.rag.rag_seam import SelectionBoost, selection_scope
from app.services.rag.rag_service import prepare_selection_boost
from app.services.resume.generate_snapshot import freeze_generation_snapshot
from app.services.resume.resume_custom_sections import attach_custom_sections
from tests.test_profile_relevance import make_job

# ===== 夹具：纯 DTO 资料（不建库） =====


def _settings(**overrides: Any) -> Settings:
    """RAG 开启 + fake embedding：确定性 hash 向量，不需要模型文件或网络。"""
    return Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="fake",
        rag_embedding_model="fake-embedding-v1",
        rag_embedding_dim=8,
        **overrides,
    )


def _spec(
    field_id: str,
    key: str,
    label: str,
    *,
    field_type: str = "single_line",
    is_builtin: bool = True,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(field_id, key, label, field_type, 1, True, True, False, is_builtin)


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id, 0, values)


def _section(
    key: str,
    name: str,
    fields: list[ConsumedFieldSpec],
    entries: list[ConsumedEntry],
    *,
    primary_field_id: str | None = None,
    filter_by_job: bool = False,
) -> ConsumedSection:
    return ConsumedSection(
        key,
        name,
        "multi",
        None,
        False,
        primary_field_id,
        tuple(fields),
        tuple(entries),
        revision=1,
        filter_by_job=filter_by_job,
    )


def _triple_entries(
    section_key: str, rows: tuple[tuple[str, str, str, str], ...], keys: tuple[str, str, str]
) -> list[ConsumedEntry]:
    """(entry_id, 主字段, 次字段, 描述) × 列键 → 消费条目；字段 id 为「分区.列键」。"""
    return [
        _entry(
            entry_id,
            {
                f"{section_key}.{keys[0]}": first,
                f"{section_key}.{keys[1]}": second,
                f"{section_key}.{keys[2]}": description,
            },
        )
        for entry_id, first, second, description in rows
    ]


_EXPERIENCE_ROWS = (
    ("e1", "甲公司", "后端实习生", "负责后端服务与检索接口开发"),
    ("e2", "乙公司", "运营实习生", "负责活动策划与用户增长"),
)
_PROJECT_ROWS = (
    ("p1", "检索平台", "后端", "实现检索接口与缓存"),
    ("p2", "照片整理", "作者", "整理照片与排版"),
    ("p3", "数据看板", "前端", "搭建可视化看板"),
    ("p4", "活动页面", "负责人", "策划活动页面"),
)
_TRIPLE_KEYS = ("company", "title", "description")
_PROJECT_KEYS = ("name", "role", "description")


def _profile() -> ConsumedProfile:
    experiences = _section(
        "experiences",
        "实习/工作经历",
        [
            _spec("experiences.company", "company", "公司"),
            _spec("experiences.title", "title", "职位"),
            _spec("experiences.description", "description", "描述", field_type="multi_line"),
        ],
        _triple_entries("experiences", _EXPERIENCE_ROWS, _TRIPLE_KEYS),
    )
    projects = _section(
        "projects",
        "项目经历",
        [
            _spec("projects.name", "name", "项目名"),
            _spec("projects.role", "role", "角色"),
            _spec("projects.description", "description", "描述", field_type="multi_line"),
        ],
        _triple_entries("projects", _PROJECT_ROWS, _PROJECT_KEYS),
    )
    skills = _section(
        "skills",
        "专业技能",
        [_spec("skills.name", "name", "技能")],
        [_entry("s1", {"skills.name": "Python"})],
    )
    section_list = (experiences, projects, skills)
    return ConsumedProfile(
        group_id="g-rag",
        group_name="RAG 组",
        is_default=False,
        participating_keys=tuple(section.key for section in section_list),
        section_order=tuple(section.key for section in section_list),
        workspace_revision=3,
        sections={section.key: section for section in section_list},
    )


def _job() -> Any:
    return make_job("后端开发工程师", "负责后端服务与检索接口开发。", "熟悉 Python 与缓存。")


def _plain_job() -> Any:
    """没有任何可识别技能/领域信号的岗位：用来触发"信号不足兜底"分支。"""
    return make_job("运营专员", "负责内容与活动支持。", "沟通能力强。")


def _selection(consumed: ConsumedProfile, job: Any, scope: SelectionBoost | None) -> Any:
    """按生产顺序构造候选：RAG 作用域包住整段候选构造（同 generate_routes）。"""
    with selection_scope(scope):
        return build_targeted_consumed_profile_context(consumed, job)


# ===== 1. 冻结快照后切组不漂移 =====


def _seed_workspace(db: Any) -> None:
    """用当前资料存储层写一份最小可生成资料（不读写旧六表）。"""
    workspace_bootstrap.ensure_workspace(db)
    entry_store.upsert_entry(db, "basic_info", values={"basic_info.name": "张三"})
    entry_store.upsert_entry(
        db, "summary", values={"summary.content": "软件工程本科生，关注后端开发。"}
    )
    entry_store.upsert_entry(
        db,
        "experiences",
        values={
            "experiences.company": "星云科技",
            "experiences.title": "后端实习生",
            "experiences.start_date": "2025.03",
            "experiences.end_date": "2025.08",
            "experiences.description": "使用 Python 与 FastAPI 开发检索接口\n维护缓存",
        },
    )
    entry_store.upsert_entry(
        db,
        "projects",
        values={
            "projects.name": "检索平台",
            "projects.role": "核心开发",
            "projects.tech_stack": "Python, FastAPI",
            "projects.description": "实现检索与召回",
        },
    )
    entry_store.upsert_entry(db, "skills", values={"skills.name": "Python", "skills.level": "熟练"})


async def test_frozen_snapshot_does_not_drift_after_group_switch(db_session):
    _seed_workspace(db_session)
    job = _job()
    settings = _settings()
    index = RagIndex()
    # 生产链路是"先取租约（数据集身份）→ 再冻结消费快照"（PR-03）。
    lease = dataset_scope.acquire_lease("rag-integration")
    try:
        frozen = freeze_generation_snapshot(db_session)
        dataset_id = lease.identity.dataset_id
    finally:
        lease.release()
    assert dataset_id == dataset_scope.current_dataset_id()

    baseline_scope = await prepare_selection_boost(
        frozen.consumed, job, settings=settings, index=index, dataset_id=dataset_id
    )
    assert baseline_scope.fallback_reason == "" and baseline_scope.boost
    baseline = _selection(frozen.consumed, job, baseline_scope)
    assert baseline.data["experiences"] and baseline.data["projects"]
    frozen_values = dict(frozen.consumed.section("experiences").entries[0].values)

    # 冻结之后再切当前组（真实切换入口：group_store.switch_current_group）。
    group = group_store.create_group(db_session, "RAG 三项组")
    group_store.set_group_members(
        db_session, group.group_id, ["experiences", "projects"], expected_revision=group.revision
    )
    state = workspace_bootstrap.ensure_workspace(db_session)
    group_store.switch_current_group(db_session, group.group_id, expected_revision=state.revision)

    switched = load_consumed_profile(db_session, resolve_current_group_scope(db_session))
    assert set(switched.participating_keys) == {"basic_info", "experiences", "projects"}
    assert switched.participating_keys != frozen.consumed.participating_keys

    after_scope = await prepare_selection_boost(
        frozen.consumed, job, settings=settings, index=index, dataset_id=dataset_id
    )
    after = _selection(frozen.consumed, job, after_scope)
    assert after_scope.boost == baseline_scope.boost
    assert after.serialized == baseline.serialized
    # 冻结快照本身不被切组改写（组名/条目值仍是创建态）。
    assert frozen.consumed.group_name == "默认组"
    assert dict(frozen.consumed.section("experiences").entries[0].values) == frozen_values
    # 对照：切组后的新快照确实不同（证明上面的"一致"来自冻结，而不是切换没生效）。
    assert _selection(switched, job, None).serialized != baseline.serialized
    refrozen_keys = set(freeze_generation_snapshot(db_session).consumed.participating_keys)
    assert refrozen_keys == {"basic_info", "experiences", "projects"}


# ===== 2. 改一条只失效那一条 =====


async def test_changing_one_entry_only_invalidates_that_vector():
    consumed = _profile()
    job = _job()
    settings = _settings()
    index = RagIndex()
    chunk_count = len(build_chunks(consumed).chunks)
    assert chunk_count >= 6

    await prepare_selection_boost(consumed, job, settings=settings, index=index)
    stats = index.stats()
    assert stats.size == stats.misses == stats.puts == chunk_count
    assert stats.hits == 0

    # 同一份消费快照第二次：全部命中，不重新编码。
    await prepare_selection_boost(consumed, job, settings=settings, index=index)
    stats = index.stats()
    assert (stats.hits, stats.misses, stats.puts) == (chunk_count, chunk_count, chunk_count)

    # 只改一条（entry_id 不变）：旧向量 key 失效，其余条目继续命中。
    experiences = consumed.sections["experiences"]
    changed_entries = tuple(
        replace(
            entry,
            values={**entry.values, "experiences.description": "新的描述：负责排序与召回"},
        )
        if entry.entry_id == "e1"
        else entry
        for entry in experiences.entries
    )
    changed_sections = dict(consumed.sections)
    changed_sections["experiences"] = replace(experiences, entries=changed_entries)
    changed = replace(consumed, sections=changed_sections)
    await prepare_selection_boost(changed, job, settings=settings, index=index)

    stats = index.stats()
    assert (stats.hits, stats.misses) == (2 * chunk_count - 1, chunk_count + 1)
    assert (stats.puts, stats.size) == (chunk_count + 1, chunk_count + 1)


# ===== 3. filter_by_job 自建板块 =====

_CUSTOM_KEY = "custom:sec-1"


def _custom_profile(*, filter_by_job: bool) -> ConsumedProfile:
    section = _section(
        _CUSTOM_KEY,
        "作品集",
        [
            _spec("cf-title", "cf-title", "标题", is_builtin=False),
            _spec("cf-desc", "cf-desc", "说明", field_type="multi_line", is_builtin=False),
        ],
        [
            _entry("c1", {"cf-title": "摄影合集", "cf-desc": "整理照片与排版"}),
            _entry("c2", {"cf-title": "增长策略复盘", "cf-desc": "沉淀召回玩法"}),
        ],
        primary_field_id="cf-title",
        filter_by_job=filter_by_job,
    )
    return ConsumedProfile(
        group_id="g-custom",
        group_name="自建组",
        is_default=False,
        participating_keys=(_CUSTOM_KEY,),
        section_order=(_CUSTOM_KEY,),
        workspace_revision=1,
        sections={_CUSTOM_KEY: section},
    )


def _custom_job() -> Any:
    return make_job(
        "用户增长分析师", "负责会员分层、召回策略与增长实验。", "熟悉用户分层与指标体系。"
    )


def _custom_preview(
    consumed: ConsumedProfile, job: Any, scope: SelectionBoost | None
) -> tuple[ResumeContent, dict[str, Any]]:
    """按生产顺序：作用域内算 focus + 投影自建板块（attach_custom_sections 是唯一执行点）。"""
    payload: dict[str, Any] = {}
    with selection_scope(scope):
        selection = build_targeted_consumed_profile_context(consumed, job)
        resume = attach_custom_sections(ResumeContent(), consumed, selection.focus, payload)
    return resume, payload


def _custom_names(resume: ResumeContent) -> list[str]:
    return [entry.text for section in resume.custom_sections for entry in section.entries]


def test_custom_section_boost_only_recalls_when_filter_by_job_enabled():
    job = _custom_job()
    enabled = _custom_profile(filter_by_job=True)
    target = build_chunks(enabled).canonical_by_entry[(_CUSTOM_KEY, "c2")]

    # 关键词没命中：没有 boost 时该板块的条目一个都不进纸面（但板块仍在筛选中）。
    plain_resume, plain_payload = _custom_preview(enabled, job, None)
    assert _custom_names(plain_resume) == []
    assert plain_payload["custom_sections"] == [
        {"key": _CUSTOM_KEY, "name": "作品集", "selected": 0, "total": 2}
    ]

    boosted_resume, boosted_payload = _custom_preview(
        enabled, job, SelectionBoost(boost={target: 1.0})
    )
    assert _custom_names(boosted_resume) == ["增长策略复盘"]
    assert boosted_payload["custom_sections"] == [
        {"key": _CUSTOM_KEY, "name": "作品集", "selected": 1, "total": 2}
    ]

    # filter_by_job=False 是用户显式选择的"这个板块不要按岗位筛"：boost 不得改取舍/顺序。
    disabled = _custom_profile(filter_by_job=False)
    plain_order = _custom_preview(disabled, job, None)
    boosted_order = _custom_preview(disabled, job, SelectionBoost(boost={target: 1.0}))
    assert _custom_names(plain_order[0]) == ["摄影合集", "增长策略复盘"]
    assert _custom_names(boosted_order[0]) == _custom_names(plain_order[0])
    assert plain_order[1] == {} and boosted_order[1] == {}


# ===== 4. 诊断语义不失真 =====


async def test_diagnostics_stay_truthful_when_boost_is_active():
    consumed = _profile()
    job = _plain_job()
    settings = _settings()
    # 无信号岗位：不 boost 时两个经历分区走"信号不足兜底"，会被如实登记。
    plain = _selection(consumed, job, None)
    assert set(plain.fallback_sections) == {"experiences", "projects"}

    scope = await prepare_selection_boost(consumed, job, settings=settings, index=RagIndex())
    assert scope.fallback_reason == "" and scope.boost
    boosted = _selection(consumed, job, scope)

    # boost 召回的条目关键词分为 0，但它们不是"信号不足兜底"——不能被误标。
    assert boosted.fallback_sections == ()
    full = build_consumed_data(consumed)
    for section in boosted.selected_counts:
        assert boosted.selected_counts[section] == len(boosted.data[section])
        assert boosted.omitted_counts[section] == (
            len(full.get(section) or []) - boosted.selected_counts[section]
        )
    assert boosted.data == json.loads(boosted.serialized)
    assert boosted.entry_names["experiences"] == ("甲公司", "乙公司")
    assert boosted.entry_names["projects"] == ("检索平台", "照片整理", "数据看板", "活动页面")
    # fake 向量与语义无关（可能负相似度），精确条数不是语义性质；上限由分区名额硬约束。
    from app.services.profile.profile_relevance_constants import section_limit

    assert 1 <= boosted.selected_counts["experiences"] <= section_limit("experiences")
    assert 1 <= boosted.selected_counts["projects"] <= section_limit("projects")

    zero_keyword = [
        item for item in full["projects"] if _score_item(item, "projects", boosted.focus) == 0
    ]
    assert zero_keyword, "前置：该岗位下项目条目关键词分应为 0"
    selected_names = {item["name"] for item in boosted.data["projects"]}
    assert any(item["name"] in selected_names for item in zero_keyword)


# ===== 5. 数据集 A 不命中 B =====


async def test_dataset_a_index_and_scope_do_not_serve_dataset_b():
    consumed = _profile()
    job = _job()
    settings = _settings()
    spec = resolve_embedding_spec(settings)
    assert spec is not None
    chunking = build_chunks(consumed)
    chunk_count = len(chunking.chunks)
    index = RagIndex()

    scope_a = await prepare_selection_boost(
        consumed, job, settings=settings, index=index, dataset_id="dataset-a"
    )
    assert scope_a.fallback_reason == "" and scope_a.boost
    stats = index.stats()
    assert (stats.size, stats.misses, stats.puts) == (chunk_count, chunk_count, chunk_count)

    # 同一 entry_id / content_hash，但数据集不同 → 索引键不同 → 全部未命中（不跨集重复用）。
    scope_b = await prepare_selection_boost(
        consumed, job, settings=settings, index=index, dataset_id="dataset-b"
    )
    stats = index.stats()
    assert (stats.size, stats.hits, stats.misses, stats.puts) == (
        2 * chunk_count,
        0,
        2 * chunk_count,
        2 * chunk_count,
    )
    assert scope_b.boost == scope_a.boost

    for chunk in chunking.chunks:
        keys = [
            build_index_key(
                spec,
                dataset_id=dataset_id,
                group_id=consumed.group_id,
                entry_id=chunk.entry_id,
                content_hash=chunk.content_hash,
            )
            for dataset_id in ("dataset-a", "dataset-b")
        ]
        assert keys[0] != keys[1] and keys[0].content_hash == keys[1].content_hash
    # 作用域策略层：数据集或资料组任一不同即不同作用域。
    assert is_same_scope("dataset-a", consumed, "dataset-b", consumed.group_id) is False
    assert is_same_scope("dataset-a", consumed, "dataset-a", consumed.group_id) is True
    assert is_same_scope("dataset-a", consumed, "dataset-a", "other-group") is False


# ===== 6. 确定性 =====


async def test_same_input_twice_yields_identical_candidates():
    consumed = _profile()
    job = _job()
    settings = _settings()
    first_scope = await prepare_selection_boost(consumed, job, settings=settings, index=RagIndex())
    second_scope = await prepare_selection_boost(consumed, job, settings=settings, index=RagIndex())
    assert first_scope.boost == second_scope.boost
    first = _selection(consumed, job, first_scope)
    second = _selection(consumed, job, first_scope)
    third = _selection(consumed, job, second_scope)
    assert first.serialized == second.serialized == third.serialized
    # chunk 构建也不依赖时钟/随机/PID：同一输入两次逐字段一致。
    assert build_chunks(consumed).chunks == build_chunks(consumed).chunks
