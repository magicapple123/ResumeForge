# SPDX-License-Identifier: Apache-2.0
"""纸面投影的派生视图：组元数据 / 逐条候选 / 来源分区布局 / 编辑器视图。

这几样都只是"内容之外"的只读摘要，不参与 ResumeContent 的组装，也不做任何映射：
候选标题字段、分区仅素材标志全部来自 paper_policy（R-37 的单点），这里只按
participating_keys（= 全局顺序）+ 条目顺序读出来。编辑器视图（F10/R-82）同理：
板块与字段的映射规则全部从 paper_policy 派生，不在这里维护第二份表。
"""

from __future__ import annotations

from collections.abc import Mapping

from ...schemas.profile_editor import EditorFieldOut, EditorSchemaOut, EditorSectionOut
from ...schemas.profile_projection import (
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
    ProjectionCandidateOut,
    ProjectionScopeOut,
    ProjectionSourceSectionOut,
)
from . import paper_policy
from .paper_content_builder import clean_values, first_line

__all__ = ["candidates", "editor_schema", "scope_out", "source_layout"]


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


def editor_schema(consumed: ConsumedProfile) -> EditorSchemaOut:
    """编辑器视图（F10/R-82）：参与分区的可见板块 + 每个板块的可见字段。

    隐藏字段不在 section.fields（消费 DTO 读取时已裁掉），所以这里天然就是「当前方案
    可见字段」。这是投影端点与创建态快照（build_snapshot_layout）共用的唯一实现：端点
    每次按当前方案重算，新建简历时把同一结果冻结进 profile_usage_snapshot；之后方案
    再改，已保存简历的板块/字段不变。
    """
    sections: list[EditorSectionOut] = []
    for key in consumed.participating_keys:
        section = consumed.sections.get(key)
        if section is None:
            continue
        sections.append(_editor_section(key, section))
    return EditorSchemaOut(
        sections=sections,
        workspace_revision=consumed.workspace_revision,
    )


def _editor_section(key: str, section: ConsumedSection) -> EditorSectionOut:
    """一个参与分区 → 编辑器板块行；特殊分区按纸面规则的同一份表派生。"""
    if key == "basic_info":
        # 基本信息没有条目模型：resume_attr 只认 BASIC_INFO_SLOTS 里的身份字段。
        return EditorSectionOut(
            section_key=key,
            section_name=section.name,
            form="singleton",
            fields=[_editor_field(spec, _basic_info_attr(spec)) for spec in section.fields],
        )
    if key == "summary":
        # 个人总结是标量分区：只有承载区字段映射到 ResumeContent.summary。
        carrier_id = paper_policy.carrier_field_id("summary")
        return EditorSectionOut(
            section_key=key,
            section_name=section.name,
            form="singleton",
            fields=[
                _editor_field(spec, "summary" if spec.field_id == carrier_id else None)
                for spec in section.fields
            ],
        )
    if key.startswith("custom:"):
        # 自建板块：字段只给定义身份；值以「标签：值」进承载区，编辑器不单独渲染。
        return EditorSectionOut(
            section_key=key,
            section_name=section.name,
            form="multi",
            resume_field="custom_sections",
            fields=[_editor_field(spec, None) for spec in section.fields],
        )
    rule = paper_policy.SECTION_RULES.get(key)
    if rule is None:
        # languages 等没有纸面分区规则的分区：保留板块行（前端页签映射照旧），字段无槽位。
        return EditorSectionOut(
            section_key=key,
            section_name=section.name,
            form=section.form or "multi",
            material_only=section.material_only,
            fields=[_editor_field(spec, None) for spec in section.fields],
        )
    return EditorSectionOut(
        section_key=key,
        section_name=section.name,
        form=section.form or "multi",
        resume_field=rule.resume_field,
        material_only=section.material_only,
        fields=[
            _editor_field(spec, _resume_attr(section, rule, spec)) for spec in section.fields
        ],
    )


def _basic_info_attr(spec: ConsumedFieldSpec) -> str | None:
    """基本信息字段的 ResumeContent 属性名；仅内置身份字段有，其余（仅素材）为 None。"""
    if not spec.is_builtin:
        return None
    slot = paper_policy.BASIC_INFO_SLOTS.get(spec.key)
    return slot.attr if slot is not None else None


def _resume_attr(
    section: ConsumedSection, rule: paper_policy.PaperSectionRule, spec: ConsumedFieldSpec
) -> str | None:
    """系统分区字段的 ResumeContent 属性名：槽位优先，其次承载区，否则无独立输入框。"""
    if not spec.is_builtin:
        return None  # 自定义字段以「标签：值」进承载区，编辑器不单独渲染
    slot = rule.slots.get(spec.key)
    if slot is not None:
        return slot.attr
    if spec.field_id == section.carrier_field_id:
        return rule.carrier_attr
    return None


def _editor_field(spec: ConsumedFieldSpec, resume_attr: str | None) -> EditorFieldOut:
    return EditorFieldOut(
        field_id=spec.field_id,
        key=spec.key,
        label=spec.label,
        field_type=spec.field_type,
        resume_attr=resume_attr,
    )


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
