# SPDX-License-Identifier: Apache-2.0
"""A4/§8.5 跨行业（非技术）岗位筛选回归。

背景：岗位相关性筛选长期以技术岗为主要样本。非技术 JD 的用词与技能名常常不同字
（JD 写「排班管理」、经历写「排班、库存」），DOMAIN_SIGNALS 也没有覆盖护理/会计/教师
等方向。旧实现会把这些岗位的**全部经历/项目/技能筛空**，模型只能凭 JD 编造——正是
计划 §8.5 要求修复的"把所有经历筛空或编造关键词"。

本文件把修复后的契约固定下来：

1. 未识别领域（DOMAIN_SIGNALS 为空）且无显式技能信号、或至少一个技能命中时：
   保留少量**真实**经历/项目/技能作候选，并在生成说明里如实解释"交集较少"；
2. 识别出领域但资料毫无证据时保持严格（不拿无关经历填充，旧回归仍然绿）；
3. 候选只能来自用户资料，不得凭空生成任何条目/技能。
"""

from __future__ import annotations

from datetime import datetime

import pytest
from app.schemas.job import JobOut
from app.schemas.profile import ProfileOut
from app.services.profile.profile_relevance import build_targeted_profile_context
from app.services.resume.resume_rationale import build_generation_rationale

# 覆盖计划 §3.2 的 12 个行业/职能组中**非技术或弱技术**的岗位标题与要求。
# 用同一份"多行业真实事实"资料去筛，验证不会出现整段筛空。
CROSS_INDUSTRY_JOBS = [
    ("护士", "病房护理；执行医嘱；健康教育；静脉穿刺"),
    ("门店店长", "排班管理；库存盘点；顾客投诉处理"),
    ("会计", "总账核算；纳税申报；财务软件"),
    ("小学教师", "备课授课；班级管理；家校沟通"),
    ("物流调度员", "线路调度；仓储盘点；异常处理"),
    ("社会工作者", "个案跟进；社区活动；资源链接"),
    ("质量检验员", "抽检流程；检验记录；异常反馈"),
    ("客服主管", "客诉处理；服务话术；团队排班"),
    ("厨师", "后厨备料；出餐质量；食品安全"),
    ("行政专员", "会议安排；办公采购；档案管理"),
    ("销售顾问", "客户拜访；报价跟单；回款跟进"),
    ("自由摄影师", "商业拍摄；客户沟通；后期修图"),
]

# 12 类岗位都能用到的一份"真实多行业事实"资料（虚构但具体）。
PROFILE = ProfileOut.model_validate(
    {
        "id": 1,
        "name": "示例用户",
        "job_intent": "多行业实践",
        "summary": "多年一线服务与协作经验。",
        "educations": [
            {"id": 1, "school": "示例职业学校", "major": "护理", "degree": "大专"}
        ],
        "experiences": [
            {
                "id": 1,
                "company": "示例医院",
                "role": "护理员",
                "description": "病房护理与交接班。\n执行医嘱与健康教育。",
            },
            {
                "id": 2,
                "company": "示例连锁门店",
                "role": "值班主管",
                "description": "排班、库存盘点与顾客投诉处理。",
            },
            {
                "id": 3,
                "company": "示例物流园",
                "role": "调度员",
                "description": "线路调度；仓储盘点；异常件处理。",
            },
            {
                "id": 4,
                "company": "示例社区服务中心",
                "role": "社工",
                "experience_kind": "volunteer",
                "description": "个案跟进；组织社区活动；链接外部资源。",
            },
            {
                "id": 5,
                "company": "示例设计工作室",
                "role": "自由摄影师",
                "experience_kind": "self_employed",
                "description": "商业拍摄；客户沟通；后期修图。",
            },
        ],
        "campus_experiences": [],
        "projects": [
            {
                "id": 1,
                "name": "社区慢病随访",
                "role": "负责人",
                "description": "组织随访与记录。",
            }
        ],
        "skills": [
            {"id": 1, "name": "静脉穿刺", "level": "熟练"},
            {"id": 2, "name": "排班管理", "level": "熟练"},
            {"id": 3, "name": "库存盘点", "level": "掌握"},
            {"id": 4, "name": "客诉处理", "level": "熟练"},
            {"id": 5, "name": "后期修图", "level": "熟练"},
        ],
        "awards": [{"id": 1, "name": "示例服务之星", "date": "2023-12"}],
    }
)


def _job(title: str, requirements: str) -> JobOut:
    now = datetime.now()
    return JobOut.model_validate(
        {
            "id": 1,
            "title": title,
            "company": "示例公司",
            "description": "",
            "requirements": requirements,
            "created_at": now,
            "updated_at": now,
        }
    )


def _rationale(selection) -> str:
    return build_generation_rationale(
        job=_job("示例岗位", ""),
        selection_counts=selection.selected_counts,
        omitted_counts=selection.omitted_counts,
        focus_skills=selection.focus.skills,
        focus_domains=selection.focus.domains,
        coverage_details=[],
        baseline_confirmed=[],
        fallback_sections=selection.fallback_sections,
    )


PROFILE_SKILLS = {item.name for item in PROFILE.skills}
PROFILE_COMPANIES = {item.company for item in PROFILE.experiences}
PROFILE_PROJECTS = {item.name for item in PROFILE.projects}


@pytest.mark.parametrize(("title", "requirements"), CROSS_INDUSTRY_JOBS)
def test_non_tech_jobs_never_screen_out_every_experience(title, requirements):
    """12 个非技术岗位：至少保留 1 段经历、1 个技能，且全部来自资料原文。"""
    selection = build_targeted_profile_context(PROFILE, _job(title, requirements))
    data = selection.data

    assert data["experiences"], f"{title}：经历被全部筛空"
    assert data["skills"], f"{title}：技能被全部筛空"
    assert data["projects"], f"{title}：项目被全部筛空"
    assert {item["company"] for item in data["experiences"]} <= PROFILE_COMPANIES
    assert {item["name"] for item in data["skills"]} <= PROFILE_SKILLS
    assert {item["name"] for item in data["projects"]} <= PROFILE_PROJECTS


@pytest.mark.parametrize(("title", "requirements"), CROSS_INDUSTRY_JOBS)
def test_fallback_is_explained_in_the_generation_rationale(title, requirements):
    """兜底候选必须在生成说明里如实解释"交集较少"，不能假装是匹配项。"""
    selection = build_targeted_profile_context(PROFILE, _job(title, requirements))
    rationale = _rationale(selection)

    if selection.fallback_sections:
        assert "没有直接同词交集" in rationale
        assert "资料里没有的岗位要求不会编写" in rationale


def test_explicit_skill_without_profile_evidence_stays_strict():
    """JD 有显式技能信号、但资料毫无对应证据时不得拿无关经历填充（旧行为回归）。

    与「未识别领域」的区分点：这里 focus.skills 非空且没有任何技能命中，
    说明系统知道岗位要什么、只是资料里没有，空候选是诚实的；未识别领域时
    focus.skills 为空（只有标题词），才允许最小兜底。
    """
    tech_job = _job("Kubernetes 运维工程师", "负责集群运维；熟悉 Kubernetes")
    selection = build_targeted_profile_context(PROFILE, tech_job)

    assert selection.focus.skills == ("Kubernetes",)
    assert selection.focus.domains == ()
    assert selection.data["experiences"] == []
    assert selection.data["skills"] == []
    assert selection.fallback_sections == ()
    assert "没有直接同词交集" not in _rationale(selection)


def test_matched_domain_keeps_strict_filtering():
    """技术岗位且资料有匹配时：只留命中条目，不混入零分条目（既有语义不变）。"""
    tech_profile = ProfileOut.model_validate(
        {
            "id": 1,
            "name": "示例",
            "experiences": [
                {"id": 1, "company": "示例科技", "role": "后端工程师", "description": "使用 Python 与 FastAPI。"},
                {"id": 2, "company": "示例餐厅", "role": "服务员", "description": "点单与传菜。"},
            ],
            "projects": [],
            "skills": [{"id": 1, "name": "Python", "level": "熟练"}],
        }
    )
    job = _job("后端开发工程师", "熟悉 Python 与 FastAPI")
    selection = build_targeted_profile_context(tech_profile, job)

    assert [item["company"] for item in selection.data["experiences"]] == ["示例科技"]
    assert selection.fallback_sections == ()


def test_only_title_terms_without_skills_still_keeps_candidates():
    """只有标题词、没有任何技能/领域信号（典型"未识别领域"）时也要保留候选。"""
    selection = build_targeted_profile_context(PROFILE, _job("会计", ""))

    assert selection.focus.skills == ()
    assert selection.focus.domains == ()
    assert selection.fallback_sections, "未识别领域应触发最小候选兜底"
    assert selection.data["experiences"]
    assert selection.data["skills"]
