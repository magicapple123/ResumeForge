"""「求职助手 P3 工具批」的守卫测试（list_match_analyses / create_interview_experience / create_referral）。

每条工具至少两条：真实落库/返回的正常路径 + 边界。对 ``list_match_analyses`` 另有一条
**分数剔除红线**：夹具里塞进真实的 0-100 参考分（``reference_score``）与按分数排序派生的
``rank``，断言返回的任何一层结构里都不出现分数字段——匹配度只有五类定性结论，数字评分
不能从助手这条链路漏出去。中文标签 / coverage 映射 / 系统提示点名由既有守卫
（``test_assistant_prompt_surface``、``test_assistant_coverage``、``test_assistant_knowledge_audit``）
抓，这里只把关键连带再钉一次，防止将来有人删守卫时静默漏气。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.models.interview_experience import InterviewExperience
from app.models.job_match_batch import JobMatchBatch
from app.models.referral import Referral
from app.schemas.job_match import (
    JobMatchResult,
    MatchCondition,
    MatchReferenceScore,
    MatchScoreDimension,
)
from app.schemas.job_match_batch import JobMatchBatchItem
from app.services.assistant_tools import _TOOLS, execute_tool, tool_names

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROMPT_MD = BACKEND_DIR / "app" / "prompts" / "assistant_system.md"
LABELS_TSX = (
    BACKEND_DIR.parent
    / "frontend"
    / "src"
    / "features"
    / "assistant"
    / "components"
    / "AssistantMessageContent.tsx"
)

# 分数红线：返回结构里这些键一律不许出现（rank 是按参考分排序派生的名次，同样算泄分）。
BANNED_KEYS = {"score", "percent", "confidence", "reference_score", "top_score", "weight", "rank"}


def _payload(db_session, name: str, arguments: dict) -> dict:
    return json.loads(execute_tool(db_session, name, arguments).text)


def _assert_no_score_fields(node) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            assert key not in BANNED_KEYS, f"返回里出现了分数字段：{key}"
            _assert_no_score_fields(value)
    elif isinstance(node, list):
        for item in node:
            _assert_no_score_fields(item)


def _batch_fixture(db_session, advice: str = "硬性门槛未满足，先补齐再投") -> JobMatchBatch:
    """一份带真实参考分的批次快照：分数会进库，但工具返回必须把它剔干净。"""
    result = JobMatchResult(
        hard_conditions=[
            MatchCondition(label="3 年以上后端经验", status="real_gap", evidence="资料中未提供")
        ],
        core_abilities=[
            MatchCondition(label="熟悉 SQL 与索引", status="matched", evidence="项目经历里写过")
        ],
        hard_gate="unmet",
        admission="block",
        advice=advice,
    )
    reference = MatchReferenceScore(
        score=87,
        dimensions=[
            MatchScoreDimension(
                key="skill_coverage", label="技能覆盖", score=90, weight=0.25, evidence="命中 3/4"
            )
        ],
        disclaimer="参考分免责文案",
    )
    completed = JobMatchBatchItem(
        job_id=11,
        job_title="后端工程师",
        company="高分公司",
        status="completed",
        reference_score=reference,
        result=result,
        model="test-model",
        analysis_source="local",
    ).model_dump(mode="json")
    failed = JobMatchBatchItem(
        job_id=12, job_title="前端工程师", company="失败公司", status="failed", error="模型超时"
    ).model_dump(mode="json")
    row = JobMatchBatch(
        requested_count=2,
        completed_count=1,
        failed_count=1,
        items=[completed, failed],
        model="test-model",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


# ===== list_match_analyses =====


def test_list_match_analyses_strips_every_score_field(db_session):
    """夹具里存了 87/90 分与名次，返回里必须一个都不剩，只给定性结论。"""
    _batch_fixture(db_session)

    result = execute_tool(db_session, "list_match_analyses", {})
    payload = json.loads(result.text)

    _assert_no_score_fields(payload)
    for banned in ("87", "90", "%", "reference_score", "top_score"):
        assert banned not in result.text, f"返回文本里泄漏了分数痕迹：{banned}"

    assert payload["总批次"] == 1
    batch = payload["分析记录"][0]
    assert (batch["岗位数"], batch["完成"], batch["失败"]) == (2, 1, 1)
    by_company = {row["公司"]: row for row in batch["岗位分析"]}
    matched = by_company["高分公司"]
    assert matched["状态"] == "completed"
    assert matched["硬性门槛"] == "未满足"
    assert matched["准入结论"] == "不建议投递"
    assert matched["建议"] == "硬性门槛未满足，先补齐再投"
    assert "已匹配 1" in matched["匹配概况"] and "真实缺口 1" in matched["匹配概况"]
    assert by_company["失败公司"]["失败原因"] == "模型超时"

    spec = next(tool for tool in _TOOLS if tool.name == "list_match_analyses")
    assert spec.writes is False


def test_list_match_analyses_strips_score_phrases_from_advice_text(db_session):
    """advice 是 LLM 自由文本：分数可以藏在句子里而非结构化字段里，同样要剥掉。"""
    _batch_fixture(db_session, advice="匹配度 87 分，建议重点准备项目深挖。")

    result = execute_tool(db_session, "list_match_analyses", {})
    payload = json.loads(result.text)

    _assert_no_score_fields(payload)
    advice = payload["分析记录"][0]["岗位分析"][0]["建议"]
    assert "87" not in advice and "分" not in advice and "%" not in advice
    # 剥掉的只是分数表述，建议内容本身不失真。
    assert advice == "匹配度，建议重点准备项目深挖。"
    assert "87" not in result.text


def test_list_match_analyses_drops_advice_that_is_only_a_score(db_session):
    """整句 advice 就是一个分数时，剥完为空 → 字段整体不出现，不给模型留半句。"""
    _batch_fixture(db_session, advice="87 分")

    result = execute_tool(db_session, "list_match_analyses", {})
    payload = json.loads(result.text)

    assert "建议" not in payload["分析记录"][0]["岗位分析"][0]
    assert "87" not in result.text


def test_list_match_analyses_on_empty_db_returns_zero_batches(db_session):
    payload = _payload(db_session, "list_match_analyses", {})
    assert payload["总批次"] == 0
    assert payload["分析记录"] == []


def test_list_match_analyses_orders_batches_newest_first(db_session):
    first = JobMatchBatch(requested_count=1, completed_count=1, failed_count=0, items=[])
    db_session.add(first)
    db_session.commit()
    second = JobMatchBatch(requested_count=2, completed_count=1, failed_count=1, items=[])
    db_session.add(second)
    db_session.commit()

    payload = _payload(db_session, "list_match_analyses", {})
    assert [row["批次"] for row in payload["分析记录"]] == [second.id, first.id]


# ===== create_interview_experience =====


def test_create_interview_experience_persists_and_defaults_to_self_source(db_session):
    result = execute_tool(
        db_session,
        "create_interview_experience",
        {
            "company": "字节跳动",
            "position": "后端开发",
            "questions": ["讲讲 MySQL 索引", "TCP 三次握手"],
            "source": "peer",
            "round_type": "一面",
            "interview_date": "2026-10-01",
        },
    )
    assert result.changed is True
    row = db_session.query(InterviewExperience).filter_by(company="字节跳动").one()
    assert row.position == "后端开发"
    assert row.questions == ["讲讲 MySQL 索引", "TCP 三次握手"]
    assert row.source == "peer"
    assert row.round_type == "一面"

    # 不传 source 时缺省「自己」——口述面经的大多数是自己面的。
    execute_tool(db_session, "create_interview_experience", {"title": "补一条"})
    other = db_session.query(InterviewExperience).filter_by(title="补一条").one()
    assert other.source == "self"


def test_create_interview_experience_rejects_a_completely_empty_entry(db_session):
    with pytest.raises(ValueError):
        execute_tool(db_session, "create_interview_experience", {})

    spec = next(tool for tool in _TOOLS if tool.name == "create_interview_experience")
    assert spec.writes is True


# ===== create_referral =====


def test_create_referral_persists_and_defaults_to_active_status(db_session):
    result = execute_tool(
        db_session,
        "create_referral",
        {
            "company": "某科技公司",
            "position": "后端工程师",
            "referrer_name": "老王",
            "relation": "前同事",
            "channel": "牛客",
        },
    )
    assert result.changed is True
    row = db_session.query(Referral).filter_by(company="某科技公司").one()
    assert row.status == "active", "状态缺省应为进行中（active）"
    assert row.referrer_name == "老王"
    assert row.position == "后端工程师"
    assert row.job_title == "后端工程师", "岗位名快照应与 position 一致"
    assert row.referral_code == "", "未给内推码时归一化为空串"


def test_create_referral_requires_company_or_referrer_and_valid_status(db_session):
    with pytest.raises(ValueError):
        execute_tool(db_session, "create_referral", {})
    with pytest.raises(ValueError):
        execute_tool(db_session, "create_referral", {"company": "某司", "status": "gone"})

    spec = next(tool for tool in _TOOLS if tool.name == "create_referral")
    assert spec.writes is True


# ===== 注册表与连带守卫 =====


def test_p3_tools_are_registered_in_order_with_correct_flags():
    names = tool_names()
    for name in ("list_match_analyses", "create_interview_experience", "create_referral"):
        assert name in names, f"{name} 没有注册进 _TOOLS"
    # 挂 report 段尾：在既有 report 工具之后、search 段（web_search）之前。
    assert names.index("update_reminder") < names.index("list_match_analyses")
    assert names.index("list_match_analyses") < names.index("create_interview_experience")
    assert names.index("create_interview_experience") < names.index("create_referral")
    assert names.index("create_referral") < names.index("web_search")

    writes = {tool.name: tool.writes for tool in _TOOLS}
    assert [
        writes[name]
        for name in ("list_match_analyses", "create_interview_experience", "create_referral")
    ] == [False, True, True]


def test_p3_tools_are_wired_into_the_connected_guards():
    """系统提示点名三个工具（两个写入类是 prompt_surface 守卫的硬要求），前端有中文标签。"""
    prompt = PROMPT_MD.read_text(encoding="utf-8")
    for name in ("list_match_analyses", "create_interview_experience", "create_referral"):
        assert name in prompt, f"工具 {name} 没在系统提示里点名"

    labels = LABELS_TSX.read_text(encoding="utf-8")
    for name in ("list_match_analyses", "create_interview_experience", "create_referral"):
        assert f"{name}:" in labels, f"工具 {name} 缺中文标签"

    # coverage 映射（interview_experience/referral 改「list+create」，job_match 域补只读工具）。
    import test_assistant_coverage  # noqa: PLC0415 - pytest 会把 tests 目录放进 sys.path

    coverage = test_assistant_coverage.COVERAGE
    assert coverage["interview_experience"] == (
        "list_interview_experiences",
        "create_interview_experience",
    )
    assert coverage["referral"] == ("list_referrals", "create_referral")
    assert "list_match_analyses" in coverage["job_match_analysis"]
    assert coverage["job_match_batch"] == ("list_match_analyses",)
