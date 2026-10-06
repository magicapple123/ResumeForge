"""生成说明（rationale）、未收录清单（coverage_details）与技能误报修复。

这批能力的共同目标：让用户明白"为什么是这样一份简历"，并且不再把资料里
真实存在的技能（从项目描述里带出来的）误报成"疑似虚构"。
"""

from __future__ import annotations

from app.schemas.resume import ResumeContent
from app.services.profile.profile_matching import _MIN_SKILL_CANDIDATES, _select_skills
from app.services.resume.resume_consistency import check_consistency
from app.services.resume.resume_coverage import find_unwritten_details, find_unwritten_items
from app.services.resume.resume_rationale import build_generation_rationale


def _resume() -> ResumeContent:
    return ResumeContent(
        summary="一段总结",
        experience=[
            {"company": "示例科技有限公司", "role": "工程师", "description": ["负责示例模块开发"]}
        ],
        projects=[{"name": "会员增长系统", "role": "前端", "description": ["要点"]}],
        skills=[{"name": "Python", "level": "熟练"}],
    )


def _selected_data(with_excel_project: bool = True) -> dict:
    """候选资料：技能候选里没有 Excel，但项目描述里用到了它。"""
    description = (
        ["用 Excel（VLOOKUP、数据透视表）完成数据核对"] if with_excel_project else ["要点"]
    )
    return {
        "educations": [{"school": "示例大学"}],
        "experiences": [{"company": "示例科技有限公司"}],
        "campus_experiences": [],
        "projects": [
            {"name": "会员增长系统", "tech_stack": ["Python"], "description": description}
        ],
        "skills": [{"name": "Python", "level": "熟练"}],
        "awards": [],
    }


# ===== #2 技能误报修复 =====


def test_skill_from_project_description_is_not_flagged_as_fabrication():
    """Excel 只出现在项目描述里、没进技能候选：不应再报"疑似虚构"。"""
    warnings = check_consistency(_resume(), _selected_data(), _selected_data())
    assert not any("Excel" in warning for warning in warnings)


def test_skill_absent_from_every_candidate_text_is_still_flagged():
    """真不在任何候选文本里的技能仍然要提示核对——豁免不能变成不设防。"""
    # 通过构造器传入（pydantic 会把 dict 转成 ResumeSkill；属性赋值/update 不校验）。
    resume = ResumeContent(
        summary="一段总结",
        experience=[
            {"company": "示例科技有限公司", "role": "工程师", "description": ["负责示例模块开发"]}
        ],
        projects=[{"name": "会员增长系统", "role": "前端", "description": ["要点"]}],
        skills=[{"name": "PhotoShop", "level": "熟练"}],
    )
    warnings = check_consistency(resume, _selected_data(), _selected_data())
    assert any("PhotoShop" in warning for warning in warnings)


def test_two_letter_english_skill_requires_whole_word_match():
    """「Go」这样的两字母技能不能靠子串匹配豁免（会撞上无关单词）。"""
    selected = {
        "educations": [],
        "experiences": [{"company": "示例公司"}],
        "campus_experiences": [],
        "projects": [{"name": "项目A", "description": ["负责 Go 语言服务"]}],
        "skills": [],
        "awards": [],
    }
    resume = ResumeContent(skills=[{"name": "Go", "level": "熟练"}])
    assert check_consistency(resume, selected, selected) == []

    # 整词不出现时仍然提示。
    selected_no_go = {
        "educations": [],
        "experiences": [{"company": "示例公司"}],
        "campus_experiences": [],
        "projects": [{"name": "项目A", "description": ["负责谷歌服务"]}],
        "skills": [],
        "awards": [],
    }
    assert check_consistency(resume, selected_no_go, selected_no_go) != []


# ===== #4 技能候选兜底 =====


def test_skill_candidates_are_padded_to_the_minimum():
    """只有 1 条匹配时按分数补足到下限，模型才有技能可写。"""
    focus = type("Focus", (), {"skills": ("python",), "domains": (), "terms": ()})()
    items = [
        {"name": "Python", "level": "熟练"},
        {"name": "Excel", "level": "熟练"},
        {"name": "R", "level": "了解"},
        {"name": "SQL", "level": "熟练"},
    ]
    # focus.skills 用 tuple；_score_item 对命中的 "Python" 给正分，其余 0 分。
    result = _select_skills(items, {}, focus)  # type: ignore[arg-type]
    assert len(result) >= _MIN_SKILL_CANDIDATES
    # 高分匹配项永远排在前面。
    assert result[0]["name"] == "Python"


# ===== 未收录清单的结构化版本 =====


def test_find_unwritten_details_splits_filtered_and_model_omitted():
    resume = _resume()
    entry_names = {
        "projects": ("会员增长系统", "内部工具迁移"),
        "experiences": ("示例科技有限公司",),
    }
    # 内部工具迁移没进候选（filtered）；会员增长系统进了但简历里没有——等等，它写了。
    # 这里把简历里的项目删掉一个来构造"进了候选但模型没写"。
    resume.projects = []
    selection_data = {
        "projects": [{"name": "会员增长系统"}],
        "experiences": [{"company": "示例科技有限公司"}],
        "educations": [],
        "campus_experiences": [],
        "awards": [],
    }
    details = find_unwritten_details(resume, entry_names, selection_data)
    project = next(note for note in details if note["section"] == "projects")
    assert project["filtered"] == ["内部工具迁移"]
    assert project["model_omitted"] == ["会员增长系统"]
    # 旧的文本警告继续由 find_unwritten_items 从 details 拼出来（分桶后逐字段一致）。
    items = find_unwritten_items(resume, entry_names, selection_data)
    assert items and "手动调整" in items[0]


# ===== 生成说明 =====


def test_generation_rationale_explains_targeted_selection():
    from types import SimpleNamespace

    text = build_generation_rationale(
        job=SimpleNamespace(title="产品运营", company="示例"),
        selection_counts={"projects": 2, "experiences": 3, "skills": 6},
        omitted_counts={"projects": 1},
        focus_skills=("数据分析",),
        focus_domains=("产品运营",),
        coverage_details=[
            {
                "section_label": "项目经历",
                "names": ["Amazon ESG"],
                "filtered": ["Amazon ESG"],
                "model_omitted": [],
                "total": 1,
            }
        ],
        baseline_confirmed=[],
    )
    assert "产品运营" in text
    assert "候选资料组成" in text
    assert "Amazon ESG" in text
    assert "没有进入候选资料" in text


def test_generation_rationale_for_general_resume_mentions_budget_only():

    text = build_generation_rationale(
        job=None,
        selection_counts={"projects": 3},
        omitted_counts={},
        focus_skills=(),
        focus_domains=(),
        coverage_details=[],
        baseline_confirmed=[],
    )
    assert "通用简历" in text
    assert "没有按任何岗位" in text
