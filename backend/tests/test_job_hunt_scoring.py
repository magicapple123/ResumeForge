# SPDX-License-Identifier: Apache-2.0
"""语义评分测试：解析纪律、封顶、夹取、别名、薪资判定。

这些用例**不需要调模型**——全部打桩在"模型输出的 JSON"上，验证的是
「拿到模型输出之后，程序怎么处理」。模型本身的能力不在这里测。
"""
from __future__ import annotations

import json

import pytest

from app.services.job_hunt.scoring import (
    CAP_CEILINGS,
    COMPONENT_LIMITS,
    build_scoring_prompt,
    parse_semantic_score,
    salary_fit_summary,
)


def _payload(**overrides) -> str:
    base = {
        "role_summary": "AI 应用开发",
        "core_duties": {"evidence": "做过 AIGC 项目", "score": 35},
        "transferable_evidence": {"evidence": "有迁移经验", "score": 20},
        "hard_requirements": {"evidence": "学历满足", "score": 15},
        "tools_industry": {"evidence": "Python/LLM", "score": 8},
        "practical_fit": {"evidence": "地点匹配", "score": 10},
        "caps": [],
        "hard_gaps": [],
        "reason": "整体匹配",
        "missing": "",
    }
    base.update(overrides)
    return json.dumps(base, ensure_ascii=False)


# ---------- 正常解析与求和 ----------


def test_parses_and_sums_components():
    score = parse_semantic_score(_payload())
    assert score.ok is True
    assert score.raw_total == 88  # 35+20+15+8+10
    assert score.total == 88
    assert [c.key for c in score.components] == list(COMPONENT_LIMITS)
    assert all(c.label for c in score.components)


def test_scores_are_clamped_to_limits():
    """模型给超上限的分：夹到上限，不整份作废。"""
    raw = _payload(
        core_duties={"evidence": "x", "score": 99},
        transferable_evidence={"evidence": "x", "score": 99},
    )
    score = parse_semantic_score(raw)
    by_key = {c.key: c.score for c in score.components}
    assert by_key["core_duties"] == 40
    assert by_key["transferable_evidence"] == 25


def test_negative_scores_clamped_to_zero():
    raw = _payload(tools_industry={"evidence": "x", "score": -5})
    score = parse_semantic_score(raw)
    assert next(c.score for c in score.components if c.key == "tools_industry") == 0


# ---------- 封顶 ----------


@pytest.mark.parametrize("cap,ceiling", list(CAP_CEILINGS.items()))
def test_cap_limits_total(cap, ceiling):
    """命中 cap 时总分不超过对应上限（原始分更高也一样）。"""
    score = parse_semantic_score(_payload(caps=[cap]))
    assert score.raw_total == 88
    assert score.total == min(88, ceiling)
    assert score.caps == [cap]


def test_strongest_cap_wins():
    """多个 cap 同时命中：取最严的那个。"""
    score = parse_semantic_score(_payload(caps=["weak_core_transfer", "technical_required"]))
    assert score.total == CAP_CEILINGS["technical_required"]  # 55 < 70


def test_unknown_cap_discarded():
    """模型自造的 cap 值丢弃，不影响总分。"""
    score = parse_semantic_score(_payload(caps=["model_invented_rule"]))
    assert score.caps == []
    assert score.total == 88


# ---------- 缺字段与坏输入 ----------


def test_missing_dimension_is_error():
    raw = json.loads(_payload())
    del raw["tools_industry"]
    score = parse_semantic_score(json.dumps(raw, ensure_ascii=False))
    assert score.ok is False
    assert "tools_industry" in score.error


def test_dimension_without_score_is_error():
    raw = json.loads(_payload())
    raw["core_duties"] = {"evidence": "只有证据没有分"}
    score = parse_semantic_score(json.dumps(raw, ensure_ascii=False))
    assert score.ok is False


def test_invalid_json_is_error():
    score = parse_semantic_score("模型说了一堆废话，没有 JSON")
    assert score.ok is False
    assert "JSON" in score.error


def test_markdown_fenced_json_accepted():
    """模型常把 JSON 包在 ```json 里：应能剥掉。"""
    fenced = "```json\n" + _payload() + "\n```"
    score = parse_semantic_score(fenced)
    assert score.ok is True
    assert score.total == 88


def test_alias_dimension_names_normalized():
    """模型把 transferable_evidence 简写成 transferable：归一后可解析。"""
    raw = json.loads(_payload())
    raw["transferable"] = raw.pop("transferable_evidence")
    score = parse_semantic_score(json.dumps(raw, ensure_ascii=False))
    assert score.ok is True


# ---------- 薪资判定 ----------


def test_salary_overlap_is_negotiable():
    assert "可谈" in salary_fit_summary("15-25K", 10, 20, 30)


def test_salary_below_expectation_penalized():
    assert "低于期望下限" in salary_fit_summary("5-8K", 10, 20, 30)


def test_salary_above_ceiling_not_mismatch():
    """高于期望不是不匹配（不能因此扣职责分）。"""
    assert "超预期" in salary_fit_summary("40-60K", 10, 20, 30)


def test_daily_wage_converted():
    """日薪折算月薪后比较。"""
    summary = salary_fit_summary("130-250元/天", 10, 20, 30)
    assert "低于期望下限" in summary  # 2.86-5.5K


# ---------- 提示词拼装 ----------


def test_prompt_includes_jd_and_salary_verdict():
    prompt = build_scoring_prompt(
        resume="简历正文",
        title="AI 工程师",
        company="某公司",
        jd="负责 AI 应用开发，要求 Python",
        salary="15-25K",
        salary_min=10,
        salary_max=20,
    )
    assert "简历正文" in prompt
    assert "负责 AI 应用开发" in prompt
    assert "可谈" in prompt
    assert "核心职责匹配（0-40 分）" in prompt


def test_prompt_marks_missing_jd():
    """没有 JD 时提示词要明确标注，避免模型凭空编造岗位要求。"""
    prompt = build_scoring_prompt(resume="x", title="t", company="c")
    assert "未提供 JD 正文" in prompt


# ---------- 技能对比（skill_compare）----------


def _with_skills(items) -> str:
    payload = json.loads(_payload())
    payload["skill_compare"] = items
    return json.dumps(payload, ensure_ascii=False)


def test_skill_compare_parsed():
    raw = _with_skills(
        [
            {"skill": "ComfyUI", "status": "matched", "resume_evidence": "用 ComfyUI 编排"},
            {"skill": "剪映", "status": "missing", "resume_evidence": "未体现"},
            {"skill": "即梦", "status": "partial", "resume_evidence": "用过同类工具"},
        ]
    )
    score = parse_semantic_score(raw)
    assert len(score.skill_compare) == 3
    assert [s.status for s in score.skill_compare] == ["matched", "missing", "partial"]
    assert score.skill_compare[0].resume_evidence == "用 ComfyUI 编排"


def test_skill_compare_invalid_status_dropped():
    """非法状态丢弃，不猜成 matched 或 missing。"""
    raw = _with_skills(
        [
            {"skill": "A", "status": "maybe", "resume_evidence": ""},
            {"skill": "B", "status": "matched", "resume_evidence": "有"},
        ]
    )
    score = parse_semantic_score(raw)
    assert len(score.skill_compare) == 1
    assert score.skill_compare[0].skill == "B"


def test_skill_compare_empty_skill_dropped():
    raw = _with_skills([{"skill": "  ", "status": "matched", "resume_evidence": "x"}])
    score = parse_semantic_score(raw)
    assert score.skill_compare == []


def test_skill_compare_capped_at_limit():
    items = [{"skill": f"S{i}", "status": "matched", "resume_evidence": "x"} for i in range(30)]
    score = parse_semantic_score(_with_skills(items))
    assert len(score.skill_compare) == 12


def test_skill_compare_absent_is_empty_not_error():
    """没有技能对比不应让整份评分失败（老输出兼容）。"""
    score = parse_semantic_score(_payload())
    assert score.ok is True
    assert score.skill_compare == []


def test_skill_compare_not_a_list_ignored():
    raw = json.loads(_payload())
    raw["skill_compare"] = "不是列表"
    score = parse_semantic_score(json.dumps(raw, ensure_ascii=False))
    assert score.ok is True
    assert score.skill_compare == []
