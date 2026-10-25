# SPDX-License-Identifier: Apache-2.0
"""N 验收：按组过滤早于评分/名额/预算；候选、诊断、进度、提示词无组外污染。

**为什么要 spy "第一次输入"**：如果实现是"先构造全量候选、再删未参与键"，最终 JSON
看起来也可以是对的，但相关性评分、名额与预算已经先被组外内容影响过（R-28 明确禁止）。
这里包住 build_job_focus / _select_entries / _select_skills / serialize_profile_prompt_data，
断言它们拿到的第一份输入里已经没有未参与分区；再比较 13 项组与其 7 项子集的候选长度、
共有分区入选数量与低预算降级后的单调性（不得因为多了无关分区而挤掉共有分区）。
"""

import json
import re

from app.services.profile import entry_store, group_store, profile_relevance, workspace_bootstrap
from app.services.profile.group_scope import resolve_current_group_scope
from app.services.profile.profile_reader import load_consumed_profile
from app.services.profile.profile_relevance import (
    build_general_consumed_profile_context,
    build_targeted_consumed_profile_context,
)
from app.services.resume.resume_generator_prompts import (
    build_progress_events,
    render_generation_messages,
    selection_data_for,
)
from tests.test_profile_relevance import make_job

# 7 项子集故意不含 skills / summary / 学术成果 / 科研 / 知识产权 / 证书资质，
# 这样"组外技能泄露"与"组外分区进诊断"都一眼可辨。
SEVEN_KEYS = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "campus_experiences",
    "awards",
    "languages",
)
UNPARTICIPATING = (
    "skills",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
)
CUSTOM_SKILL = "RF_CUSTOM_SKILL_XYZ"

_ENTRY_VALUES: dict[str, tuple[dict[str, str], ...]] = {
    "educations": (
        {
            "educations.school": "示例大学",
            "educations.major": "计算机",
            "educations.start_date": "2020.09",
            "educations.end_date": "2024.06",
            "educations.achievements": "一等奖学金",
        },
    ),
    "experiences": (
        {
            "experiences.company": "星云科技",
            "experiences.title": "后端实习生",
            "experiences.description": "开发 REST 接口\n维护缓存",
        },
        {
            "experiences.company": "青年中心",
            "experiences.title": "运营实习生",
            "experiences.description": "活动策划",
        },
    ),
    "projects": (
        {
            "projects.name": "检索平台",
            "projects.role": "后端",
            "projects.description": "实现检索接口",
            "projects.highlights": "响应提升",
            "projects.tech_stack": "Python, FastAPI",
        },
        {
            "projects.name": "预约服务",
            "projects.role": "负责人",
            "projects.description": "预约与排班",
            "projects.outcome_type": "开源项目",
        },
    ),
    "skills": (
        {"skills.name": "Python", "skills.level": "熟练", "skills.category": "编程语言"},
        {"skills.name": CUSTOM_SKILL, "skills.level": "熟练"},
        {"skills.name": "MySQL", "skills.level": "掌握"},
    ),
    "campus_experiences": (
        {
            "campus_experiences.organization": "校学生会",
            "campus_experiences.role": "部长",
            "campus_experiences.description": "组织活动",
        },
    ),
    "awards": (
        {"awards.title": "一等奖学金", "awards.awarded_at": "2023", "awards.description": "学业"},
    ),
    "publications": (
        {
            "publications.title": "论文A",
            "publications.authors": "张三、李四",
            "publications.venue": "某期刊",
            "publications.year": "2024",
            "publications.status": "已发表",
        },
    ),
    "research_projects": (
        {
            "research_projects.name": "科研A",
            "research_projects.role": "骨干",
            "research_projects.description": "课题研究",
            "research_projects.level": "校级",
        },
    ),
    "patents": (
        {
            "patents.title": "一种方法",
            "patents.inventors": "张三",
            "patents.patent_number": "CN1",
            "patents.status": "已授权",
        },
    ),
    "credentials": (
        {
            "credentials.title": "软考中级",
            "credentials.issuer": "工信部",
            "credentials.status": "有效",
        },
    ),
    "languages": (
        {"languages.language": "英语", "languages.level": "CET-6", "languages.score": "550"},
    ),
}
BASIC_VALUES = {
    "basic_info.name": "张三",
    "basic_info.birth_month": "1999",
    "basic_info.city": "上海",
    "basic_info.job_intention": "后端工程师",
}
SUMMARY_VALUES = {"summary.content": "软件工程本科生，关注后端开发。"}


def seed_profile(db, *, include_new_sections: bool = True) -> None:
    """用 F1 存储层写入一份 13 分区都有内容的资料（不读写旧六表）。"""
    workspace_bootstrap.ensure_workspace(db)
    entry_store.upsert_entry(db, "basic_info", values=dict(BASIC_VALUES))
    entry_store.upsert_entry(db, "summary", values=dict(SUMMARY_VALUES))
    for section_key, entries in _ENTRY_VALUES.items():
        if not include_new_sections and section_key in (
            "publications",
            "research_projects",
            "patents",
            "credentials",
            "languages",
        ):
            continue
        for index, values in enumerate(entries):
            entry_store.upsert_entry(db, section_key, values=dict(values), sort_order=index)


def all_sections_consumed(db):
    state = workspace_bootstrap.ensure_workspace(db)
    default_group = workspace_bootstrap.active_group(db, state.default_group_id)
    group_store.switch_current_group(db, default_group.group_id, expected_revision=state.revision)
    return load_consumed_profile(db, resolve_current_group_scope(db))


def seven_sections_consumed(db):
    group = group_store.create_group(db, "七项组")
    group_store.set_group_members(
        db, group.group_id, list(SEVEN_KEYS), expected_revision=group.revision
    )
    state = workspace_bootstrap.ensure_workspace(db)
    group_store.switch_current_group(db, group.group_id, expected_revision=state.revision)
    return load_consumed_profile(db, resolve_current_group_scope(db))


def _job():
    return make_job(
        "后端开发工程师",
        "负责后端服务与 RESTful API 开发。",
        f"熟悉 Python、FastAPI、MySQL 与 {CUSTOM_SKILL}。",
    )


def _section_keys(data: dict) -> set[str]:
    from app.services.profile.profile_relevance_constants import SECTION_LIMITS

    return {key for key, value in data.items() if key in SECTION_LIMITS and isinstance(value, list)}


def test_first_inputs_already_exclude_unparticipating_sections(db_session, monkeypatch):
    seed_profile(db_session)
    recorded: dict[str, list] = {"focus": [], "entries": [], "skills": 0, "serialize": []}
    original_focus = profile_relevance.build_job_focus
    original_entries = profile_relevance._select_entries
    original_skills = profile_relevance._select_skills
    original_serialize = profile_relevance.serialize_profile_prompt_data

    def spy_focus(job, profile=None, *, skill_names=None):
        recorded["focus"].append(list(skill_names or []))
        return original_focus(job, profile, skill_names=skill_names)

    def spy_entries(items, section, focus, *, fallback_allowed=False):
        recorded["entries"].append(section)
        return original_entries(items, section, focus, fallback_allowed=fallback_allowed)

    def spy_skills(items, evidence, focus, *, fallback_allowed=False):
        recorded["skills"] += 1
        return original_skills(items, evidence, focus, fallback_allowed=fallback_allowed)

    def spy_serialize(data, max_chars):
        recorded["serialize"].append(set(data))
        return original_serialize(data, max_chars)

    monkeypatch.setattr(profile_relevance, "build_job_focus", spy_focus)
    monkeypatch.setattr(profile_relevance, "_select_entries", spy_entries)
    monkeypatch.setattr(profile_relevance, "_select_skills", spy_skills)
    monkeypatch.setattr(profile_relevance, "serialize_profile_prompt_data", spy_serialize)

    seven = build_targeted_consumed_profile_context(seven_sections_consumed(db_session), _job())

    assert set(recorded["entries"]) <= set(SEVEN_KEYS) - {"basic_info", "languages"}
    assert recorded["focus"] == [[]], "组外技能不得作为 build_job_focus 的输入"
    assert recorded["skills"] == 0, "skills 未参与时不应进入技能选择"
    assert recorded["serialize"], "预算序列化必须真的被调用"
    for keys in recorded["serialize"]:
        assert not (keys & set(UNPARTICIPATING)), keys
    assert _section_keys(seven.data) == set(SEVEN_KEYS) - {"basic_info"}


def test_seven_group_candidate_is_smaller_and_shared_counts_not_lower(db_session):
    seed_profile(db_session)
    thirteen = build_targeted_consumed_profile_context(all_sections_consumed(db_session), _job())
    seven = build_targeted_consumed_profile_context(seven_sections_consumed(db_session), _job())

    assert len(seven.serialized) <= len(thirteen.serialized)
    shared = set(seven.selected_counts) & set(thirteen.selected_counts)
    assert shared, "至少应有共有分区参与比较"
    for section in shared:
        assert seven.selected_counts[section] >= thirteen.selected_counts[section], section
    # 四诊断只含参与分区（R-30）：未参与分区不出项，更不能伪造成 0。
    for section in UNPARTICIPATING:
        assert section not in seven.selected_counts
        assert section not in seven.omitted_counts
        assert section not in seven.entry_names
        assert section not in seven.data
    json.loads(seven.serialized)


def test_seven_group_progress_and_prompt_do_not_mention_unparticipating(db_session):
    seed_profile(db_session)
    selection = build_targeted_consumed_profile_context(seven_sections_consumed(db_session), _job())
    selection_data = selection_data_for(selection)
    assert set(selection_data) == {
        "data",
        "selected_counts",
        "omitted_counts",
        "entry_names",
        "focus",
        "fallback_sections",
    }
    progress = build_progress_events(True, selection, enhance=False, scoped=True)
    message = progress[0]["message"]
    for section in UNPARTICIPATING:
        assert section not in message
    # 周知用语也不应出现未参与分区的中文名（技能/学术成果/知识产权/证书资质/科研项目）。
    for label in ("技能", "学术成果", "科研项目", "知识产权", "证书资质"):
        assert label not in message, (label, message)
    messages = render_generation_messages(
        _env(),
        selection,
        _job(),
        _options(),
        baseline=None,
        career_context_block="",
        general=False,
        scoped=True,
    )
    candidate = _prompt_candidate(messages)
    assert not (_section_keys(candidate) & set(UNPARTICIPATING))
    # 系统补充规则包含 C5-B① 与语言映射口径（F3 契约 §2 提示词要求）。
    system = messages[0]["content"]
    assert "13 个大字段" in system and "标签：值" in system and " · " in system


def test_low_budget_only_touches_participating_keys_and_keeps_monotonic_counts(db_session):
    seed_profile(db_session)
    thirteen_consumed = all_sections_consumed(db_session)
    seven_consumed = seven_sections_consumed(db_session)
    for budget in (1_200, 1_600, 2_400):
        thirteen = build_targeted_consumed_profile_context(
            thirteen_consumed, _job(), max_chars=budget
        )
        seven = build_targeted_consumed_profile_context(seven_consumed, _job(), max_chars=budget)
        assert len(thirteen.serialized) <= budget
        assert len(seven.serialized) <= budget
        packed = json.loads(seven.serialized)
        assert not (_section_keys(packed) & set(UNPARTICIPATING))
        json.loads(thirteen.serialized)
        for section in set(seven.selected_counts) & set(thirteen.selected_counts):
            assert seven.selected_counts[section] >= thirteen.selected_counts[section], (
                budget,
                section,
            )


def test_general_consumed_context_only_keeps_participating_sections(db_session):
    seed_profile(db_session)
    selection = build_general_consumed_profile_context(seven_sections_consumed(db_session))
    assert not (_section_keys(selection.data) & set(UNPARTICIPATING))
    assert set(selection.selected_counts) <= set(SEVEN_KEYS) - {"basic_info"}


# ===== 小工具（与生成测试共用的选项/环境构造） =====


def _env():
    from pathlib import Path

    from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

    prompts_dir = Path(__file__).resolve().parents[1] / "app" / "prompts"
    return Environment(
        loader=FileSystemLoader(prompts_dir),
        undefined=StrictUndefined,
        autoescape=select_autoescape(default=False, default_for_string=False),
    )


def _options():
    from app.schemas.resume import GenerateOptions

    return GenerateOptions()


def _prompt_candidate(messages: list[dict]) -> dict:
    fence = chr(96) * 3
    pattern = "## 候选个人资料.*?" + fence + "json\n(.*?)\n" + fence
    match = re.search(pattern, messages[1]["content"], re.DOTALL)
    assert match is not None
    return json.loads(match.group(1))
