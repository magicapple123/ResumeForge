# SPDX-License-Identifier: Apache-2.0
"""``match_scoring`` 参考分的纯函数测试。

重点钉住两条性质：

1. 参考分是**派生值**：调用后不改变输入 ``JobMatchResult`` 的五类结论与准入结论；
2. 五维常量表结构正确（5 维、权重和为 1、每维都返回 0-100 分）。
"""

from app.schemas.job_match import JobMatchResult, MatchCondition
from app.services.match_scoring import MATCH_SCORE_DIMENSIONS, score_match_result


def _by_key(score):
    return {dimension.key: dimension for dimension in score.dimensions}


def test_dimensions_are_five_and_weights_sum_to_one():
    assert len(MATCH_SCORE_DIMENSIONS) == 5
    assert abs(sum(spec.weight for spec in MATCH_SCORE_DIMENSIONS) - 1.0) < 1e-9


def test_score_returns_five_dimensions_and_disclaimer():
    score = score_match_result(JobMatchResult(), {}, "", "")
    assert 0 <= score.score <= 100
    assert len(score.dimensions) == 5
    assert score.disclaimer


def test_hard_gate_met_vs_unmet():
    met = JobMatchResult(
        hard_conditions=[MatchCondition(label="学历", status="matched")],
        hard_gate="met",
    )
    unmet = JobMatchResult(
        hard_conditions=[MatchCondition(label="学历", status="real_gap")],
        hard_gate="unmet",
    )
    assert _by_key(score_match_result(met, {}, "", ""))["hard_gate"].score == 100
    assert _by_key(score_match_result(unmet, {}, "", ""))["hard_gate"].score == 0


def test_scoring_does_not_change_admission_or_hard_gate():
    """参考分绝不参与、也绝不改变五类结论与准入闸门。"""
    result = JobMatchResult(
        hard_conditions=[MatchCondition(label="硬门槛", status="real_gap")],
        hard_gate="unmet",
        admission="block",
    )
    score_match_result(
        result,
        {"requirements": "需要 3 年经验，熟悉 Python"},
        "",
        "",
    )
    assert result.admission == "block"
    assert result.hard_gate == "unmet"
    # 该结果里唯一的硬条件仍是 real_gap，五类结论没有被评分逻辑改写。
    assert result.hard_conditions[0].status == "real_gap"


def test_jd_keyword_coverage_scores_partial_overlap():
    result = JobMatchResult()
    score = score_match_result(
        result,
        {"requirements": "熟悉 Python 与 机器学习"},
        "",
        "我熟悉 Python",
    )
    coverage = _by_key(score)["jd_keyword_coverage"]
    # 命中一半关键词：既不是满分也不是零分。
    assert 0 < coverage.score < 100


def test_neutral_score_when_no_signals():
    """没有任何信号时给出中性分，而不是误报成 0 分（不匹配）。"""
    score = score_match_result(JobMatchResult(), {}, "", "")
    assert score.score == 50


# ===== 年限维度：按年月计算 + 去重（本轮修复的回归测试）=====
#
# 旧实现按整数年差求和：2023.07–至今 被算成 0.5 年（把「至今」当缺失），资料与简历里
# 同一段经历还会各算一遍，于是 3 年多经历显示成「约 2.0 年」。这里钉住新的口径：
# - 按 (年,月) 计算月数，进行中（至今/缺结束）算到 now 所在月；
# - 同一段经历（company+role+起始月）在资料与简历里只算一次（resume 优先）；
# - 重叠时间段合并，避免并行经历被重复累计；
# - 只有起始月/跨月/实习等边界都有确定结果。

import json  # noqa: E402
from datetime import date  # noqa: E402

from app.services.match_scoring import _estimate_years  # noqa: E402

_NOW = date(2026, 10, 15)


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _exp(company: str, role: str, start: str, end: str) -> dict:
    return {"company": company, "role": role, "start_date": start, "end_date": end}


def test_estimate_years_uses_months_and_counts_ongoing_until_now():
    profile = _json(
        {
            "experiences": [
                {
                    "company": "示例科技",
                    "role": "市场运营",
                    "start_date": "2023.07",
                    "end_date": "至今",
                },
                {
                    "company": "示例文化",
                    "role": "运营实习",
                    "start_date": "2022.06",
                    "end_date": "2022.12",
                },
            ]
        }
    )
    # 2023-07 → 2026-10 = 39 个月；2022-06 → 2022-12 = 6 个月；合计 45 个月 = 3.75 年，
    # 四舍五入到 0.1 年 = 3.8（旧实现会给 1.0：两段各 +0.5）。
    assert _estimate_years(profile, "", now=_NOW) == 3.8


def test_estimate_years_dedupes_same_experience_across_profile_and_resume():
    entry = _exp("示例科技", "市场运营", "2023.07", "至今")
    profile = _json({"experiences": [entry]})
    resume = _json({"content": {"experience": [dict(entry)]}})

    only_profile = _estimate_years(profile, "", now=_NOW)
    both_sources = _estimate_years(profile, resume, now=_NOW)

    assert only_profile == 3.3  # 39 个月 ≈ 3.25 → 3.3
    assert both_sources == only_profile, "同一段经历在资料与简历里不能各算一遍"


def test_estimate_years_internship_and_full_time_are_both_counted():
    profile = _json(
        {
            "experiences": [
                _exp("示例科技", "市场运营", "2023.07", "2026.07"),
                _exp("示例文化", "运营实习", "2022.06", "2022.12"),
            ]
        }
    )
    # 36 + 6 = 42 个月 = 3.5 年（实习也计入：参考分只做展示，不区分实习/全职）。
    assert _estimate_years(profile, "", now=_NOW) == 3.5


def test_estimate_years_merges_overlapping_entries():
    profile = _json(
        {
            "experiences": [
                _exp("示例科技", "市场运营", "2023.07", "2025.01"),
                _exp("示例咨询", "兼职顾问", "2024.01", "2024.06"),
            ]
        }
    )
    # 2023-07..2025-01（18 个月）与 2024-01..2024-07（6 个月）有 6 个月重叠，
    # 合并后 18 个月 = 1.5 年，而不是简单相加的 24 个月 = 2.0 年。
    assert _estimate_years(profile, "", now=_NOW) == 1.5


def test_estimate_years_same_month_counts_one_month():
    profile = _json({"experiences": [_exp("示例科技", "短期项目", "2026.10", "2026.10")]})
    assert _estimate_years(profile, "", now=_NOW) == 0.1


def test_estimate_years_ignores_invalid_and_future_entries():
    profile = _json(
        {
            "experiences": [
                {"company": "缺日期公司", "role": "x"},
                _exp("未来公司", "预入职", "2027.01", "2027.06"),
                _exp("示例科技", "市场运营", "2023.07", "至今"),
            ]
        }
    )
    # 缺起始月的忽略；晚于 now 的起始月按 0 个月处理；只剩有效那段 39 个月 → 3.3。
    assert _estimate_years(profile, "", now=_NOW) == 3.3


def test_estimate_years_handles_chinese_and_dash_date_formats():
    profile = _json(
        {
            "experiences": [
                _exp("示例科技", "市场运营", "2023年7月", "2026年10月"),
                _exp("示例文化", "运营实习", "2022-06", "2022-12"),
            ]
        }
    )
    assert _estimate_years(profile, "", now=_NOW) == 3.8


def test_experience_dimension_evidence_uses_fixed_estimate():
    from app.services.match_scoring import _score_experience_years

    profile = _json({"experiences": [_exp("示例科技", "市场运营", "2023.07", "至今")]})
    score, evidence = _score_experience_years(
        JobMatchResult(), {"requirements": "3 年以上相关经验"}, profile, "", now=_NOW
    )
    assert evidence == "约 3.3 年 / 要求 3 年"
    assert score == 100  # 3.3 >= 3 → 年限维度满分（仅展示分）
