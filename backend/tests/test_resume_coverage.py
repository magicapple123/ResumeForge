# SPDX-License-Identifier: Apache-2.0
"""覆盖度检查：资料里有、但这份简历里没写的内容，要说清是什么、为什么、怎么办。

背景是一条真实用户反馈：项目写进了资料、台账也确认了，生成出来的简历却没有它。
根因在生成链路的两道静默关卡（岗位相关性筛选、模型取舍）。这里钉住的是
"检查本身不误报、原因分类正确、提醒里带着下一步"。
"""

from __future__ import annotations

import json
import re

from app.schemas.claim import ClaimDigestOut
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent, ResumeSkill
from app.services.resume.resume_coverage import (
    _normalized_values,
    all_entry_names,
    confirmed_claims_about,
    find_unwritten_field_details,
    find_unwritten_items,
)

# 筛选前的资料里"都有谁"：两个项目、一段工作、一段校园、一个奖项、一所学校。
ENTRY_NAMES = {
    "projects": ("会员增长系统", "内部工具迁移"),
    "experiences": ("示例科技有限公司",),
    "campus_experiences": ("示例辩论队",),
    "awards": ("示例奖学金",),
    "educations": ("示例大学",),
}

# 真正发给模型的候选资料：只有「会员增长系统」这个项目被留下（另一条被相关性筛掉）。
CANDIDATES = {
    "projects": [{"name": "会员增长系统", "description": ["负责从 0 到 1 的增长"]}],
    "experiences": [{"company": "示例科技有限公司", "description": ["负责增长"]}],
    "campus_experiences": [{"organization": "示例辩论队", "description": ["队长"]}],
    "awards": [{"name": "示例奖学金"}],
    "educations": [{"school": "示例大学"}],
}


def _resume_with(*sections: str) -> ResumeContent:
    """造一份只写了指定分区的简历（其余分区留空）。"""
    return ResumeContent(
        name="张示例",
        projects=[{"name": "会员增长系统"}] if "projects" in sections else [],
        experience=[{"company": "示例科技有限公司"}] if "experience" in sections else [],
        campus_experience=[{"organization": "示例辩论队"}] if "campus_experience" in sections else [],
        awards=[{"name": "示例奖学金"}] if "awards" in sections else [],
        education=[{"school": "示例大学"}] if "education" in sections else [],
    )


def _resume_with_everything() -> ResumeContent:
    """每个分区、每一条都写了（含两个项目）。"""
    return ResumeContent(
        name="张示例",
        projects=[{"name": "会员增长系统"}, {"name": "内部工具迁移"}],
        experience=[{"company": "示例科技有限公司"}],
        campus_experience=[{"organization": "示例辩论队"}],
        awards=[{"name": "示例奖学金"}],
        education=[{"school": "示例大学"}],
    )


def test_no_warning_when_everything_was_written():
    """资料里的每一条都写进去了：一个字都不该多说。"""
    assert find_unwritten_items(_resume_with_everything(), ENTRY_NAMES, CANDIDATES) == []


def test_missing_entry_says_whether_it_reached_the_model():
    """「内部工具迁移」没进候选资料、「会员增长系统」进了但没被写——两类原因要分开。"""
    # 简历里只写了工作经历：两个项目都缺，但缺的原因不同。
    resume = _resume_with("experience")
    warnings = find_unwritten_items(resume, ENTRY_NAMES, CANDIDATES)
    project_warning = next(w for w in warnings if "项目经历" in w)

    assert "「内部工具迁移」" in project_warning
    assert "关键词交集不足" in project_warning
    assert "「会员增长系统」" in project_warning
    assert "模型没有把它写进简历" in project_warning
    # 提醒必须带着下一步，不能只说"少了东西"。
    assert "手动调整" in project_warning


def test_written_entries_are_never_reported():
    """写进去的内容绝不能被误报成缺失——宁可少报，不能冤枉。"""
    everything = {"projects": [{"name": "会员增长系统"}, {"name": "内部工具迁移"}]}
    assert find_unwritten_items(
        _resume_with_everything(), ENTRY_NAMES, {**CANDIDATES, **everything}
    ) == []


def test_missing_sections_of_an_empty_profile_are_silent():
    """资料里本来就没有的分区不产生提醒（否则每个新用户都会收到一面墙的警告）。"""
    resume = _resume_with("projects", "experience", "campus_experience", "awards", "education")
    assert find_unwritten_items(resume, {}, CANDIDATES) == []


def test_too_many_missing_entries_are_summarised_not_dumped():
    """缺一大片时列出前几条并给出总数，不把警告变成一面墙。"""
    entry_names = {"projects": tuple(f"项目{i}" for i in range(1, 9))}
    resume = _resume_with("experience")
    warnings = find_unwritten_items(resume, entry_names, {"projects": []})
    assert len(warnings) == 1
    assert "（共 8 条）" in warnings[0]
    # 列出的条目不超过上限。
    listed = re.findall(r"「([^」]+)」", warnings[0])
    assert len([name for name in listed if name.startswith("项目")]) <= 4


def test_confirmed_claims_are_matched_by_subject():
    baseline = ClaimDigestOut(
        confirmed_count=2,
        baseline_text="\n".join(
            json.dumps(entry, ensure_ascii=False)
            for entry in (
                {
                    "subject": "会员增长系统的注册转化提升了 18%",
                    "category": "项目",
                    "fact": "fact",
                    "responsibility": "主导",
                    "boundary": "",
                    "allowed_uses": "",
                },
                {
                    "subject": "示例大学期间担任班长",
                    "category": "教育",
                    "fact": "fact",
                    "responsibility": "负责",
                    "boundary": "",
                    "allowed_uses": "",
                },
            )
        ),
    )
    assert confirmed_claims_about({"会员增长系统"}, baseline) == ["会员增长系统"]
    assert confirmed_claims_about({"内部工具迁移"}, baseline) == []
    # 全部条目里有两个能对上已确认的主张。
    assert confirmed_claims_about(all_entry_names(ENTRY_NAMES), baseline) == [
        "会员增长系统",
        "示例大学",
    ]


def test_malformed_baseline_lines_do_not_break_the_check():
    baseline = ClaimDigestOut(confirmed_count=0, baseline_text="不是 JSON\n{也是坏的\n")
    assert confirmed_claims_about({"会员增长系统"}, baseline) == []


# ===== 问题 15：资料侧带 `- ` 前缀时不能把已写入的内容误报成"未写" =====


def test_normalized_values_strip_line_prefix_but_keep_inline_hyphen():
    """只剥行首列表标记；正文里的连字符与日期不是列表前缀。"""
    assert _normalized_values("- 接口 P99 从 1.2 秒降到 180 毫秒") == [
        "接口 P99 从 1.2 秒降到 180 毫秒"
    ]
    assert _normalized_values("- A\n- B") == ["A", "B"]
    assert _normalized_values("1. 第一步\n2) 第二步") == ["第一步", "第二步"]
    assert _normalized_values("- 优化 1-2 秒的轮询间隔") == ["优化 1-2 秒的轮询间隔"]
    assert _normalized_values("2024-08 入职，2024.03 立项") == ["2024-08 入职", "2024.03 立项"]
    # 只有一个 "- " 的空行剥完为空，必须丢弃（否则空串会进比对集合）。
    assert _normalized_values("- \n- 有内容") == ["有内容"]


def _project_consumed(highlights: str) -> ConsumedProfile:
    """只有「项目」分区的消费快照：高亮按用户实际写法给（多行 Markdown 字符串）。"""
    fields = tuple(
        ConsumedFieldSpec(
            field_id=f"projects.{key}",
            key=key,
            label=key,
            field_type="single_line" if key == "name" else "multi_line",
            order=index,
            llm_allowed=True,
            webform_allowed=True,
            private=False,
            is_builtin=True,
        )
        for index, key in enumerate(("name", "tech_stack", "highlights"))
    )
    section = ConsumedSection(
        key="projects",
        name="项目经历",
        form="multi",
        carrier_field_id="projects.description",
        material_only=False,
        primary_field_id=None,
        fields=fields,
        entries=(
            ConsumedEntry(
                entry_id="pr1",
                sort_order=0,
                values={
                    "projects.name": "电商订单服务重构",
                    "projects.tech_stack": "Python, Redis",
                    "projects.highlights": highlights,
                },
            ),
        ),
        revision=1,
    )
    return ConsumedProfile(
        group_id="g1",
        group_name="测试组",
        is_default=True,
        participating_keys=("projects",),
        section_order=("projects",),
        workspace_revision=1,
        sections={"projects": section},
    )


def test_dash_prefixed_source_is_not_reported_as_unwritten():
    """资料 `- A\\n- B` + 简历 ["A","B"] → 零 missing（此前每条都误报）。"""
    consumed = _project_consumed("- 接口 P99 从 1.2 秒降到 180 毫秒\n- 补齐 37 个单元测试")
    resume = ResumeContent(
        projects=[
            {
                "name": "电商订单服务重构",
                "tech_stack": ["Python", "Redis"],
                "highlights": ["接口 P99 从 1.2 秒降到 180 毫秒", "补齐 37 个单元测试"],
            }
        ]
    )

    assert find_unwritten_field_details(resume, consumed) == []


def test_truly_missing_field_value_is_still_reported():
    """资料 3 条、简历只写 2 条 → 仍然报那 1 条（不能因为剥前缀把真缺失也放过）。"""
    consumed = _project_consumed("- 一\n- 二\n- 三")
    resume = ResumeContent(
        projects=[
            {
                "name": "电商订单服务重构",
                "tech_stack": ["Python", "Redis"],
                "highlights": ["一", "二"],
            }
        ]
    )

    details = find_unwritten_field_details(resume, consumed)
    assert [detail["names"] for detail in details] == [["三"]]


# ===== 技能的"模型省略"归因（2026-11 问题 2）=====
#
# 技能名额在 SECTION_LIMITS["skills"]（14）就压掉了：候选 14 条、实写 14 条时模型
# 一条都没漏，旧实现却把没写进去的一律记 model_omitted。归因必须与条目级同口径：
# 只有**进过候选**的才算模型取舍。


def _skill_name(index: int) -> str:
    """等长的技能名（`_similar_skill` 用子串判断，S1 会被 S11 吞掉）。"""
    return f"S{index:02d}"


def _skills_profile(monkeypatch, count: int) -> None:
    """让 project_paper_content 返回一份有 `count` 条技能的"资料投影"。"""
    from app.services.resume import resume_coverage

    skills = [ResumeSkill(name=_skill_name(index)) for index in range(1, count + 1)]
    monkeypatch.setattr(
        resume_coverage,
        "project_paper_content",
        lambda _consumed: ResumeContent(name="张示例", skills=skills),
    )


def _skills_resume(count: int) -> ResumeContent:
    return ResumeContent(
        name="张示例",
        skills=[ResumeSkill(name=_skill_name(index)) for index in range(1, count + 1)],
    )


def _skill_candidates(count: int) -> dict[str, object]:
    return {
        "data": {
            "skills": [
                {"name": _skill_name(index), "level": "熟练"} for index in range(1, count + 1)
            ]
        }
    }


def test_skills_at_the_capacity_are_never_blamed_on_the_model(monkeypatch):
    """候选 14 / 实写 14（资料 16 条）→ model_omitted 必须为 0。"""
    _skills_profile(monkeypatch, 16)

    details = find_unwritten_field_details(_skills_resume(14), object(), _skill_candidates(14))
    note = next(detail for detail in details if detail["section"] == "skills")
    assert note["model_omitted"] == []
    assert note["filtered"] == []
    # 被名额裁掉的那两条落进 capacity_omitted，不能算模型省略。
    assert note["capacity_omitted"] == [_skill_name(15), _skill_name(16)]
    assert note["names"] == [_skill_name(15), _skill_name(16)]
    assert note["total"] == 2


def test_capacity_bucket_is_a_partition_of_the_missing_names(monkeypatch):
    """三个桶是 missing 的一个划分：capacity 与 model 各自只剩自己的那几条。"""
    _skills_profile(monkeypatch, 16)

    details = find_unwritten_field_details(_skills_resume(10), object(), _skill_candidates(14))
    note = next(detail for detail in details if detail["section"] == "skills")
    assert note["model_omitted"] == [
        _skill_name(11),
        _skill_name(12),
        _skill_name(13),
        _skill_name(14),
    ]
    assert note["capacity_omitted"] == [_skill_name(15), _skill_name(16)]
    assert note["filtered"] == []
    assert sorted(note["model_omitted"] + note["capacity_omitted"]) == note["names"]


def test_skill_outside_the_candidates_is_not_blamed_on_the_model(monkeypatch):
    """候选没满名额、这条技能也没进候选 → filtered（门槛 1 拦的），不是模型取舍。"""
    _skills_profile(monkeypatch, 6)

    details = find_unwritten_field_details(_skills_resume(5), object(), _skill_candidates(5))
    note = next(detail for detail in details if detail["section"] == "skills")
    assert note["filtered"] == [_skill_name(6)]
    assert note["model_omitted"] == []
    assert note["capacity_omitted"] == []
    assert note["total"] == 1


def test_missing_snapshot_keeps_the_legacy_attribution(monkeypatch):
    """没有候选快照就无法区分：按旧口径记 model_omitted，不谎称是名额裁的。"""
    _skills_profile(monkeypatch, 6)

    details = find_unwritten_field_details(_skills_resume(5), object())
    note = next(detail for detail in details if detail["section"] == "skills")
    assert note["model_omitted"] == [_skill_name(6)]
    assert note["filtered"] == []
    assert note["capacity_omitted"] == []
