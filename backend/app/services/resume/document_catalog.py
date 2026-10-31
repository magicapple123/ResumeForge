# SPDX-License-Identifier: Apache-2.0
"""简历字段目录 v2：默认纸面位置 / 格式 / 素材标记的唯一来源（D5/D6）。

**为什么要有这一份目录**：v1 里"哪些字段有槽位、哪些字段只能追加到承载区、哪些字段
只能当生成素材"分散在 paper_policy / 四个渲染器 / 模板 / 前端 fieldLayout 里，同一个
字段的位置规则最多有四五份。v2 只回答一次：每个字段的默认 placement、显示格式、是否
仅素材、对应的资料字段 key；planner 与 converter 都从这里取（自建字段走 profile 定义
的 default_placement/material_only，不在此表）。

**只放数据与查询，不放渲染/IO**（planner 依赖它，模板/导出不直接读它）。
"""

from __future__ import annotations

from dataclasses import dataclass

from ...schemas.resume_document import (
    BodyStyle,
    Format,
    HeaderPlacement,
    Placement,
    SectionKind,
)
from .resume_labels import field_labels, normalize_language, section_title

__all__ = [
    "CUSTOM_FIELD_DEFAULT_PLACEMENT",
    "FieldSpec",
    "HEADER_FIELDS",
    "HEADER_FIELD_MAP",
    "HeaderFieldSpec",
    "SECTION_CATALOG",
    "SECTION_ORDER",
    "SectionSpec",
    "custom_field_placement",
    "default_header_placement",
    "field_label",
    "field_spec",
    "header_field_spec",
    "profile_field_id",
    "resolve_section_title",
    "section_spec",
    "sections",
]


@dataclass(frozen=True)
class FieldSpec:
    """一个内置字段的纸面默认值（key = v2 item key，与 v1 ResumeContent 属性名对齐）。"""

    key: str
    label_key: str
    fmt: Format = "text"
    default_placement: Placement = "trail"
    material_only: bool = False
    private: bool = False
    body_style: BodyStyle = "bullet"
    wrap: str = "none"
    join: str = "semicolon"
    # 枚举显示走 resume_labels 的哪个表：publication_status / patent_status /
    # credential_status / experience_kind。
    enum_kind: str = ""
    # 资料库字段 key（source.field_id = profile_key + "." + profile_key）。
    profile_key: str = ""


@dataclass(frozen=True)
class SectionSpec:
    """一个系统板块的目录：v2 分区 key、标题 key、kind、字段表、资料分区 key。"""

    key: str
    title_key: str
    kind: SectionKind
    profile_key: str
    fields: tuple[FieldSpec, ...]

    def field(self, item_key: str) -> FieldSpec | None:
        return next((spec for spec in self.fields if spec.key == item_key), None)


@dataclass(frozen=True)
class HeaderFieldSpec:
    """页眉字段目录：v2 header item key / 默认位置 / 格式 / 资料字段 id。"""

    key: str
    label_key: str
    placement: HeaderPlacement
    fmt: Format = "text"
    profile_key: str = ""


def _field(
    key: str,
    label_key: str,
    placement: Placement,
    *,
    fmt: Format = "text",
    body_style: BodyStyle = "bullet",
    wrap: str = "none",
    join: str = "semicolon",
    enum_kind: str = "",
    material_only: bool = False,
    private: bool = False,
    profile_key: str = "",
) -> FieldSpec:
    return FieldSpec(
        key=key,
        label_key=label_key,
        fmt=fmt,
        default_placement=placement,
        material_only=material_only,
        private=private,
        body_style=body_style,
        wrap=wrap,
        join=join,
        enum_kind=enum_kind,
        profile_key=profile_key or key,
    )


# 默认位置（计划 §4 表；用户可拖走）。title/meta 在条目头，lead/trail 是正文前后灰字段组，
# body 是正文块。
_EDUCATION = SectionSpec(
    key="education",
    title_key="education",
    kind="entries",
    profile_key="educations",
    fields=(
        _field("school", "school", "title"),
        _field("major", "major", "title"),
        _field("degree", "degree", "meta"),
        _field("period", "period", "meta", fmt="date_range"),
        _field("gpa", "gpa", "lead"),
        _field("courses", "courses", "lead", fmt="list", join="comma"),
        _field("study_form", "study_form", "trail"),
        _field("degree_type", "degree_type", "trail"),
        _field("department", "department", "trail"),
        _field("rank", "rank", "trail"),
        _field("advisor", "advisor", "trail"),
        _field("research_direction", "research_direction", "trail"),
        _field("achievements", "achievements", "body"),
    ),
)
_EXPERIENCE = SectionSpec(
    key="experience",
    title_key="experience",
    kind="entries",
    profile_key="experiences",
    fields=(
        _field("company", "company", "title"),
        _field("role", "role", "title"),
        _field("period", "period", "meta", fmt="date_range"),
        _field("team_size", "team_size", "trail"),
        _field("experience_kind", "experience_kind", "trail", enum_kind="experience_kind"),
        _field("description", "description", "body"),
    ),
)
_PROJECTS = SectionSpec(
    key="projects",
    title_key="projects",
    kind="entries",
    profile_key="projects",
    fields=(
        _field("name", "name", "title"),
        _field("role", "role", "meta"),
        _field("period", "period", "meta", fmt="date_range"),
        _field("project_size", "project_size", "trail"),
        _field("tech_stack", "tech_stack", "trail", fmt="list", join="comma"),
        _field("artifact_type", "artifact_type", "trail"),
        _field("public_url", "public_url", "trail", fmt="url"),
        _field("description", "description", "body"),
        _field("highlights", "highlights", "body"),
    ),
)
_CAMPUS = SectionSpec(
    key="campus_experience",
    title_key="campus_experience",
    kind="entries",
    profile_key="campus_experiences",
    fields=(
        _field("organization", "organization", "title"),
        _field("role", "role", "title"),
        _field("period", "period", "meta", fmt="date_range"),
        _field("activity_type", "activity_type", "trail"),
        _field("description", "description", "body"),
    ),
)
_AWARDS = SectionSpec(
    key="awards",
    title_key="awards",
    kind="entries",
    profile_key="awards",
    fields=(
        _field("name", "name", "title"),
        _field("date", "date", "meta", fmt="date"),
        _field("issuer", "issuer", "trail"),
        _field("level", "level", "trail"),
        _field("ratio", "ratio", "trail"),
        _field("description", "description", "body", body_style="paragraph"),
    ),
)
_PUBLICATIONS = SectionSpec(
    key="publications",
    title_key="publications",
    kind="entries",
    profile_key="publications",
    fields=(
        _field("title", "title", "title"),
        _field("venue", "venue", "meta"),
        _field("year", "year", "meta"),
        _field("status", "status", "meta", enum_kind="publication_status"),
        _field("authors", "authors", "trail", fmt="authors"),
        _field("outcome_type", "outcome_type", "trail"),
        _field("my_rank", "my_rank", "trail"),
        _field("volume_pages", "volume_pages", "trail"),
        _field("doi", "doi", "trail"),
        _field("url", "url", "trail", fmt="url"),
        _field("note", "note", "trail"),
    ),
)
_RESEARCH = SectionSpec(
    key="research_projects",
    title_key="research_projects",
    kind="entries",
    profile_key="research_projects",
    fields=(
        _field("name", "name", "title"),
        _field("role", "role", "title"),
        _field("organization", "organization", "meta"),
        _field("period", "period", "meta", fmt="date_range"),
        _field("level", "level", "trail"),
        _field("funding", "funding", "trail"),
        _field("description", "description", "body"),
        _field("outcomes", "outcomes", "body"),
    ),
)
_PATENTS = SectionSpec(
    key="patents",
    title_key="patents",
    kind="entries",
    profile_key="patents",
    fields=(
        _field("title", "title", "title"),
        _field("patent_number", "patent_number", "meta"),
        _field("country", "country", "meta"),
        _field("status", "status", "meta", enum_kind="patent_status"),
        _field("inventors", "inventors", "trail", fmt="authors"),
        _field("filed_date", "filed_date", "trail", fmt="date"),
        _field("granted_date", "granted_date", "trail", fmt="date"),
        _field("url", "url", "trail", fmt="url"),
        _field("outcome_type", "outcome_type", "trail", material_only=True),
        _field("inventor_rank", "inventor_rank", "trail", material_only=True),
    ),
)
_CREDENTIALS = SectionSpec(
    key="credentials",
    title_key="credentials",
    kind="entries",
    profile_key="credentials",
    fields=(
        _field("name", "name", "title"),
        _field("issuer", "issuer", "meta"),
        _field("status", "status", "meta", enum_kind="credential_status"),
        _field("credential_type", "credential_type", "trail"),
        _field("issue_date", "issue_date", "trail", fmt="date"),
        _field("expiry_date", "expiry_date", "trail", fmt="date"),
        _field("verify_url", "verify_url", "trail", fmt="url"),
        _field("note", "note", "trail"),
    ),
)
_SKILLS = SectionSpec(
    key="skills",
    title_key="skills",
    kind="inline",
    profile_key="skills",
    fields=(
        _field("category", "category", "trail"),
        _field("name", "name", "body"),
        _field("level", "level", "body", wrap="paren"),
    ),
)
_LANGUAGES = SectionSpec(
    key="languages",
    title_key="languages",
    kind="inline",
    profile_key="languages",
    fields=(
        _field("obtained_at", "obtained", "trail", fmt="date"),
        _field("name", "language_name", "body"),
        _field("level", "level", "body", wrap="paren"),
        _field("certificate", "certificate", "body", wrap="paren"),
        _field("score", "score", "body", wrap="paren"),
    ),
)
_SUMMARY = SectionSpec(
    key="summary",
    title_key="summary",
    kind="text",
    profile_key="summary",
    fields=(_field("content", "content", "body", body_style="paragraph"),),
)

SECTION_ORDER: tuple[SectionSpec, ...] = (
    _EDUCATION,
    _EXPERIENCE,
    _PROJECTS,
    _PUBLICATIONS,
    _RESEARCH,
    _PATENTS,
    _CREDENTIALS,
    _SKILLS,
    _LANGUAGES,
    _CAMPUS,
    _AWARDS,
    _SUMMARY,
)
SECTION_CATALOG: dict[str, SectionSpec] = {spec.key: spec for spec in SECTION_ORDER}

HEADER_FIELDS: tuple[HeaderFieldSpec, ...] = (
    HeaderFieldSpec("name", "name", "name", "text", "basic_info.name"),
    HeaderFieldSpec("gender", "gender", "name_meta", "text", "basic_info.gender"),
    HeaderFieldSpec("job_intent", "intent", "subtitle", "text", "basic_info.job_intention"),
    HeaderFieldSpec("phone", "phone", "contact", "text", "basic_info.phone"),
    HeaderFieldSpec("email", "email", "contact", "text", "basic_info.email"),
    HeaderFieldSpec("city", "city", "contact", "text", "basic_info.city"),
    HeaderFieldSpec("birth_year", "birth_year", "contact", "text", "basic_info.birth_month"),
    HeaderFieldSpec("github", "github", "contact", "text", "basic_info.github"),
    HeaderFieldSpec("personal_website", "website", "contact", "text", "basic_info.homepage"),
    HeaderFieldSpec("photo", "photo_alt", "photo", "text", "basic_info.photo"),
)
HEADER_FIELD_MAP: dict[str, HeaderFieldSpec] = {spec.key: spec for spec in HEADER_FIELDS}

# D6：自定义字段默认位置（用户可在资料页/添加时改）。
CUSTOM_FIELD_DEFAULT_PLACEMENT: dict[str, Placement] = {
    "single_line": "trail",
    "date_text": "trail",
    "enum": "trail",
    "multi_line": "body",
    "number": "trail",
}


def sections() -> tuple[SectionSpec, ...]:
    return SECTION_ORDER


def section_spec(section_key: str) -> SectionSpec | None:
    return SECTION_CATALOG.get(str(section_key or "").strip())


def field_spec(section_key: str, item_key: str) -> FieldSpec | None:
    spec = section_spec(section_key)
    return spec.field(item_key) if spec is not None else None


def header_field_spec(item_key: str) -> HeaderFieldSpec | None:
    return HEADER_FIELD_MAP.get(str(item_key or "").strip())


def default_header_placement(item_key: str) -> HeaderPlacement:
    spec = header_field_spec(item_key)
    return spec.placement if spec is not None else "contact"


def custom_field_placement(field_type: str) -> Placement:
    """D6：短文本/日期/枚举 -> trail；多行 -> body；未知按 trail（不猜成正文）。"""
    return CUSTOM_FIELD_DEFAULT_PLACEMENT.get(str(field_type or "").strip(), "trail")


def profile_field_id(section_key: str, item_key: str) -> str:
    """内置字段的 source.field_id（资料字段稳定 id = 资料分区 key + "." + 字段 key）。"""
    spec = section_spec(section_key)
    if spec is None:
        return ""
    field = spec.field(item_key)
    if field is None:
        return ""
    return f"{spec.profile_key}.{field.profile_key}"


def field_label(section_key: str, item_key: str, language: str | None = None) -> str:
    """字段的纸面标签：内置走 resume_labels 的唯一表；未知 key 回落 key 本身。"""
    field = field_spec(section_key, item_key)
    labels = field_labels(normalize_language(language))
    if field is None:
        return str(item_key or "")
    return labels.get(field.label_key, str(item_key or ""))


def resolve_section_title(key: str, title: str, language: str | None = None) -> str:
    """板块标题：自建板块用 title；系统板块 title_override 优先，否则按语言取目录标题。"""
    override = str(title or "").strip()
    spec = section_spec(key)
    if spec is None:
        return override or str(key or "")
    return override or section_title(spec.title_key, language)
