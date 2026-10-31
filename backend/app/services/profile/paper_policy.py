# SPDX-License-Identifier: Apache-2.0
"""纸面规则的唯一来源：承载区（R-37/R-42/R-77）与「资料 → ResumeContent」映射表。

**为什么映射表全部在这里**：paper_projection.py 只执行算法（遍历、拆分、限长、
组装），它不维护任何映射；承载区、槽位、条目标题/副标题、状态枚举的中文映射一旦
分散就会漂移，而 R-37 要求"改一次映射，生成链路与填充链路同时变化"。13 个系统
分区的承载区从 definition_catalog.carrier_field_key **派生**，不在这里重写第二份
表（R-77）；本模块只新增"承载区之外"的纸面规则。

**默认字段的两条去路**（需求 v3 §5.7 / 计划 §7）：
1. 有独立纸面槽位（ResumeContent 的既有字段）→ 直接映射（slots）；
2. 没有槽位且不是私密/仅素材 → 以「标签：值」追加到该条目的承载区，与自定义小字段
   同一条规则（appended_field_specs）。例：项目「成果类型」得到
   「成果类型：开源项目」；公开链接有独立槽位，不重复追加。

**仅素材**（basic_info / patents / languages）用数据表达（material_only）：
carrier_field_id 为 None、appended_field_specs 空元组；语言能力另由
language_projection.py 映射成独立 languages 分区（2026-10 起），本模块不猜。

**自建分区**（R-79）：主文本字段 = 自建定义的 primary_field_id，否则第一个多行
文本字段；其余字段按定义顺序生成「标签：值」行；分区标题 = 大字段名。

**枚举只映射已知词**：状态字段落槽位需要 ResumeContent 的既有枚举；未识别时由
投影层把原文追加到承载区（不擅改枚举，也不静默丢值）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from ...schemas.profile_projection import ConsumedFieldSpec, ConsumedSection
from ...schemas.resume import ResumeContent
from ...schemas.resume_credentials import ResumeCredential
from ...schemas.resume_entries import (
    EXPERIENCE_KINDS,
    ResumeAward,
    ResumeCampusExperience,
    ResumeEducation,
    ResumeExperience,
    ResumeProject,
    ResumeSkill,
)
from ...schemas.resume_research import (
    ResumePatent,
    ResumePublication,
    ResumeResearchProject,
)
from .definition_catalog import FIELD_BY_ID, get_section

SlotKind = Literal["text", "lines", "items", "authors", "enum", "url", "photo"]


@dataclass(frozen=True)
class SlotRule:
    """一个默认字段落到 ResumeContent 槽位的规则。"""

    attr: str
    kind: SlotKind = "text"
    # 仅 kind="enum"：中文原文 → 既有枚举值；未识别不猜，交给投影层追加到承载区。
    enum: Mapping[str, str] | None = None
    # F8（R-81）：生成链路确定性回填的来源清单由这个标记派生（见 BACKFILL_SLOT_KEYS），
    # 避免回填侧再手写第二份"哪些字段要回填"的映射。
    backfill: bool = False


@dataclass(frozen=True)
class PaperSectionRule:
    """一个系统分区的纸面规则：槽位表 + 承载区目标（None = 仅素材）。"""

    resume_field: str
    model: type
    slots: Mapping[str, SlotRule]
    carrier_attr: str | None = None
    # 承载区目标是列表（多行）还是标量：决定超长时"放得下多少放多少"的单位。
    carrier_list: bool = False


# ===== 承载区（R-77 的唯一口径；数据从 definition_catalog 派生） =====


def carrier_field_id(section_key: str) -> str | None:
    """该分区的承载区字段 id；仅素材分区、自建/未知分区返回 None。"""
    spec = get_section(section_key)
    return spec.carrier_field_id if spec is not None else None


def is_material_only(section_key: str) -> bool:
    """是否仅素材（无承载区、自定义字段也不上纸面）；自建/未知分区为 False。"""
    spec = get_section(section_key)
    return bool(spec is not None and spec.material_only)


def builtin_field_specs(section_key: str) -> tuple[ConsumedFieldSpec, ...]:
    """内置分区默认字段的消费视图（定义顺序）；未知分区返回空元组。

    只用于纯函数调用方（如 project_carrier_text 手里只有 section_key）；读库链路
    直接用 ConsumedSection.fields，不经过这里。
    """
    spec = get_section(section_key)
    if spec is None:
        return ()
    return tuple(
        ConsumedFieldSpec(
            field_id=builtin.field_id,
            key=builtin.key,
            label=builtin.label,
            field_type=builtin.field_type,
            order=builtin.order,
            llm_allowed=builtin.llm_allowed,
            webform_allowed=builtin.webform_allowed,
            private=builtin.private,
            is_builtin=True,
        )
        for builtin in spec.fields
    )


def appended_field_specs(section_key: str) -> tuple[ConsumedFieldSpec, ...]:
    """该分区没有独立槽位、需以「标签：值」追加的默认字段（定义顺序）。

    仅素材分区返回空元组（R-43/R-76：basic_info / patents / languages 的自定义字段
    与新增字段只进生成素材）；私密字段永不出现（证书编号红线）。
    """
    spec = get_section(section_key)
    rule = SECTION_RULES.get(section_key)
    if spec is None or rule is None or spec.material_only:
        return ()
    carrier = spec.carrier_field_id
    return tuple(
        builtin
        for builtin in builtin_field_specs(section_key)
        if builtin.field_id != carrier and builtin.key not in rule.slots and not builtin.private
    )


def custom_section_text_field(section: ConsumedSection) -> str | None:
    """自建分区的主文本字段 id：**只认显式 primary_field_id**（R1-E/R-37 单源）。

    不做多行字段回退：否则两条链形状不一致且丢 label/source；无主文本时全走「标签：值」行。
    """
    primary = str(section.primary_field_id or "").strip()
    if primary and any(spec.field_id == primary for spec in section.fields):
        return primary
    return None


def custom_section_line_fields(
    section: ConsumedSection, text_field_id: str | None
) -> tuple[ConsumedFieldSpec, ...]:
    """自建分区除主文本外的字段（定义顺序），逐条生成「标签：值」行。"""
    return tuple(spec for spec in section.fields if spec.field_id != text_field_id)


# ===== 「资料 → ResumeContent」映射表（只给 paper_projection 执行） =====

_PUBLICATION_STATUS: Mapping[str, str] = {
    "已发表": "published",
    "已录用": "accepted",
    "录用": "accepted",
    "接收": "accepted",
    "在印": "in_press",
    "即将发表": "in_press",
    "审稿中": "under_review",
    "在审": "under_review",
    "预印本": "preprint",
    "预印": "preprint",
    "其他": "other",
}
_PATENT_STATUS: Mapping[str, str] = {
    "已受理": "filed",
    "申请中": "filed",
    "实审中": "pending",
    "审查中": "pending",
    "已授权": "granted",
    "授权": "granted",
    "已过期": "expired",
    "其他": "other",
}
_CREDENTIAL_STATUS: Mapping[str, str] = {
    "有效": "active",
    "已取得": "active",
    "待定": "pending",
    "办理中": "pending",
    "已过期": "expired",
    "未知": "unknown",
}
# F8（R-81）：资料页"工作类型"是自由文本，纸面 experience_kind 是 A4 固定 code 白名单；
# 中文→code 映射只在这里一份（投影/回填共用 SlotRule.enum）。
# 同时接受 code 自身（identity），旧内容/外部工具写入的 code 不会被误追加到承载区。
_WORK_TYPE: Mapping[str, str] = {
    "全职": "full_time",
    "兼职": "part_time",
    "合同": "contract",
    "合同制": "contract",
    "自雇": "self_employed",
    "自由职业": "self_employed",
    "实习": "internship",
    "志愿": "volunteer",
    "志愿服务": "volunteer",
    "其他": "other",
}
# 同时接受 code 自身（旧内容/外部工具可能直接写 code），不把已知值误当未识别。
_WORK_TYPE.update({code: code for code in EXPERIENCE_KINDS})


def _slot(attr: str, kind: SlotKind = "text", enum: Mapping[str, str] | None = None) -> SlotRule:
    return SlotRule(attr=attr, kind=kind, enum=enum)


def _backfill_slot(
    attr: str, kind: SlotKind = "text", enum: Mapping[str, str] | None = None
) -> SlotRule:
    """F8（R-81）字段槽位：生成链路会按 SlotRule.backfill 标记确定性回填。"""
    return SlotRule(attr=attr, kind=kind, enum=enum, backfill=True)


# 基本信息没有条目模型：它只把身份字段投影到 ResumeContent 的标量槽位。
# photo 走资源引用解析（可选 resolver 由调用方注入，解析不了就留空 + warning）。
BASIC_INFO_SLOTS: Mapping[str, SlotRule] = {
    "name": _slot("name"),
    "gender": _slot("gender"),
    "birth_month": _slot("birth_year"),  # v3 改名，但 ResumeContent 结构不改（R-45）
    "phone": _slot("phone"),
    "email": _slot("email"),
    "city": _slot("city"),
    "homepage": _slot("personal_website"),
    "github": _slot("github"),
    "job_intention": _slot("job_intent"),
    "photo": _slot("photo", "photo"),
}

# 10 个有条目的系统分区；basic_info 无条目模型，summary 只写 ResumeContent.summary，
# languages 整条交给 language_projection（2026-10 起独立成栏），三者不在本表。
SECTION_RULES: Mapping[str, PaperSectionRule] = {
    "educations": PaperSectionRule(
        resume_field="education",
        model=ResumeEducation,
        slots={
            "school": _slot("school"),
            "major": _slot("major"),
            "degree": _slot("degree"),
            "start_date": _slot("start_date"),
            "end_date": _slot("end_date"),
            "gpa": _slot("gpa"),
            "core_courses": _slot("courses", "lines"),
            "study_form": _backfill_slot("study_form"),
            "degree_type": _backfill_slot("degree_type"),
            "department": _backfill_slot("department"),
            "rank": _backfill_slot("rank"),
            "advisor": _backfill_slot("advisor"),
            "research_direction": _backfill_slot("research_direction"),
        },
        carrier_attr="achievements",
        carrier_list=True,
    ),
    "experiences": PaperSectionRule(
        resume_field="experience",
        model=ResumeExperience,
        slots={
            "company": _slot("company"),
            "title": _slot("role"),
            "start_date": _slot("start_date"),
            "end_date": _slot("end_date"),
            "team_size": _backfill_slot("team_size"),
            "work_type": _backfill_slot("experience_kind", "enum", _WORK_TYPE),
        },
        carrier_attr="description",
        carrier_list=True,
    ),
    "projects": PaperSectionRule(
        resume_field="projects",
        model=ResumeProject,
        slots={
            "name": _slot("name"),
            "role": _slot("role"),
            "start_date": _slot("start_date"),
            "end_date": _slot("end_date"),
            "tech_stack": _slot("tech_stack", "items"),
            "highlights": _slot("highlights", "lines"),
            "public_url": _slot("public_url", "url"),
            "project_size": _backfill_slot("project_size"),
            "outcome_type": _backfill_slot("artifact_type"),
        },
        carrier_attr="description",
        carrier_list=True,
    ),
    "skills": PaperSectionRule(
        resume_field="skills",
        model=ResumeSkill,
        slots={
            "name": _slot("name"),
            "category": _backfill_slot("category"),
        },
        carrier_attr="level",
        carrier_list=False,
    ),
    "campus_experiences": PaperSectionRule(
        resume_field="campus_experience",
        model=ResumeCampusExperience,
        slots={
            "organization": _slot("organization"),
            "role": _slot("role"),
            "start_date": _slot("start_date"),
            "end_date": _slot("end_date"),
            "activity_type": _backfill_slot("activity_type"),
        },
        carrier_attr="description",
        carrier_list=True,
    ),
    "awards": PaperSectionRule(
        resume_field="awards",
        model=ResumeAward,
        slots={
            "title": _slot("name"),
            "awarded_at": _slot("date"),
            "issuer": _backfill_slot("issuer"),
            "level": _backfill_slot("level"),
            "award_ratio": _backfill_slot("ratio"),
        },
        carrier_attr="description",
        carrier_list=False,
    ),
    "publications": PaperSectionRule(
        resume_field="publications",
        model=ResumePublication,
        slots={
            "title": _slot("title"),
            "authors": _slot("authors", "authors"),
            "venue": _slot("venue"),
            "year": _slot("year"),
            "status": _slot("status", "enum", _PUBLICATION_STATUS),
            "url": _slot("url", "url"),
            "doi": _slot("doi"),
            "volume_pages": _slot("volume_pages"),
            "outcome_type": _backfill_slot("outcome_type"),
            "authorship_rank": _backfill_slot("my_rank"),
        },
        carrier_attr="note",
        carrier_list=False,
    ),
    "research_projects": PaperSectionRule(
        resume_field="research_projects",
        model=ResumeResearchProject,
        slots={
            "name": _slot("name"),
            "role": _slot("role"),
            "institution": _slot("organization"),
            "start_date": _slot("start_date"),
            "end_date": _slot("end_date"),
            "outcomes": _slot("outcomes", "lines"),
            "level": _backfill_slot("level"),
            "funding": _backfill_slot("funding"),
        },
        carrier_attr="description",
        carrier_list=True,
    ),
    "patents": PaperSectionRule(
        resume_field="patents",
        model=ResumePatent,
        slots={
            "title": _slot("title"),
            "inventors": _slot("inventors", "authors"),
            "patent_number": _slot("patent_number"),
            "country": _slot("country"),
            "status": _slot("status", "enum", _PATENT_STATUS),
            "application_date": _slot("filed_date"),
            "grant_date": _slot("granted_date"),
            "url": _slot("url", "url"),
        },
        carrier_attr=None,
    ),
    "credentials": PaperSectionRule(
        resume_field="credentials",
        model=ResumeCredential,
        slots={
            "title": _slot("name"),
            "issuer": _slot("issuer"),
            "issued_at": _slot("issue_date"),
            "expires_at": _slot("expiry_date"),
            "status": _slot("status", "enum", _CREDENTIAL_STATUS),
            "verify_url": _slot("verify_url", "url"),
            "credential_type": _backfill_slot("credential_type"),
        },
        carrier_attr="note",
        carrier_list=False,
    ),
}

# F8（R-81）回填来源清单：从 SlotRule.backfill 派生（F8-E 只 import 这一份，不复制表）。
BACKFILL_SLOT_KEYS: Mapping[str, tuple[str, ...]] = {
    section_key: tuple(
        field_key for field_key, slot_rule in rule.slots.items() if slot_rule.backfill
    )
    for section_key, rule in SECTION_RULES.items()
    if any(slot_rule.backfill for slot_rule in rule.slots.values())
}


def backfill_slot_rules(section_key: str) -> tuple[tuple[str, SlotRule], ...]:
    """该分区需要生成链路确定性回填的 (field_key, SlotRule)（按槽位表顺序）。"""
    rule = SECTION_RULES.get(section_key)
    if rule is None:
        return ()
    return tuple(
        (field_key, slot_rule) for field_key, slot_rule in rule.slots.items() if slot_rule.backfill
    )


# 候选条目的标题/副标题来源字段（「从资料填充」下拉用；None = 无该来源）。
CANDIDATE_FIELDS: Mapping[str, tuple[str | None, str | None]] = {
    "basic_info": ("name", "job_intention"),
    "educations": ("school", "major"),
    "experiences": ("company", "title"),
    "projects": ("name", "role"),
    "skills": ("name", "level"),
    "campus_experiences": ("organization", "role"),
    "awards": ("title", "issuer"),
    "summary": (None, None),
    "publications": ("title", "venue"),
    "research_projects": ("name", "institution"),
    "patents": ("title", "patent_number"),
    "credentials": ("title", "issuer"),
    "languages": ("language", "level"),
}


def candidate_fields(section_key: str) -> tuple[str | None, str | None]:
    """候选条目的标题/副标题字段 key；自建/未知分区返回 (None, None)。"""
    return CANDIDATE_FIELDS.get(section_key, (None, None))


def _validate_tables() -> None:
    """导入期自检：映射表与定义目录、ResumeContent 槽位必须一一对上，坏数据不许静默。"""
    content_fields = ResumeContent.model_fields
    for key, rule in SECTION_RULES.items():
        spec = get_section(key)
        assert spec is not None, f"{key} 不是内置分区"
        assert rule.resume_field in content_fields, f"{key} 的 resume_field 不存在"
        assert (rule.carrier_attr is None) == spec.material_only, f"{key} 承载区与仅素材不一致"
        if rule.carrier_attr is not None:
            assert rule.carrier_attr in rule.model.model_fields, f"{key} 承载区属性不存在"
        for field_key, slot_rule in rule.slots.items():
            assert f"{key}.{field_key}" in FIELD_BY_ID, f"{key}.{field_key} 不是目录字段"
            assert slot_rule.attr in rule.model.model_fields, f"{slot_rule.attr} 不是 {key} 的槽位"
            if slot_rule.kind == "enum":
                assert slot_rule.enum is not None, f"{key}.{field_key} 枚举缺少映射"
    for field_key, slot_rule in BASIC_INFO_SLOTS.items():
        assert f"basic_info.{field_key}" in FIELD_BY_ID, f"basic_info.{field_key} 不是目录字段"
        assert slot_rule.attr in content_fields, f"{slot_rule.attr} 不是 ResumeContent 槽位"
    # 每个默认字段必须有去路：槽位 / 承载区 / 追加 / 私密 / 仅素材；漏一个就是静默丢内容。
    for section_key, rule in SECTION_RULES.items():
        spec = get_section(section_key)
        assert spec is not None
        carrier = spec.carrier_field_id
        appended_ids = {item.field_id for item in appended_field_specs(section_key)}
        for builtin in spec.fields:
            routed = (
                spec.material_only
                or builtin.key in rule.slots
                or builtin.field_id == carrier
                or builtin.private
                or builtin.field_id in appended_ids
            )
            assert routed, f"{builtin.field_id} 没有纸面去路"
    for section_key, (title_key, subtitle_key) in CANDIDATE_FIELDS.items():
        spec = get_section(section_key)
        assert spec is not None, f"{section_key} 不是内置分区"
        keys = {builtin.key for builtin in spec.fields}
        for field_key in (title_key, subtitle_key):
            assert field_key is None or field_key in keys, f"{section_key}.{field_key} 不存在"
    # F8（R-81）：20 个资料小字段必须进槽位、不再追加承载区；回填总数钉住（漏/多标 import 报错）。
    backfill_total = sum(len(keys) for keys in BACKFILL_SLOT_KEYS.values())
    assert backfill_total == 20, f"F8 回填槽位应为 20 个，实际 {backfill_total}"
    for section_key in BACKFILL_SLOT_KEYS:
        assert appended_field_specs(section_key) == (), (
            f"{section_key} 的 F8 字段已进槽位，不应再留在 appended_field_specs"
        )


_validate_tables()


__all__ = [
    "BACKFILL_SLOT_KEYS",
    "BASIC_INFO_SLOTS",
    "CANDIDATE_FIELDS",
    "PaperSectionRule",
    "SECTION_RULES",
    "SlotRule",
    "appended_field_specs",
    "backfill_slot_rules",
    "builtin_field_specs",
    "candidate_fields",
    "carrier_field_id",
    "custom_section_line_fields",
    "custom_section_text_field",
    "is_material_only",
]
