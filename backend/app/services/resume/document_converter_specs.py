# SPDX-License-Identifier: Apache-2.0
"""v1 -> v2 逐分区字段映射表（document_converter_sections 的数据部分）。

从 document_converter_sections 拆出的唯一原因是单文件 500 行预算；表与执行逻辑分开后
"新增/调整一个 v1 字段的去路"只需要改这一份数据表。
"""

from __future__ import annotations

from typing import Any

__all__ = ["ENTRY_SPECS"]

# 每个系统分区：字段表 + 承载区正文（v1 列表字段 -> TextItem 的 attr）+ 作者字段。
# 字段行格式：(v2 item key, v1 attr, placement, format, wrap)。format/wrap 为 None 时
# 走目录默认；period 由 start_date/end_date 合成一个 date_range item。
ENTRY_SPECS: dict[str, dict[str, Any]] = {
    "education": {
        "fields": (
            ("school", "school", "title", None, None),
            ("major", "major", "title", None, None),
            ("degree", "degree", "meta", None, None),
            ("gpa", "gpa", "lead", None, None),
            ("study_form", "study_form", "trail", None, None),
            ("degree_type", "degree_type", "trail", None, None),
            ("department", "department", "trail", None, None),
            ("rank", "rank", "trail", None, None),
            ("advisor", "advisor", "trail", None, None),
            ("research_direction", "research_direction", "trail", None, None),
        ),
        "period": True,
        "lists": (("courses", "courses", "lead"),),
        "texts": (("achievements", "achievements", "bullet"),),
    },
    "experience": {
        "fields": (
            ("company", "company", "title", None, None),
            ("role", "role", "title", None, None),
            ("team_size", "team_size", "trail", None, None),
            ("experience_kind", "experience_kind", "trail", "enum", None),
        ),
        "period": True,
        "lists": (),
        "texts": (("description", "description", "bullet"),),
    },
    "projects": {
        "fields": (
            ("name", "name", "title", None, None),
            ("role", "role", "meta", None, None),
            ("project_size", "project_size", "trail", None, None),
            ("artifact_type", "artifact_type", "trail", None, None),
            ("public_url", "public_url", "trail", None, None),
        ),
        "period": True,
        "lists": (("tech_stack", "tech_stack", "trail"),),
        "texts": (
            ("description", "description", "bullet"),
            ("highlights", "highlights", "bullet"),
        ),
    },
    "campus_experience": {
        "fields": (
            ("organization", "organization", "title", None, None),
            ("role", "role", "title", None, None),
            ("activity_type", "activity_type", "trail", None, None),
        ),
        "period": True,
        "lists": (),
        "texts": (("description", "description", "bullet"),),
    },
    "awards": {
        "fields": (
            ("name", "name", "title", None, None),
            ("date", "date", "meta", "date", None),
            ("issuer", "issuer", "trail", None, None),
            ("level", "level", "trail", None, None),
            ("ratio", "ratio", "trail", None, None),
        ),
        "period": False,
        "lists": (),
        "texts": (("description", "description", "paragraph"),),
    },
    "publications": {
        "fields": (
            ("title", "title", "title", None, None),
            ("venue", "venue", "meta", None, None),
            ("year", "year", "meta", None, None),
            ("status", "status", "meta", "enum", None),
            ("outcome_type", "outcome_type", "trail", None, None),
            ("my_rank", "my_rank", "trail", None, None),
            ("volume_pages", "volume_pages", "trail", None, None),
            ("doi", "doi", "trail", None, None),
            ("url", "url", "trail", None, None),
            ("note", "note", "trail", None, None),
        ),
        "period": False,
        "authors": (("authors", "authors"),),
        "lists": (),
        "texts": (),
    },
    "research_projects": {
        "fields": (
            ("name", "name", "title", None, None),
            ("role", "role", "title", None, None),
            ("organization", "organization", "meta", None, None),
            ("level", "level", "trail", None, None),
            ("funding", "funding", "trail", None, None),
        ),
        "period": True,
        "lists": (),
        "texts": (
            ("description", "description", "bullet"),
            ("outcomes", "outcomes", "bullet"),
        ),
    },
    "patents": {
        "fields": (
            ("title", "title", "title", None, None),
            ("patent_number", "patent_number", "meta", None, None),
            ("country", "country", "meta", None, None),
            ("status", "status", "meta", "enum", None),
            ("filed_date", "filed_date", "trail", "date", None),
            ("granted_date", "granted_date", "trail", "date", None),
            ("url", "url", "trail", None, None),
            ("outcome_type", "outcome_type", "hidden", None, None),
            ("inventor_rank", "inventor_rank", "hidden", None, None),
        ),
        "period": False,
        "authors": (("inventors", "inventors"),),
        "lists": (),
        "texts": (),
    },
    "credentials": {
        "fields": (
            ("name", "name", "title", None, None),
            ("issuer", "issuer", "meta", None, None),
            ("status", "status", "meta", "enum", None),
            ("credential_type", "credential_type", "trail", None, None),
            ("issue_date", "issue_date", "trail", "date", None),
            ("expiry_date", "expiry_date", "trail", "date", None),
            ("verify_url", "verify_url", "trail", None, None),
            ("note", "note", "trail", None, None),
        ),
        "period": False,
        "lists": (),
        "texts": (),
    },
    "skills": {
        "fields": (
            ("category", "category", "trail", None, None),
            ("name", "name", "body", None, None),
            ("level", "level", "body", None, "paren"),
        ),
        "period": False,
        "lists": (),
        "texts": (),
    },
    "languages": {
        "fields": (
            ("obtained_at", "obtained_at", "trail", "date", None),
            ("name", "name", "body", None, None),
            ("level", "level", "body", None, "paren"),
            ("certificate", "certificate", "body", None, "paren"),
            ("score", "score", "body", None, "paren"),
        ),
        "period": False,
        "lists": (),
        "texts": (),
    },
}
