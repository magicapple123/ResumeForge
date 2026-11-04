# SPDX-License-Identifier: Apache-2.0
"""field_limits_catalog 的逐键漂移守卫（T06）。

期望表是 2026-11-04 改造前从旧实现冻结的**现场值**（``read_field_limits.READ_SIDE_LIMITS``、
``profile_service._BASIC_FIELD_MAP`` / ``_ITEM_FIELD_MAP``），不是事后重新推导的结果。
改任何一行数字都必须说明读取投影（``schemas.profile`` 的 ``*Out`` 模型）同步改了什么；
禁止为了让测试变绿改期望表——那会把"存得进去、资料页读不出来"的 500 放回来。
"""

from __future__ import annotations

from app.services.profile.definition_catalog import get_field
from app.services.profile.field_limits_catalog import (
    BASIC_FIELD_MAP,
    READ_SIDE_LIMITS,
    SECTION_FIELD_MAP,
    limit_of,
    too_long_detail,
)

_FROZEN_BASIC_FIELD_MAP: dict[str, str] = {
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

_FROZEN_SECTION_FIELD_MAP: dict[str, dict[str, str | None]] = {
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

_FROZEN_READ_SIDE_LIMITS: dict[str, int] = {
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


def test_basic_field_map_is_frozen() -> None:
    """旧标量映射逐键冻结：键数与值都必须与改造前一致。"""
    assert BASIC_FIELD_MAP == _FROZEN_BASIC_FIELD_MAP
    assert len(BASIC_FIELD_MAP) == len(_FROZEN_BASIC_FIELD_MAP) == 11


def test_section_field_map_is_frozen() -> None:
    """子项映射逐键冻结（含 None：新模型没有位置的旧字段不能悄悄复活）。"""
    assert SECTION_FIELD_MAP == _FROZEN_SECTION_FIELD_MAP
    assert len(SECTION_FIELD_MAP) == len(_FROZEN_SECTION_FIELD_MAP) == 6


def test_read_side_limits_are_frozen() -> None:
    """写入侧上限逐键冻结：键数与值都必须与改造前一致。"""
    assert READ_SIDE_LIMITS == _FROZEN_READ_SIDE_LIMITS
    assert len(READ_SIDE_LIMITS) == len(_FROZEN_READ_SIDE_LIMITS) == 43


def test_every_limit_field_exists_in_definition_catalog() -> None:
    """上限表里的每个 field_id 都必须仍在新目录里，否则就是"上限表里有已不存在的字段"。"""
    missing = sorted(field_id for field_id in READ_SIDE_LIMITS if get_field(field_id) is None)
    assert not missing, f"上限表里有已不存在的字段: {missing}"


def test_section_map_targets_all_have_read_limits() -> None:
    """子项映射里能落到新模型的 field_id 都必须有读取侧上限（两表同源，缺一就是漂移）。"""
    mapped = {
        field_id
        for fields in SECTION_FIELD_MAP.values()
        for field_id in fields.values()
        if field_id is not None
    }
    assert mapped <= set(READ_SIDE_LIMITS)
    assert len(mapped) == 33


def test_limit_of_and_too_long_detail_keep_old_contract() -> None:
    """函数签名与语义不变：未知/无读取模型返回 None；超限文案带字段标签与两个数字。"""
    assert limit_of("awards.title") == 128
    assert limit_of("custom:1.自定义字段") is None
    assert limit_of("basic_info.photo") is None
    detail = too_long_detail("awards.title", 160, 128)
    assert "奖项名称" in detail
    assert "128" in detail
    assert "160" in detail
