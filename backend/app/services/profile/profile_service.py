# SPDX-License-Identifier: Apache-2.0
"""个人资料业务逻辑：旧协议（/api/profile）的读取、整体更新（PUT）与局部合并（PATCH）。

**F2 起旧协议落到新模型**（F2 契约 §5.1）：读从新模型条目全量投影出旧 `ProfileOut`
（形状等价，不读旧六表）；写按「旧字段 → 稳定 field_id」映射后 upsert/软删
`profile_entry`，不再触发旧子表 delete-orphan 全量重建。旧 payload 里新模型没有位置的
内容（网申专用列、四六级分数、参考文件…）写日志告警后丢弃——不静默；能映射的字段按
最接近分区映射。

**旧 ORM 读取保留**：`get_profile_detail` / `to_profile_out` 仍供尚未迁移的生成、网申、
面试链路使用（F3/F5 会换成消费 DTO），与新协议适配器（`project_legacy_profile` /
`update_profile`）是两条独立的读路径。
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session, selectinload

from ...models import profile as legacy_models
from ...models.profile_entry import ProfileEntry
from ...models.profile_group import ProfileWorkspaceState
from ...schemas import profile as profile_schemas
from . import workspace_bootstrap
from .definition_catalog import BUILTIN_SECTION_KEYS, get_field
from .errors import ValidationError as StoreValidationError
from .value_validation import ValidationFailure, validate_value

if TYPE_CHECKING:
    from ...schemas.profile_projection import ConsumedProfile

logger = logging.getLogger(__name__)

# 子表名称 -> 旧读路径的模型类（get_profile_detail 用它预加载，兼容用例也以它为清单）。
_SECTION_MODELS = {
    "educations": legacy_models.Education,
    "experiences": legacy_models.Experience,
    "campus_experiences": legacy_models.CampusExperience,
    "projects": legacy_models.Project,
    "skills": legacy_models.Skill,
    "awards": legacy_models.Award,
}

# 名字为空就整行丢掉（而不是写进库）的子表：只有技能（`name` 是它唯一内容，空名落库
# 就是一条永远显示不出来的空标签）。学历/经历不丢弃——空行至少还有可编辑字段。
_BLANK_ROWS_DROPPED = ("skills",)

# ===== 旧协议字段 → 新模型 field_id 的映射（F2 契约 §5.1，唯一一份）=====
_LEGACY_SECTIONS = ("educations", "experiences", "campus_experiences", "projects", "skills", "awards")
_LEGACY_ORDER_KEYS = tuple(profile_schemas.PROFILE_SECTION_KEYS)  # 旧 ProfileOut 的 8 个 key
_RAW_SECTION_KEYS = ("basic_info", "summary", *_LEGACY_SECTIONS)

# 旧标量 → 新 field_id；birth_year/birth_date 合并到 basic_info.birth_month
# （新模型只有一个"出生年月"位置，见 _project_basic / _basic_values）。
_BASIC_FIELD_MAP = {
    "name": "basic_info.name", "gender": "basic_info.gender",
    "phone": "basic_info.phone", "email": "basic_info.email",
    "city": "basic_info.city", "target_city": "basic_info.target_city",
    "job_intent": "basic_info.job_intention", "personal_website": "basic_info.homepage",
    "github": "basic_info.github", "political_status": "basic_info.political_status",
    "photo": "basic_info.photo",
}

# 新模型没有位置的旧标量：写日志告警后丢弃，不静默。phone_country_code 的默认 +86
# 不算内容（旧界面本来就默认带它），只有用户真的改了才告警。
_BASIC_UNSUPPORTED = (
    "wechat", "id_type", "id_number", "country_region", "native_place",
    "phone_country_code", "family_info", "expected_salary", "qq", "advisor",
    "research_direction", "preferred_industry",
)
_UNSUPPORTED_DEFAULTS = {"phone_country_code": "+86"}

# 旧子项字段 → 新 field_id；None = 新模型没有这个位置（四六级分数、参考文件等）。
_ITEM_FIELD_MAP: dict[str, dict[str, str | None]] = {
    "educations": {
        "school": "educations.school", "major": "educations.major",
        "degree": "educations.degree", "study_mode": "educations.study_form",
        "degree_type": "educations.degree_type", "department": "educations.department",
        "start_date": "educations.start_date", "end_date": "educations.end_date",
        "gpa": "educations.gpa", "courses": "educations.core_courses",
        "achievements": "educations.achievements",
        "cet4_score": None, "cet6_score": None,
        "reference_file_name": None, "reference_content": None,
    },
    "experiences": {
        "company": "experiences.company", "role": "experiences.title",
        "start_date": "experiences.start_date", "end_date": "experiences.end_date",
        "description": "experiences.description",
        "reference_file_name": None, "reference_content": None,
    },
    "campus_experiences": {
        "organization": "campus_experiences.organization", "role": "campus_experiences.role",
        "start_date": "campus_experiences.start_date",
        "end_date": "campus_experiences.end_date",
        "description": "campus_experiences.description",
        "reference_file_name": None, "reference_content": None,
    },
    "projects": {
        "name": "projects.name", "role": "projects.role",
        "start_date": "projects.start_date", "end_date": "projects.end_date",
        "tech_stack": "projects.tech_stack", "description": "projects.description",
        "highlights": "projects.highlights",
        "reference_file_name": None, "reference_content": None,
    },
    "skills": {"name": "skills.name", "level": "skills.level"},
    "awards": {
        "name": "awards.title", "date": "awards.awarded_at", "description": "awards.description",
    },
}
_FOUR_DIGIT_YEAR_RE = re.compile(r"^(\d{4})")

# ===== 旧 ORM 读路径（尚未迁移的生成/网申/面试链路继续使用）=====

def _writable_section_items(section: str, items: list[Any]) -> list[Any]:
    """写入前把"名字去空白后为空"的技能行剔除（旧协议与旧 PATCH 共同的边界）。"""
    if section not in _BLANK_ROWS_DROPPED:
        return list(items)
    return [item for item in items if str(getattr(item, "name", "")).strip()]

def get_or_create_profile(db: Session) -> legacy_models.UserProfile:
    """单用户应用：保证主表始终有一条记录（旧读路径与照片/事实模块共用）。"""
    profile = db.query(legacy_models.UserProfile).first()
    if profile is None:
        profile = legacy_models.UserProfile()
        db.add(profile)
        db.flush()
    return profile

def get_profile_detail(db: Session) -> legacy_models.UserProfile:
    """读取旧主表+全部子表（旧链路专用；新协议读见 project_legacy_profile）。

    必须 selectinload：生成接口在异步上下文中使用该对象，懒加载会触发 MissingGreenlet。
    """
    profile = get_or_create_profile(db)
    options = [selectinload(getattr(legacy_models.UserProfile, name)) for name in _SECTION_MODELS]
    # identity map 里一定有这一行（刚 get_or_create），`or profile` 只是写给类型检查。
    return db.get(legacy_models.UserProfile, profile.id, options=options) or profile

def to_profile_out(profile: legacy_models.UserProfile) -> profile_schemas.ProfileOut:
    """旧 ORM 行 → 旧 ProfileOut（旧读路径专用；新协议用纯投影，不经过 ORM）。"""
    return profile_schemas.ProfileOut.model_validate(profile)

# ===== 新模型 → 旧 ProfileOut 的投影（不读旧六表）=====

def _legacy_section_order(order: Sequence[Any]) -> list[str]:
    """全局顺序里只保留旧协议的 8 个 key；缺失项按旧界面规范顺序补齐。"""
    allowed = set(_LEGACY_ORDER_KEYS)
    seen: set[str] = set()
    result: list[str] = []
    for raw in order:
        key = str(raw)
        if key in allowed and key not in seen:
            seen.add(key)
            result.append(key)
    result.extend(key for key in _LEGACY_ORDER_KEYS if key not in seen)
    return result

def _project_basic(values: Mapping[str, Any]) -> dict[str, str]:
    """基础条目 values → 旧标量；新模型没有的旧字段保留旧协议默认值（形状等价）。"""
    data = {key: str(values.get(field_id, "") or "") for key, field_id in _BASIC_FIELD_MAP.items()}
    month = str(values.get("basic_info.birth_month", "") or "")
    year_match = _FOUR_DIGIT_YEAR_RE.match(month)
    data["birth_year"] = year_match.group(1) if year_match else month
    data["birth_date"] = month
    data.update(_UNSUPPORTED_DEFAULTS)
    return data

def _project_item(section_key: str, values: Mapping[str, Any]) -> dict[str, str]:
    """一条条目的 values → 旧子项字段；新模型没有位置的旧字段留默认空串。"""
    return {
        key: str(values.get(field_id, "") or "")
        for key, field_id in _ITEM_FIELD_MAP[section_key].items()
        if field_id is not None
    }

def _build_profile_out(
    sections: Mapping[str, Sequence[Mapping[str, Any]]], order: Sequence[Any]
) -> profile_schemas.ProfileOut:
    """把「分区 key → 条目 values 列表」组装成旧 ProfileOut（读/三链外共用的唯一实现）。"""
    basic_rows = sections.get("basic_info") or ()
    kwargs: dict[str, Any] = dict(_project_basic(basic_rows[0] if basic_rows else {}))
    out_models = (
        ("educations", profile_schemas.EducationOut),
        ("experiences", profile_schemas.ExperienceOut),
        ("campus_experiences", profile_schemas.CampusExperienceOut),
        ("projects", profile_schemas.ProjectOut),
        ("skills", profile_schemas.SkillOut),
        ("awards", profile_schemas.AwardOut),
    )
    for section_key, model in out_models:
        kwargs[section_key] = [
            model(id=index, **_project_item(section_key, values))
            for index, values in enumerate(sections.get(section_key) or (), start=1)
        ]
    summary_rows = sections.get("summary") or ()
    kwargs["summary"] = str(
        (summary_rows[0] if summary_rows else {}).get("summary.content", "") or ""
    )
    kwargs["section_order"] = _legacy_section_order(order)
    # 新模型没有 user_profile 行；单用户应用沿用旧协议恒为 1 的主键，id 只作形状占位。
    return profile_schemas.ProfileOut(id=1, **kwargs)

def _raw_sections(db: Session) -> dict[str, list[dict[str, str]]]:
    """直接读新模型条目（含 hidden 值）：旧协议是编辑视图，隐藏字段的值必须能回显，
    否则旧界面保存一次就会把隐藏值写成空串（R-67 要求"值保留"）。"""
    rows = (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key.in_(_RAW_SECTION_KEYS),
            ProfileEntry.deleted_at.is_(None),
        )
        .order_by(
            ProfileEntry.section_key.asc(), ProfileEntry.sort_order.asc(), ProfileEntry.id.asc()
        )
        .all()
    )
    grouped: dict[str, list[dict[str, str]]] = {key: [] for key in _RAW_SECTION_KEYS}
    for row in rows:
        values = row.values if isinstance(row.values, dict) else {}
        grouped[row.section_key].append(
            {str(field_id): str(value) for field_id, value in values.items()}
        )
    return grouped

def _current_section_order(db: Session) -> list[str]:
    """全局顺序；库还没有 state 行时退回代码里的 13 条默认顺序（读路径不 bootstrap）。"""
    state = db.query(ProfileWorkspaceState).filter(ProfileWorkspaceState.id == 1).first()
    order = [str(key) for key in (state.section_order or [])] if state is not None else []
    known = set(order)
    order.extend(key for key in BUILTIN_SECTION_KEYS if key not in known)
    return order

def project_legacy_profile(db: Session) -> profile_schemas.ProfileOut:
    """GET /api/profile：从新模型全量投影旧 ProfileOut，不读旧六表。"""
    return _build_profile_out(_raw_sections(db), _current_section_order(db))

def project_legacy_profile_from_consumed(consumed: ConsumedProfile) -> profile_schemas.ProfileOut:
    """消费 DTO → 旧 ProfileOut（助手/岗位匹配的三链外适配用；hidden 已被剔除）。"""
    sections: dict[str, list[dict[str, str]]] = {}
    for key in _RAW_SECTION_KEYS:
        section = consumed.section(key)
        sections[key] = [
            {str(field_id): str(value) for field_id, value in entry.values.items()}
            for entry in (section.entries if section is not None else ())
        ]
    return _build_profile_out(sections, consumed.section_order)

def legacy_profile_has_entries(db: Session) -> bool:
    """新模型有没有任何活动条目（旧助手上下文区分"尚未保存资料"用）。"""
    return (
        db.query(ProfileEntry.id).filter(ProfileEntry.deleted_at.is_(None)).first() is not None
    )

def legacy_profile_is_empty(profile: profile_schemas.ProfileOut) -> bool:
    """旧协议口径的"资料为空"：身份/总结/教育/经历/项目/技能全空（岗位匹配入口用）。"""
    return not any(
        [
            profile.name,
            profile.phone,
            profile.email,
            profile.summary,
            profile.job_intent,
            profile.educations,
            profile.experiences,
            profile.projects,
            profile.skills,
        ]
    )

# ===== 旧协议写入：映射到新条目（upsert / 软删），不再重建旧子表 =====

def _normalize_value(field_id: str, raw: Any) -> str:
    """按目录里的真实字段类型收口一个值；照片例外：旧协议的 data URL 无 2048 引用上限。"""
    if field_id.endswith(".photo"):
        return str(raw or "")
    spec = get_field(field_id)
    field_type = spec.field_type if spec is not None else "single_line"
    try:
        return validate_value(field_type, raw)
    except ValidationFailure as exc:
        raise StoreValidationError(exc.detail, code=exc.code) from exc

def _collect_unsupported_basic(
    payload: profile_schemas.ProfileUpdate, fields_set: set[str] | None
) -> set[str]:
    """记录旧 payload 里新模型没有位置但用户真的填了的值（日志告警用）。"""
    dropped: set[str] = set()
    for old_name in _BASIC_UNSUPPORTED:
        if fields_set is not None and old_name not in fields_set:
            continue
        value = str(getattr(payload, old_name, "") or "").strip()
        if value and value != _UNSUPPORTED_DEFAULTS.get(old_name):
            dropped.add(f"basic_info.{old_name}")
    return dropped

def _basic_values(
    payload: profile_schemas.ProfileUpdate, fields_set: set[str] | None
) -> dict[str, str]:
    """旧 PUT/PATCH 的基础字段 → 基础条目 values（PATCH 只取本次出现的键）。"""
    values: dict[str, str] = {}
    for old_name, field_id in _BASIC_FIELD_MAP.items():
        if fields_set is not None and old_name not in fields_set:
            continue
        values[field_id] = _normalize_value(field_id, getattr(payload, old_name))
    if fields_set is None or {"birth_year", "birth_date"} & fields_set:
        month = str(payload.birth_date or "").strip() or str(payload.birth_year or "").strip()
        values["basic_info.birth_month"] = _normalize_value("basic_info.birth_month", month)
    return values

def _map_item(section_key: str, item: Any, dropped: set[str]) -> dict[str, str]:
    """旧子项 → 新条目 values；不能映射的非空字段记入 dropped（日志告警）。"""
    values: dict[str, str] = {}
    for old_name, field_id in _ITEM_FIELD_MAP[section_key].items():
        if field_id is None:
            if str(getattr(item, old_name, "") or "").strip():
                dropped.add(f"{section_key}.{old_name}")
            continue
        values[field_id] = _normalize_value(field_id, getattr(item, old_name, ""))
    return values

def _section_payloads(
    payload: profile_schemas.ProfileUpdate, fields_set: set[str] | None
) -> dict[str, list[Any]]:
    """本次要整体替换的旧大字段（PATCH 只处理出现了的键；技能空行照旧剔除）。"""
    result: dict[str, list[Any]] = {}
    for section_key in _LEGACY_SECTIONS:
        if fields_set is not None and section_key not in fields_set:
            continue
        result[section_key] = _writable_section_items(
            section_key, list(getattr(payload, section_key) or [])
        )
    return result

def _merged_snapshot(
    section_key: str, previous: Any, mapped: Mapping[str, str]
) -> list[dict[str, str]]:
    """保存时补齐历史标签快照：只增不删，供已删除自定义字段的旧值回显。"""
    snapshot = (
        [dict(item) for item in previous if isinstance(item, dict)]
        if isinstance(previous, list)
        else []
    )
    known = {str(item.get("field_id")) for item in snapshot}
    for field_id in mapped:
        spec = get_field(field_id)
        if spec is None or field_id in known:
            continue
        snapshot.append(
            {"field_id": spec.field_id, "label": spec.label, "field_type": spec.field_type}
        )
        known.add(field_id)
    return snapshot

def _active_rows(db: Session, section_key: str) -> list[ProfileEntry]:
    return (
        db.query(ProfileEntry)
        .filter(
            ProfileEntry.section_key == section_key,
            ProfileEntry.deleted_at.is_(None),
        )
        .order_by(ProfileEntry.sort_order.asc(), ProfileEntry.id.asc())
        .all()
    )

def _new_entry(
    db: Session, section_key: str, values: dict[str, str], sort_order: int
) -> ProfileEntry:
    row = ProfileEntry(
        entry_id=workspace_bootstrap.generate_external_id(db, ProfileEntry, "entry_id"),
        section_key=section_key,
        sort_order=sort_order,
        values=dict(values),
        field_snapshot=_merged_snapshot(section_key, [], values),
        revision=1,
    )
    db.add(row)
    return row

def _touch_row(row: ProfileEntry, values: dict[str, str]) -> None:
    """合并写入一条：只覆盖映射到的字段，未映射字段（新模型独有/自定义字段）保留旧值。"""
    old_values = row.values if isinstance(row.values, dict) else {}
    merged = {**old_values, **values}
    if merged == old_values:
        return
    row.values = merged
    row.field_snapshot = _merged_snapshot(row.section_key, row.field_snapshot, values)
    row.revision = int(row.revision or 1) + 1
    row.updated_at = legacy_models.utcnow()

def _apply_singleton(db: Session, section_key: str, values: dict[str, str]) -> None:
    """单例分区（basic_info/summary）upsert：绝不建第二条（R-02）。"""
    row = next(
        (item for item in _active_rows(db, section_key) if int(item.sort_order or 0) == 0),
        None,
    )
    if row is None:
        _new_entry(db, section_key, values, 0)
    else:
        _touch_row(row, values)
    db.flush()

def _apply_multi(db: Session, section_key: str, mapped_items: list[dict[str, str]]) -> None:
    """多条分区整体替换：复用前 N 条（保留 entry_id）、软删多余、追加新增（稳定序）。"""
    existing = _active_rows(db, section_key)
    reuse = min(len(existing), len(mapped_items))
    offset = max((int(row.sort_order or 0) for row in existing), default=0) + 1000
    for index in range(reuse):
        existing[index].sort_order = offset + index
    if reuse:
        db.flush()
    for row in existing[reuse:]:
        row.deleted_at = legacy_models.utcnow()
        row.revision = int(row.revision or 1) + 1
        row.updated_at = legacy_models.utcnow()
    if reuse < len(existing):
        db.flush()
    for index in range(reuse):
        row = existing[index]
        _touch_row(row, mapped_items[index])
        row.sort_order = index
    for index in range(reuse, len(mapped_items)):
        _new_entry(db, section_key, mapped_items[index], index)
    db.flush()

def _apply_section_order(db: Session, order: Sequence[Any]) -> None:
    """旧 payload 的 8 个 key 顺序写回全局顺序：只替换这 8 个槽位，其余分区位置不动。"""
    state = workspace_bootstrap.ensure_workspace(db)
    current = [str(key) for key in (state.section_order or [])]
    desired = [str(key) for key in order if str(key) in _LEGACY_ORDER_KEYS]
    positions = [index for index, key in enumerate(current) if key in _LEGACY_ORDER_KEYS]
    updated = list(current)
    for index, replacement in zip(positions, desired, strict=False):
        updated[index] = replacement
    if updated == current:
        return
    state.section_order = updated
    state.revision = int(state.revision or 1) + 1
    state.updated_at = legacy_models.utcnow()
    db.flush()

def _write_legacy_profile(
    db: Session, payload: profile_schemas.ProfileUpdate, *, partial: bool
) -> profile_schemas.ProfileOut:
    """PUT/PATCH 共用写入：同一事务内映射、upsert/软删、写顺序；失败全部回滚。"""
    fields_set = set(payload.model_fields_set) if partial else None
    dropped = _collect_unsupported_basic(payload, fields_set)
    basic_values = _basic_values(payload, fields_set)
    section_values = {
        section_key: [_map_item(section_key, item, dropped) for item in items]
        for section_key, items in _section_payloads(payload, fields_set).items()
    }
    summary_needed = fields_set is None or "summary" in fields_set
    order_needed = fields_set is None or "section_order" in fields_set
    summary_text = _normalize_value("summary.content", payload.summary) if summary_needed else ""
    try:
        workspace_bootstrap.ensure_workspace(db)
        _apply_singleton(db, "basic_info", basic_values)
        for section_key in _LEGACY_SECTIONS:
            if section_key in section_values:
                _apply_multi(db, section_key, section_values[section_key])
        if summary_needed and (summary_text or _active_rows(db, "summary")):
            _apply_singleton(db, "summary", {"summary.content": summary_text})
        if order_needed:
            _apply_section_order(db, list(payload.section_order or []))
        db.commit()
    except Exception:
        db.rollback()
        raise
    if dropped:
        # 只记字段名，不记任何资料内容（AGENTS 安全边界）。
        logger.warning("旧协议写入丢弃了新模型不支持的内容字段=%s", sorted(dropped))
    return project_legacy_profile(db)

def update_profile(db: Session, payload: profile_schemas.ProfileUpdate) -> profile_schemas.ProfileOut:
    """PUT 语义：整体替换旧协议的 8 个大字段，未传字段落回默认值；写新条目。"""
    return _write_legacy_profile(db, payload, partial=False)

def patch_profile(db: Session, payload: profile_schemas.ProfileUpdate) -> profile_schemas.ProfileOut:
    """PATCH 语义：只写 `model_fields_set` 里出现过的键（显式 [] = 清空该数组）。"""
    return _write_legacy_profile(db, payload, partial=True)

__all__ = [
    "get_or_create_profile",
    "get_profile_detail",
    "legacy_profile_has_entries",
    "legacy_profile_is_empty",
    "patch_profile",
    "project_legacy_profile",
    "project_legacy_profile_from_consumed",
    "to_profile_out",
    "update_profile",
]
