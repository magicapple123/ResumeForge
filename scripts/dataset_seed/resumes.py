# SPDX-License-Identifier: Apache-2.0
"""简历：6 份简历（含草稿与英文版）。

简历正文用 ``ResumeContent`` 校验后再落库——JSON 列不会替我们查字段名，
写错一个键的后果是"这份简历打不开"，而不是"这个字段没显示"。

人设：2027 届计算机科学与技术本科（后端 / AI Agent / 全栈方向）。标题与
``jobs.py`` 里的岗位名逐字对应，投递进度表引用的是同一批标题。
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
    """默认内容 = 一份"后端 / AI Agent 应届生"标准版；各份简历只覆盖差异部分。

    ``compact`` 去掉科研三栏、校园、证书与开源板块，只留招聘方最先看的六块——
    定向投递的简历必须压在一页内，把 13 个板块全塞进去会排成三页（那是「长 CV」的形态，
    由另一份简历专门覆盖）。
    """
    data = {
        "name": BASIC["name"],
        "photo": "",
        "gender": BASIC["gender"],
        "birth_year": "2005",
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
                "key": "custom:opensource",
                "title": "开源贡献",
                "entries": [
                    {
                        "entry_id": "o1",
                        "text": "agent-toolkit：Agent 工具调用的重试与结构化输出校验库",
                        "lines": [
                            {
                                "label": "链接",
                                "value": "https://github.com/yizhou-shen/agent-toolkit",
                            },
                            {
                                "label": "说明",
                                "value": "被实验室 3 个项目接入，仓库 186 star",
                            },
                        ],
                    },
                    {
                        "entry_id": "o2",
                        "text": "oss-pr-index：向两个 Python 开源项目提交的 5 个 PR 索引",
                        "lines": [
                            {
                                "label": "链接",
                                "value": "https://github.com/yizhou-shen/oss-pr-index",
                            },
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
    "Computer Science undergraduate (class of 2027) working on backend services and LLM agent "
    "applications. Two internships: business APIs on a trading platform (order-detail p95 from "
    "380 ms to 95 ms, cache hit rate 43% to 91%, slow queries from 23K to 900 per day) and the "
    "tool layer of an enterprise knowledge-base agent (tool-call success 79% to 94%, hybrid "
    "retrieval Recall@5 from 61% to 84%). Built a resume-oriented LLM agent workbench (tool "
    "calling, structured output, 240-case eval set) and shipped a campus marketplace on React, "
    "FastAPI and PostgreSQL. I write tests and eval sets before touching code."
)

EN_EXPERIENCES = [
    {
        "company": "Shuyun Information Technology (Hangzhou) Co., Ltd.",
        "role": "Backend Engineering Intern",
        "start_date": "2026-07",
        "end_date": "2026-10",
        "description": [
            "Owned four trading-platform APIs (order lookup, refund, stock check, statement "
            "export) on Python and FastAPI, serving 2.1M requests per day; p95 down from 640 ms "
            "to 220 ms.",
            "Added two-level caching (Redis plus in-process LRU) to order detail: hit rate 43% "
            "to 91%, origin QPS 1800 to 160, p95 from 380 ms to 95 ms.",
            "Triaged 17 full-table scans with EXPLAIN, added 4 composite indexes and rewrote 3 "
            "deep-pagination queries; slow queries from 23K to 900 per day.",
            "Moved statement export to an async Celery task with progress polling; timeout error "
            "rate from 8.4% to 0.2% and manual retries disappeared.",
        ],
        "team_size": "12",
        "experience_kind": "internship",
    },
    {
        "company": "Lingshu Intelligence Technology (Hangzhou) Co., Ltd.",
        "role": "Agent Development Intern",
        "start_date": "2026-01",
        "end_date": "2026-05",
        "description": [
            "Built the tool layer of an enterprise knowledge-base agent: 9 function tools with "
            "schema validation and retry; tool-call success from 79% to 94%.",
            "Created a 160-case eval set and a pre-release regression run; 21 regressions were "
            "caught before shipping in three months.",
            "Reworked retrieval with heading-aware chunking, 512-token windows and BM25 plus "
            "vector fusion; Recall@5 from 61% to 84%.",
        ],
        "team_size": "6",
        "experience_kind": "internship",
    },
]

EN_PROJECTS = [
    {
        "name": "LLM Agent Workbench for Job Applications",
        "role": "Project owner",
        "start_date": "2026-03",
        "end_date": "2026-08",
        "tech_stack": ["Python", "FastAPI", "LangGraph", "PostgreSQL", "React"],
        "description": [
            "Splits resume tailoring into intent parsing, fact retrieval, rewriting and fact "
            "checking, all chained through tool calls and persisted step by step.",
        ],
        "highlights": [
            "Structured output plus a second-pass fact check cut unsupported claims from 11% "
            "to 1.2% over 240 manually reviewed cases.",
            "Tool-call success 94%, p95 latency 3.1 s; 61 pytest cases cover tool failures, "
            "timeouts and invalid JSON.",
            "Used for five months: 180 tailored resumes, 40 minutes down to 6 minutes each.",
        ],
        "project_size": "Personal project, 240-case eval set",
        "artifact_type": "Personal project",
    }
]

EN_SKILLS = [
    {"name": "Python", "level": "Proficient", "category": "Programming"},
    {"name": "FastAPI", "level": "Proficient", "category": "Frameworks"},
    {"name": "PostgreSQL", "level": "Proficient", "category": "Databases"},
    {"name": "Redis", "level": "Working knowledge", "category": "Databases"},
    {"name": "LLM tool calling", "level": "Proficient", "category": "AI engineering"},
    {"name": "RAG / vector search", "level": "Working knowledge", "category": "AI engineering"},
]

EN_EDUCATION = [
    {
        "school": "Nanjing University of Science and Technology",
        "major": "Computer Science and Technology",
        "degree": "Bachelor",
        "start_date": "2023-09",
        "end_date": "2027-06",
        "gpa": "3.7/4.0",
        "courses": [
            "Data Structures and Algorithms",
            "Operating Systems",
            "Database Systems",
            "Computer Networks",
            "Distributed Systems",
        ],
        "achievements": [
            "Ranked 9/126 in the major; silver award at CCPC Jiangsu Provincial Contest 2024.",
            "Led a provincial undergraduate innovation project on LLM agent reliability.",
        ],
        "study_form": "Full-time",
        "degree_type": "Bachelor of Engineering",
        "department": "School of Computer Science and Engineering",
        "rank": "9/126",
    }
]

EN_CREDENTIALS = [
    {
        "name": "Software Designer (Intermediate Professional Qualification)",
        "issuer": "MIIT Education and Examination Center",
        "issue_date": "2026-05",
        "expiry_date": "",
        "status": "active",
        "verify_url": "",
        "note": "",
        "credential_type": "Professional qualification",
    },
    {
        "name": "Huawei Certified AI Engineer (HCIA-AI)",
        "issuer": "Huawei",
        "issue_date": "2025-11",
        "expiry_date": "2028-11",
        "status": "active",
        "verify_url": "",
        "note": "",
        "credential_type": "Skill certification",
    },
]

EN_LANGUAGES = [
    {"name": "Chinese", "level": "Native", "certificate": "", "score": "", "obtained_at": ""},
    {
        "name": "English",
        "level": "Professional working proficiency",
        "certificate": "CET-6",
        "score": "561",
        "obtained_at": "2025-06",
    },
]


def _en_content() -> dict:
    """英文版：连学历、证书、语言也一起换成英文，避免「英文简历里嵌着中文段落」。"""
    return _content(
        minimal=True,
        name="Yizhou Shen",
        gender="Male",
        city="Nanjing",
        job_intent="Backend / AI Agent Developer",
        summary=EN_SUMMARY,
        education=EN_EDUCATION,
        experience=EN_EXPERIENCES,
        projects=EN_PROJECTS,
        skills=EN_SKILLS,
        credentials=EN_CREDENTIALS,
        languages=EN_LANGUAGES,
        awards=[
            {
                "name": "National Inspirational Scholarship",
                "date": "2025-10",
                "description": "Top 5% of the major.",
                "issuer": "Ministry of Education",
                "level": "National",
                "ratio": "Top 5%",
            }
        ],
    )


RESUMES = [
    {
        "title": "后端开发工程师 - 杭州枢云信息科技有限公司",
        "job_index": 0,
        "content": lambda: _content(
            compact=True,
            experience=[_experience(0, bullets=4), _experience(1, bullets=2)],
            job_intent="后端开发工程师",
            summary=(
                "计算机本科（2027 届），后端方向：交易中台 4 个接口的迭代与治理，"
                "订单详情 P95 380 ms→95 ms（缓存命中率 43%→91%），"
                "慢查询日均 2.3 万→900 条、对账导出 42 s→6 s。熟悉 FastAPI、MySQL 索引优化、"
                "Redis 缓存与 Celery 异步任务，习惯先补单测再改代码。"
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
        "custom_instruction": "突出接口性能优化与慢查询治理的量化结果",
        "note": "投枢云用，第一页必须出现 P95 和慢查询两个数。",
        "model": "deepseek-v4-flash",
        "enhancement_enabled": True,
        "enhancement_level": "strong",
        "rationale": "岗位强调接口性能与 MySQL 索引，因此把缓存与慢查询治理放在第一条，并保留 Agent 侧一条作为佐证。",
    },
    {
        "title": "大模型应用开发工程师 - 上海曦和智能科技有限公司",
        "job_index": 12,
        "content": lambda: _content(
            minimal=True,
            job_intent="大模型应用开发工程师",
            summary=(
                "计算机本科（2027 届），做过 Agent 工具层与 RAG 召回：9 个 function tool 的"
                "调用成功率 79%→94%，混合检索 Recall@5 61%→84%；自己写过一套求职场景的"
                "Agent 工作台（工具调用 + 结构化输出 + 240 条评测集）。"
            ),
            projects=[_project(0)],
        ),
        "source": "ai",
        "favorite": True,
        "template": "classic",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 1,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "一页版，只放 Agent 工作台与工具层那条实习。",
        "model": "deepseek-v4-flash",
        "enhancement_enabled": True,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "AI Agent 开发工程师 - 杭州灵枢智能科技有限公司",
        "job_index": 1,
        "content": lambda: _content(
            campus_experience=[],
            job_intent="AI Agent 开发工程师",
            summary=(
                "计算机本科 + 人工智能微专业（2027 届），在 Agent 应用组做过工具层与评测："
                "工具调用成功率 79%→94%、参数格式错误率 12%→1.8%、Recall@5 61%→84%；"
                "能自己搭评测集并把回归问题拦在发版前。"
            ),
            experience=[_experience(1, bullets=4), _experience(0, bullets=2)],
            projects=[_project(2)],
            skills=_skills(8),
        ),
        "source": "manual",
        "favorite": False,
        "template": "elegant",
        "format_name": "compact",
        "format_config": {},
        "page_limit": 2,
        "font_scale": "small",
        "language": "zh-CN",
        "custom_instruction": "",
        "note": "偏 Agent 方向，把实习顺序调成 Agent 在前、后端在后。",
        "model": "",
        "enhancement_enabled": False,
        "enhancement_level": "balanced",
        "rationale": "",
    },
    {
        "title": "通用简历（后端 / AI Agent）",
        "job_index": None,
        "content": lambda: _content(
            minimal=True,
            job_intent="后端开发 / AI Agent 开发",
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
        "title": "English Resume - Backend / AI Agent Developer",
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
        "title": "草稿：全栈开发工程师 - 南京云枢软件有限公司",
        "job_index": None,
        "content": lambda: _content(
            job_intent="全栈开发工程师",
            summary=persona.SUMMARY,
            experience=[_experience(0, bullets=3), _experience(2, bullets=2)],
        ),
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
