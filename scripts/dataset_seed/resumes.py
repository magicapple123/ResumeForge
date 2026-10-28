# SPDX-License-Identifier: Apache-2.0
"""简历：6 份简历（含草稿与英文版）。

简历正文用 ``ResumeContent`` 校验后再落库——JSON 列不会替我们查字段名，
写错一个键的后果是"这份简历打不开"，而不是"这个字段没显示"。
"""

from __future__ import annotations

from datetime import timedelta

from app.schemas.resume import ResumeContent

from dataset_seed import persona
from dataset_seed.base import NOW, ins, row

BASIC = persona.BASIC
EDUCATIONS = persona.EDUCATIONS
EXPERIENCES = persona.EXPERIENCES
PROJECTS = persona.PROJECTS


def _bullets(text: str) -> list[str]:
    return [line.lstrip("- ").strip() for line in str(text).splitlines() if line.strip()]


def _education(index: int) -> dict:
    item = EDUCATIONS[index]
    return {
        "school": item["school"],
        "major": item["major"],
        "degree": item["degree"],
        "start_date": item["start_date"],
        "end_date": item["end_date"],
        "gpa": item["gpa"],
        "courses": [part for part in item["core_courses"].split("；") if part],
        "achievements": _bullets(item["achievements"])[:2],
        "study_form": item["study_form"],
        "degree_type": item["degree_type"],
        "department": item["department"],
        "rank": item["rank"],
        "advisor": item["advisor"],
        "research_direction": item["research_direction"],
    }


def _experience(index: int, bullets: int = 6) -> dict:
    item = EXPERIENCES[index]
    return {
        "company": item["company"],
        "role": item["title"],
        "start_date": item["start_date"],
        "end_date": item["end_date"],
        "description": _bullets(item["description"])[:bullets],
        "team_size": item["team_size"],
        "experience_kind": "full_time" if item["work_type"] == "全职" else "internship",
    }


def _project(index: int) -> dict:
    item = PROJECTS[index]
    return {
        "name": item["name"],
        "role": item["role"],
        "start_date": item["start_date"],
        "end_date": item["end_date"],
        "tech_stack": [part.strip() for part in item["tech_stack"].split(",")],
        "description": _bullets(item["description"]),
        "highlights": _bullets(item["highlights"]),
        "project_size": item["project_size"],
        "public_url": item["public_url"],
        "artifact_type": item["outcome_type"],
    }


def _language(item: dict) -> dict:
    """资料里的语言字段叫 language，简历条目叫 name——两处键名不同，映射只写一次。"""
    return {
        "name": item["language"],
        "level": item["level"],
        "certificate": item["certificate"],
        "score": item["score"],
        "obtained_at": item["obtained_at"],
    }


def _skills(limit: int = 8) -> list[dict]:
    return [dict(item) for item in persona.SKILLS[:limit]]


def _content(compact: bool = False, minimal: bool = False, **overrides) -> dict:
    """默认内容 = 一份"增长分析师"标准版；各份简历只覆盖差异部分。

    ``compact`` 去掉科研三栏、校园、证书与作品集，只留招聘方最先看的六块——
    定向投递的简历必须压在一页内，把 13 个板块全塞进去会排成三页（那是「长 CV」的形态，
    由另一份简历专门覆盖）。
    """
    data = {
        "name": BASIC["name"],
        "photo": "",
        "gender": BASIC["gender"],
        "birth_year": "1998",
        "phone": BASIC["phone"],
        "email": BASIC["email"],
        "city": BASIC["city"],
        "personal_website": BASIC["homepage"],
        "github": BASIC["github"],
        "job_intent": BASIC["job_intention"],
        "summary": persona.SUMMARY,
        "education": [_education(0), _education(1)],
        "experience": [_experience(0), _experience(1, bullets=2)],
        "campus_experience": [
            {
                "organization": item["organization"],
                "role": item["role"],
                "start_date": item["start_date"],
                "end_date": item["end_date"],
                "description": _bullets(item["description"]),
                "activity_type": item["activity_type"],
            }
            for item in persona.CAMPUS_EXPERIENCES
        ],
        "projects": [_project(0), _project(1)],
        "skills": _skills(),
        "languages": [_language(item) for item in persona.LANGUAGES],
        "awards": [
            {
                "name": item["title"],
                "date": item["awarded_at"],
                "description": item["description"],
                "issuer": item["issuer"],
                "level": item["level"],
                "ratio": item["award_ratio"],
            }
            for item in persona.AWARDS[:3]
        ],
        "publications": [
            {
                "title": persona.PUBLICATIONS[0]["title"],
                "authors": [
                    {"name": "周敏华", "is_self": False, "corresponding": True},
                    {"name": BASIC["name"], "is_self": True, "corresponding": False},
                    {"name": "陈立", "is_self": False, "corresponding": False},
                ],
                "venue": persona.PUBLICATIONS[0]["venue"],
                "year": persona.PUBLICATIONS[0]["year"],
                "status": "published",
                "doi": persona.PUBLICATIONS[0]["doi"],
                "url": persona.PUBLICATIONS[0]["url"],
                "volume_pages": persona.PUBLICATIONS[0]["volume_pages"],
                "note": persona.PUBLICATIONS[0]["note"],
                "outcome_type": "会议论文",
                "my_rank": "第二作者",
            }
        ],
        "research_projects": [
            {
                "name": persona.RESEARCH_PROJECTS[0]["name"],
                "role": persona.RESEARCH_PROJECTS[0]["role"],
                "organization": persona.RESEARCH_PROJECTS[0]["institution"],
                "start_date": persona.RESEARCH_PROJECTS[0]["start_date"],
                "end_date": persona.RESEARCH_PROJECTS[0]["end_date"],
                "funding": persona.RESEARCH_PROJECTS[0]["funding"],
                "description": _bullets(persona.RESEARCH_PROJECTS[0]["description"]),
                "outcomes": _bullets(persona.RESEARCH_PROJECTS[0]["outcomes"]),
                "level": persona.RESEARCH_PROJECTS[0]["level"],
            }
        ],
        "patents": [
            {
                "title": persona.PATENTS[1]["title"],
                "inventors": [
                    {"name": BASIC["name"], "is_self": True, "corresponding": False},
                    {"name": "吴穹", "is_self": False, "corresponding": False},
                ],
                "patent_number": persona.PATENTS[1]["patent_number"],
                "country": "中国",
                "status": "granted",
                "filed_date": persona.PATENTS[1]["application_date"],
                "granted_date": persona.PATENTS[1]["grant_date"],
                "url": "",
            }
        ],
        "credentials": [
            {
                "name": item["title"],
                "issuer": item["issuer"],
                "issue_date": item["issued_at"],
                "expiry_date": item["expires_at"],
                "status": "expired" if item["status"] == "已过期" else "active",
                "verify_url": item["verify_url"],
                "note": item["note"],
                "credential_type": item["credential_type"],
            }
            for item in persona.CREDENTIALS[:3]
        ],
        "custom_sections": [
            {
                "key": "custom:portfolio",
                "title": "作品集",
                "entries": [
                    {
                        "entry_id": "p1",
                        "text": "增长周报模板（Notion 公开版）",
                        "lines": [
                            {
                                "label": "链接",
                                "value": "https://zhiyao.example.com/notes/growth-weekly",
                            },
                        ],
                    },
                    {
                        "entry_id": "p2",
                        "text": "AB 实验复盘清单",
                        "lines": [
                            {"label": "说明", "value": "9 个检查点，团队连续使用 11 个月"},
                        ],
                    },
                ],
            }
        ],
    }
    if minimal:
        # 一页版：只留招聘方先看的四块，其余全部去掉。
        data.update(
            education=[_education(0)],
            experience=[_experience(0, bullets=4)],
            campus_experience=[],
            projects=[_project(0)],
            skills=_skills(6),
            languages=[],
            awards=data["awards"][:1],
            publications=[],
            research_projects=[],
            patents=[],
            credentials=[],
            custom_sections=[],
        )
    elif compact:
        data.update(
            campus_experience=[],
            languages=[_language(item) for item in persona.LANGUAGES[:2]],
            awards=data["awards"][:2],
            publications=[],
            research_projects=[],
            patents=[],
            credentials=data["credentials"][:2],
            custom_sections=[],
        )
    data.update(overrides)
    return ResumeContent(**data).model_dump()


EN_SUMMARY = (
    "Growth analyst with 3 years of experience in membership lifecycle and experimentation. "
    "Led a 5-tier segmentation and win-back program for 1.86M members, lifting quarterly "
    "reactivation from 8.1% to 12.4% and adding roughly CNY 2.1M incremental GMV. Ran 12 A/B "
    "tests on new-user retention (D7: 31% to 38%) and built a channel-quality score that cut "
    "CAC by 17%. Comfortable owning the whole loop: SQL, modeling, experiment design, and "
    "communicating the result to business stakeholders."
)

EN_EXPERIENCES = [
    {
        "company": "Lanshi Data Technology (Shanghai) Co., Ltd.",
        "role": "User Growth Analyst",
        "start_date": "2023-07",
        "end_date": "Present",
        "description": [
            "Owned membership lifecycle growth: segmented 1.86M members into five tiers and "
            "designed three win-back tracks, lifting quarterly reactivation from 8.1% to 12.4%.",
            "Led 12 A/B tests on new-user retention with product and algorithm teams; the "
            "shipped incentive bundle moved D7 retention from 31% to 38%.",
            "Built the daily growth dashboard (SQL + Tableau) covering acquisition, activation, "
            "retention and monetization, replacing three weekly spreadsheets.",
            "Co-designed a channel-quality score (CAC, D1 retention, LTV30); cut four low-quality "
            "channels and reduced CAC by 17% in one quarter.",
        ],
        "team_size": "8",
        "experience_kind": "full_time",
    }
]

EN_PROJECTS = [
    {
        "name": "Multi-channel Attribution Dashboard",
        "role": "Sole developer",
        "start_date": "2025-01",
        "end_date": "2025-04",
        "tech_stack": ["SQL", "Metabase", "Python"],
        "description": [
            "Marketing teams summed self-reported conversions across seven channels, "
            "overstating total conversions by 30%.",
        ],
        "highlights": [
            "Rebuilt the funnel as a single event chain and shipped last-click and linear "
            "attribution side by side; the channel ROI ranking changed materially.",
            "Saved about 12 hours of manual reconciliation per month.",
        ],
        "project_size": "7 channels, 400K events/day",
        "artifact_type": "Personal project",
    }
]

EN_SKILLS = [
    {"name": "SQL", "level": "Expert", "category": "Programming"},
    {"name": "Python (pandas)", "level": "Proficient", "category": "Programming"},
    {"name": "Tableau", "level": "Proficient", "category": "Tools"},
    {"name": "Experiment design", "level": "Proficient", "category": "Analytics"},
    {"name": "Segmentation / RFM", "level": "Proficient", "category": "Analytics"},
]


EN_EDUCATION = [
    {
        "school": "Shanghai University of Finance and Economics",
        "major": "Applied Statistics",
        "degree": "Master",
        "start_date": "2021-09",
        "end_date": "2023-06",
        "gpa": "3.8/4.0",
        "courses": [
            "Applied Regression",
            "Causal Inference & Experimental Design",
            "Time Series Analysis",
            "Data Mining",
        ],
        "achievements": [
            "Thesis on member churn prediction nominated for the school's outstanding thesis "
            "(blind review 88/100).",
        ],
        "study_form": "Full-time",
        "degree_type": "Professional Master",
        "department": "School of Statistics and Management",
        "rank": "6/48",
    }
]

EN_CREDENTIALS = [
    {
        "name": "Google Analytics 4 Certification",
        "issuer": "Google",
        "issue_date": "2024-03",
        "expiry_date": "2026-03",
        "status": "expired",
        "verify_url": "https://skillshop.example.com/verify/GA4-2024-088417",
        "note": "",
        "credential_type": "Skill certification",
    },
    {
        "name": "Alibaba Cloud ACP Data Analyst",
        "issuer": "Alibaba Cloud",
        "issue_date": "2023-11",
        "expiry_date": "2026-11",
        "status": "active",
        "verify_url": "",
        "note": "",
        "credential_type": "Professional certificate",
    },
]

EN_LANGUAGES = [
    {"name": "Chinese", "level": "Native", "certificate": "", "score": "", "obtained_at": ""},
    {
        "name": "English",
        "level": "Professional working proficiency",
        "certificate": "IELTS",
        "score": "7.0",
        "obtained_at": "2022-03",
    },
]


def _en_content() -> dict:
    """英文版：连学历、证书、语言也一起换成英文，避免「英文简历里嵌着中文段落」。"""
    return _content(
        minimal=True,
        name="Zhiyao Lin",
        gender="Female",
        city="Shanghai",
        job_intent="User Growth Analyst",
        summary=EN_SUMMARY,
        education=EN_EDUCATION,
        experience=EN_EXPERIENCES,
        projects=EN_PROJECTS,
        skills=EN_SKILLS,
        credentials=EN_CREDENTIALS,
        languages=EN_LANGUAGES,
        awards=[
            {
                "name": "National Scholarship",
                "date": "2020-10",
                "description": "Top 2% of the major.",
                "issuer": "Ministry of Education",
                "level": "National",
                "ratio": "Top 2%",
            }
        ],
    )


RESUMES = [
    {
        "title": "用户增长分析师 - 澄川科技（上海）有限公司",
        "job_index": 0,
        "content": lambda: _content(
            compact=True,
            experience=[_experience(0, bullets=3), _experience(1, bullets=2)],
            job_intent="用户增长分析师",
            summary=(
                "3 年用户增长经验，主导 186 万会员的分层召回与 12 组留存实验："
                "季度召回率 8.1%→12.4%、新客 7 日留存 31%→38%、获客成本下降 17%。"
                "能独立完成取数、建模、实验设计与复盘汇报。"
            ),
        ),
        "source": "ai",
        "favorite": True,
        "template": "modern",
        "format_name": "standard",
        "format_config": {"accent": "#16365c"},
        "page_limit": 2,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "突出会员召回与 AB 实验的量化结果",
        "note": "投澄川科技用，第一页必须出现召回率和留存两个数。",
        "model": "deepseek-v4-flash",
        "enhancement_enabled": True,
        "enhancement_level": "strong",
        "rationale": "岗位强调会员体系与 AB 实验，因此把会员分层项目放在项目首位，并保留渠道成本一条作为佐证。",
    },
    {
        "title": "增长分析师 - 星桥教育科技有限公司",
        "job_index": 12,
        "content": lambda: _content(
            minimal=True,
            job_intent="增长分析师",
            summary=(
                "3 年增长分析经验，做过会员召回、留存实验与招聘漏斗诊断；"
                "习惯先把指标口径钉死再谈结论，做过的分析都会落成看板或 SOP。"
            ),
            projects=[_project(4)],
        ),
        "source": "ai",
        "favorite": False,
        "template": "classic",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 1,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "",
        "model": "deepseek-v4-flash",
        "enhancement_enabled": True,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "商业分析师 - 弦月网络科技（上海）有限公司",
        "job_index": 1,
        "content": lambda: _content(
            campus_experience=[],
            job_intent="商业分析师",
            summary=(
                "统计硕士 + 3 年分析与增长经验，擅长把业务问题拆成可验证的指标与实验；"
                "做过经营复盘、渠道归因与会员分层，能用业务听得懂的话讲清结论。"
            ),
            experience=[_experience(0, bullets=3), _experience(2, bullets=1)],
            projects=[_project(4)],
            skills=_skills(8),
        ),
        "source": "manual",
        "favorite": False,
        "template": "elegant",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 3,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "偏经营分析方向，项目里多放了招聘漏斗和归因。",
        "model": "",
        "enhancement_enabled": False,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "通用简历（数据分析 / 用户增长）",
        "job_index": None,
        "content": lambda: _content(
            minimal=True,
            job_intent="数据分析 / 用户增长",
            summary=persona.SUMMARY,
            skills=_skills(8),
        ),
        "source": "manual",
        "favorite": True,
        "template": "minimal",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 1,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "方向未定时先投这一份。",
        "model": "",
        "enhancement_enabled": False,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "English Resume - Growth Analyst",
        "job_index": None,
        "content": _en_content,
        "source": "manual",
        "favorite": False,
        "template": "scholar",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 1,
        "font_scale": "small",
        "language": "en-US",
        "custom_instruction": "",
        "note": "英文版，用于外企与海外岗位；纸面标题用英文（语言=English）。",
        "model": "",
        "enhancement_enabled": False,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "草稿：增长策略经理 - 木野生活",
        "job_index": None,
        "content": lambda: _content(job_intent="增长策略经理", summary=persona.SUMMARY),
        "source": "manual",
        "favorite": False,
        "template": "compact",
        "format_name": "standard",
        "format_config": {},
        "page_limit": 1,
        "font_scale": "standard",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "点进制作台没保存就关掉的那一份，应该不出现在简历列表里。",
        "model": "",
        "enhancement_enabled": False,
        "enhancement_level": "balanced",
        "rationale": "",
        "draft": True,
    },
]


def seed() -> None:
    """写 6 份简历（其中 1 份是草稿、1 份英文版）。"""
    from dataset_seed.jobs import JOBS

    rows = []
    for index, spec in enumerate(RESUMES):
        job = JOBS[spec["job_index"]] if spec["job_index"] is not None else None
        created = NOW - timedelta(days=index * 3 + 1)
        rows.append(
            row(
                title=spec["title"],
                job_id=(spec["job_index"] + 1) if spec["job_index"] is not None else None,
                job_title=job["title"] if job else "",
                company=job["company"] if job else "",
                content=spec["content"](),
                warnings=[],
                source=spec["source"],
                favorite=spec["favorite"],
                draft=spec.get("draft", False),
                revision=3 if index < 2 else 1,
                document_mode="resume",
                model=spec["model"],
                tone="standard",
                enhancement_enabled=spec["enhancement_enabled"],
                enhancement_level=spec["enhancement_level"],
                template=spec["template"],
                format_name=spec["format_name"],
                format_config=spec["format_config"],
                page_limit=spec["page_limit"],
                font_scale=spec["font_scale"],
                language=spec["language"],
                custom_instruction=spec["custom_instruction"],
                note=spec["note"],
                parse_error="",
                coverage_notes=[],
                fact_annotations=[],
                rationale=spec["rationale"],
                created_at=created,
                updated_at=created,
                deleted_at=None,
                parent_revision_id=None,
                context_snapshot=None,
            )
        )
    ins("resume_record", rows)
