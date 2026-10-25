# SPDX-License-Identifier: Apache-2.0
"""职业场景领域 schema（A1，契约 §2.1/§2.2/§2.4）。

职业场景是"本窗口建议"的一组受限维度：职业阶段、使用目的、目标行业/职能、合作形式、
内容语言、地区、推荐栏目与表达偏好。它**不是**账号权限、岗位过滤器、模板或提示词里的
扮演角色；切换场景不写任何业务数据，只有用户在生成配置里显式"用于本次生成"时才由
服务端解析成不可变快照（见 `schemas/generation_context.py`）。

边界（计划 §7.2）：

- 名称 1–40 字；每数据集自定义场景 ≤50；config JSON ≤16 KiB；行业 ≤5 个 × 40 字；
  表达偏好 ≤800 字。
- 未知字段/非法枚举一律 422（``extra="forbid"``），不让前端上传任意系统提示词。
- ``employment_status``` 只是本地保存的维度：默认不进 AI、不进导出；本次生成是否
  允许使用由请求的披露开关决定（resolver 负责裁剪）。

**分区 key 为什么在本文件里复制一份**：schemas 是叶子层，不得 import services
（`tests/test_import_direction.py` 会红）。允许的 key 与
`services/resume/resume_sections.py::DEFAULT_SECTION_ORDER` 必须逐项一致，由
`tests/test_career_scenarios.py` 逐个比对两边；改分区清单要同批改两处。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ===== 维度枚举（严格；前端不得自造取值）=====
CareerStage = Literal["unset", "student", "entry", "experienced", "senior"]
EmploymentStatus = Literal[
    "unset", "employed", "unemployed", "self_employed", "studying", "career_break", "other"
]
CareerPurpose = Literal[
    "general",
    "internship",
    "job_search",
    "career_change",
    "internal_transfer",
    "research_application",
    "project_collaboration",
    "career_return",
]
CooperationForm = Literal["unset", "full_time", "part_time", "contract", "self_employed", "other"]
ContentLanguage = Literal["unset", "zh-CN", "en-US"]

# ===== 限量常量（catalog 接口的 limits 直接取自这里，不散落第二份）=====
MAX_SCENARIO_NAME_LENGTH = 40
MAX_SCENARIOS_PER_DATASET = 50
MAX_CONFIG_BYTES = 16 * 1024
MAX_TARGET_INDUSTRIES = 5
MAX_TARGET_INDUSTRY_LENGTH = 40
MAX_TARGET_FUNCTION_LENGTH = 120
MAX_WORK_REGION_LENGTH = 40
MAX_PREFERRED_SECTIONS = 10
MAX_EXPRESSION_PREFERENCES_LENGTH = 800
MAX_GUIDANCE_ITEMS = 3
MAX_GUIDANCE_LENGTH = 40

# config 的结构版本；与 catalog_version（内置规则版本）、revision（用户编辑版本）分开。
SCENARIO_SCHEMA_VERSION = 1

# 允许的正文分区 key（顺序与 DEFAULT_SECTION_ORDER 一致；2026-10-25 起含 credentials）。
RESUME_SECTION_KEYS: tuple[str, ...] = (
    "education",
    "experience",
    "projects",
    "publications",
    "research_projects",
    "patents",
    # A4：资格证照（与 services/resume/resume_sections.py 的 DEFAULT_SECTION_ORDER 同批更新）。
    "credentials",
    "skills",
    "campus_experience",
    "awards",
    "summary",
)
RESUME_SECTION_KEY_SET = frozenset(RESUME_SECTION_KEYS)

# ===== 错误码（API 响应顶层 code；前端按码处理，不解析文案）=====
CAREER_SCENARIO_NOT_FOUND = "career_scenario_not_found"
CAREER_SCENARIO_ARCHIVED = "career_scenario_archived"
CAREER_SCENARIO_REVISION_CONFLICT = "career_scenario_revision_conflict"
CAREER_SCENARIO_LIMIT_REACHED = "career_scenario_limit_reached"
CAREER_SCENARIO_SCHEMA_UNSUPPORTED = "career_scenario_schema_unsupported"
CAREER_SCENARIO_CONFIG_INVALID = "career_scenario_config_invalid"
CAREER_SCENARIO_CATALOG_UNAVAILABLE = "career_scenario_catalog_unavailable"
CAREER_SCENARIO_CATALOG_VERSION_CONFLICT = "career_scenario_catalog_version_conflict"
CAREER_SCENARIO_PRESET_NOT_FOUND = "career_scenario_preset_not_found"


class CareerScenarioConfig(BaseModel):
    """一个场景的受限配置。字段与契约 §2.2 逐项对应，全部有安全默认值。"""

    model_config = ConfigDict(extra="forbid")

    career_stage: CareerStage = "unset"
    # 本地保存；默认不进 AI/导出。是否允许本次发送见 CareerContextRequest。
    employment_status: EmploymentStatus = "unset"
    purpose: CareerPurpose = "general"
    target_industries: list[str] = Field(
        default_factory=list, max_length=MAX_TARGET_INDUSTRIES
    )
    target_function: str = Field(default="", max_length=MAX_TARGET_FUNCTION_LENGTH)
    cooperation_form: CooperationForm = "unset"
    content_language: ContentLanguage = "unset"
    work_region: str = Field(default="", max_length=MAX_WORK_REGION_LENGTH)
    preferred_sections: list[str] = Field(
        default_factory=list, max_length=MAX_PREFERRED_SECTIONS
    )
    expression_preferences: str = Field(
        default="", max_length=MAX_EXPRESSION_PREFERENCES_LENGTH
    )
    # 保存的偏好，不自动等于"这一次生成已确认发送"（见 generation_context 说明）。
    include_employment_status: bool = False

    @field_validator("target_industries")
    @classmethod
    def _clean_industries(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = (item or "").strip()
            if not text:
                continue
            if len(text) > MAX_TARGET_INDUSTRY_LENGTH:
                raise ValueError(
                    f"每个目标行业最多 {MAX_TARGET_INDUSTRY_LENGTH} 字（当前 {len(text)} 字）"
                )
            if text not in cleaned:
                cleaned.append(text)
        return cleaned

    @field_validator("target_function", "work_region", "expression_preferences")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("preferred_sections")
    @classmethod
    def _clean_sections(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            key = (item or "").strip()
            if not key:
                continue
            if key not in RESUME_SECTION_KEY_SET:
                allowed = "、".join(RESUME_SECTION_KEYS)
                raise ValueError(f"未知的推荐栏目 {key}；可选：{allowed}")
            if key not in cleaned:
                cleaned.append(key)
        return cleaned

    @model_validator(mode="after")
    def _limit_serialized_size(self) -> CareerScenarioConfig:
        # 16 KiB 是**序列化后**的大小（契约 §2.2），按 UTF-8 字节算，中文不按字符数低估。
        payload = json.dumps(
            self.model_dump(), ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        if len(payload) > MAX_CONFIG_BYTES:
            raise ValueError(
                f"场景配置过大：上限 {MAX_CONFIG_BYTES} 字节（当前 {len(payload)} 字节）"
            )
        return self


class CareerScenarioCreate(BaseModel):
    """POST /api/career-scenarios 的请求体。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_SCENARIO_NAME_LENGTH)
    config: CareerScenarioConfig

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("场景名称不能为空")
        return cleaned


class CareerScenarioUpdate(BaseModel):
    """PATCH：只改显式给出的字段；每次成功 PATCH 都推进 revision。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_SCENARIO_NAME_LENGTH)
    config: CareerScenarioConfig | None = None
    # 归档/取消归档同样算一次编辑（revision+1）；归档不删除行。
    archived: bool | None = None
    expected_revision: int = Field(ge=1)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("场景名称不能为空")
        return cleaned


class CareerScenarioOut(BaseModel):
    """读取侧：如实回显保存的配置与版本。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    schema_version: int
    revision: int
    config: CareerScenarioConfig
    archived: bool
    created_at: datetime
    updated_at: datetime | None = None


class CareerScenarioListOut(BaseModel):
    items: list[CareerScenarioOut]
    total: int


class CatalogLimitsOut(BaseModel):
    """catalog 接口暴露给前端的限量，避免前端复制一份数字。"""

    max_scenarios: int = MAX_SCENARIOS_PER_DATASET
    max_name_length: int = MAX_SCENARIO_NAME_LENGTH
    max_config_bytes: int = MAX_CONFIG_BYTES
    max_target_industries: int = MAX_TARGET_INDUSTRIES
    max_target_industry_length: int = MAX_TARGET_INDUSTRY_LENGTH
    max_target_function_length: int = MAX_TARGET_FUNCTION_LENGTH
    max_work_region_length: int = MAX_WORK_REGION_LENGTH
    max_preferred_sections: int = MAX_PREFERRED_SECTIONS
    max_expression_preferences_length: int = MAX_EXPRESSION_PREFERENCES_LENGTH


class CatalogPresetOut(BaseModel):
    """一个内置快捷场景（仅快捷组合，不是互斥身份）。"""

    key: str
    name: str
    config: CareerScenarioConfig
    suggested_sections: list[str]
    guidance: list[str]


class CareerScenarioCatalogOut(BaseModel):
    catalog_version: str
    schema_version: int
    limits: CatalogLimitsOut
    presets: list[CatalogPresetOut]


__all__ = [
    "CAREER_SCENARIO_ARCHIVED",
    "CAREER_SCENARIO_CATALOG_UNAVAILABLE",
    "CAREER_SCENARIO_CATALOG_VERSION_CONFLICT",
    "CAREER_SCENARIO_CONFIG_INVALID",
    "CAREER_SCENARIO_LIMIT_REACHED",
    "CAREER_SCENARIO_NOT_FOUND",
    "CAREER_SCENARIO_PRESET_NOT_FOUND",
    "CAREER_SCENARIO_REVISION_CONFLICT",
    "CAREER_SCENARIO_SCHEMA_UNSUPPORTED",
    "MAX_CONFIG_BYTES",
    "MAX_EXPRESSION_PREFERENCES_LENGTH",
    "MAX_GUIDANCE_ITEMS",
    "MAX_GUIDANCE_LENGTH",
    "MAX_PREFERRED_SECTIONS",
    "MAX_SCENARIOS_PER_DATASET",
    "MAX_SCENARIO_NAME_LENGTH",
    "MAX_TARGET_FUNCTION_LENGTH",
    "MAX_TARGET_INDUSTRIES",
    "MAX_TARGET_INDUSTRY_LENGTH",
    "MAX_WORK_REGION_LENGTH",
    "RESUME_SECTION_KEYS",
    "RESUME_SECTION_KEY_SET",
    "SCENARIO_SCHEMA_VERSION",
    "CareerPurpose",
    "CareerScenarioCatalogOut",
    "CareerScenarioConfig",
    "CareerScenarioCreate",
    "CareerScenarioListOut",
    "CareerScenarioOut",
    "CareerScenarioUpdate",
    "CareerStage",
    "CatalogLimitsOut",
    "CatalogPresetOut",
    "ContentLanguage",
    "CooperationForm",
    "EmploymentStatus",
]
