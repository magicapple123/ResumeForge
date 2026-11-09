# SPDX-License-Identifier: Apache-2.0
"""职业场景：四种投递情境，覆盖"后端校招 / Agent 英文版 / 日常实习 / 转测试开发"。

场景只是**一组受限维度 + 推荐栏目**，不写任何业务数据；它的价值在于生成简历时
能给模型一个明确的取舍口径（比如"校招版把校园经历提到项目前面"）。所以四个场景的
差异要落在 ``preferred_sections`` 与 ``expression_preferences`` 上，而不是换个名字。

人设是 2027 届在校本科生，因此 ``career_stage`` 用 ``student``、``employment_status``
用 ``studying``——这两维会进场景卡片的筛选，不该写成 ``experienced/employed``。
"""

from __future__ import annotations

from app.database import SessionLocal
from app.schemas.career_scenario import CareerScenarioConfig, CareerScenarioCreate
from app.services.career_scenarios import store

SCENARIOS = [
    {
        "name": "后端开发校招（主投）",
        "archived": False,
        "config": {
            "career_stage": "student",
            "employment_status": "studying",
            "purpose": "job_search",
            "target_industries": ["互联网", "企业服务"],
            "target_function": "后端开发",
            "cooperation_form": "full_time",
            "content_language": "zh-CN",
            "work_region": "上海 / 杭州 / 南京",
            "preferred_sections": [
                "education",
                "experience",
                "projects",
                "skills",
                "summary",
            ],
            "expression_preferences": (
                "数字先行：每条先给结果再给做法；接口类成果必须带 P95、慢查询条数这类可比数字；"
                "不写「负责…工作」这类空句；一条不超过 2 行。"
            ),
        },
    },
    {
        "name": "AI Agent 开发（英文版）",
        "archived": False,
        "config": {
            "career_stage": "student",
            "employment_status": "studying",
            "purpose": "job_search",
            "target_industries": ["AI 应用", "企业服务"],
            "target_function": "AI Agent Developer",
            "cooperation_form": "full_time",
            "content_language": "en-US",
            "work_region": "上海 / 远程",
            "preferred_sections": ["experience", "projects", "skills", "languages", "summary"],
            "expression_preferences": (
                "Use past-tense action verbs, quantify impact (latency, success rate, Recall@5), "
                "keep bullets under two lines."
            ),
        },
    },
    {
        "name": "日常实习版",
        "archived": False,
        "config": {
            "career_stage": "student",
            "employment_status": "studying",
            "purpose": "internship",
            "target_industries": ["互联网", "AI 应用"],
            "target_function": "后端开发 / Agent 开发",
            "cooperation_form": "other",
            "content_language": "zh-CN",
            "work_region": "南京 / 上海 / 杭州 / 苏州",
            "preferred_sections": [
                "education",
                "projects",
                "skills",
                "campus_experience",
                "awards",
            ],
            "expression_preferences": (
                "突出课程项目与实验室项目；在开头写清每周可到岗天数与可实习起止时间，"
                "弱化「实习经历」的年资感。"
            ),
        },
    },
    {
        "name": "转测试开发（已归档）",
        "archived": True,
        "config": {
            "career_stage": "student",
            "employment_status": "studying",
            "purpose": "career_change",
            "target_industries": ["互联网", "企业服务"],
            "target_function": "测试开发",
            "cooperation_form": "full_time",
            "content_language": "zh-CN",
            "work_region": "深圳 / 上海",
            "preferred_sections": ["experience", "projects", "credentials", "skills"],
            "expression_preferences": (
                "把接口治理与评测集经验改写成质量保障语言：可测性、回归效率、拦截率；"
                "少写「测试用例数量」，多写「拦住了什么」。"
            ),
        },
    },
]


def seed() -> None:
    """按配置建场景；其中一条建完就归档，用来测「显示已归档」的筛选。"""
    with SessionLocal() as db:
        for item in SCENARIOS:
            created = store.create_scenario(
                db,
                CareerScenarioCreate(
                    name=item["name"], config=CareerScenarioConfig(**item["config"])
                ),
            )
            if item["archived"]:
                store.set_archived(
                    db, created.id, archived=True, expected_revision=created.revision
                )
