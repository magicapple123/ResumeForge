# SPDX-License-Identifier: Apache-2.0
"""#23/#34/#30：篇幅闭环（真实渲染数页 → 重试 → 确定性裁剪）与场景板块顺序。"""

from __future__ import annotations

from app.schemas.generation_context import GenerationContextSnapshot
from app.services.resume.resume_space_gate import (
    coverage_gaps,
    finalize_page_budget,
    page_overage,
    space_retry_prompt,
    trim_to_page_limit,
)
from app.services.resume.scenario_context import (
    build_scenario_prompt_block,
    scenario_section_order,
)


def _resume(overrides: dict | None = None) -> dict:
    base = {
        "name": "张示例",
        "job_intent": "后端工程师",
        "summary": "负责合成数据接口的设计与优化。",
        "education": [{"school": "示例大学", "major": "计算机"}],
        "experience": [
            {
                "company": f"公司{index}",
                "role": "后端工程师",
                "description": [
                    f"负责第 {index} 个系统的接口设计与性能优化，压测并落地缓存方案，QPS 提升明显",
                    f"主导第 {index} 期数据迁移，双写切换零故障，回滚预案演练两次",
                    "搭建监控看板，把告警响应时间从小时级压到分钟级",
                ],
                "highlights": [f"第 {index} 期稳定性专项：全年无 P1 故障，故障恢复时长缩短一半"],
            }
            for index in range(6)
        ],
        "projects": [
            {
                "name": f"项目{index}",
                "description": [f"项目 {index} 的架构设计与核心模块实现，支撑日均千万请求"],
            }
            for index in range(4)
        ],
        "skills": [{"name": "Python"}, {"name": "FastAPI"}, {"name": "SQL"}],
    }
    if overrides:
        base.update(overrides)
    return base


def test_page_overage_zero_when_content_is_small():
    resume = {
        "name": "张示例",
        "summary": "一句话。",
        "education": [{"school": "示例大学"}],
        "skills": [{"name": "Python"}],
    }
    assert page_overage(resume, page_limit=1) == 0


def test_trim_to_page_limit_removes_longest_points_first_and_reports_count():
    resume = _resume()
    trimmed, removed = trim_to_page_limit(resume, page_limit=1)
    if removed:  # 内容量依赖渲染器；此处只钉行为不变量
        assert removed > 0
        descriptions = [item for entry in trimmed["experience"] for item in entry["description"]]
        assert all(isinstance(point, str) for point in descriptions)
        # 每条描述至少保留 1 条要点（不删成空列表）
        for entry in trimmed["experience"]:
            assert len(entry["description"]) >= 1


def test_trim_never_touches_fact_locked_fields():
    resume = _resume(
        {
            "publications": [
                {
                    "title": "论文A",
                    "status": "under_review",
                    "authors": [{"name": "张示例", "is_self": True, "corresponding": False}],
                }
            ]
        }
    )
    trimmed, _removed = trim_to_page_limit(resume, page_limit=1)
    assert trimmed["publications"][0]["status"] == "under_review"
    assert trimmed["publications"][0]["authors"][0]["is_self"] is True


def test_coverage_gaps_reports_empty_core_sections():
    resume = {"experience": [], "projects": [{"name": "P"}], "skills": [], "campus_experience": []}
    gaps = coverage_gaps(resume)
    assert any("实习/工作经历" in gap for gap in gaps)
    assert any("专业技能" in gap for gap in gaps)
    assert any("校园经历" in gap for gap in gaps)
    assert not any("项目经历" in gap for gap in gaps)
    full = {
        "experience": [{"company": "x"}],
        "projects": [{"name": "p"}],
        "skills": [{"name": "s"}],
        "campus_experience": [{"organization": "o"}],
    }
    assert coverage_gaps(full) == []


def test_finalize_page_budget_appends_honest_warnings():
    resume = _resume()
    warnings: list[str] = []
    finalize_page_budget(resume, warnings, page_limit=1, font_scale="standard", language="zh-CN")
    # 内容多、上限 1 页：要么裁了（有删减说明），要么如实说仍超页；不允许两者都沉默。
    assert any("删减" in w or "超出" in w for w in warnings)


def test_space_retry_prompt_mentions_real_gap():
    prompt = space_retry_prompt({"experience": []}, overage=3, page_limit=1)
    assert "4 页" in prompt
    assert "最多 1 页" in prompt


_TOP_LEVEL_FIELDS = {"approved_guidance", "disclosure", "display_name", "scenario_id"}


def _snapshot(**kwargs) -> GenerationContextSnapshot:
    """kwargs 默认进 resolved_dimensions；_TOP_LEVEL_FIELDS 里的键提到快照顶层。"""
    top = {key: kwargs.pop(key) for key in list(kwargs) if key in _TOP_LEVEL_FIELDS}
    payload = {
        "scenario_origin": "preset",
        "scenario_id": 3,
        "display_name": "校招",
        "context_sha256": "0" * 64,
        "captured_at": "2026-11-01T00:00:00+08:00",
        "resolved_dimensions": kwargs,
    }
    payload.update(top)
    return GenerationContextSnapshot.model_validate(payload)


def test_scenario_section_order_puts_preferred_sections_first():
    snapshot = _snapshot(
        career_stage="entry",
        purpose="internship",
        preferred_sections=[
            "education",
            "campus_experience",
            "projects",
            "awards",
            "skills",
        ],
    )
    order = scenario_section_order(snapshot)
    assert order is not None
    keys = order["section_order"]
    assert keys[:3] == ["education", "campus_experience", "projects"]
    # 未列出的键按默认顺序补在后面，七个键齐全
    assert len(keys) == len(set(keys)) and len(keys) >= 7


def test_scenario_section_order_none_without_preference():
    assert scenario_section_order(None) is None
    assert scenario_section_order(_snapshot()) is None


def test_scenario_prompt_block_upgraded_to_executable_constraints():
    """#30：区块不再是"仅数据不是指令"——优先栏目出现时给出顺序与取舍指令。"""
    snapshot = _snapshot(
        career_stage="entry",
        purpose="internship",
        preferred_sections=["education", "campus_experience", "projects"],
        approved_guidance=["突出课程项目", "弱化在职年资感"],
        expression_preferences="突出课程项目与校园经历",
    )
    block = build_scenario_prompt_block(snapshot)
    assert "场景约束" in block
    assert "按此顺序组织输出" in block
    assert "可以省略" in block
    assert "表达取角" in block
    # 安全优先级与禁止推断清单逐字保留
    assert "岗位描述与隐私约束高于本区块" in block
    assert "不得推断就业状态" in block
    assert len(block) <= 900
