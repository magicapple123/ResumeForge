# SPDX-License-Identifier: Apache-2.0
"""F8 纸面渲染的新增条目字段：分区→字段顺序 + 「标签：值」行（单一来源）。

HTML 模板无法 import Python（_resume_blocks.j2 按同一顺序显式写行）；Markdown / Word /
PDF 三个 Python 渲染器都从这里取——不许各处再抄一份字段顺序，否则四格式迟早漂移。
标签仍只来自 resume_labels.FIELD_LABELS（渲染层不写中文字面量）。

只列 F8 新增/复用的有纸面追加行字段：已复用的 experience_kind / artifact_type /
funding 保持既有渲染位置（契约 §2），不在这里重复输出。

顺序 = 契约 §1 表顺序 = 模型字段追加顺序；新增字段只增不改，空值跳过。
"""

from __future__ import annotations

from collections.abc import Mapping

# 分区键用 ResumeContent 字段名（education/experience/...），与四个渲染器的分区键一致。
PROFILE_FIELD_ORDER: dict[str, tuple[str, ...]] = {
    "education": (
        "study_form",
        "degree_type",
        "department",
        "rank",
        "advisor",
        "research_direction",
    ),
    "experience": ("team_size",),
    "campus_experience": ("activity_type",),
    "projects": ("project_size",),
    "skills": ("category",),
    "awards": ("issuer", "level", "ratio"),
    "publications": ("outcome_type", "my_rank"),
    "research_projects": ("level",),
    "credentials": ("credential_type",),
}

__all__ = ["PROFILE_FIELD_ORDER", "profile_field_lines", "profile_field_text"]


def profile_field_lines(
    item: object, section_key: str, labels: Mapping[str, str]
) -> list[tuple[str, str]]:
    """该条目要追加的 (标签, 值) 行：空值跳过、顺序固定。

    labels 传 resume_labels.field_labels(language)；缺键直接 KeyError（宁可导出时炸出
    明显错误，也不要把某一行静默丢掉）。
    """
    rows: list[tuple[str, str]] = []
    for field in PROFILE_FIELD_ORDER.get(section_key, ()):
        value = str(getattr(item, field, "") or "").strip()
        if value:
            rows.append((labels[field], value))
    return rows


def profile_field_text(item: object, section_key: str, labels: Mapping[str, str]) -> str:
    """把同一组行拼成行内文本（skills 行内流用）：标签：值 · 标签：值。"""
    return " · ".join(
        f"{label}：{value}" for label, value in profile_field_lines(item, section_key, labels)
    )
