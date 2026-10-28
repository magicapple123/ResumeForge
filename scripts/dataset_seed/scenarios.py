# SPDX-License-Identifier: Apache-2.0
"""职业场景：四种投递情境，覆盖"在职看机会 / 外企英文 / 校招实习 / 转岗"。

场景只是**一组受限维度 + 推荐栏目**，不写任何业务数据；它的价值在于生成简历时
能给模型一个明确的取舍口径（比如"校招版把校园经历提到项目前面"）。所以四个场景的
差异要落在 ``preferred_sections`` 与 ``expression_preferences`` 上，而不是换个名字。
"""

from __future__ import annotations

from app.database import SessionLocal
from app.schemas.career_scenario import CareerScenarioConfig, CareerScenarioCreate
from app.services.career_scenarios import store

SCENARIOS = [
    {
        "name": "大厂增长岗（在职看机会）",
        "archived": False,
        "config": {
            "career_stage": "experienced",
            "employment_status": "employed",
            "purpose": "job_search",
            "target_industries": ["互联网", "消费零售"],
            "target_function": "用户增长 / 增长分析",
            "cooperation_form": "full_time",
            "content_language": "zh-CN",
            "work_region": "上海",
            "preferred_sections": [
                "experience",
                "projects",
                "skills",
                "summary",
                "education",
            ],
            "expression_preferences": (
                "数字先行：每条先给结果再给做法；不写形容词堆砌，不写「负责…工作」这类空句；"
                "一段不超过 3 行。"
            ),
        },
    },
    {
        "name": "外企商业分析（英文版）",
        "archived": False,
        "config": {
            "career_stage": "experienced",
            "employment_status": "employed",
            "purpose": "job_search",
            "target_industries": ["企业服务", "咨询"],
            "target_function": "Business Analyst",
            "cooperation_form": "full_time",
            "content_language": "en-US",
            "work_region": "上海 / 远程",
            "preferred_sections": ["experience", "education", "skills", "languages", "summary"],
            "expression_preferences": (
                "Use past-tense action verbs, quantify impact, keep bullets under two lines."
            ),
        },
    },
    {
        "name": "校招 / 实习版",
        "archived": False,
        "config": {
            "career_stage": "entry",
            "employment_status": "employed",
            "purpose": "internship",
            "target_industries": ["互联网", "教育"],
            "target_function": "数据分析 / 用户研究",
            "cooperation_form": "other",
            "content_language": "zh-CN",
            "work_region": "上海 / 杭州",
            "preferred_sections": [
                "education",
                "campus_experience",
                "projects",
                "awards",
                "skills",
            ],
            "expression_preferences": "突出课程项目与校园经历，弱化在职经历的年资感。",
        },
    },
    {
        "name": "转岗数据产品（已归档）",
        "archived": True,
        "config": {
            "career_stage": "experienced",
            "employment_status": "employed",
            "purpose": "career_change",
            "target_industries": ["企业服务", "互联网"],
            "target_function": "数据产品经理",
            "cooperation_form": "full_time",
            "content_language": "zh-CN",
            "work_region": "上海",
            "preferred_sections": ["experience", "projects", "credentials", "summary"],
            "expression_preferences": "把分析项目改写成「需求—方案—上线—度量」的产品语言。",
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
