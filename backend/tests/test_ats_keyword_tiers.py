# SPDX-License-Identifier: Apache-2.0
"""ATS 抽词四规则与两档覆盖率（问题 5）。

四条验收直接对应四个用例组：

1. 复合词切分：``Vue/React/Element`` 是 3 个词；
2. 白名单优先：``plus`` / ``vibe`` / ``coding`` / ``orm`` / 不在词库的 ``api`` 不再出现；
3. 中文短语有边界：``实现数据`` / ``类产品`` / ``搭建高性能`` 不再出现；
4. 别名归一：``Postgres`` ↔ ``PostgreSQL`` 这类写法差异算命中；
5. 两档覆盖率：补充词不进核心分母。
"""

from __future__ import annotations

import pytest
from app.schemas.resume import ResumeContent, ResumeSkill
from app.services.ats_check import (
    _MAX_TARGET_KEYWORDS,
    _jd_chinese_phrases,
    _jd_tech_tokens,
    _keyword_analysis,
    _keyword_issues,
    _target_tiers,
    _total_score,
    check_ats,
    load_keywords,
    normalize_alias,
    split_compound,
)

# 一份真实形状的 JD：复合词、连写别名、口语词、可切碎的中文短语、日期与区间全都有。
_SAMPLE_JD = (
    "岗位职责：负责 Vue/React/Element 前端开发，熟悉 SpringBoot/SpringCloud 微服务，"
    "MyBatis Plus/JPA 持久层，PostgreSQL/MySQL 调优，ECharts/antv/g2plot 数据可视化。"
    "实现数据可视化平台，支持数据仓库建设，搭建高性能数据服务，各类产品需求分析。"
    "要求 1-2 秒内响应，2024-08 之后上线，有 vibe coding 经验，熟悉 API 设计与 ORM 使用。"
)


def _resume(**overrides) -> ResumeContent:
    payload = {
        "name": "林晓样",
        "phone": "13800001234",
        "email": "linxiaoyang@example.com",
        "job_intent": "后端开发工程师",
        "summary": "3 年后端开发经验",
    }
    payload.update(overrides)
    return ResumeContent(**payload)


def _words(result) -> list[str]:
    return [hit["keyword"] for hit in result.keyword_hits]


def _lowered(result) -> set[str]:
    return {word.lower() for word in _words(result)}


def test_compound_token_splits_into_independent_keywords():
    result = check_ats(_resume(), jd_text="要求 Vue/React/Element 开发经验")
    lowered = _lowered(result)
    assert {"vue", "react", "element"} <= lowered
    # 整串不能再出现在目标词里：简历里不可能这样写，命中率恒为 0。
    assert "vue/react/element" not in lowered


def test_split_compound_keeps_library_tokens_intact():
    # C++ / CI/CD 这类"分隔符本身就是词的一部分"的写法不能被切坏。
    assert split_compound("scikit-learn") == ["scikit", "learn"]
    keys = {word.lower(): word for word in load_keywords()}
    assert _jd_tech_tokens("熟悉 C++ 与 CI/CD", keys) == ["c++", "ci/cd"]


def test_generic_tokens_and_fragments_are_dropped():
    result = check_ats(_resume(), jd_text=_SAMPLE_JD)
    assert not _lowered(result) & {"plus", "vibe", "coding", "orm", "api"}


def test_chinese_fragments_are_not_keywords():
    result = check_ats(_resume(), jd_text=_SAMPLE_JD)
    words = set(_words(result))
    for fragment in ("实现数据", "支持数据", "类产品", "搭建高性能"):
        assert fragment not in words
    # 剩下的应当是完整短语而不是从任意汉字位置切出来的碎片。
    assert "数据可视化平台" in words


def test_date_and_range_are_not_split_into_tokens():
    assert _jd_tech_tokens("要求 1-2 秒内响应，2024-08 上线", {}) == []
    assert _jd_chinese_phrases("要求 1-2 秒内响应，2024-08 上线") == []


def test_alias_variants_are_normalized():
    assert normalize_alias("Postgres") == "PostgreSQL"
    assert normalize_alias("k8s") == "Kubernetes"
    assert normalize_alias("React.js") == "React"
    assert normalize_alias("SpringBoot") == "Spring Boot"
    assert normalize_alias("MyBatis Plus") is None  # 多词写法在分词前按短语替换
    assert normalize_alias("Golang") == "Go"


@pytest.mark.parametrize(
    ("canonical", "jd_form", "resume_form"),
    [
        ("PostgreSQL", "Postgres", "PostgreSQL"),
        ("Kubernetes", "k8s", "Kubernetes"),
        ("React", "React.js", "React"),
        ("Spring Boot", "SpringBoot", "Spring Boot"),
        ("MyBatis-Plus", "MyBatis Plus", "MyBatis-Plus"),
        ("Go", "Golang", "Go 语言"),
    ],
)
def test_alias_spelling_difference_counts_as_hit(canonical: str, jd_form: str, resume_form: str):
    result = check_ats(_resume(summary=f"熟悉 {resume_form}"), jd_text=f"要求 {jd_form}")
    assert canonical in result.matched_keywords
    assert canonical not in result.missing_keywords


def test_supplementary_words_do_not_enter_core_denominator():
    # 命中一个核心词（Python），JD 里另外塞入若干与简历无关的补充词。
    result = check_ats(
        _resume(summary="熟悉 Python", skills=[ResumeSkill(name="Python")]),
        jd_text="要求 Python，加分项：Kubernetes 调优、gRPC 网关、Flink 实时计算、数据治理",
    )
    tiers = {hit["keyword"]: hit["tier"] for hit in result.keyword_hits}
    assert tiers["Python"] == "core"
    assert result.coverage_ratio == pytest.approx(1.0)
    assert 0.0 <= result.supplementary_coverage_ratio < 1.0
    # 补充词不产生扣分条目：核心词全覆盖时不该报"关键词覆盖不足"。
    assert "关键词覆盖不足" not in {issue.title for issue in result.issues}


def test_without_jd_there_are_no_target_keywords():
    """没有 JD 就没有目标词：不拿内置词库顶替（非技术岗位会被系统性误判）。"""
    result = check_ats(_resume())
    assert result.keyword_hits == []
    assert result.matched_keywords == []
    assert result.missing_keywords == []
    assert result.coverage_ratio is None
    assert result.supplementary_coverage_ratio == 0.0
    assert _target_tiers("", load_keywords()) == ([], [])


def test_target_keywords_are_capped_per_tier():
    core, supplemental = _target_tiers(_SAMPLE_JD, load_keywords())
    assert 0 < len(core) <= _MAX_TARGET_KEYWORDS
    assert 0 < len(supplemental) <= _MAX_TARGET_KEYWORDS
    # 两档不重叠：同一个词不能既算核心又算补充。
    assert not {word.lower() for word in core} & {word.lower() for word in supplemental}


# ===== 覆盖率口径（2026-11 问题 1）：没有分母不许当满分 =====


def test_zero_coverage_gets_no_keyword_score():
    """覆盖率 0% 的简历：关键词分项 ≤10，总分被显著拉低（旧口径：关键词 98、总分 92）。"""
    zero = check_ats(_resume(), jd_text="要求熟悉 Kubernetes 与 gRPC")
    full = check_ats(
        _resume(summary="熟悉 Kubernetes 与 gRPC", skills=[ResumeSkill(name="Kubernetes")]),
        jd_text="要求熟悉 Kubernetes 与 gRPC",
    )

    assert zero.coverage_ratio == 0.0
    assert zero.subscores["keyword"] <= 10
    assert full.coverage_ratio == pytest.approx(1.0)
    assert full.subscores["keyword"] == 100
    # 两份简历的格式/位置项几乎相同，分数差全部来自关键词项。
    assert full.score - zero.score >= 15


def test_coverage_issue_severity_follows_missing_ratio():
    """缺得越多越显眼：≥60% 缺失 high、≥25% medium、其余 low。"""
    high = check_ats(_resume(), jd_text="要求熟悉 Kubernetes 与 gRPC")
    # 5 个核心词命中 4 个 → 缺 20%，落在 low 档。
    low = check_ats(
        _resume(summary="熟悉 Kubernetes、Docker、Kafka、Redis"),
        jd_text="要求熟悉 Kubernetes、Docker、Kafka、Redis、MySQL",
    )

    high_issue = next(issue for issue in high.issues if issue.title == "关键词覆盖不足")
    low_issue = next(issue for issue in low.issues if issue.title == "关键词覆盖不足")
    assert high_issue.severity == "high"
    assert low_issue.severity == "low"
    assert low.coverage_ratio == pytest.approx(0.8)


def test_empty_core_falls_back_to_supplementary_denominator():
    """核心词为空时用"核心 + 补充"做分母，而不是记 100%。"""
    # JD 里没有一个词库词，只有自由技术 token / 中文短语 → 全部落在补充档。
    analysis = _keyword_analysis(_resume(), "要求熟悉 FooBar 平台开发")
    assert analysis.core_target == []
    assert analysis.supplementary_target
    assert analysis.coverage_ratio == 0.0
    # 分母是补充词时也必须出问题条目，否则分数掉了却没有任何解释。
    issues = _keyword_issues(analysis)
    assert [issue.title for issue in issues] == ["关键词覆盖不足"]
    assert issues[0].severity == "high"


def test_no_comparable_keywords_reports_none(monkeypatch):
    """词库与 JD 都抽不出词 → 覆盖率是 None（前端显示"需要 JD"）。"""
    from app.services import ats_keywords

    monkeypatch.setattr(ats_keywords, "load_keywords", lambda: ())
    analysis = ats_keywords._keyword_analysis(_resume(), "")
    assert analysis.coverage_ratio is None
    assert analysis.target == []
    # 没有目标就没有"未覆盖"：既不出条目，也不参与计分。
    assert ats_keywords._keyword_issues(analysis) == []
    # 分项不参与计分：缺 keyword 分项时总分算不出来（不是按满分 100 计）。
    assert _total_score({"format": 90, "position": 80}) is None


def test_old_import_surface_still_works():
    """拆文件后 ``ats_check`` 的对外导入面与 monkeypatch 落点必须照旧可用（问题 5 验收 6）。"""
    from app.services import ats_check

    for name in (
        "_jd_tech_tokens",
        "_jd_chinese_phrases",
        "_jd_library_hits",
        "_target_keywords",
        "_strip_phrase_noise",
        "_CHINESE_PHRASE_RE",
        "_CHINESE_SUFFIXES",
        "_JD_TOKEN_RE",
        "_JD_STOPWORDS",
        "_MAX_TARGET_KEYWORDS",
        "load_keywords",
        "parse_check_issues",
    ):
        assert hasattr(ats_check, name), name
