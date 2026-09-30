"""网申字段定义使用的类型、分组和数据来源常量。"""

from dataclasses import dataclass

# 分组名同时用作前端的分区标题。
GROUP_IDENTITY = "身份信息"
GROUP_CONTACT = "联系方式"
GROUP_EDUCATION = "教育经历"
GROUP_OTHER = "其他"
GROUP_EXTRA_SCHOOL = "学籍与档案"
GROUP_EXTRA_LANGUAGE = "语言与证书"
GROUP_EXTRA_FAMILY = "家庭与紧急联系人"
GROUP_EXTRA_PARTY = "党团信息"
GROUP_EXTRA_HEALTH = "身体情况"
GROUP_EXTRA_INTENT = "意向与到岗"
GROUP_EXTRA_MISC = "其他补充"

# 值从哪来。
SOURCE_PROFILE = "profile"
SOURCE_EXTRA = "extra"


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
    "GROUP_EDUCATION",
    "GROUP_EXTRA_FAMILY",
    "GROUP_EXTRA_HEALTH",
    "GROUP_EXTRA_INTENT",
    "GROUP_EXTRA_LANGUAGE",
    "GROUP_EXTRA_MISC",
    "GROUP_EXTRA_PARTY",
    "GROUP_EXTRA_SCHOOL",
    "GROUP_IDENTITY",
    "GROUP_OTHER",
    "SOURCE_EXTRA",
    "SOURCE_PROFILE",
    "FormField",
]
