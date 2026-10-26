# SPDX-License-Identifier: Apache-2.0
"""网申字段定义使用的类型、分组和数据来源常量。"""

from dataclasses import dataclass
from typing import Any

# Stable protocol identities. Locale-specific labels are resolved only by the UI.
GROUP_IDENTITY = "identity"
GROUP_CONTACT = "contact"
GROUP_EDUCATION = "education"
GROUP_OTHER = "other"
GROUP_EXTRA_SCHOOL = "school"
GROUP_EXTRA_LANGUAGE = "language"
GROUP_EXTRA_FAMILY = "family"
GROUP_EXTRA_PARTY = "party"
GROUP_EXTRA_HEALTH = "health"
GROUP_EXTRA_INTENT = "intent"
GROUP_EXTRA_MISC = "misc"
GROUP_CUSTOM = "custom"

# 值从哪来。
SOURCE_PROFILE = "profile"
SOURCE_EXTRA = "extra"

GROUP_LABEL_KEYS: dict[str, str] = {
    GROUP_IDENTITY: "identity",
    GROUP_CONTACT: "contact",
    GROUP_EDUCATION: "education",
    GROUP_OTHER: "other",
    GROUP_EXTRA_SCHOOL: "school",
    GROUP_EXTRA_LANGUAGE: "language",
    GROUP_EXTRA_FAMILY: "family",
    GROUP_EXTRA_PARTY: "party",
    GROUP_EXTRA_HEALTH: "health",
    GROUP_EXTRA_INTENT: "intent",
    GROUP_EXTRA_MISC: "misc",
    GROUP_CUSTOM: "custom",
}

LEGACY_GROUP_IDS: dict[str, str] = {
    "身份信息": GROUP_IDENTITY,
    "联系方式": GROUP_CONTACT,
    "教育经历": GROUP_EDUCATION,
    "其他": GROUP_OTHER,
    "学籍与档案": GROUP_EXTRA_SCHOOL,
    "语言与证书": GROUP_EXTRA_LANGUAGE,
    "家庭与紧急联系人": GROUP_EXTRA_FAMILY,
    "党团信息": GROUP_EXTRA_PARTY,
    "身体情况": GROUP_EXTRA_HEALTH,
    "意向与到岗": GROUP_EXTRA_INTENT,
    "其他补充": GROUP_EXTRA_MISC,
    "自定义": GROUP_CUSTOM,
}


def normalize_group_id(value: str) -> str:
    """Read legacy labels at the boundary; emit lowercase ASCII identities."""
    return LEGACY_GROUP_IDS.get(value, value)


def normalize_grouped_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy fixed group labels at an API response boundary."""
    normalized = dict(payload)
    if isinstance(normalized.get("groups"), list):
        normalized["groups"] = [
            normalize_group_id(str(group)) for group in normalized["groups"]
        ]
    if isinstance(normalized.get("fields"), list):
        normalized["fields"] = [
            {**field, "group": normalize_group_id(str(field.get("group") or ""))}
            if isinstance(field, dict)
            else field
            for field in normalized["fields"]
        ]
    return normalized


@dataclass(frozen=True)
class FormField:
    """目录里的一条字段定义。"""

    key: str
    label: str
    group: str
    kind: str = "text"
    options: tuple[str, ...] = ()
    sensitive: bool = False
    derived: bool = False
    source: str = SOURCE_PROFILE


__all__ = [
    "GROUP_CONTACT",
    "GROUP_CUSTOM",
    "GROUP_EDUCATION",
    "GROUP_EXTRA_FAMILY",
    "GROUP_EXTRA_HEALTH",
    "GROUP_EXTRA_INTENT",
    "GROUP_EXTRA_LANGUAGE",
    "GROUP_EXTRA_MISC",
    "GROUP_EXTRA_PARTY",
    "GROUP_EXTRA_SCHOOL",
    "GROUP_IDENTITY",
    "GROUP_LABEL_KEYS",
    "GROUP_OTHER",
    "LEGACY_GROUP_IDS",
    "normalize_group_id",
    "normalize_grouped_payload",
    "SOURCE_EXTRA",
    "SOURCE_PROFILE",
    "FormField",
]
