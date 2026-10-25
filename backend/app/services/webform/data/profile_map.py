# SPDX-License-Identifier: Apache-2.0
"""网申取数用的共享映射：新字段 → 网申目录键、学历排序、多行文本压平。

F5 起"资料 → 扁平字段"的映射由 defined_fields 从消费 DTO 产出（按当前组裁剪）。
本文件只保留**纯数据表与纯函数**（不依赖数据库、不依赖旧 UserProfile），供
defined_fields / catalog 复用；旧的 profile_to_form_data 与 pick_* 已退役。

表的名字都带 WEBFORM_ 前缀且只有一份：新增字段时要改的是这里，不是各处再拼一份；
defined_fields 的遍历器按这些表把"新字段 key"翻译成"网申基础 key"，再交给
repeated_fields.field_key_for_block 展开成 education_1_school 这类带序号动态键。
"""
from __future__ import annotations

from collections.abc import Mapping

# 学历层次排序：取"最高"那一条去填表。认不出的学历排最低，同级时按资料里的顺序。
DEGREE_RANK: dict[str, int] = {
    "博士": 4,
    "博士研究生": 4,
    "硕士": 3,
    "研究生": 3,
    "硕士研究生": 3,
    "本科": 2,
    "大学本科": 2,
    "大专": 1,
    "专科": 1,
    "高职": 1,
    "高中": 0,
}

# 单例分区里"新字段 id → 网申目录键"；未列出的字段走 defined_fields 的 CUSTOM_ 通道。
WEBFORM_SINGLE_VALUE_KEYS: Mapping[str, str] = {
    "basic_info.name": "name",
    "basic_info.gender": "gender",
    "basic_info.phone": "phone",
    "basic_info.email": "email",
    "basic_info.city": "city",
    "basic_info.target_city": "target_city",
    "basic_info.job_intention": "job_intent",
    "basic_info.homepage": "personal_website",
    "basic_info.github": "github",
    "basic_info.available_date": "available_date",
    "summary.content": "summary",
}

# 多条分区：section_key → (重复区块 family, 新字段 key → 网申基础键)。
WEBFORM_FAMILIES: Mapping[str, tuple[str, Mapping[str, str]]] = {
    "educations": (
        "education",
        {
            "school": "school",
            "department": "department",
            "major": "major",
            "degree": "degree",
            "study_form": "study_mode",
            "degree_type": "degree_type",
            "start_date": "education_start",
            "end_date": "education_end",
            "gpa": "gpa",
            "core_courses": "education_courses",
            "achievements": "education_achievements",
        },
    ),
    "experiences": (
        "experience",
        {
            "company": "experience_company",
            "title": "experience_role",
            "start_date": "experience_start",
            "end_date": "experience_end",
            "description": "experience_description",
        },
    ),
    "projects": (
        "project",
        {
            "name": "project_name",
            "role": "project_role",
            "start_date": "project_start",
            "end_date": "project_end",
            "tech_stack": "project_tech_stack",
            "description": "project_description",
            "highlights": "project_highlights",
        },
    ),
    "campus_experiences": (
        "campus",
        {
            "organization": "campus_organization",
            "role": "campus_role",
            "start_date": "campus_start",
            "end_date": "campus_end",
            "description": "campus_description",
        },
    ),
    "awards": (
        "award",
        {
            "title": "award_name",
            "awarded_at": "award_date",
            "description": "award_description",
        },
    ),
    "skills": (
        "skill",
        {"name": "skill_name", "level": "skill_mastery"},
    ),
}

# 教育分区"最高学历那一条"的兼容扁平键（与旧 profile_to_form_data 对齐）。
EDUCATION_FLAT_KEYS: Mapping[str, str] = {
    "school": "school",
    "department": "department",
    "major": "major",
    "degree": "degree",
    "study_form": "study_mode",
    "degree_type": "degree_type",
    "start_date": "education_start",
    "end_date": "education_end",
    "gpa": "gpa",
    "core_courses": "courses",
    "achievements": "achievements",
}

# 实习/工作分区"最近一条"的兼容扁平键。
EXPERIENCE_LATEST_KEYS: Mapping[str, str] = {
    "company": "company",
    "title": "job_title",
    "start_date": "work_start",
    "end_date": "work_end",
}

# 其它多条分区"第一条"的兼容扁平键（旧页面/旧调用方仍用无序号 key）。
FIRST_RECORD_FLAT_KEYS: Mapping[str, Mapping[str, str]] = {
    "experiences": {
        "company": "experience_company",
        "title": "experience_role",
        "start_date": "experience_start",
        "end_date": "experience_end",
        "description": "experience_description",
    },
    "projects": {
        "name": "project_name",
        "role": "project_role",
        "start_date": "project_start",
        "end_date": "project_end",
        "tech_stack": "project_tech_stack",
        "description": "project_description",
        "highlights": "project_highlights",
    },
    "campus_experiences": {
        "organization": "campus_organization",
        "role": "campus_role",
        "start_date": "campus_start",
        "end_date": "campus_end",
        "description": "campus_description",
    },
    "awards": {
        "title": "award_name",
        "awarded_at": "award_date",
        "description": "award_description",
    },
    "skills": {"name": "skill_name", "level": "skill_mastery"},
}


def _as_block_text(raw: str) -> str:
    """把换行分隔的多行文本压成一行（清单/预览是给人扫的，多行会把一屏吃掉）。"""
    lines = [line.strip() for line in (raw or "").splitlines() if line.strip()]
    return "；".join(lines)


__all__ = [
    "DEGREE_RANK",
    "EDUCATION_FLAT_KEYS",
    "EXPERIENCE_LATEST_KEYS",
    "FIRST_RECORD_FLAT_KEYS",
    "WEBFORM_FAMILIES",
    "WEBFORM_SINGLE_VALUE_KEYS",
    "_as_block_text",
]
