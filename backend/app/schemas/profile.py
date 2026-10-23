# SPDX-License-Identifier: Apache-2.0
"""个人资料 Schema：In 为写入结构（子表不带 id），Out 为读取结构。"""
import base64
import binascii
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .date_format import normalize_partial_date
from .extraction import (
    MAX_EXTRACTION_DOCUMENT_COUNT,
    MAX_EXTRACTION_IMAGE_COUNT,
    MAX_RECOGNIZED_TEXT_CHARS,
    ExtractionDocumentInput,
    ExtractionImageInput,
)

# 资料照片（我的资料 → 简历照片）单张上限。base64 后约 ×1.34，仍在 8MB 请求体预算内。
MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024
# 岗位备注图片沿用同一套校验，但**单独一档**：一次最多 2 张，若也放宽到 5MB，
# 两张就会超过 8MB 的请求体上限，用户只会看到 413。
MAX_REFERENCE_FILE_NAME_CHARS = 255
MAX_REFERENCE_CONTENT_CHARS = 200_000
MAX_PROFILE_TEXT_CHARS = 100_000
MAX_PROFILE_DETAIL_CHARS = 200_000
MAX_PROFILE_SECTION_ITEMS = 200
PROFILE_SECTION_KEYS = (
    "basic_info",
    "experiences",
    "projects",
    "skills",
    "educations",
    "awards",
    "campus_experiences",
    "summary",
)
def _encoded_char_limit(max_bytes: int) -> int:
    """base64 后的字符上限：多留 2 字节吸收末尾填充。"""

    return 4 * ((max_bytes + 2) // 3)
_PHOTO_HEADER_RE = re.compile(r"^data:(image/(?:jpeg|png|webp));base64$", re.IGNORECASE)


def validate_photo_data_url(value: str, *, max_bytes: int = MAX_PROFILE_PHOTO_BYTES) -> str:
    """只接受体积受限且文件签名匹配的 JPEG/PNG/WebP data URL。"""
    if not value:
        return ""

    header, separator, encoded = value.partition(",")
    header_match = _PHOTO_HEADER_RE.fullmatch(header)
    if not separator or header_match is None:
        raise ValueError("照片必须是 JPEG、PNG 或 WebP 格式的 base64 data URL")
    if len(encoded) > _encoded_char_limit(max_bytes):
        raise ValueError(f"照片大小不能超过 {max_bytes // (1024 * 1024)} MB")

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("照片数据不是有效的 base64 编码") from exc
    if len(image_bytes) > max_bytes:
        raise ValueError(f"照片大小不能超过 {max_bytes // (1024 * 1024)} MB")

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
    school: str = Field(default="", max_length=128)
    major: str = Field(default="", max_length=128)
    degree: str = Field(default="", max_length=32)
    study_mode: str = Field(default="", max_length=32)  # 全日制/非全日制
    degree_type: str = Field(default="", max_length=32)  # 学士/硕士/博士（学位类型）
    department: str = Field(default="", max_length=128)  # 院系
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    gpa: str = Field(default="", max_length=64)
    # 四六级分数：网申表单要具体分数，而成绩属于某段学历期间，所以录在教育经历上。
    cet4_score: str = Field(default="", max_length=16)
    cet6_score: str = Field(default="", max_length=16)
    courses: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔
    achievements: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔

    @field_validator("start_date", "end_date")
    @classmethod
    def dates_use_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)


class ExperienceIn(ReferenceFileFields):
    company: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔

    @field_validator("start_date", "end_date")
    @classmethod
    def dates_use_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)


class CampusExperienceIn(ReferenceFileFields):
    organization: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔

    @field_validator("start_date", "end_date")
    @classmethod
    def dates_use_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)


class ProjectIn(ReferenceFileFields):
    name: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=64)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    tech_stack: str = Field(default="", max_length=10_000)  # 逗号分隔
    description: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔
    highlights: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)  # 换行分隔

    @field_validator("start_date", "end_date")
    @classmethod
    def dates_use_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)


class SkillIn(BaseModel):
    name: str = Field(default="", max_length=64)
    level: str = Field(default="", max_length=32)


class AwardIn(BaseModel):
    name: str = Field(default="", max_length=128)
    date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=2000)

    @field_validator("date")
    @classmethod
    def date_uses_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)


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

    name: str = Field(default="", max_length=64)
    gender: str = Field(default="", max_length=64)
    birth_year: str = Field(default="", max_length=32)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=128)
    city: str = Field(default="", max_length=64)
    target_city: str = Field(default="", max_length=64)
    job_intent: str = Field(default="", max_length=128)
    personal_website: str = Field(default="", max_length=256)
    github: str = Field(default="", max_length=256)
    # ===== 网申专用字段 =====
    # 公司自建网申系统（腾讯校招那类）的必填项。**只服务「网申填表」**：不进简历导出、
    # 不进 `ResumeContent`、不编入发给模型的资料提示词（白名单在
    # `services/profile/profile_relevance_constants.py::_LLM_PROFILE_FIELDS`）。
    # 其中 `id_number` 属高敏感数据——改那一组白名单时要单独审视。
    wechat: str = Field(default="", max_length=64)
    birth_date: str = Field(default="", max_length=32)
    id_type: str = Field(default="", max_length=32)
    id_number: str = Field(default="", max_length=64)
    country_region: str = Field(default="", max_length=64)
    native_place: str = Field(default="", max_length=64)
    political_status: str = Field(default="", max_length=32)
    phone_country_code: str = Field(default="+86", max_length=8)
    family_info: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)
    expected_salary: str = Field(default="", max_length=64)
    qq: str = Field(default="", max_length=32)
    advisor: str = Field(default="", max_length=64)
    research_direction: str = Field(default="", max_length=128)
    preferred_industry: str = Field(default="", max_length=128)
    photo: str = ""
    summary: str = Field(default="", max_length=MAX_PROFILE_DETAIL_CHARS)
    section_order: list[str] = Field(
        default_factory=lambda: list(PROFILE_SECTION_KEYS), max_length=len(PROFILE_SECTION_KEYS)
    )
    educations: list[EducationIn] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    experiences: list[ExperienceIn] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    campus_experiences: list[CampusExperienceIn] = Field(
        default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS
    )
    projects: list[ProjectIn] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    skills: list[SkillIn] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    awards: list[AwardIn] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)

    @field_validator("birth_date")
    @classmethod
    def birth_date_uses_short_dash_format(cls, value: str) -> str:
        return normalize_partial_date(value)

    @field_validator("photo")
    @classmethod
    def photo_must_be_safe_image(cls, value: str) -> str:
        return validate_photo_data_url(value)

    @field_validator("section_order")
    @classmethod
    def section_order_must_be_supported(cls, value: list[str]) -> list[str]:
        supported = set(PROFILE_SECTION_KEYS)
        normalized = list(
            dict.fromkeys(key for key in value if key in supported and key != "basic_info")
        )
        return [
            "basic_info",
            *normalized,
            *(key for key in PROFILE_SECTION_KEYS if key != "basic_info" and key not in normalized),
        ]


class ProfilePatch(ProfileUpdate):
    """PATCH 语义：**只改传了的字段**，未传的原样保留（``PUT`` 仍是整体替换）。

    刻意**继承** ``ProfileUpdate`` 而不是再写一套字段：两套字段定义必然漂移，而漂移的
    表现是"PUT 能存进去的字段，PATCH 存不进去"（或反过来），用户只会看到"改了没生效"。
    所有字段本身都有默认值，所以 ``model_dump(exclude_unset=True)`` 天然就是"这次传了
    什么"——一个字段是"没传"还是"显式传了空值"，Pydantic 用 ``model_fields_set`` 区分，
    这正是 PATCH 需要的语义：

    - 没传 ``educations`` → 教育经历原样保留；
    - 传 ``"educations": []`` → **清空**教育经历（显式传空数组是"清空"，不是"不动"）。

    校验规则（长度、日期格式、照片签名…）全部继承，不必重复一遍。
    """


class ProfileTextParseRequest(BaseModel):
    """粘贴的个人资料文本、资料截图或文档（可同时给）。"""

    text: str = Field(default="", max_length=MAX_PROFILE_TEXT_CHARS)
    images: list[ExtractionImageInput] = Field(
        default_factory=list, max_length=MAX_EXTRACTION_IMAGE_COUNT
    )
    documents: list[ExtractionDocumentInput] = Field(
        default_factory=list, max_length=MAX_EXTRACTION_DOCUMENT_COUNT
    )

    @model_validator(mode="after")
    def require_text_or_images(self) -> "ProfileTextParseRequest":
        if not self.text.strip() and not self.images and not self.documents:
            raise ValueError("请粘贴个人资料，或上传至少一张截图或一份文档")
        return self


class ProfileTextParseResult(ProfileUpdate):
    warnings: list[str] = Field(default_factory=list)
    # 识别引擎（AI 还是本地规则）；与岗位草稿的同名字段保持一致的语义。
    parse_engine: Literal["ai", "local"] = "local"
    # 图片识别时模型逐字抄录的原文，供用户对照截图核对；纯文本识别为空。
    recognized_text: str = Field(default="", max_length=MAX_RECOGNIZED_TEXT_CHARS)


class ProfileOut(ProfileUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # 读取历史数据时保持宽容；写入约束由 ProfileUpdate 执行。
    name: str = ""
    updated_at: datetime | None = None
    educations: list[EducationOut] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    experiences: list[ExperienceOut] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    campus_experiences: list[CampusExperienceOut] = Field(
        default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS
    )
    projects: list[ProjectOut] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    skills: list[SkillOut] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
    awards: list[AwardOut] = Field(default_factory=list, max_length=MAX_PROFILE_SECTION_ITEMS)
