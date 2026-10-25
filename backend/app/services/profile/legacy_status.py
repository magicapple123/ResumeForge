# SPDX-License-Identifier: Apache-2.0
"""R-47 升级检测：旧资料表里是否还有"实际内容"（唯一实现）。

**为什么只返回布尔**（需求 R-47 / 计划 §3）：资料页顶部只需要知道"要不要提示用户旧资料
还在、可以先从备份取出后手动重填"。把旧资料读出来再判断，既会泄露隐私（旧表里有身份证
号、手机号与照片），也会把"旧数据不迁移"（R-46）变成事实上的迁移。所以这里对每张存在
的旧表最多做一次 SELECT 1 ... LIMIT 1：不取行、不计数、日志里也不记任何资料。

**什么不算旧内容**（契约 §2.3 / 计划 §3）：字段偏好（profile_fact_field_pref 的隐藏项与
自定义标签）、空壳记录（只有默认值的行）、phone_country_code 的默认 "+86"、以及只填了
网申专用列（身份证号、政治面貌、期望薪资等）的 user_profile —— 这些要么不是简历内容，
要么在新版本里另有入口（网申专用项仍由网申链路读取，R-75）。

**表存在性进程内缓存**：部分历史库可能没有某些旧表（迁移链允许这种历史形态），每次
请求都 inspect 一遍 schema 是浪费。缓存的是"schema 事实"，写入资料不会改变它；升级
状态本身每次现算，所以新资料保存后自然重查。若调用方重建/替换了整个库结构（备份导入、
恢复、迁移），调用 invalidate_table_cache() 让缓存失效即可。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, inspect, or_, text
from sqlalchemy.orm import Session

from ...models.profile import (
    Award,
    CampusExperience,
    Education,
    Experience,
    Project,
    Skill,
    UserProfile,
)
from ...models.profile_fact import ProfileFact

# 旧资料子表：任意一行有实际非空值，即视为"旧资料里有内容"。
_LEGACY_CHILD_MODELS = (Education, Experience, CampusExperience, Project, Skill, Award)

# 旧 user_profile 的"简历字段"（六段式资料里的基本信息与个人总结）。网申专用列
# （id_number/expected_salary/...）是明确例外：它们仍被网申取数读取，单独填过不构成
# "旧简历内容"，否则每个用过网申的用户升级后都会看到"旧资料未显示"的误报。
_LEGACY_PROFILE_COLUMNS = (
    "name",
    "gender",
    "birth_year",
    "phone",
    "email",
    "city",
    "target_city",
    "job_intent",
    "personal_website",
    "github",
    "photo",
    "summary",
)

# 旧补充事实：payload 是 JSON（字符串/数字/列表/自定义字段数组）。用 json_each 只看顶层
# 直接子值，避免把整份旧事实读进 Python；deleted_at 不为空的行在旧回收站里，不算内容。
_FACT_CONTENT_SQL = text(
    "SELECT 1 FROM profile_fact, json_each(profile_fact.payload) "
    "WHERE profile_fact.deleted_at IS NULL AND ("
    "(json_each.type = 'text' AND trim(json_each.value) <> '') "
    "OR (json_each.type = 'array' AND json_array_length(json_each.value) > 0) "
    "OR (json_each.type = 'object' AND trim(CAST(json_each.value AS TEXT)) NOT IN ('', '{}')) "
    "OR json_each.type IN ('integer', 'real', 'true')"
    ") LIMIT 1"
)

# 引擎键 → 该库里实际存在的表名；只缓存 schema 事实，不缓存任何资料状态。
_TABLE_CACHE: dict[str, frozenset[str]] = {}


def invalidate_table_cache() -> None:
    """库结构被重建/替换后（导入、恢复、迁移）丢弃表存在性缓存。"""
    _TABLE_CACHE.clear()


def _engine_key(db: Session) -> tuple[str, Any]:
    """缓存键带上引擎身份：同名 URL 的不同引擎（数据集切换）不会互相串缓存。"""
    bind = db.get_bind()
    engine = getattr(bind, "engine", bind)
    url = getattr(engine, "url", None)
    return f"{url}#{id(engine)}", engine


def _existing_legacy_tables(db: Session) -> frozenset[str]:
    key, engine = _engine_key(db)
    cached = _TABLE_CACHE.get(key)
    if cached is None:
        cached = frozenset(inspect(engine).get_table_names())
        _TABLE_CACHE[key] = cached
    return cached


def _table_has_content(db: Session, model: Any) -> bool:
    """旧子表里是否有任意一行含实际内容；空壳行（全空串）不算。"""
    columns = [
        column for column in model.__table__.columns if column.name not in ("id", "profile_id")
    ]
    if not columns:
        return False
    conditions = [func.coalesce(column, "") != "" for column in columns]
    return db.query(model.id).filter(or_(*conditions)).limit(1).first() is not None


def _profile_has_resume_content(db: Session) -> bool:
    """旧 user_profile 是否填过简历字段（只看简历列，不看网申专用列与 section_order）。"""
    conditions = [
        func.coalesce(getattr(UserProfile, name), "") != "" for name in _LEGACY_PROFILE_COLUMNS
    ]
    return db.query(UserProfile.id).filter(or_(*conditions)).limit(1).first() is not None


def _fact_has_content(db: Session) -> bool:
    return db.execute(_FACT_CONTENT_SQL).first() is not None


def has_legacy_data(db: Session) -> bool:
    """旧表里是否有实际的旧简历内容（R-47）；只做存在性探测，不返回任何资料。"""
    existing = _existing_legacy_tables(db)
    for model in _LEGACY_CHILD_MODELS:
        if model.__tablename__ in existing and _table_has_content(db, model):
            return True
    if ProfileFact.__tablename__ in existing and _fact_has_content(db):
        return True
    return "user_profile" in existing and _profile_has_resume_content(db)


__all__ = ["has_legacy_data", "invalidate_table_cache"]
