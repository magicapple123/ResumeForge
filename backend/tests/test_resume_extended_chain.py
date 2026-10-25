# SPDX-License-Identifier: Apache-2.0
"""A4 十段链路的 AI 保真部分：grounding 回填、一致性、覆盖度、建议、双语路径。

这些模块在 W14/A4 之前都只有"六类旧栏目"的白名单/映射；新增 schema 不会自动让它们
支持新事实。本文件逐个钉住"新栏目有链路"与"新字段为空时旧行为逐字不变"两件事。

证据分工（交付报告按此引用）：
- grounding 回填：test_restore_selected_sections_*；
- consistency：test_consistency_*；
- coverage：test_coverage_*；
- suggestions：test_suggestion_prompt_*；
- bilingual：test_bilingual_*。
"""

from __future__ import annotations

from app.schemas.resume import ResumeContent
from app.services.resume.bilingual_variants import translatable_paths
from app.services.resume.resume_consistency import check_consistency
from app.services.resume.resume_coverage import find_unwritten_details
from app.services.resume.resume_grounding import restore_selected_sections
from app.services.resume.resume_suggestions import (
    _resume_prompt_data,
    serialize_resume_prompt_data,
)

CREDENTIALS = [
    {"name": "注册会计师", "issuer": "财政部", "status": "pending"},
    {"name": "注册信息安全专业人员", "issuer": "中国信息安全测评中心", "status": "active"},
]
PUBLICATIONS = [{"title": "高并发交易链路稳定性实践", "status": "under_review"}]

# consistency 对旧六栏用直接下标取值，所以候选快照必须带齐这些键（与真实 profile
# prompt data 同形）。
_BASE_CANDIDATES = {
    "educations": [],
    "experiences": [],
    "campus_experiences": [],
    "projects": [],
    "skills": [],
    "awards": [],
}


def _extended_resume() -> ResumeContent:
    return ResumeContent.model_validate(
        {"name": "张三", "credentials": CREDENTIALS, "publications": PUBLICATIONS}
    )


# ===== 1. grounding：restore_selected_sections 回填新栏目 =====


def test_restore_selected_sections_fills_extended_sections():
    resume = ResumeContent(name="张三")
    restored = restore_selected_sections(
        resume,
        {
            "credentials": CREDENTIALS,
            "publications": PUBLICATIONS,
            "projects": [{"name": "统一网关平台", "public_url": "https://example.com/g"}],
        },
    )
    assert [item.name for item in restored.credentials] == ["注册会计师", "注册信息安全专业人员"]
    assert restored.publications[0].status == "under_review"
    assert restored.projects[0].public_url == "https://example.com/g"


def test_restore_selected_sections_is_noop_without_extended_keys():
    """旧链路（候选资料没有新键）必须原样返回同一个对象——不复制、不改一个字段。"""
    resume = ResumeContent.model_validate(
        {"name": "张三", "experience": [{"company": "甲公司"}]}
    )
    assert restore_selected_sections(resume, {}) is resume
    assert restore_selected_sections(resume, {"skills": []}) is resume


# ===== 2. consistency：只有候选里确实有新栏目时才比对（旧链路不变）=====


def test_consistency_flags_credentials_missing_from_candidates():
    warnings = check_consistency(
        _extended_resume(),
        None,
        {**_BASE_CANDIDATES, "credentials": [{"name": "注册会计师"}], "publications": []},
    )
    assert any("证书资质" in message and "注册信息安全专业人员" in message for message in warnings)
    # 候选里确实有"注册会计师"，不应冤枉成虚构。
    assert not any("注册会计师" in message for message in warnings)


def test_consistency_keeps_old_behaviour_without_extended_candidates():
    """候选资料没有新栏目键时，带科研/证照的旧简历不会被新检查冤枉成虚构。"""
    warnings = check_consistency(_extended_resume(), None, dict(_BASE_CANDIDATES))
    assert not any("证书资质" in message or "学术成果" in message for message in warnings)


# ===== 3. coverage：extended 分区 → 身份字段映射 =====


def test_coverage_maps_extended_sections():
    resume = ResumeContent.model_validate({"name": "张三", "credentials": [CREDENTIALS[0]]})
    details = find_unwritten_details(
        resume,
        entry_names={"credentials": ("注册会计师", "注册信息安全专业人员")},
        selection_data={"credentials": [CREDENTIALS[0]]},
    )
    assert len(details) == 1
    assert details[0]["section"] == "credentials"
    assert details[0]["section_label"] == "证书资质"
    # 这条没有进入候选资料（筛选/预算拦下）：按"filtered"报，而不是"模型没写"。
    assert details[0]["filtered"] == ["注册信息安全专业人员"]


def test_coverage_is_unchanged_when_extended_names_are_absent():
    resume = ResumeContent.model_validate({"name": "张三", "projects": [{"name": "甲"}]})
    assert (
        find_unwritten_details(
            resume,
            entry_names={"projects": ("甲",)},
            selection_data={"projects": [{"name": "甲"}]},
        )
        == []
    )


# ===== 4. suggestions：扩展栏目进提示词数据（空时旧提示词不变）=====


def test_suggestion_prompt_data_includes_extended_sections_when_present():
    data = _resume_prompt_data(_extended_resume())
    assert [item["name"] for item in data["credentials"]] == [
        "注册会计师",
        "注册信息安全专业人员",
    ]
    assert data["publications"][0]["title"] == "高并发交易链路稳定性实践"
    serialized = serialize_resume_prompt_data(_extended_resume())
    assert "注册会计师" in serialized


def test_suggestion_prompt_data_is_unchanged_for_old_content():
    """旧简历的提示词数据键集合与 A4 之前一致：不多出 credentials/publications 键。"""
    data = _resume_prompt_data(ResumeContent(name="张三", summary="总结"))
    assert set(data) == {
        "job_intent",
        "summary",
        "projects",
        "experience",
        "campus_experience",
        "education",
        "skills",
        "awards",
    }


# ===== 5. bilingual：科研项目的要点数组进入翻译路径 =====


def test_bilingual_translatable_paths_include_research_project_points():
    paths = translatable_paths(
        {
            "summary": "一段总结",
            "research_projects": [
                {
                    "name": "分布式交易一致性研究",
                    "role": "负责人",
                    "description": ["研究跨库事务一致性。"],
                    "outcomes": ["形成补偿框架。"],
                }
            ],
            "credentials": CREDENTIALS,
        }
    )
    assert "research_projects.0.role" in paths
    assert "research_projects.0.description.0" in paths
    assert "research_projects.0.outcomes.0" in paths
    # 证照没有可翻译的要点数组（名称/机构/状态是事实，不送翻译）。
    assert not [path for path in paths if path.startswith("credentials")]


def test_bilingual_translatable_paths_are_unchanged_for_old_content():
    paths = translatable_paths({"summary": "一段总结", "experience": [{"role": "工程师"}]})
    assert paths == ["summary", "experience.0.role"]
