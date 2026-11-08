# SPDX-License-Identifier: Apache-2.0
"""RAG 策略与可观测性的单元测试（零网络、零数据库，直接实例化消费 DTO）。

守卫的性质：
- boost 只允许内置四分区 + filter_by_job=True 的自建板块，顺序按用户分区顺序；
  名单与 profile_relevance._CONSUMED_VALUE_SECTIONS 逐字一致（漂移即红）；
- 私密 / llm_allowed=False 字段的值永远不出现在 RAG 可见字段里（只暴露字段 id）；
- 自建板块主文本只认 paper_policy.custom_section_text_field，不做字段回退；
- 作用域是 (dataset_id, group_id) 精确相等——A 组 / A 数据集不命中 B；
- 日志只有 7 个白名单字段：未知键丢弃、长文本截断、sk- 密钥只留遮罩。
"""

from __future__ import annotations

import hashlib
import logging

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.rag import rag_observability, rag_policy

# ===== DTO 构造（不建库、不建连接） =====


def _spec(
    field_id: str,
    key: str,
    *,
    llm_allowed: bool = True,
    private: bool = False,
    is_builtin: bool = True,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id=field_id,
        key=key,
        label=key,
        field_type="single_line",
        order=0,
        llm_allowed=llm_allowed,
        webform_allowed=False,
        private=private,
        is_builtin=is_builtin,
    )


def _entry(values: dict[str, str], entry_id: str = "entry-1") -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=0, values=values)


def _section(
    key: str,
    fields: tuple[ConsumedFieldSpec, ...],
    *,
    primary_field_id: str | None = None,
    filter_by_job: bool = False,
) -> ConsumedSection:
    return ConsumedSection(
        key=key,
        name=key,
        form="multi",
        carrier_field_id=None,
        material_only=False,
        primary_field_id=primary_field_id,
        fields=fields,
        entries=(),
        revision=1,
        filter_by_job=filter_by_job,
    )


def _profile(
    sections: tuple[ConsumedSection, ...],
    *,
    group_id: str = "group-a",
    section_order: tuple[str, ...] | None = None,
) -> ConsumedProfile:
    keys = tuple(section.key for section in sections)
    return ConsumedProfile(
        group_id=group_id,
        group_name="A 组",
        is_default=False,
        participating_keys=keys,
        section_order=keys if section_order is None else section_order,
        workspace_revision=1,
        sections={section.key: section for section in sections},
    )


def _custom_fields() -> tuple[ConsumedFieldSpec, ...]:
    return (
        _spec("cf-text", "cf-text", is_builtin=False),
        _spec("cf-note", "cf-note", is_builtin=False),
    )


# ===== boost 白名单 =====


def test_boostable_builtin_sections_are_the_four_value_sections():
    from app.services.profile import profile_relevance

    assert rag_policy.BOOSTABLE_BUILTIN_SECTIONS == (
        "educations",
        "experiences",
        "campus_experiences",
        "projects",
    )
    # 单一来源守卫：RAG 的白名单必须与下游岗位相关性重排的作用范围逐字一致。
    assert rag_policy.BOOSTABLE_BUILTIN_SECTIONS == profile_relevance._CONSUMED_VALUE_SECTIONS


def test_awards_and_skills_are_never_boostable():
    consumed = _profile(
        (
            _section("experiences", (_spec("experiences.company", "company"),)),
            _section("awards", (_spec("awards.name", "name"),)),
            _section("skills", (_spec("skills.name", "name"),)),
        )
    )
    assert rag_policy.is_section_boostable("experiences", consumed)
    assert not rag_policy.is_section_boostable("awards", consumed)
    assert not rag_policy.is_section_boostable("skills", consumed)
    # 不在参与清单里的内置分区同样不允许（条目没进这份简历）。
    assert not rag_policy.is_section_boostable("projects", consumed)


def test_custom_section_boost_requires_filter_by_job():
    consumed = _profile(
        (
            _section("custom:sec-on", (_spec("cf", "cf", is_builtin=False),), filter_by_job=True),
            _section("custom:sec-off", (_spec("cf2", "cf2", is_builtin=False),)),
        )
    )
    assert rag_policy.is_section_boostable("custom:sec-on", consumed)
    assert not rag_policy.is_section_boostable("custom:sec-off", consumed)


def test_boostable_sections_follow_user_section_order():
    consumed = _profile(
        (
            _section("experiences", (_spec("experiences.company", "company"),)),
            _section("awards", (_spec("awards.name", "name"),)),
            _section("custom:sec-on", (_spec("cf", "cf", is_builtin=False),), filter_by_job=True),
            _section("custom:sec-off", (_spec("cf2", "cf2", is_builtin=False),)),
            _section("educations", (_spec("educations.school", "school"),)),
        ),
        section_order=("custom:sec-off", "educations", "custom:sec-on", "awards", "experiences"),
    )
    assert rag_policy.boostable_sections(consumed) == (
        "educations",
        "custom:sec-on",
        "experiences",
    )


# ===== 字段白名单 =====


def test_entry_llm_values_excludes_private_and_unauthorized_fields():
    fields = (
        _spec("experiences.company", "company"),
        _spec("experiences.role", "role", llm_allowed=False),
        _spec("experiences.credential_number", "credential_number", private=True),
        _spec("experiences.note", "note"),
    )
    section = _section("experiences", fields)
    entry = _entry(
        {
            "experiences.company": "某公司",
            "experiences.role": "后端工程师",
            "experiences.credential_number": "A1234567",
            "experiences.note": "   ",
        }
    )
    values = rag_policy.entry_llm_values(section, entry)
    assert values == {"experiences.company": "某公司"}
    # 私密 / 未授权字段：值绝不返回，只暴露字段 id（generation_postprocess 同一判据）。
    assert rag_policy.private_field_ids(section) == (
        "experiences.role",
        "experiences.credential_number",
    )


def test_custom_section_text_uses_only_paper_policy_primary_field():
    section = _section("custom:sec-1", _custom_fields(), primary_field_id="cf-text")
    entry = _entry({"cf-text": "项目正文", "cf-note": "备注不能当正文"})
    assert rag_policy.custom_section_text(section, entry) == "项目正文"


def test_custom_section_text_is_empty_without_primary_field():
    entry = _entry({"cf-text": "项目正文"})
    no_primary = _section("custom:sec-1", _custom_fields(), primary_field_id=None)
    assert rag_policy.custom_section_text(no_primary, entry) == ""
    # 主字段被隐藏（定义里已不存在）= paper_policy 找不到，不回退到其它字段。
    hidden_primary = _section("custom:sec-1", (_custom_fields()[1],), primary_field_id="cf-text")
    assert rag_policy.custom_section_text(hidden_primary, entry) == ""
    private_primary = _section(
        "custom:sec-1",
        (_spec("cf-text", "cf-text", is_builtin=False, private=True),),
        primary_field_id="cf-text",
    )
    assert rag_policy.custom_section_text(private_primary, entry) == ""


def test_is_entry_chunkable_builtin_requires_primary_text():
    section = _section(
        "experiences",
        (_spec("experiences.company", "company"), _spec("experiences.role", "role")),
    )
    assert rag_policy.is_entry_chunkable(section, _entry({"experiences.company": "某公司"}))
    assert not rag_policy.is_entry_chunkable(section, _entry({"experiences.role": "工程师"}))
    # 单例分区（summary）没有 SECTION_PRIMARY_FIELDS 主字段，不成 chunk。
    summary = _section("summary", (_spec("summary.content", "content"),))
    assert not rag_policy.is_entry_chunkable(summary, _entry({"summary.content": "自我介绍"}))
    # 主字段未授权 = 值不可发送，同样不能进索引。
    awards = _section("awards", (_spec("awards.name", "name", llm_allowed=False),))
    assert not rag_policy.is_entry_chunkable(awards, _entry({"awards.name": "金奖"}))


def test_is_entry_chunkable_custom_section_requires_primary_text():
    with_primary = _section("custom:sec-1", _custom_fields(), primary_field_id="cf-text")
    assert not rag_policy.is_entry_chunkable(with_primary, _entry({"cf-note": "备注"}))
    assert rag_policy.is_entry_chunkable(with_primary, _entry({"cf-text": "项目正文"}))
    no_primary = _section("custom:sec-2", _custom_fields())
    assert not rag_policy.is_entry_chunkable(no_primary, _entry({"cf-note": "备注"}))


# ===== 作用域隔离 =====


def _scope_profile() -> ConsumedProfile:
    return _profile((_section("experiences", (_spec("experiences.company", "company"),)),))


def test_scope_key_is_dataset_plus_group():
    consumed = _scope_profile()
    assert rag_policy.scope_key("ds-a", consumed) == ("ds-a", "group-a")


def test_same_scope_rejects_other_group_or_dataset():
    consumed = _scope_profile()
    assert rag_policy.is_same_scope("ds-a", consumed, "ds-a", "group-a")
    # 同一数据集、不同资料组：A 组的索引不得命中 B 组。
    assert not rag_policy.is_same_scope("ds-a", consumed, "ds-a", "group-b")
    # 不同数据集的候选永远不命中（哪怕组 id 撞名）。
    assert not rag_policy.is_same_scope("ds-a", consumed, "ds-b", "group-a")


# ===== 可观测性（日志只有白名单字段） =====


def _sha256_prefix(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def _event(**overrides) -> rag_observability.RagEvent:
    values = {
        "provider": "fake",
        "model": "fake-embedding-v1",
        "candidate_count": 3,
        "hit_sources": ("keyword", "vector"),
        "elapsed_ms": 12.6,
        "fallback_reason": "",
        "hash_prefixes": ("abc123def456",),
    }
    values.update(overrides)
    return rag_observability.RagEvent(**values)


def test_fallback_reasons_cover_required_family():
    required = {
        "disabled",
        "not_configured",
        "timeout",
        "provider_error",
        "invalid_response",
        "index_missing",
        "empty_vectors",
    }
    assert required <= set(rag_observability.FALLBACK_REASONS)
    assert len(rag_observability.FALLBACK_REASONS) == len(set(rag_observability.FALLBACK_REASONS))


def test_hash_prefix_is_stable_sha256_prefix():
    prefix = rag_observability.hash_prefix
    assert prefix("entry-1") == _sha256_prefix("entry-1")
    assert prefix("entry-1") == prefix("entry-1")
    assert prefix("entry-1") != prefix("entry-2")
    # 前缀长度封顶：日志里不允许出现足够反推的完整哈希。
    assert len(prefix("entry-1", 200)) <= 16
    assert len(prefix("entry-1", 0)) >= 1


def test_sanitize_event_drops_unknown_fields_and_normalizes():
    jd = "负责核心交易链路的稳定性建设与容量规划。" * 10
    cleaned = rag_observability.sanitize_event(
        {
            "provider": "p" * 80,
            "model": "m" * 80,
            "candidate_count": "7",
            "hit_sources": ("keyword", "keyword", "vector", ""),
            "elapsed_ms": 12.6,
            "fallback_reason": "timeout",
            "hash_prefixes": ("abc", "abc", "x" * 40),
            "query": jd,
            "resume_text": jd,
        }
    )
    assert set(cleaned) == {
        "provider",
        "model",
        "candidate_count",
        "hit_sources",
        "elapsed_ms",
        "fallback_reason",
        "hash_prefixes",
    }
    assert len(cleaned["provider"]) == 64
    assert len(cleaned["model"]) == 64
    assert cleaned["candidate_count"] == 7
    assert cleaned["hit_sources"] == ("keyword", "vector")
    assert cleaned["elapsed_ms"] == 13
    assert cleaned["hash_prefixes"] == ("abc", "x" * 16)


def test_sanitize_event_redacts_secrets_before_logging():
    cleaned = rag_observability.sanitize_event(
        {"provider": "sk-" + "a" * 24, "model": "sk-" + "b" * 24}
    )
    assert cleaned["provider"] == "sk-***"
    assert cleaned["model"] == "sk-***"


def test_log_rag_event_redacts_secret_and_logs_structured_fields(caplog):
    logger = logging.getLogger("tests.rag.observability")
    event = _event(
        provider="sk-" + "a" * 24,
        model="sk-" + "b" * 24,
        candidate_count=5,
        hit_sources=("keyword", "vector", "keyword"),
        elapsed_ms=9.2,
        fallback_reason="timeout",
        hash_prefixes=(rag_observability.hash_prefix("entry-1"),),
    )
    with caplog.at_level(logging.INFO, logger=logger.name):
        rag_observability.log_rag_event(logger, event)
    text = caplog.text
    assert "rag event" in text
    assert "sk-***" in text
    assert "a" * 24 not in text
    assert "b" * 24 not in text
    assert "candidates=5" in text
    assert "sources=keyword,vector" in text
    assert "elapsed_ms=9" in text
    assert "fallback=timeout" in text
    assert "hashes=" in text


def test_log_rag_event_drops_jd_like_text(caplog):
    jd = "岗位职责：负责高并发服务端研发、稳定性建设与容量规划。" * 20
    logger = logging.getLogger("tests.rag.observability.jd")
    with caplog.at_level(logging.INFO, logger=logger.name):
        rag_observability.log_rag_event(
            logger,
            {
                "provider": "fake",
                "model": "fake-embedding-v1",
                "candidate_count": 0,
                "hit_sources": (),
                "elapsed_ms": 0,
                "fallback_reason": "empty_vectors",
                "hash_prefixes": (),
                "jd": jd,
                "resume_text": jd,
            },
        )
    text = caplog.text
    assert "fallback=empty_vectors" in text
    assert "sources=-" in text
    assert "hashes=-" in text
    assert jd not in text


def test_log_rag_event_truncates_abnormally_long_provider(caplog):
    logger = logging.getLogger("tests.rag.observability.long")
    long_text = "长" * 300
    with caplog.at_level(logging.INFO, logger=logger.name):
        rag_observability.log_rag_event(logger, _event(provider=long_text))
    text = caplog.text
    assert long_text not in text
    assert "长" * 64 in text
