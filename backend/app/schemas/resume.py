"""简历 Schema：生成请求、LLM 输出结构、历史记录。"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profile import validate_photo_data_url


class GenerateOptions(BaseModel):
    # 定制风格：standard 综合均衡 / tech 技术突出 / academic 科研算法
    tone: Literal["standard", "tech", "academic"] = "standard"


class GenerateRequest(BaseModel):
    job_id: int
    options: GenerateOptions = GenerateOptions()


# ===== 简历内容结构（LLM 输出的 JSON 必须符合此结构） =====
# 与个人资料的差异：多行文本拆成了数组，更利于模型逐条输出与后续渲染。
class ResumeEducation(BaseModel):
    school: str = ""
    major: str = ""
    degree: str = ""
    start_date: str = ""
    end_date: str = ""
    gpa: str = ""
    courses: list[str] = []
    achievements: list[str] = []


class ResumeExperience(BaseModel):
    company: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    description: list[str] = []


class ResumeCampusExperience(BaseModel):
    organization: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    description: list[str] = []


class ResumeProject(BaseModel):
    name: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    tech_stack: list[str] = []
    description: list[str] = []
    highlights: list[str] = []


class ResumeSkill(BaseModel):
    name: str = ""
    level: str = ""


class ResumeAward(BaseModel):
    name: str = ""
    date: str = ""
    description: str = ""


class ResumeContent(BaseModel):
    name: str = ""
    photo: str = ""
    gender: str = ""
    birth_year: str = ""
    phone: str = ""
    email: str = ""
    city: str = ""
    job_intent: str = ""
    summary: str = ""
    education: list[ResumeEducation] = []
    experience: list[ResumeExperience] = []
    campus_experience: list[ResumeCampusExperience] = []
    projects: list[ResumeProject] = []
    skills: list[ResumeSkill] = []
    awards: list[ResumeAward] = []

    @field_validator("photo")
    @classmethod
    def photo_must_be_safe_image(cls, value: str) -> str:
        return validate_photo_data_url(value)


class ResumeBrief(BaseModel):
    """列表页不携带完整 content，避免大 JSON 反复传输。"""

    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    job_title: str
    company: str
    model: str
    tone: str
    created_at: datetime


class ResumeOut(ResumeBrief):
    content: ResumeContent
    warnings: list[str] = []
    parse_error: str = ""


class ResumeRenderRequest(BaseModel):
    """生成完成后、未落库前的即时预览渲染。"""

    content: ResumeContent
