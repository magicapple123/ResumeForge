"""集中导入全部模型，保证 Base.metadata 注册完整（create_all 依赖此注册）。"""
from .job import Job
from .profile import Award, Education, Experience, Project, Skill, UserProfile
from .resume import ResumeRecord
from .setting import AppSetting

__all__ = [
    "Job",
    "UserProfile",
    "Education",
    "Experience",
    "Project",
    "Skill",
    "Award",
    "ResumeRecord",
    "AppSetting",
]
