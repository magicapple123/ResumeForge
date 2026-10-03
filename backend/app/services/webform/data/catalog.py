"""「人工挑选」完整清单：常量表与目录构造（职责④）。

从 ``webform/data.py`` 拆出：给人逐条挑选的目录——子表**逐条列出**，
与给匹配器用的 ``profile_to_form_data``（每个字段一个值）成对存在。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...profile.profile_service import get_profile_detail
from .. import extra_profile, repeated_profile
from ..extra_profile import list_entries
from ..fields import FORM_FIELDS

from .profile_map import _as_block_text, profile_to_form_data


# ===== 供"人工挑选"的完整清单 =====
#
# 与 ``profile_to_form_data`` 的关键差别：那个是**给匹配器用的**（每个字段一个值，
# 教育/实习只取最近一条），这个是**给人挑的**——所以子表要**逐条列出**，否则用户
# 想填第二条实习经历时根本挑不到。
#
# 这也是"让用户自己选"这套办法能顺带解决多段经历的原因：不需要识别「添加」按钮、
# 不需要判断区块，第几条就是清单里的第几行。

# 子表 → (字段名, 中文标签) 的展开顺序。
_EDUCATION_FIELDS: tuple[tuple[str, str], ...] = (
    ("school", "学校"),
    ("department", "院系"),
    ("major", "专业"),
    ("degree", "学历"),
    ("study_mode", "学习形式"),
    ("degree_type", "学位"),
    ("start_date", "入学时间"),
    ("end_date", "毕业时间"),
    ("gpa", "绩点或排名"),
    ("cet4_score", "英语四级分数"),
    ("cet6_score", "英语六级分数"),
    ("courses", "核心课程"),
    ("achievements", "在校成果"),
)
_EXPERIENCE_FIELDS: tuple[tuple[str, str], ...] = (
    ("company", "实习单位"),
    ("role", "实习职位"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("description", "工作内容"),
)
_PROJECT_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "项目名称"),
    ("role", "担任角色"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("tech_stack", "技术栈、工具和方法"),
    ("description", "项目描述"),
    ("highlights", "亮点与成果"),
)
_CAMPUS_FIELDS: tuple[tuple[str, str], ...] = (
    ("organization", "组织或部门"),
    ("role", "职务或角色"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("description", "经历描述"),
)
_SKILL_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "技能"),
    ("level", "熟练程度"),
)
_AWARD_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "奖项名称"),
    ("date", "获奖时间"),
    ("description", "奖项说明"),
)

# **目录里**这些字段取自子表、但用的是扁平键名（匹配器要"每个字段一个值"）。在给人挑的
# 清单里它们由按条分组覆盖，所以跳过——否则同一个值会出现两次。
#
# ⚠️ 这里是**手写列举目录键名**，不是从子表列名推出来的。曾经想省事用子表列名生成，
# 结果 `project.name` / `award.name` 的列名 `name` 把目录里的「姓名」也一起排除了
# ——清单上直接少了姓名，而那种缺失一眼看不出来。
_MIRRORED_BY_RECORDS: frozenset[str] = frozenset(
    {
        "school",
        "department",
        "major",
        "degree",
        "study_mode",
        "degree_type",
        "gpa",
        "education_start",
        "education_end",
        "company",
        "job_title",
        "work_start",
        "work_end",
    }
)

_RECORD_GROUPS: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    ("educations", "教育经历", _EDUCATION_FIELDS),
    ("experiences", "实习和工作", _EXPERIENCE_FIELDS),
    ("campus_experiences", "校园经历", _CAMPUS_FIELDS),
    ("projects", "项目经历", _PROJECT_FIELDS),
    ("skills", "专业技能", _SKILL_FIELDS),
    ("awards", "荣誉奖项", _AWARD_FIELDS),
)

# 清单中的子表列名不一定就是匹配目录里的字段 key（例如 ``project.name`` 不能
# 使用裸 ``name``，否则会与用户姓名共用同义词）。统一在这里做一次映射，
# 让“人工挑选”和批量匹配使用同一套字段语义。
_RECORD_FORM_KEYS: dict[str, dict[str, str]] = {
    "educations": {
        "start_date": "education_start",
        "end_date": "education_end",
        "courses": "education_courses",
        "achievements": "education_achievements",
    },
    "experiences": {
        "company": "experience_company",
        "role": "experience_role",
        "start_date": "experience_start",
        "end_date": "experience_end",
        "description": "experience_description",
    },
    "projects": {
        "name": "project_name",
        "role": "project_role",
        "start_date": "project_start",
        "end_date": "project_end",
        "description": "project_description",
        "tech_stack": "project_tech_stack",
        "highlights": "project_highlights",
    },
    "campus_experiences": {
        "organization": "campus_organization",
        "role": "campus_role",
        "start_date": "campus_start",
        "end_date": "campus_end",
        "description": "campus_description",
    },
    "skills": {
        "name": "skill_name",
        "level": "skill_mastery",
    },
    "awards": {
        "name": "award_name",
        "date": "award_date",
        "description": "award_description",
    },
}


def catalog_from_profile(profile: Any, *, job_title: str = "") -> list[dict[str, str]]:
    """把资料整理成一份**给人挑**的清单：``[{group, label, value}, ...]``。

    分区沿用字段目录的分组名（身份信息 / 联系方式 / 教育经历 / 其他），子表则按条分组
    （"教育经历 1"、"实习/工作 2"…）。空值不进清单——列一堆点不动的行没有意义。
    """
    entries: list[dict[str, str]] = []

    data = profile_to_form_data(profile, job_title=job_title)
    for spec in FORM_FIELDS:
        # 两类别在这里出现，它们由下面的**按条分组**覆盖：
        # - `derived`（"实习单位（第一条）"那种）；
        # - 取自子表但用了扁平字段名的（学校/专业/学历、最近实习单位…）——扁平那份只
        #   取了最近一条，而按条分组列的是全部。两份都放，用户会看到同一个值出现两次。
        if spec.derived or spec.key in _MIRRORED_BY_RECORDS:
            continue
        value = (data.get(spec.key) or "").strip()
        if value:
            # `key` 给「可能是这几个」排序用（`service.related_entries` 靠它取同义词表）。
            # 顺带说明：加它**不影响 `build_catalog` 那段去重**——`SOURCE_EXTRA` 与
            # `SOURCE_PROFILE` 的 key 集合按构造不相交。
            entries.append(
                {"group": spec.group, "label": spec.label, "value": value, "key": spec.key}
            )

    for attribute, group_name, fields in _RECORD_GROUPS:
        for index, record in enumerate(getattr(profile, attribute, []) or [], start=1):
            group = f"{group_name} {index}"
            for field_name, label in fields:
                value = str(getattr(record, field_name, "") or "").strip()
                if value:
                    # 子表字段的 key 直接用字段名（`school` / `company`…）：排序时靠它去
                    # `FIELD_SYNONYMS` 取同义词表，取不到才退回按标签比。
                    entries.append(
                        {
                            "group": group,
                            "label": label,
                            "value": value,
                            "key": _RECORD_FORM_KEYS.get(attribute, {}).get(
                                field_name, field_name
                            ),
                        }
                    )

    # 长文本（工作内容、项目描述）压成一行：清单是给人扫的，多行会把一屏吃掉。
    for entry in entries:
        entry["value"] = _as_block_text(entry["value"])
    return entries


def build_catalog(db: Session, *, job_title: str = "") -> list[dict[str, str]]:
    """返回完整可挑选目录，并把已记住的网申字段也放进来。"""
    entries = catalog_from_profile(get_profile_detail(db), job_title=job_title)
    entries.extend(repeated_profile.catalog_entries(db))
    values = list_entries(db)
    details = extra_profile.list_details(db)
    known_keys = {entry.get("key", "") for entry in entries}

    for field in FORM_FIELDS:
        value = (values.get(field.key) or "").strip()
        if not value or field.key in known_keys:
            continue
        entries.append(
            {
                "group": field.group,
                "label": field.label,
                "value": _as_block_text(value),
                "key": field.key,
                "source": "extra",
            }
        )
        known_keys.add(field.key)

    custom_groups: list[str] = []
    for field in extra_profile.custom_fields_of(db, custom_groups):
        key = field["key"]
        value = (values.get(key) or "").strip()
        if not value or key in known_keys:
            continue
        entries.append(
            {
                "group": field["group"],
                "label": field["label"],
                "value": _as_block_text(value),
                "key": key,
                "source": "extra",
                "reuse": details.get(key, {}).get("reuse", "general"),
            }
        )
        known_keys.add(key)
    return entries

