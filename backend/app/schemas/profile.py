"""个人资料 Schema：In 为写入结构（子表不带 id），Out 为读取结构。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EducationIn(BaseModel):
    school: str = ""
    major: str = ""
    degree: str = ""
    start_date: str = ""
    end_date: str = ""
    gpa: str = ""
    courses: str = ""  # 换行分隔
    achievements: str = ""  # 换行分隔


class ExperienceIn(BaseModel):
    company: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    description: str = ""  # 换行分隔


class ProjectIn(BaseModel):
    name: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    tech_stack: str = ""  # 逗号分隔
    description: str = ""  # 换行分隔
    highlights: str = ""  # 换行分隔


class SkillIn(BaseModel):
    name: str = ""
    level: str = ""


class AwardIn(BaseModel):
    name: str = ""
    date: str = ""
    description: str = ""


class EducationOut(EducationIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ExperienceOut(ExperienceIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ProjectOut(ProjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class SkillOut(SkillIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AwardOut(AwardIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ProfileUpdate(BaseModel):
    """PUT 语义：整体替换，子表列表会先删后插。"""

    name: str = ""
    gender: str = ""
    birth_year: str = ""
    phone: str = ""
    email: str = ""
    city: str = ""
    target_city: str = ""
    job_intent: str = ""
    personal_website: str = ""
    github: str = ""
    summary: str = ""
    educations: list[EducationIn] = []
    experiences: list[ExperienceIn] = []
    projects: list[ProjectIn] = []
    skills: list[SkillIn] = []
    awards: list[AwardIn] = []


class ProfileOut(ProfileUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    updated_at: datetime | None = None
    educations: list[EducationOut] = []
    experiences: list[ExperienceOut] = []
    projects: list[ProjectOut] = []
    skills: list[SkillOut] = []
    awards: list[AwardOut] = []
