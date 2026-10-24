# SPDX-License-Identifier: Apache-2.0
"""模板预览用的示例简历内容。

工作台里"每个模板都要有预览"这件事不能依赖用户手上有简历：新装的用户打开工作台时
一条记录都没有。所以这里备一份结构完整、长度接近真实一页的示例内容——它的作用是
展示版式（标题层级、条目间距、技能标签排布、照片位），不是给用户看的简历。

两条刻意的约束：

1. **覆盖 ``ResumeContent`` 的全部字段**，包括 ``photo`` / ``gender`` / ``birth_year`` /
   ``personal_website`` / ``github``。少一个字段，那个模板位在缩略图里就永远是空的：
   用户看不到"这里会长什么样"，也就不知道该不该填。照片见 ``resume_sample_photo``
   （虚构卡通头像，不含任何真实个人信息）。
2. **按"一页装得下多少"给详略，而不是维护多份内容**。一页能装多少由两件事决定：
   **字号档位**（小字号 11px 装得最多、大字号 18px 最少）与**模板排版宽松度**
   （compact / scholar 的默认行高比其余模板低约 25%，同一份内容在它们里面显得空）。
   所以基础数据只有一份，裁剪规则集中在 ``_DENSITY``（字号 × 宽松度两个维度）：
   维护多份独立内容必然漂移（改了一个字段漏改另一份的表现是"切字号以后某一栏突然空了"）。

判据（改内容后必须重新量，见 ``tests/test_resume_sample_content.py``）：每套模板 ×
每档字号都只排一页，且内容填充率落在 80%–100%——留白太多说明示例没把模板"填满"，
用户会以为模板本身就这么空；超一页则缩略图会被截掉半页。
"""

from __future__ import annotations

from dataclasses import dataclass

from ...schemas.resume import (
    ResumeAward,
    ResumeCampusExperience,
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from .resume_sample_photo import SAMPLE_PHOTO_DATA_URL
from .resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS

# 与 ``schemas.resume_generation.ResumeFontScale`` 同值；这里不 import 它，
# 是因为 services 依赖 schemas 的方向更自然（且它只是三个字符串）。
SAMPLE_FONT_SCALES: tuple[str, ...] = ("small", "standard", "large")
DEFAULT_FONT_SCALE = "standard"

# 排版「宽松档」的判据：行高明显小于其余模板（实测 compact 1.55 / scholar 1.50，
# 其余 ≥ 1.60）。同一份内容在宽松档里会显得空，所以取更密的一档内容。
#
# 阈值取自 ``TEMPLATE_LAYOUT_DEFAULTS`` 的实测分布，**不写死模板名**：模板的默认行高
# 一改，这里的分组就跟着变，不会出现"某套模板被留在一个错的内容档上"。
# 需要与测得的填充率一起复核（见 ``tests/test_resume_sample_content.py``）。
_ROOMY_LINE_HEIGHT = 1.6


@dataclass(frozen=True)
class _Density:
    """一档字号下"取基础数据里的多少"。

    字段全部是**数量**，不是内容本身：内容只有一份（见模块 docstring 第 2 条）。
    """

    summary_sentences: int
    education_courses: int
    education_achievements: int
    experiences: int
    experience_bullets: int
    projects: int
    project_description: int
    project_highlights: int
    campus_items: int
    campus_bullets: int
    skills: int
    award_items: int


# 三档字号 × 两档排版宽松度。取值由"渲染后一页装得下、且填满到不显得空"反推得到：
# 每套模板都实测过 ``build_resume_pdf`` 的页数与 ``measure_content_height`` 的填充率，
# 数据写在该测试模块的 docstring 里。
#
# 一条硬约束决定了 ``large`` 只能保留 5 个小节：18px 下**页眉（含照片）+ 七个小节标题
# 本身就超过一页**（实测 classic 110%、modern 119%），无论内容多短都排不进一页。所以
# 大字号档保留「教育 / 实习工作 / 项目 / 技能 / 总结」，校园经历与荣誉奖项只在
# small / standard 两档出现——比"七节齐全但缩略图被截掉半页"更接近用户想看的效果。
_DENSITY: dict[str, dict[str, _Density]] = {
    # 常规排版（classic / modern / elegant / minimal 等）：行高大、一页装得少。
    "regular": {
        "small": _Density(
            summary_sentences=2,
            education_courses=2,
            education_achievements=1,
            experiences=3,
            experience_bullets=3,
            projects=1,
            project_description=2,
            project_highlights=1,
            campus_items=1,
            campus_bullets=1,
            skills=5,
            award_items=2,
        ),
        "standard": _Density(
            summary_sentences=1,
            education_courses=2,
            education_achievements=0,
            experiences=1,
            experience_bullets=2,
            projects=1,
            project_description=1,
            project_highlights=0,
            campus_items=1,
            campus_bullets=1,
            skills=4,
            award_items=1,
        ),
        "large": _Density(
            summary_sentences=1,
            education_courses=1,
            education_achievements=0,
            experiences=1,
            experience_bullets=1,
            projects=1,
            project_description=1,
            project_highlights=0,
            campus_items=0,
            campus_bullets=0,
            skills=3,
            award_items=0,
        ),
    },
    # 宽松排版（compact / scholar）：行高与页边距小约 25%，同一份内容会显得空，
    # 所以取更密的一档。
    "roomy": {
        "small": _Density(
            summary_sentences=3,
            education_courses=3,
            education_achievements=2,
            experiences=3,
            experience_bullets=4,
            projects=2,
            project_description=2,
            project_highlights=2,
            campus_items=1,
            campus_bullets=2,
            skills=6,
            award_items=2,
        ),
        "standard": _Density(
            summary_sentences=2,
            education_courses=2,
            education_achievements=0,
            experiences=2,
            experience_bullets=2,
            projects=2,
            project_description=1,
            project_highlights=1,
            campus_items=1,
            campus_bullets=1,
            skills=5,
            award_items=2,
        ),
        "large": _Density(
            summary_sentences=1,
            education_courses=1,
            education_achievements=0,
            experiences=1,
            experience_bullets=2,
            projects=1,
            project_description=1,
            project_highlights=1,
            campus_items=1,
            campus_bullets=1,
            skills=3,
            award_items=1,
        ),
    },
}

# ===== 基础数据（唯一一份）=====
#
# 全虚构：姓名「张示例」、公司与学校都带「示例」字样，联系方式用 example.com 保留域名。
# 岗位刻意选**非技术岗**（市场运营）：工作台默认示例是每个新用户看到的第一份简历，
# 如果它长成"后端开发 + 高并发 + Go/Redis"，非技术岗的用户第一眼就会觉得"这不是给我
# 用的"。技能也只用通用办公能力（活动策划、Excel、数据复盘）。

_NAME = "张示例"
_GENDER = "女"
_BIRTH_YEAR = "2001"
_PHONE = "138-0000-0000"
_EMAIL = "zhang@example.com"
_CITY = "上海"
_PERSONAL_WEBSITE = "https://portfolio.example.com/zhangshili"
_GITHUB = "https://github.example.com/zhangshili"
_JOB_INTENT = "市场运营专员"

_SUMMARY_SENTENCES: tuple[str, ...] = (
    "3 年市场与运营经验，主导过从 0 到 1 的会员增长项目。",
    "擅长把一次性的活动经验沉淀成可复用的流程与台账。",
    "习惯用数据解释结论，而不是凭感觉拍板。",
)

_EDUCATION = {
    "school": "示例大学",
    "major": "市场营销",
    "degree": "本科",
    "start_date": "2019.09",
    "end_date": "2023.06",
    "gpa": "3.7/4.0",
}
_EDUCATION_COURSES: tuple[str, ...] = ("市场调研", "消费者行为", "应用统计")
_EDUCATION_ACHIEVEMENTS: tuple[str, ...] = (
    "连续两年获得校级奖学金",
    "校级营销策划大赛二等奖（团队 4 人，负责用户调研与方案撰写）",
)

_EXPERIENCES: tuple[dict, ...] = (
    {
        "company": "示例科技有限公司",
        "role": "市场运营专员",
        "start_date": "2023.07",
        "end_date": "至今",
        "description": (
            "主导季度主题营销活动，参与 1.2 万人，转化率环比提升 18%。",
            "把活动复盘沉淀成 9 个检查点的 SOP，单场筹备从 10 天压到 4 天。",
            "对接 12 家渠道并建立效果台账，停投 3 家低效渠道后成本降 15%。",
            "按活跃度设计 4 档会员触达节奏，沉默用户回访率从 11% 到 23%。",
        ),
    },
    {
        "company": "示例文化传播有限公司",
        "role": "市场部实习生",
        "start_date": "2022.06",
        "end_date": "2022.12",
        "description": (
            "独立完成社群选题、撰写与发布，月均 20 篇，半年粉丝净增 3000。",
            "按打开率与转发率重建选题库，高互动选题占比从 25% 提到 48%。",
        ),
    },
    {
        "company": "示例咨询工作室",
        "role": "运营助理（兼职）",
        "start_date": "2021.03",
        "end_date": "2022.05",
        "description": ("整理 30 余场线下沙龙的报名与到场数据，输出复盘表与改进建议。",),
    },
)

_PROJECTS: tuple[dict, ...] = (
    {
        "name": "校园招聘会策划",
        "role": "项目负责人",
        "start_date": "2024.03",
        "end_date": "2024.06",
        "tech_stack": ("活动策划", "渠道对接", "预算管理"),
        "description": (
            "从 0 到 1 策划校园招聘会，到会企业 40 家、学生 1200 人。",
            "设计学生侧一页纸岗位速览，现场咨询量降 30%、简历回收提升 25%。",
        ),
        "highlights": (
            "用分时段报名数据调度入场，现场排队控制在 10 分钟内。",
            "3 天完成 40 家企业邀约确认，到会率 92%。",
        ),
    },
    {
        "name": "会员增长实验",
        "role": "项目成员（负责实验设计与复盘）",
        "start_date": "2023.09",
        "end_date": "2023.12",
        "tech_stack": ("数据复盘", "Excel", "A/B 测试"),
        "description": ("设计 3 组触达文案实验，样本各 2000 人，按周复盘转化差异。",),
        "highlights": ("胜出文案沉淀成模板库，复用到后续 6 场活动，转化率提升 9%。"),
    },
)

_CAMPUS: tuple[dict, ...] = (
    {
        "organization": "示例大学学生会宣传部",
        "role": "副部长",
        "start_date": "2021.09",
        "end_date": "2022.06",
        "description": (
            "统筹 6 场校园活动的宣传排期，协调 8 人小组分工，累计触达 3000 余人次。",
            "建立宣传物料模板库（海报、推文、短视频各 3 套），单场物料准备时间缩短一半。",
        ),
    },
)

_SKILLS: tuple[tuple[str, str], ...] = (
    ("活动策划", "熟练"),
    ("Excel", "熟练"),
    ("数据复盘", "掌握"),
    ("沟通协作", "熟练"),
    ("商务英语", "了解"),
    ("短视频剪辑", "掌握"),
)

_AWARDS: tuple[tuple[str, str], ...] = (
    ("示例大学一等奖学金", "2021.10"),
    ("校级优秀学生干部", "2021.05"),
)


def normalize_font_scale(value: object) -> str:
    """把任意输入收口到三档之一；认不出就用 ``standard``。

    预览接口的 ``font_scale`` 已经在 schema 层限成 Literal，但 ``sample_resume_content``
    也会被脚本与测试直接调用——"传了个没见过的字号"不该抛异常，回落比崩掉好。
    """
    return value if isinstance(value, str) and value in SAMPLE_FONT_SCALES else DEFAULT_FONT_SCALE


def density_group(template_name: str | None) -> str:
    """这套模板吃哪一档内容密度：``roomy``（行高小、一页装得多）或 ``regular``。

    认不出的模板名（含 ``None``）一律按 ``regular`` 处理——那是内容更少的一档，
    宁可显得空一点，也不会因为内容过长把页面顶到第二页。
    """
    layout = TEMPLATE_LAYOUT_DEFAULTS.get((template_name or "").strip())
    if layout is not None and float(layout.get("line_height", 0.0)) < _ROOMY_LINE_HEIGHT:
        return "roomy"
    return "regular"


def _summary(density: _Density) -> str:
    """按档位取前几句总结（句子级裁剪，避免半句话看得莫名其妙）。"""
    sentences = _SUMMARY_SENTENCES[: max(1, density.summary_sentences)]
    return "".join(sentences)


def _education(density: _Density) -> list[ResumeEducation]:
    return [
        ResumeEducation(
            **_EDUCATION,
            courses=list(_EDUCATION_COURSES[: density.education_courses]),
            achievements=list(_EDUCATION_ACHIEVEMENTS[: density.education_achievements]),
        )
    ]


def _experience(density: _Density) -> list[ResumeExperience]:
    items: list[ResumeExperience] = []
    for raw in _EXPERIENCES[: max(1, density.experiences)]:
        lines = list(raw["description"])[: max(1, density.experience_bullets)]
        items.append(
            ResumeExperience(
                company=raw["company"],
                role=raw["role"],
                start_date=raw["start_date"],
                end_date=raw["end_date"],
                description=lines,
            )
        )
    return items


def _projects(density: _Density) -> list[ResumeProject]:
    items: list[ResumeProject] = []
    for raw in _PROJECTS[: max(1, density.projects)]:
        items.append(
            ResumeProject(
                name=raw["name"],
                role=raw["role"],
                start_date=raw["start_date"],
                end_date=raw["end_date"],
                tech_stack=list(raw["tech_stack"]),
                description=list(raw["description"])[: max(1, density.project_description)],
                highlights=list(raw["highlights"])[: max(0, density.project_highlights)],
            )
        )
    return items


def _campus(density: _Density) -> list[ResumeCampusExperience]:
    items: list[ResumeCampusExperience] = []
    for raw in _CAMPUS[: max(0, density.campus_items)]:
        items.append(
            ResumeCampusExperience(
                organization=raw["organization"],
                role=raw["role"],
                start_date=raw["start_date"],
                end_date=raw["end_date"],
                description=list(raw["description"])[: max(1, density.campus_bullets)],
            )
        )
    return items


def _skills(density: _Density) -> list[ResumeSkill]:
    return [
        ResumeSkill(name=name, level=level) for name, level in _SKILLS[: max(1, density.skills)]
    ]


def _awards(density: _Density) -> list[ResumeAward]:
    return [
        ResumeAward(name=name, date=date, description="")
        for name, date in _AWARDS[: max(0, density.award_items)]
    ]


def sample_resume_content(
    font_scale: str = DEFAULT_FONT_SCALE,
    template_name: str | None = None,
) -> ResumeContent:
    """示例简历内容；详略由 **字号档位 × 模板排版宽松度** 决定。

    ``font_scale``：small 最密、large 最简（小字号一页装得下更多字）。
    ``template_name``：只用来判断这套模板吃哪一档密度（见 ``density_group``）——
    compact / scholar 的行高比其余模板低约 25%，同一份内容在它们里面会显得空。

    调用方：模板预览接口把用户当前选的档位与正在预览的模板一起传进来
    （``api/resume_templates.py``）；体验示例数据集、脚本与测试用默认值即可。
    """
    density = _DENSITY[density_group(template_name)][normalize_font_scale(font_scale)]
    return ResumeContent(
        name=_NAME,
        photo=SAMPLE_PHOTO_DATA_URL,
        gender=_GENDER,
        birth_year=_BIRTH_YEAR,
        phone=_PHONE,
        email=_EMAIL,
        city=_CITY,
        personal_website=_PERSONAL_WEBSITE,
        github=_GITHUB,
        job_intent=_JOB_INTENT,
        summary=_summary(density),
        education=_education(density),
        experience=_experience(density),
        campus_experience=_campus(density),
        projects=_projects(density),
        skills=_skills(density),
        awards=_awards(density),
    )


__all__ = [
    "DEFAULT_FONT_SCALE",
    "SAMPLE_FONT_SCALES",
    "density_group",
    "normalize_font_scale",
    "sample_resume_content",
]
