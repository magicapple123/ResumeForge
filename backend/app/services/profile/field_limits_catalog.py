# SPDX-License-Identifier: Apache-2.0
"""读取侧字段上限目录：写入校验与读取投影共用的约束，2.0 起由本模块自持。

**为什么需要它**（2026-11 用户报告）：写入侧只按字段类型给上限（单行 200、多行
2000），而读取投影用旧 ``*Out`` 模型逐字段建模、字段上有更紧的 ``max_length``（如
``AwardOut.name`` 128）。于是 160 字的奖项名称能写进库，``GET /api/profile`` 的投影
当场 ``ValidationError``，资料页整页 500——写入时没人拦。

**为什么是字面常量而不是从读取模型 import**：2.0 下线旧写协议后，本模块不能再反向
依赖旧写协议服务与旧 ``*Out`` DTO。下面三张表在 T06 改造（2026-11-04）时从旧实现
逐键冻结：

- ``SECTION_FIELD_MAP``：旧子项字段 → 新 ``field_id``（``None`` = 新模型没有该位置）；
- ``BASIC_FIELD_MAP``：旧标量 → 新 ``field_id``；
- ``READ_SIDE_LIMITS``：原读取侧上限函数 ``_item_limits()/_basic_limits()`` 的计算结果。
  上限来源是 ``schemas.profile`` 的 ``ProfileOut``（基本信息/总结）与
  ``EducationOut``/``ExperienceOut``/``CampusExperienceOut``/``ProjectOut``/``SkillOut``/
  ``AwardOut``（子表），冻结日期 2026-11-04。

改这些数字必须同时改 ``tests/test_field_limits_catalog.py`` 的逐键期望表，并说明读取
投影同步改了什么；**不允许**为了让测试变绿改期望表——那会把"存得进去、资料页读不
出来"的 500 放回来。
"""

from __future__ import annotations

from .definition_catalog import get_field

# 旧子项字段 → 新模型 field_id；None = 新模型没有这个位置（四六级分数、参考文件等）。
SECTION_FIELD_MAP: dict[str, dict[str, str | None]] = {
    "awards": {
        "date": "awards.awarded_at",
        "description": "awards.description",
        "name": "awards.title",
    },
    "campus_experiences": {
        "description": "campus_experiences.description",
        "end_date": "campus_experiences.end_date",
        "organization": "campus_experiences.organization",
        "reference_content": None,
        "reference_file_name": None,
        "role": "campus_experiences.role",
        "start_date": "campus_experiences.start_date",
    },
    "educations": {
        "achievements": "educations.achievements",
        "cet4_score": None,
        "cet6_score": None,
        "courses": "educations.core_courses",
        "degree": "educations.degree",
        "degree_type": "educations.degree_type",
        "department": "educations.department",
        "end_date": "educations.end_date",
        "gpa": "educations.gpa",
        "major": "educations.major",
        "reference_content": None,
        "reference_file_name": None,
        "school": "educations.school",
        "start_date": "educations.start_date",
        "study_mode": "educations.study_form",
    },
    "experiences": {
        "company": "experiences.company",
        "description": "experiences.description",
        "end_date": "experiences.end_date",
        "reference_content": None,
        "reference_file_name": None,
        "role": "experiences.title",
        "start_date": "experiences.start_date",
    },
    "projects": {
        "description": "projects.description",
        "end_date": "projects.end_date",
        "highlights": "projects.highlights",
        "name": "projects.name",
        "reference_content": None,
        "reference_file_name": None,
        "role": "projects.role",
        "start_date": "projects.start_date",
        "tech_stack": "projects.tech_stack",
    },
    "skills": {
        "level": "skills.level",
        "name": "skills.name",
    },
}

# 旧标量 → 新模型 field_id；birth_year/birth_date 合并到 basic_info.birth_month。
BASIC_FIELD_MAP: dict[str, str] = {
    "city": "basic_info.city",
    "email": "basic_info.email",
    "gender": "basic_info.gender",
    "github": "basic_info.github",
    "job_intent": "basic_info.job_intention",
    "name": "basic_info.name",
    "personal_website": "basic_info.homepage",
    "phone": "basic_info.phone",
    "photo": "basic_info.photo",
    "political_status": "basic_info.political_status",
    "target_city": "basic_info.target_city",
}

# field_id → 读取侧允许的最大字符数（逐键期望值由 tests/test_field_limits_catalog.py 钉住）。
READ_SIDE_LIMITS: dict[str, int] = {
    "awards.awarded_at": 32,
    "awards.description": 2000,
    "awards.title": 128,
    "basic_info.city": 64,
    "basic_info.email": 128,
    "basic_info.gender": 64,
    "basic_info.github": 256,
    "basic_info.homepage": 256,
    "basic_info.job_intention": 128,
    "basic_info.phone": 32,
    "basic_info.political_status": 32,
    "basic_info.target_city": 64,
    "campus_experiences.description": 200000,
    "campus_experiences.end_date": 32,
    "campus_experiences.organization": 128,
    "campus_experiences.role": 128,
    "campus_experiences.start_date": 32,
    "educations.achievements": 200000,
    "educations.core_courses": 200000,
    "educations.degree": 32,
    "educations.degree_type": 32,
    "educations.department": 128,
    "educations.end_date": 32,
    "educations.gpa": 64,
    "educations.major": 128,
    "educations.school": 128,
    "educations.start_date": 32,
    "educations.study_form": 32,
    "experiences.company": 128,
    "experiences.description": 200000,
    "experiences.end_date": 32,
    "experiences.start_date": 32,
    "experiences.title": 128,
    "projects.description": 200000,
    "projects.end_date": 32,
    "projects.highlights": 200000,
    "projects.name": 128,
    "projects.role": 64,
    "projects.start_date": 32,
    "projects.tech_stack": 10000,
    "skills.level": 32,
    "skills.name": 64,
    "summary.content": 200000,
}


def limit_of(field_id: str) -> int | None:
    """某字段在读取侧的上限；没有读取投影（自建字段等）返回 None = 不额外限制。"""
    return READ_SIDE_LIMITS.get(str(field_id))


def too_long_detail(field_id: str, length: int, limit: int) -> str:
    """超限文案：只写原因（下一步由前端 errorGuidance 给），字段名用目录里的标签。"""
    spec = get_field(field_id)
    label = spec.label if spec is not None else field_id
    return f"「{label}」最多 {limit} 个字符，当前 {length} 个字符，超出部分无法被资料页读出"


__all__ = [
    "BASIC_FIELD_MAP",
    "READ_SIDE_LIMITS",
    "SECTION_FIELD_MAP",
    "limit_of",
    "too_long_detail",
]
