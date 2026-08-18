"""个人资料 Schema：In 为写入结构（子表不带 id），Out 为读取结构。"""
import base64
import binascii
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024
MAX_REFERENCE_FILE_NAME_CHARS = 255
MAX_REFERENCE_CONTENT_CHARS = 200_000
MAX_PROFILE_TEXT_CHARS = 100_000
PROFILE_SECTION_KEYS = (
    "basic_info",
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
    "skills",
    "awards",
    "summary",
)
_MAX_ENCODED_PHOTO_CHARS = 4 * ((MAX_PROFILE_PHOTO_BYTES + 2) // 3)
_PHOTO_HEADER_RE = re.compile(r"^data:(image/(?:jpeg|png|webp));base64$", re.IGNORECASE)


def validate_photo_data_url(value: str) -> str:
    """只接受体积受限且文件签名匹配的 JPEG/PNG/WebP data URL。"""
    if not value:
        return ""

    header, separator, encoded = value.partition(",")
    header_match = _PHOTO_HEADER_RE.fullmatch(header)
    if not separator or header_match is None:
        raise ValueError("照片必须是 JPEG、PNG 或 WebP 格式的 base64 data URL")
    if len(encoded) > _MAX_ENCODED_PHOTO_CHARS:
        raise ValueError("照片大小不能超过 2 MB")

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("照片数据不是有效的 base64 编码") from exc
    if len(image_bytes) > MAX_PROFILE_PHOTO_BYTES:
        raise ValueError("照片大小不能超过 2 MB")

    mime = header_match.group(1).lower()
    signatures_match = {
        "image/jpeg": image_bytes.startswith(b"\xff\xd8\xff"),
        "image/png": image_bytes.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": (
            len(image_bytes) >= 12
            and image_bytes.startswith(b"RIFF")
            and image_bytes[8:12] == b"WEBP"
        ),
    }
    if not signatures_match[mime]:
        raise ValueError("照片内容与声明的图片格式不一致")
    return value


class ReferenceFileFields(BaseModel):
    """浏览器读取的参考文件；服务端不接收也不保存本地路径。"""

    reference_file_name: str = ""
    reference_content: str = ""

    @field_validator("reference_file_name")
    @classmethod
    def reference_file_name_must_fit(cls, value: str) -> str:
        if len(value) > MAX_REFERENCE_FILE_NAME_CHARS:
            raise ValueError(
                f"参考文件名不能超过 {MAX_REFERENCE_FILE_NAME_CHARS} 个字符"
            )
        return value

    @field_validator("reference_content")
    @classmethod
    def reference_content_must_fit(cls, value: str) -> str:
        if len(value) > MAX_REFERENCE_CONTENT_CHARS:
            raise ValueError(
                f"参考文件内容不能超过 {MAX_REFERENCE_CONTENT_CHARS} 个字符"
            )
        return value


class EducationIn(ReferenceFileFields):
    school: str = ""
    major: str = ""
    degree: str = ""
    start_date: str = ""
    end_date: str = ""
    gpa: str = ""
    courses: str = ""  # 换行分隔
    achievements: str = ""  # 换行分隔


class ExperienceIn(ReferenceFileFields):
    company: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    description: str = ""  # 换行分隔


class CampusExperienceIn(ReferenceFileFields):
    organization: str = ""
    role: str = ""
    start_date: str = ""
    end_date: str = ""
    description: str = ""  # 换行分隔


class ProjectIn(ReferenceFileFields):
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


class CampusExperienceOut(CampusExperienceIn):
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
    photo: str = ""
    summary: str = ""
    section_order: list[str] = Field(default_factory=lambda: list(PROFILE_SECTION_KEYS))
    educations: list[EducationIn] = []
    experiences: list[ExperienceIn] = []
    campus_experiences: list[CampusExperienceIn] = []
    projects: list[ProjectIn] = []
    skills: list[SkillIn] = []
    awards: list[AwardIn] = []

    @field_validator("photo")
    @classmethod
    def photo_must_be_safe_image(cls, value: str) -> str:
        return validate_photo_data_url(value)

    @field_validator("section_order")
    @classmethod
    def section_order_must_be_supported(cls, value: list[str]) -> list[str]:
        supported = set(PROFILE_SECTION_KEYS)
        normalized = [key for key in value if key in supported]
        normalized.extend(key for key in PROFILE_SECTION_KEYS if key not in normalized)
        return normalized


class ProfileTextParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_PROFILE_TEXT_CHARS)

    @field_validator("text")
    @classmethod
    def text_must_contain_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("个人资料不能为空")
        return value


class ProfileTextParseResult(ProfileUpdate):
    warnings: list[str] = Field(default_factory=list)


class ProfileOut(ProfileUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    updated_at: datetime | None = None
    educations: list[EducationOut] = []
    experiences: list[ExperienceOut] = []
    campus_experiences: list[CampusExperienceOut] = []
    projects: list[ProjectOut] = []
    skills: list[SkillOut] = []
    awards: list[AwardOut] = []
