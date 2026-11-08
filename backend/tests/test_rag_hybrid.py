# SPDX-License-Identifier: Apache-2.0
"""Wave 2 验收：融合定点化、条目级去重、索引失效粒度、boost 注入接缝。

守卫的性质（计划 §3.3/§4.1/§8）：
- 融合分先 `round(score, 4)` 再比较，平局回落原 index 顺序（不是"看起来稳定"）；
- 同一 entry 跨 chunk 只贡献一个候选；
- 索引缓存按内容哈希失效：改一条只让那一条未命中，其余继续命中；
- boost 只在 `selection_scope` 内生效、只影响可 boost 分区，作用域外行为逐字不变；
- 查询扩展只进 `JobFocus.terms`，skills/domains 原样不动；
- `filter_by_job=True` 的自建板块能被 boost 召回，`False` 的板块不受影响。

全部用纯 DTO + fake embedding provider，不建库、不联网。
"""

from __future__ import annotations

import asyncio
from dataclasses import replace

from app.config import Settings
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.llm.embeddings import EmbeddingModelSpec, FakeEmbeddingProvider
from app.services.profile.profile_custom_filter import plan_custom_section_filter
from app.services.profile.profile_matching import (
    _select_entries,
    build_job_focus,
)
from app.services.profile.profile_relevance import build_targeted_consumed_profile_context
from app.services.rag import rag_seam
from app.services.rag.rag_chunking import build_chunks, canonical_item_hash
from app.services.rag.rag_hybrid import (
    FUSION_ROUND,
    RankedHit,
    build_boost,
    cosine_similarity,
    fuse_rrf,
    keyword_ranking,
    vector_ranking,
)
from app.services.rag.rag_index import RagIndex, build_index_key
from app.services.rag.rag_service import prepare_selection_boost


def _spec(
    field_id: str,
    key: str,
    label: str,
    *,
    field_type: str = "single_line",
    llm_allowed: bool = True,
    private: bool = False,
    is_builtin: bool = True,
):
    return ConsumedFieldSpec(
        field_id, key, label, field_type, 1, llm_allowed, True, private, is_builtin
    )


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id, 0, values)


def _section(
    key, name, fields, entries, *, form="multi", primary_field_id=None, filter_by_job=False
) -> ConsumedSection:
    return ConsumedSection(
        key,
        name,
        form,
        None,
        False,
        primary_field_id,
        tuple(fields),
        tuple(entries),
        revision=1,
        filter_by_job=filter_by_job,
    )


def _job():
    from datetime import UTC, datetime

    from app.schemas.job import JobOut

    now = datetime.now(UTC)
    return JobOut(
        id=1,
        title="用户增长分析师",
        description="负责会员分层、召回策略与增长实验，要求数据驱动。",
        requirements="熟悉用户分层与指标体系。",
        keywords=[],
        created_at=now,
        updated_at=now,
    )


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
            _entry("p2", {"projects.name": "渠道看板", "projects.description": "归因分析"}),
        ],
    )
    skills = _section(
        "skills",
        "专业技能",
        [_spec("skills.name", "name", "技能"), _spec("skills.level", "level", "熟练度")],
        [_entry("s1", {"skills.name": "SQL", "skills.level": "精通"})],
    )
    awards = _section(
        "awards",
        "荣誉奖项",
        [_spec("awards.title", "title", "奖项")],
        [_entry("a1", {"awards.title": "国家奖学金"})],
    )
    sections = {item.key: item for item in (experiences, projects, skills, awards)}
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("experiences", "projects", "skills", "awards"),
        section_order=("experiences", "projects", "skills", "awards"),
        workspace_revision=7,
        sections=sections,
    )


# ===== 融合 =====


def test_fuse_rrf_rounds_scores_to_4_places_and_is_deterministic():
    keyword = (RankedHit("h1", "experiences", 1, 12.0), RankedHit("h2", "projects", 2, 4.0))
    vector = (RankedHit("h2", "projects", 1, 0.9), RankedHit("h3", "projects", 2, 0.8))
    first = fuse_rrf(keyword, vector)
    second = fuse_rrf(keyword, vector)
    assert first.scores == second.scores
    for value in first.scores.values():
        assert value == round(value, FUSION_ROUND)
    assert first.scores["h2"] == round(1 / 62 + 1 / 61, FUSION_ROUND)


def test_fuse_rrf_keeps_disjoint_hits():
    fused = fuse_rrf((RankedHit("only-keyword", "experiences", 1, 8.0),), ())
    assert set(fused.scores) == {"only-keyword"}


def test_keyword_ranking_only_covers_boostable_sections():
    corpus = _profile()
    focus = build_job_focus(_job(), skill_names=["SQL"])
    hits = keyword_ranking(corpus, focus)
    assert hits and all(hit.section_key in {"experiences", "projects"} for hit in hits)


def test_vector_ranking_dedupes_same_entry_across_chunks():
    corpus = _profile()
    chunking = build_chunks(corpus)
    first = chunking.chunks[0]
    duplicated = replace(first, chunk_id=first.chunk_id + ":child")
    vectors = {
        first.chunk_id: (1.0, 0.0),
        duplicated.chunk_id: (0.5, 0.5),
    }
    hits = vector_ranking((first, duplicated), (1.0, 0.0), vectors)
    assert len(hits) == 1
    assert hits[0].canonical_item_hash == first.canonical_item_hash


def test_cosine_similarity_handles_zero_vectors():
    assert cosine_similarity((1.0, 0.0), (1.0, 0.0)) == 1.0
    assert cosine_similarity((0.0, 0.0), (1.0, 0.0)) == 0.0
    assert cosine_similarity((1.0,), (1.0, 0.0)) == 0.0


def test_build_boost_returns_entry_level_scores():
    corpus = _profile()
    chunking = build_chunks(corpus)
    spec = EmbeddingModelSpec("fake", "fake-embedding-v1", 8, "mean")
    vectors = {
        chunk.chunk_id: asyncio.run(_fake_vector(chunk.display_text, spec))
        for chunk in chunking.chunks
    }
    query = asyncio.run(_fake_vector("会员召回", spec))
    focus = build_job_focus(_job())
    fused = build_boost(corpus, focus, chunking, query, vectors)
    assert set(fused.scores) <= set(chunking.entry_by_canonical)
    assert fused.keyword_count >= 1


async def _fake_vector(text: str, spec: EmbeddingModelSpec) -> tuple[float, ...]:
    provider = FakeEmbeddingProvider(spec)
    return await provider.embed_query(text)


# ===== 定点化 / 接缝 =====


def test_boost_ties_fall_back_to_original_index_order():
    corpus = _profile()
    focus = build_job_focus(_job())
    items = corpus.sections["projects"].entries
    raw_items = __import__(
        "app.services.profile.profile_context", fromlist=["build_consumed_data"]
    ).build_consumed_data(corpus)["projects"]
    hashes = [canonical_item_hash("projects", item) for item in raw_items]
    boost = {hashes[0]: 1.00000001, hashes[1]: 1.00000002}
    selected = _select_entries(raw_items, "projects", focus, boost=boost)
    assert [item["name"] for item in selected] == ["增长实验平台", "渠道看板"]
    assert len(items) == 2


def test_scope_only_active_inside_selection_scope():
    corpus = _profile()
    focus = build_job_focus(_job())
    raw_items = __import__(
        "app.services.profile.profile_context", fromlist=["build_consumed_data"]
    ).build_consumed_data(corpus)["experiences"]
    second_hash = canonical_item_hash("experiences", raw_items[1])
    baseline = _select_entries(raw_items, "experiences", focus)
    baseline_order = [item["company"] for item in baseline]
    assert baseline_order  # 前置：非空
    with rag_seam.selection_scope(rag_seam.SelectionBoost(boost={second_hash: 100.0})):
        boosted = _select_entries(raw_items, "experiences", focus)
        assert boosted[0]["company"] == "乙公司"
    after = _select_entries(raw_items, "experiences", focus)
    assert [item["company"] for item in after] == baseline_order


def test_extra_terms_only_touch_terms():
    focus = build_job_focus(_job(), skill_names=["SQL"])
    before_skills = focus.skills
    before_domains = focus.domains
    with rag_seam.selection_scope(
        rag_seam.SelectionBoost(extra_terms=("会员生命周期运营", "用户召回"))
    ):
        expanded = build_job_focus(_job(), skill_names=["SQL"])
    assert expanded.skills == before_skills
    assert expanded.domains == before_domains
    assert "会员生命周期运营" in expanded.terms


# ===== 索引失效粒度 =====


def test_index_invalidates_only_changed_entry():
    spec = EmbeddingModelSpec("fake", "m", 4, "mean")
    index = RagIndex(max_entries=8)
    keys = [
        build_index_key(spec, dataset_id="d", group_id="g", entry_id=f"e{i}", content_hash=f"h{i}")
        for i in range(3)
    ]
    for position, key in enumerate(keys):
        index.put(key, (float(position), 0.0, 0.0, 1.0))
    assert all(index.get(key) is not None for key in keys)
    changed = build_index_key(spec, dataset_id="d", group_id="g", entry_id="e1", content_hash="new")
    assert index.get(changed) is None
    stats = index.stats()
    assert stats.hits == 3 and stats.misses == 1
    assert index.get(keys[0]) is not None
    assert index.get(keys[2]) is not None


def test_index_is_bounded_and_rejects_wrong_dimension():
    spec = EmbeddingModelSpec("fake", "m", 2, "mean")
    index = RagIndex(max_entries=2)
    keys = [
        build_index_key(spec, dataset_id="d", group_id="g", entry_id=f"e{i}", content_hash="h")
        for i in range(3)
    ]
    index.put(keys[0], (1.0, 0.0))
    index.put(keys[1], (1.0, 0.0))
    index.put(keys[2], (1.0, 0.0))
    assert index.stats().size == 2 and index.stats().evictions == 1
    try:
        index.put(keys[0], (1.0,))
    except ValueError:
        pass
    else:  # pragma: no cover - 明确失败而不是静默接受坏向量
        raise AssertionError("维度不符必须报错")


# ===== 自建板块（filter_by_job） =====


def _custom_profile(*, filter_by_job: bool) -> ConsumedProfile:
    section = _section(
        "custom:sec-1",
        "作品集",
        [
            _spec("cf-title", "cf-title", "标题", is_builtin=False),
            _spec("cf-desc", "cf-desc", "说明", field_type="multi_line", is_builtin=False),
        ],
        [
            _entry("c1", {"cf-title": "增长策略复盘", "cf-desc": "沉淀召回玩法"}),
            _entry("c2", {"cf-title": "无关作品", "cf-desc": "摄影合集"}),
        ],
        primary_field_id="cf-title",
        filter_by_job=filter_by_job,
    )
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("custom:sec-1",),
        section_order=("custom:sec-1",),
        workspace_revision=1,
        sections={"custom:sec-1": section},
    )


def test_filter_by_job_true_section_can_be_recalled_by_boost():
    corpus = _custom_profile(filter_by_job=True)
    focus = build_job_focus(_job())
    chunking = build_chunks(corpus)
    target_hash = chunking.canonical_by_entry[("custom:sec-1", "c2")]
    plain = plan_custom_section_filter(corpus, focus)
    assert plain.active
    assert "c2" not in plain.kept["custom:sec-1"]
    with rag_seam.selection_scope(rag_seam.SelectionBoost(boost={target_hash: 1.0})):
        boosted = plan_custom_section_filter(corpus, focus)
    assert "c2" in boosted.kept["custom:sec-1"]


def test_filter_by_job_false_section_ignores_boost():
    corpus = _custom_profile(filter_by_job=False)
    focus = build_job_focus(_job())
    chunking = build_chunks(corpus)
    target_hash = chunking.canonical_by_entry[("custom:sec-1", "c2")]
    with rag_seam.selection_scope(rag_seam.SelectionBoost(boost={target_hash: 1.0})):
        plan = plan_custom_section_filter(corpus, focus)
    assert not plan.active


# ===== 编排回退 =====


def test_prepare_selection_boost_disabled_is_noop():
    scope = asyncio.run(
        prepare_selection_boost(_profile(), _job(), settings=Settings(rag_retrieval_enabled=False))
    )
    assert scope.is_empty
    assert scope.fallback_reason == "disabled"


def test_prepare_selection_boost_unknown_provider_falls_back():
    settings = Settings(rag_retrieval_enabled=True, rag_embedding_provider="unknown")
    scope = asyncio.run(prepare_selection_boost(_profile(), _job(), settings=settings))
    assert scope.fallback_reason == "not_configured"
    assert not scope.boost


def test_prepare_selection_boost_with_fake_provider_produces_scope():
    settings = Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="fake",
        rag_embedding_model="fake-embedding-v1",
        rag_embedding_dim=16,
    )
    scope = asyncio.run(prepare_selection_boost(_profile(), _job(), settings=settings))
    assert scope.fallback_reason == ""
    assert scope.boost


def test_selection_pipeline_is_deterministic_under_scope():
    corpus = _profile()
    settings = Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="fake",
        rag_embedding_model="fake-embedding-v1",
        rag_embedding_dim=16,
    )
    scope = asyncio.run(prepare_selection_boost(corpus, _job(), settings=settings))
    with rag_seam.selection_scope(scope):
        first = build_targeted_consumed_profile_context(corpus, _job()).serialized
    with rag_seam.selection_scope(scope):
        second = build_targeted_consumed_profile_context(corpus, _job()).serialized
    assert first == second
