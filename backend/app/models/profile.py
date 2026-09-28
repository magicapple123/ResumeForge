"""个人资料相关模型：主表 + 各子表（教育/实习/校园/项目/技能/荣誉）。

日期统一用字符串（如 "2022.09"）：简历中的时间本就是展示文本，
避免日期解析带来的兼容性问题。多行文本（经历描述、项目亮点等）
以换行分隔存储，输入模型时再拆成列表。
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def utcnow() -> datetime:
    """统一时间戳（无时区的 UTC），避免 SQLite 中带时区比较的坑。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserProfile(Base):
    __tablename__ = "user_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    gender: Mapped[str] = mapped_column(String(16), default="")
    birth_year: Mapped[str] = mapped_column(String(16), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    city: Mapped[str] = mapped_column(String(64), default="")
    target_city: Mapped[str] = mapped_column(String(64), default="")
    job_intent: Mapped[str] = mapped_column(String(128), default="")  # 求职意向
    personal_website: Mapped[str] = mapped_column(String(256), default="")
    github: Mapped[str] = mapped_column(String(256), default="")
    photo: Mapped[str] = mapped_column(Text, default="")  # 受限的 base64 图片 data URL
    summary: Mapped[str] = mapped_column(Text, default="")  # 个人总结/自我评价
    section_order: Mapped[list[str]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    # ===== 网申专用字段（2026-09-26 随「网申填表」新增）=====
    #
    # 这一组是公司自建网申系统（腾讯校招那类）的必填项，简历与投递链路都不用它，
    # **只有 services/webform/ 读**。它们同时也出现在简历里的可能性极低，所以既不进
    # 简历导出、也不进 `ResumeContent`。
    #
    # 关于隐私：这些值（尤其 `id_number`）属于高敏感数据，但**不会自动外流**——
    # 助手读资料走 `assistant_context.profile_context`，它虽然先构造出含全部列的
    # `ProfileOut`，但紧接着 `build_llm_profile_prompt_data` 会重建字典、只保留
    # `_LLM_PROFILE_FIELDS` 白名单里的键（连姓名与手机号都不在其中）。
    # **修改那一组白名单时要单独审视，那是这些字段唯一的出口。**
    #
    # 日期一律用字符串，与既有约定一致（见模块 docstring）。
    wechat: Mapped[str] = mapped_column(String(64), default="")
    birth_date: Mapped[str] = mapped_column(String(16), default="")  # 完整出生日期，比 birth_year 精确
    id_type: Mapped[str] = mapped_column(String(32), default="")  # 身份证/护照/港澳通行证…
    id_number: Mapped[str] = mapped_column(String(64), default="")
    country_region: Mapped[str] = mapped_column(String(64), default="")
    native_place: Mapped[str] = mapped_column(String(64), default="")  # 籍贯
    political_status: Mapped[str] = mapped_column(String(32), default="")  # 政治面貌
    # 手机区号单独存：网申表单普遍把区号与号码拆成两个控件（默认 +86）。
    phone_country_code: Mapped[str] = mapped_column(String(8), default="+86", server_default="+86")
    family_info: Mapped[str] = mapped_column(Text, default="")  # 家庭信息，换行分隔
    expected_salary: Mapped[str] = mapped_column(String(64), default="")
    # 校招表单里很常见的几项（2026-09-26 按腾讯校招简历页的实测字段补）。
    qq: Mapped[str] = mapped_column(String(32), default="")
    advisor: Mapped[str] = mapped_column(String(64), default="")  # 导师
    research_direction: Mapped[str] = mapped_column(String(128), default="")  # 研究方向
    preferred_industry: Mapped[str] = mapped_column(String(128), default="")  # 意向行业 / 事业群

    educations: Mapped[list["Education"]] = relationship(
        cascade="all, delete-orphan", order_by="Education.id"
    )
    experiences: Mapped[list["Experience"]] = relationship(
        cascade="all, delete-orphan", order_by="Experience.id"
    )
    campus_experiences: Mapped[list["CampusExperience"]] = relationship(
        cascade="all, delete-orphan", order_by="CampusExperience.id"
    )
    projects: Mapped[list["Project"]] = relationship(
        cascade="all, delete-orphan", order_by="Project.id"
    )
    skills: Mapped[list["Skill"]] = relationship(cascade="all, delete-orphan", order_by="Skill.id")
    awards: Mapped[list["Award"]] = relationship(cascade="all, delete-orphan", order_by="Award.id")
    photos: Mapped[list["ProfilePhoto"]] = relationship(
        cascade="all, delete-orphan", order_by="ProfilePhoto.id"
    )


class ProfilePhoto(Base):
    """可选择的多张个人照片。

    ``UserProfile.photo`` 仍然是"当前使用的那一张"的镜像：简历生成、预览与导出
    全部读它，因此切换照片时同步写回主表，老链路一行都不用改。
    """

    __tablename__ = "profile_photo"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("user_profile.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128), default="")
    # 受限的 base64 图片 data URL，校验规则与资料照片完全一致。
    image: Mapped[str] = mapped_column(Text, default="")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Education(Base):
    __tablename__ = "education"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    school: Mapped[str] = mapped_column(String(128), default="")
    # 院系：网申表单普遍与「学校」「专业」并列单独问一项。
    department: Mapped[str] = mapped_column(String(128), default="")
    major: Mapped[str] = mapped_column(String(128), default="")
    degree: Mapped[str] = mapped_column(String(32), default="")  # 本科/硕士/博士（学历层次）
    # 网申表单把"学历"拆成三个独立下拉，这里补上另外两个（2026-09-26 随「网申填表」新增）。
    # 与 `degree` 一样是自由文本：站点枚举千差万别，不做规范化字典，交给填表时的选项匹配。
    study_mode: Mapped[str] = mapped_column(String(32), default="")  # 全日制/非全日制
    degree_type: Mapped[str] = mapped_column(String(32), default="")  # 学士/硕士/博士（学位类型）
    start_date: Mapped[str] = mapped_column(String(16), default="")
    end_date: Mapped[str] = mapped_column(String(16), default="")
    gpa: Mapped[str] = mapped_column(String(32), default="")  # 绩点/排名，如 "3.8/4.0"
    # 四六级分数。网申表单普遍问**具体分数**（不少系统按分数自动筛，只填"已通过"过不了），
    # 而它属于某一段学历期间考出来的成绩，所以录在教育经历上，不放在基本信息里。
    # 自由文本而非整数：`""`（没填）/ `"512"` / `"未考"` 都可能，不做规范化。
    cet4_score: Mapped[str] = mapped_column(String(16), default="")
    cet6_score: Mapped[str] = mapped_column(String(16), default="")
    courses: Mapped[str] = mapped_column(Text, default="")  # 核心课程，换行分隔
    achievements: Mapped[str] = mapped_column(Text, default="")  # 在校成果，换行分隔
    reference_file_name: Mapped[str] = mapped_column(String(255), default="")
    reference_content: Mapped[str] = mapped_column(Text, default="")


class Experience(Base):
    __tablename__ = "experience"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    company: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(128), default="")
    start_date: Mapped[str] = mapped_column(String(16), default="")
    end_date: Mapped[str] = mapped_column(String(16), default="")
    description: Mapped[str] = mapped_column(Text, default="")  # 工作内容，换行分隔
    reference_file_name: Mapped[str] = mapped_column(String(255), default="")
    reference_content: Mapped[str] = mapped_column(Text, default="")


class CampusExperience(Base):
    __tablename__ = "campus_experience"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    organization: Mapped[str] = mapped_column(String(128), default="")  # 学生会/班级/社团等
    role: Mapped[str] = mapped_column(String(128), default="")  # 职务或担任角色
    start_date: Mapped[str] = mapped_column(String(16), default="")
    end_date: Mapped[str] = mapped_column(String(16), default="")
    description: Mapped[str] = mapped_column(Text, default="")  # 经历描述，换行分隔
    reference_file_name: Mapped[str] = mapped_column(String(255), default="")
    reference_content: Mapped[str] = mapped_column(Text, default="")


class Project(Base):
    __tablename__ = "project"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(64), default="")
    start_date: Mapped[str] = mapped_column(String(16), default="")
    end_date: Mapped[str] = mapped_column(String(16), default="")
    tech_stack: Mapped[str] = mapped_column(String(256), default="")  # 逗号分隔
    description: Mapped[str] = mapped_column(Text, default="")  # 项目描述，换行分隔
    highlights: Mapped[str] = mapped_column(Text, default="")  # 亮点/成果，换行分隔
    reference_file_name: Mapped[str] = mapped_column(String(255), default="")
    reference_content: Mapped[str] = mapped_column(Text, default="")


class Skill(Base):
    __tablename__ = "skill"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64), default="")
    level: Mapped[str] = mapped_column(String(32), default="")  # 熟练/掌握/了解


class Award(Base):
    __tablename__ = "award"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("user_profile.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128), default="")
    date: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(String(256), default="")
