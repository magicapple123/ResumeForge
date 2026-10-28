# SPDX-License-Identifier: Apache-2.0
"""「我的资料」：13 个内置板块的条目、两个自建板块、三个投递方案。

全部走应用自己的服务层（``entry_store`` / ``definition_store`` / ``group_store`` /
``webform.extra_profile``），不直接写 profile_entry 的 JSON：字段快照、sort_order、
工作区 revision、自建字段的 ``paper_policy`` 派生都在这几层里，手写 SQL 一定会漂移。
"""

from __future__ import annotations

import re

from app.database import SessionLocal
from app.services.profile import definition_store, entry_store, group_store, workspace_bootstrap
from app.services.profile.definition_catalog import SECTION_BY_KEY
from app.services.resume.resume_sample_photo import SAMPLE_PHOTO_DATA_URL

from dataset_seed import persona

# 板块 key → 该板块里「一条条目录数据」的字段名。键名必须与 definition_catalog 的
# field.key 完全一致，否则会落成「未知字段」错误（entry_store 会拒绝）。
SECTION_ITEMS = {
    "educations": persona.EDUCATIONS,
    "experiences": persona.EXPERIENCES,
    "projects": persona.PROJECTS,
    "skills": persona.SKILLS,
    "campus_experiences": persona.CAMPUS_EXPERIENCES,
    "awards": persona.AWARDS,
    "publications": persona.PUBLICATIONS,
    "research_projects": persona.RESEARCH_PROJECTS,
    "patents": persona.PATENTS,
    "credentials": persona.CREDENTIALS,
    "languages": persona.LANGUAGES,
}


def _plain_lines(text: str) -> str:
    """去掉行首的项目符号。

    资料里的长段落是**一行一条**写的，纸面渲染会给每行套一个项目符号；行首再留一个
    「- 」就会变成「• - 负责…」。作者在编辑器里看到的仍是分段的一行行。
    """
    lines = [re.sub(r"^[-•·]\s+", "", line).strip() for line in str(text).splitlines()]
    return "\n".join(line for line in lines if line)


def _field_ids(section_key: str, values: dict) -> dict[str, str]:
    """短键（school）→ 稳定 field_id（educations.school），空值不写。"""
    spec = SECTION_BY_KEY[section_key]
    known = {field.key for field in spec.fields}
    mapped: dict[str, str] = {}
    for key, value in values.items():
        if key not in known:
            raise KeyError(f"{section_key} 没有字段 {key}，可用：{sorted(known)}")
        text = str(value or "").strip()
        if not text:
            continue
        field_type = next(field.field_type for field in spec.fields if field.key == key)
        mapped[f"{section_key}.{key}"] = _plain_lines(text) if field_type == "multi_line" else text
    return mapped


def seed() -> None:
    """按「条目 → 自建板块 → 方案 → 网申资料」的顺序写入。"""
    with SessionLocal() as db:
        workspace_bootstrap.ensure_workspace(db)
        _seed_entries(db)
        _seed_custom_sections(db)
        _seed_groups(db)


def _seed_entries(db) -> None:
    basic = dict(persona.BASIC)
    values = _field_ids("basic_info", basic)
    values["basic_info.photo"] = SAMPLE_PHOTO_DATA_URL
    entry_store.upsert_entry(db, "basic_info", values=values)
    entry_store.upsert_entry(db, "summary", values={"summary.content": persona.SUMMARY})

    for section_key, items in SECTION_ITEMS.items():
        for item in items:
            entry_store.upsert_entry(db, section_key, values=_field_ids(section_key, item))


def _seed_custom_sections(db) -> None:
    """自建板块：字段定义 + 条目。第一个字段是主文本字段（纸面标题），由服务层派生。"""
    for spec in persona.CUSTOM_SECTIONS:
        section = definition_store.create_custom_section(db, spec["name"])
        field_ids: dict[str, str] = {}
        for label, field_type in spec["fields"]:
            field = definition_store.create_custom_field(db, section.key, label, field_type)
            field_ids[label] = field.field_id
        for item in spec["entries"]:
            entry_store.upsert_entry(
                db,
                section.key,
                values={
                    field_ids[label]: str(value)
                    for label, value in item.items()
                    if label in field_ids and str(value).strip()
                },
            )


def _all_section_keys(db) -> list[str]:
    return workspace_bootstrap.active_section_keys(db)


def _seed_groups(db) -> None:
    """三个投递方案（组）：参与清单不同，资料本身共用同一份。

    这是 F1 最容易被误测的一块：方案切换只改「这一份投递里带哪些板块」，
    条目数量不会变。演示数据里必须有至少两个非默认方案，用户才能点到切换。
    """
    custom_keys = [key for key in _all_section_keys(db) if key.startswith("custom:")]
    plans = [
        (
            "增长分析师投递方案",
            [
                "basic_info",
                "summary",
                "experiences",
                "projects",
                "skills",
                "educations",
                "awards",
                "credentials",
                "languages",
            ],
        ),
        (
            "商业分析投递方案",
            [
                "basic_info",
                "summary",
                "experiences",
                "projects",
                "skills",
                "educations",
                "publications",
                "research_projects",
                "credentials",
            ],
        ),
        (
            "运营/产品投递方案",
            [
                "basic_info",
                "summary",
                "experiences",
                "projects",
                "skills",
                "campus_experiences",
                "awards",
                *custom_keys,
            ],
        ),
    ]
    for name, keys in plans:
        group = group_store.create_group(db, name)
        group_store.set_group_members(db, group.group_id, keys, expected_revision=group.revision)
