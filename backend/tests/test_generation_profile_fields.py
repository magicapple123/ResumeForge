# SPDX-License-Identifier: Apache-2.0
"""F8-E（R-81）验收：生成结果按 F3 快照条目身份做槽位确定性回填。

覆盖契约 §4：
- 资料侧有值、结果侧槽位为空 → 写入（文本字段 + experience_kind 的中文→code 映射）；
- AI 已写值不被覆盖；
- 未参与当前组的分区不回填；
- hidden 字段不回填（消费快照已在 reader 剔除）；
- 未匹配到来源条目的简历条目不补造；
- 超长源值按模型 max_length 截断，永不抛异常（不阻断保存）；
- 字段清单唯一来源 paper_policy.BACKFILL_SLOT_KEYS / SlotRule.backfill（不复制契约表）；
- 真实生成链路 ResumeGenerator.generate 端到端回填（SSE/后台共用同一条链）。
"""

from app.schemas.resume import GenerateOptions, ResumeContent
from app.services.profile import entry_store, field_preferences
from app.services.profile.paper_policy import BACKFILL_SLOT_KEYS, SECTION_RULES
from app.services.resume.generation_postprocess import apply_profile_field_backfill
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_profile_group_budget import (
    all_sections_consumed,
    seed_profile,
    seven_sections_consumed,
)
from tests.test_profile_relevance import CapturingProvider, make_job

# 契约 §1 的 20 个字段：seed 进资料的值。
EDUCATION_F8 = {
    "educations.study_form": "全日制",
    "educations.degree_type": "学士",
    "educations.department": "计算机学院",
    "educations.rank": "前 5%",
    "educations.advisor": "张伟",
    "educations.research_direction": "自然语言处理",
}
EXPERIENCE_F8 = {"experiences.team_size": "5 人", "experiences.work_type": "实习"}
PROJECT_F8 = {"projects.project_size": "10 人月", "projects.outcome_type": "开源项目"}
SKILL_F8 = {"skills.category": "编程语言"}
CAMPUS_F8 = {"campus_experiences.activity_type": "学生会"}
AWARD_F8 = {"awards.issuer": "学校", "awards.level": "校级", "awards.award_ratio": "前 10%"}
PUBLICATION_F8 = {
    "publications.outcome_type": "期刊论文",
    "publications.authorship_rank": "第一作者",
}
RESEARCH_F8 = {"research_projects.level": "校级", "research_projects.funding": "10 万元"}
CREDENTIAL_F8 = {"credentials.credential_type": "职业资格"}


def _job():
    return make_job("后端开发工程师", "负责后端服务与 RESTful API 开发。", "熟悉 Python。")


def _update(db, section_key, values, index=0):
    entry = entry_store.list_entries(db, section_key=section_key)[index]
    entry_store.upsert_entry(
        db,
        section_key,
        entry_id=entry.entry_id,
        values=dict(values),
        expected_revision=entry.revision,
    )


def _seed_f8(db):
    seed_profile(db)
    _update(db, "educations", EDUCATION_F8)
    _update(db, "experiences", EXPERIENCE_F8)
    _update(db, "projects", PROJECT_F8)
    _update(db, "skills", SKILL_F8)
    _update(db, "campus_experiences", CAMPUS_F8)
    _update(db, "awards", AWARD_F8)
    _update(db, "publications", PUBLICATION_F8)
    _update(db, "research_projects", RESEARCH_F8)
    _update(db, "credentials", CREDENTIAL_F8)


def _resume(**overrides):
    data = {
        "education": [{"school": "示例大学"}],
        "experience": [{"company": "星云科技"}],
        "projects": [{"name": "检索平台"}],
        "skills": [{"name": "Python"}],
        "campus_experience": [{"organization": "校学生会"}],
        "awards": [{"name": "一等奖学金"}],
        "publications": [{"title": "论文A"}],
        "research_projects": [{"name": "科研A"}],
        "credentials": [{"name": "软考中级"}],
    }
    data.update(overrides)
    return ResumeContent.model_validate(data)


def test_missing_slot_fields_are_backfilled_from_snapshot(db_session):
    _seed_f8(db_session)
    filled = apply_profile_field_backfill(_resume(), all_sections_consumed(db_session))

    education = filled.education[0]
    assert education.study_form == "全日制"
    assert education.degree_type == "学士"
    assert education.department == "计算机学院"
    assert education.rank == "前 5%"
    assert education.advisor == "张伟"
    assert education.research_direction == "自然语言处理"

    experience = filled.experience[0]
    assert experience.team_size == "5 人"
    # enum 槽位复用 paper_policy 的唯一映射：中文「实习」→ A4 code。
    assert experience.experience_kind == "internship"

    project = filled.projects[0]
    assert project.project_size == "10 人月"
    assert project.artifact_type == "开源项目"
    assert filled.skills[0].category == "编程语言"
    assert filled.campus_experience[0].activity_type == "学生会"

    award = filled.awards[0]
    assert award.issuer == "学校"
    assert award.level == "校级"
    assert award.ratio == "前 10%"

    publication = filled.publications[0]
    assert publication.outcome_type == "期刊论文"
    assert publication.my_rank == "第一作者"

    research = filled.research_projects[0]
    assert research.level == "校级"
    assert research.funding == "10 万元"
    assert filled.credentials[0].credential_type == "职业资格"


def test_ai_written_values_are_never_overwritten(db_session):
    _seed_f8(db_session)
    resume = _resume(
        education=[
            {
                "school": "示例大学",
                "advisor": "AI 写的导师",
                "study_form": "非全日制",
            }
        ]
    )
    filled = apply_profile_field_backfill(resume, all_sections_consumed(db_session))

    education = filled.education[0]
    assert education.advisor == "AI 写的导师"
    assert education.study_form == "非全日制"
    # 同一分区里 AI 没写的字段照常回填。
    assert education.department == "计算机学院"


def test_unparticipating_sections_are_not_backfilled(db_session):
    _seed_f8(db_session)
    resume = _resume(
        skills=[{"name": "Python"}],
        publications=[{"title": "论文A"}],
        research_projects=[{"name": "科研A"}],
        credentials=[{"name": "软考中级"}],
    )
    filled = apply_profile_field_backfill(resume, seven_sections_consumed(db_session))

    # 教育经历在七项组里 → 回填。
    assert filled.education[0].advisor == "张伟"
    # 未参与分区整段都不会出现在消费快照里 → 不写。
    assert filled.skills[0].category == ""
    assert filled.publications[0].outcome_type == ""
    assert filled.publications[0].my_rank == ""
    assert filled.research_projects[0].funding == ""
    assert filled.credentials[0].credential_type == ""


def test_hidden_field_is_not_backfilled(db_session):
    _seed_f8(db_session)
    field_preferences.patch_preference(
        db_session, "educations.advisor", section_key="educations", hidden=True
    )
    filled = apply_profile_field_backfill(_resume(), all_sections_consumed(db_session))
    assert filled.education[0].advisor == ""
    assert filled.education[0].department == "计算机学院"


def test_unmatched_entry_is_not_invented_and_identity_disambiguates(db_session):
    _seed_f8(db_session)
    filled = apply_profile_field_backfill(
        _resume(education=[{"school": "不存在的大学"}]),
        all_sections_consumed(db_session),
    )
    assert filled.education[0].advisor == ""
    assert filled.education[0].department == ""


def test_overlong_value_is_truncated_and_never_raises(db_session):
    seed_profile(db_session)
    long_advisor = "导" * 200
    _update(db_session, "educations", {"educations.advisor": long_advisor})
    filled = apply_profile_field_backfill(_resume(), all_sections_consumed(db_session))
    advisor = filled.education[0].advisor
    # 模型 max_length=128：截断而不是让整次生成保存失败。
    assert len(advisor) == 128
    # 仍是一个可序列化/可校验的 ResumeContent。
    assert ResumeContent.model_validate(filled.model_dump(exclude_none=True)).education[0].advisor


def test_nothing_to_fill_returns_content_untouched(db_session):
    _seed_f8(db_session)
    # 所有条目身份都对不上快照 → 没有可回填的对象，返回的对象必须逐字段不变（不补造）。
    resume = _resume(
        education=[{"school": "另一所大学"}],
        experience=[{"company": "另一家公司"}],
        projects=[{"name": "另一个项目"}],
        skills=[{"name": "Go"}],
        campus_experience=[{"organization": "另一个组织"}],
        awards=[{"name": "另一个奖项"}],
        publications=[{"title": "另一篇论文"}],
        research_projects=[{"name": "另一个科研"}],
        credentials=[{"name": "另一个证书"}],
    )
    consumed = all_sections_consumed(db_session)
    assert apply_profile_field_backfill(resume, consumed).model_dump() == resume.model_dump()


def test_backfill_field_list_has_single_source_of_truth():
    total = sum(len(keys) for keys in BACKFILL_SLOT_KEYS.values())
    assert total == 20, "契约 §1 固定 20 个字段；多/少标要先改契约"
    for section_key, field_keys in BACKFILL_SLOT_KEYS.items():
        slots = SECTION_RULES[section_key].slots
        for field_key in field_keys:
            assert slots[field_key].backfill is True
    # 既有槽位（school/major 等）不被顺手改写：它们不在回填清单里。
    assert "school" not in BACKFILL_SLOT_KEYS["educations"]
    assert "major" not in BACKFILL_SLOT_KEYS["educations"]


async def test_generator_end_to_end_backfills_missing_fields(db_session):
    _seed_f8(db_session)
    provider = CapturingProvider(
        {
            "summary": "示例总结",
            "education": [{"school": "示例大学"}],
            "experience": [{"company": "星云科技"}],
        }
    )
    events = [
        event
        async for event in ResumeGenerator(provider).generate(
            None,
            _job(),
            GenerateOptions(enhance=False),
            consumed=all_sections_consumed(db_session),
        )
    ]
    done = next(event for event in events if event["type"] == "done")
    education = done["resume"]["education"][0]
    assert education["advisor"] == "张伟"
    assert education["study_form"] == "全日制"
    experience = done["resume"]["experience"][0]
    assert experience["team_size"] == "5 人"
    assert experience["experience_kind"] == "internship"
