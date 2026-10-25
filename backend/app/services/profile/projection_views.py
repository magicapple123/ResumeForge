# SPDX-License-Identifier: Apache-2.0
"""纸面投影的派生视图：组元数据 / 逐条候选 / 来源分区布局。

这三样都只是"内容之外"的只读摘要，不参与 ResumeContent 的组装，也不做任何映射：
候选标题字段、分区仅素材标志全部来自 paper_policy（R-37 的单点），这里只按
participating_keys（= 全局顺序）+ 条目顺序读出来。
"""

from __future__ import annotations

from collections.abc import Mapping

from ...schemas.profile_projection import (
    ConsumedProfile,
    ProjectionCandidateOut,
    ProjectionScopeOut,
    ProjectionSourceSectionOut,
)
from . import paper_policy
from .paper_content_builder import clean_values, first_line

__all__ = ["candidates", "scope_out", "source_layout"]


def scope_out(consumed: ConsumedProfile) -> ProjectionScopeOut:
    """投影响应的组元数据（生成/新建面板的"本次使用"只读摘要来源）。"""
    return ProjectionScopeOut(
        group_id=consumed.group_id,
        group_name=consumed.group_name,
        is_default=consumed.is_default,
        participating_keys=list(consumed.participating_keys),
        section_order=list(consumed.section_order),
        workspace_revision=consumed.workspace_revision,
    )


def candidates(
    consumed: ConsumedProfile, entry_paths: Mapping[str, str]
) -> list[ProjectionCandidateOut]:
    """每分区每活动条目一项（顺序 = 全局顺序 + 条目 sort_order），不含折叠/隐藏态。

    paper_content_path 由组装层提供（entry_paths）：前端"追加这一条"据此直接从
    服务端投影的 content 里取现成条目，不再按 title 猜第二份映射（R-16/R-37 单源）。
    """
    result: list[ProjectionCandidateOut] = []
    for key in consumed.participating_keys:
        section = consumed.sections.get(key)
        if section is None:
            continue
        title_field, subtitle_field = paper_policy.candidate_fields(key)
        for entry in section.entries:
            values = clean_values(entry.values)
            if key.startswith("custom:"):
                title, subtitle = _custom_candidate(section, values)
            elif key == "summary":
                title = section.name
                subtitle = first_line(values.get("summary.content", ""))
            else:
                title = (
                    values.get(f"{key}.{title_field}", "") if title_field else ""
                ) or section.name
                subtitle = values.get(f"{key}.{subtitle_field}", "") if subtitle_field else ""
            result.append(
                ProjectionCandidateOut(
                    section_key=key,
                    section_name=section.name,
                    entry_id=entry.entry_id,
                    title=title,
                    subtitle=subtitle,
                    paper_content_path=entry_paths.get(entry.entry_id, ""),
                )
            )
    return result


def source_layout(consumed: ConsumedProfile) -> list[ProjectionSourceSectionOut]:
    """来源分区布局（新建简历的 7/13 来源面板用它渲染，不用前端再分组）。"""
    layout: list[ProjectionSourceSectionOut] = []
    for key in consumed.participating_keys:
        section = consumed.sections.get(key)
        if section is None:
            continue
        layout.append(
            ProjectionSourceSectionOut(
                section_key=key,
                section_name=section.name,
                form=section.form or "multi",
                entry_count=len(section.entries),
                material_only=paper_policy.is_material_only(key),
            )
        )
    return layout


def _custom_candidate(section, values) -> tuple[str, str]:
    """自建分区候选：主文本第一行优先，否则第一条标签行；副标题=分区名。"""
    text_field = paper_policy.custom_section_text_field(section)
    title = first_line(values.get(text_field, "")) if text_field else ""
    if not title:
        for spec in paper_policy.custom_section_line_fields(section, text_field):
            title = first_line(values.get(spec.field_id, ""))
            if title:
                break
    return title or section.name, section.name
