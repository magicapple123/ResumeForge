# SPDX-License-Identifier: Apache-2.0
"""「重复网申补充」清单行的英文显示名（按 `repeat:<group>` / `repeat:<group>.<field>` 索引）。

**为什么单独一个文件**：这些行的生产者是 ``repeated_profile.catalog_entries``（12 个补充组 ×
若干条记录），key 空间与简历侧板块、网申单值目录都不同；表放在 ``panel_labels`` 会把它顶过
仓库的 500 行预算（预算由 ``tests/test_file_size_budget.py`` 守着）。这里只放**两张表**，
解析逻辑仍在 ``panel_labels``。

文案来源（不发明措辞）：

- 组名 → ``frontend/src/i18n/messages/en-US.webformGroups.ts`` 的 ``webformGroups.repeat.*``；
- 字段名 → 能复用已校对措辞的一律复用（``en-US.webformFields.ts`` / ``en-US.profileField.ts``），
  其余**暂时由后端持有**，逐条登记在 ``BACKEND_OWNED_COPY`` 里，前端补齐后迁走。
  ``tests/test_webform_panel_labels.py`` 会回读前端词表核对，白名单只许写 ``repeat:`` 键。
"""

from __future__ import annotations

# 清单行的稳定 key 前缀：`repeat:<group_key>` / `repeat:<group_key>.<field_key>`。
REPEAT_KEY_PREFIX = "repeat:"

# 补充组名：key = RepeatedProfileGroup.key。前 10 条抄前端 `webformGroups.repeat.*`；
# 后 2 条（portfolio / social）前端词表暂无，文案暂由后端持有。
REPEAT_GROUP_LABELS: dict[str, str] = {
    "education": "Education details",
    "experience": "Work experience details",
    "project": "Project details",
    "campus": "Campus and community experience",
    "academic": "Academic achievements",
    "award": "Awards and competitions",
    "language": "Language details",
    "certificate": "Certification details",
    "skill": "Skill details",
    "emergency_contact": "Emergency contacts",
    "portfolio": "Portfolio and attachments",
    "social": "Social accounts",
}

# 补充字段名：key = RepeatedProfileField.key。只收录**前端词表还没覆盖**的 16 个；
# 其余（学校 / 专业 / 学历 / 论文名称…）已在 `panel_labels.FORM_FIELD_LABELS` 里。
REPEAT_FIELD_LABELS: dict[str, str] = {
    # —— 复用已校对措辞 ——
    "education_expected_graduation": "Graduation year",  # webformFields.graduation_cohort
    "education_qualification_type": "Degree",  # webformFields.degree_type
    "education_laboratory": "Laboratory",  # webformFields.laboratory
    "project_content": "Project description",  # profileField.projects.description
    "skill_name": "Skill",  # profileField.skills.name
    "certificate_name": "Credential",  # profileField.credentials.title
    "certificate_type": "Credential type",  # profileField.credentials.credential_type
    # —— 后端自持（前端词表暂无）——
    "academic_attachment_note": "Paper attachment note",
    "portfolio_name": "Portfolio name",
    "portfolio_link": "Portfolio link",
    "portfolio_blog_name": "Online portfolio or blog",
    "portfolio_blog_link": "Online portfolio or blog link",
    "portfolio_attachment_note": "Portfolio attachment note",
    "social_platform": "Social platform",
    "social_account": "Social account",
    "social_link": "Social link",
}

# 英文暂时由后端持有的键（**白名单**，不是"翻译豁免"）：加新面孔必须先进这里，
# 测试会核对每一项都真的用在上面的表里、且一律以 `repeat:` 开头。
BACKEND_OWNED_COPY: frozenset[str] = frozenset(
    {
        f"{REPEAT_KEY_PREFIX}portfolio",
        f"{REPEAT_KEY_PREFIX}social",
        f"{REPEAT_KEY_PREFIX}academic.academic_attachment_note",
        f"{REPEAT_KEY_PREFIX}portfolio.portfolio_name",
        f"{REPEAT_KEY_PREFIX}portfolio.portfolio_link",
        f"{REPEAT_KEY_PREFIX}portfolio.portfolio_blog_name",
        f"{REPEAT_KEY_PREFIX}portfolio.portfolio_blog_link",
        f"{REPEAT_KEY_PREFIX}portfolio.portfolio_attachment_note",
        f"{REPEAT_KEY_PREFIX}social.social_platform",
        f"{REPEAT_KEY_PREFIX}social.social_account",
        f"{REPEAT_KEY_PREFIX}social.social_link",
    }
)


def is_repeat_key(value: str) -> bool:
    """这个 key 是不是补充记录那一支（``repeat:…``）。"""
    return str(value or "").startswith(REPEAT_KEY_PREFIX)


def repeat_group_label(group_key: str) -> str:
    """``repeat:<group>`` → 组英文名；不在表里返回空串（调用方回退原值）。"""
    key = str(group_key or "")
    if not is_repeat_key(key):
        return ""
    return REPEAT_GROUP_LABELS.get(key[len(REPEAT_KEY_PREFIX) :], "")


def repeat_field_label(field_key: str) -> str:
    """补充字段英文名。

    接受的写法有两种：裸字段 key（``portfolio_name``，给面板标题用）与清单行的
    ``repeat:<group>.<field>``（给行标签用）。
    """
    key = str(field_key or "")
    if is_repeat_key(key):
        key = key.split(".", 1)[1] if "." in key else ""
    return REPEAT_FIELD_LABELS.get(key, "")


__all__ = [
    "BACKEND_OWNED_COPY",
    "REPEAT_FIELD_LABELS",
    "REPEAT_GROUP_LABELS",
    "REPEAT_KEY_PREFIX",
    "is_repeat_key",
    "repeat_field_label",
    "repeat_group_label",
]
