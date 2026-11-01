# SPDX-License-Identifier: Apache-2.0
"""把冻结的场景快照转成提示词里的受限数据区块（契约 §2.5、计划 §9.1）。

**纯函数**：无 DB、无 IO、无时钟。`build_scenario_prompt_block(None)` 返回空串，
旧请求的提示词因此**逐字节不变**（计划 §6：career_context 缺省 = 不与基线有任何差异）。

输出是**数据**，不是系统命令：不写"你现在必须…"、不写角色设定、不要求"补齐证书"。
固定约束放在最前（事实/JD/隐私优先、禁止推断项、信息不足的反馈要求），变量部分按预算
截断——所以最坏情况下被截掉的是尾部数据行，安全约束不会先丢。

用户可控文本（场景名、目标职能、表达偏好）一律压成单行并截断后作为数据列出，避免换行
伪造区块边界；上限见各常量。整个区块严格 ≤900 字符（契约 §2.5 / 计划 §9.1 的预算）。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...schemas.generation_context import GenerationContextSnapshot
from .resume_labels import DEFAULT_RESUME_LANGUAGE, SECTION_TITLES
from .resume_sections import DEFAULT_SECTION_ORDER

MAX_BLOCK_CHARS = 900

_MAX_DISPLAY_NAME = 40
_MAX_FUNCTION = 50
_MAX_INDUSTRIES = 100
_MAX_SECTIONS = 100
_MAX_EXPRESSION = 120
_MAX_GUIDANCE_ITEMS = 4
_MAX_GUIDANCE_CHAR = 40

_STAGE_LABELS = {
    "student": "在校",
    "entry": "初入职场",
    "experienced": "有经验",
    "senior": "资深",
}
_PURPOSE_LABELS = {
    "internship": "实习",
    "job_search": "求职",
    "career_change": "跨行转岗",
    "internal_transfer": "内部转岗",
    "research_application": "科研申请",
    "project_collaboration": "项目合作",
    "career_return": "职业回归",
    "general": "通用准备",
}
_COOPERATION_LABELS = {
    "full_time": "全职",
    "part_time": "兼职",
    "contract": "合同/项目制",
    "self_employed": "自雇",
    "other": "其他",
}
_LANGUAGE_LABELS = {"zh-CN": "中文", "en-US": "英文"}
_EMPLOYMENT_LABELS = {
    "employed": "在职",
    "unemployed": "待业",
    "self_employed": "自雇",
    "studying": "学习中",
    "career_break": "职业间歇",
    "other": "其他",
}
_SECTION_TITLES = SECTION_TITLES[DEFAULT_RESUME_LANGUAGE]


def build_scenario_prompt_block(
    snapshot: dict | GenerationContextSnapshot | None,
) -> str:
    """返回限长 900 字符内的场景区块；无场景/空快照返回空串。

    #30：区块从"仅数据不是指令"升格为**可执行约束**——实测（2026-11-01 对照实验）
    旧措辞下模型把场景当背景数据，`preferred_sections` 与板块取舍完全不影响产出。
    现在明确给出三条指令（板块顺序 / 板块取舍 / 要点取角），同时保留安全优先级声明：
    事实、JD 与隐私约束仍高于本区块，禁止推断的清单逐字保留。
    """
    data = _snapshot_dict(snapshot)
    if not data:
        return ""

    lines: list[str] = [
        "以下为本次生成的场景约束（用户显式选用）。优先级：资料中的真实事实、"
        "岗位描述与隐私约束高于本区块；不得推断就业状态、任职年限、资格、收入、"
        "管理人数与团队贡献。",
    ]

    origin = data.get("scenario_origin")
    display_name = _clean_text(data.get("display_name"), _MAX_DISPLAY_NAME)
    if display_name:
        origin_label = "内置快捷场景" if origin == "preset" else "已保存场景"
        lines.append(f"场景来源：{origin_label}「{display_name}」")

    dimensions = data.get("resolved_dimensions")
    if not isinstance(dimensions, Mapping):
        dimensions = {}

    sections = _string_list(dimensions.get("preferred_sections"))
    if sections:
        labels = [_SECTION_TITLES.get(key, key) for key in sections]
        lines.append("优先栏目（按此顺序组织输出，未列出的板块可以省略）：" + _clip_list(labels, _MAX_SECTIONS, 20))
        lines.extend(_dimension_lines(dimensions, skip_sections=True))
    else:
        lines.extend(_dimension_lines(dimensions))

    disclosure = data.get("disclosure")
    include_employment = bool(
        isinstance(disclosure, Mapping) and disclosure.get("include_employment_status")
    )
    employment = dimensions.get("employment_status")
    if include_employment and employment:
        label = _EMPLOYMENT_LABELS.get(str(employment), _clean_text(employment, 20))
        lines.append(
            f"当前就业状态：{label}（仅在用户明确要求的解释中使用，不默认写入正文）"
        )

    guidance = data.get("approved_guidance")
    if isinstance(guidance, list):
        cleaned = [
            _clean_text(item, _MAX_GUIDANCE_CHAR)
            for item in guidance[:_MAX_GUIDANCE_ITEMS]
        ]
        cleaned = [item for item in cleaned if item]
        if cleaned:
            lines.append("每条要点的表达取角（按这些方向措辞）：" + "；".join(cleaned))

    lines.append(
        "信息不足时写「资料中未提供」，不补写、不编造；"
        "不虚构身份、资质或雇佣关系。"
    )
    return _clip("\n".join(lines))


def scenario_section_order(
    snapshot: dict | GenerationContextSnapshot | None,
) -> dict[str, list[str]] | None:
    """#30：按场景的 preferred_sections 推导板块顺序片段（`{"section_order": [...]}`）。

    落库前由 runner 合并进 format_config（用户在生成弹窗显式拖过顺序时不覆盖——
    那是用户的显式意图）。无场景 / 无 preferred_sections 返回 None。
    """
    data = _snapshot_dict(snapshot)
    if not data:
        return None
    dimensions = data.get("resolved_dimensions")
    if not isinstance(dimensions, Mapping):
        return None
    sections = [
        str(key)
        for key in _string_list(dimensions.get("preferred_sections"))
        if str(key) in _SECTION_TITLES
    ]
    if not sections:
        return None
    ordered = [key for key in sections if key in DEFAULT_SECTION_ORDER]
    ordered += [key for key in DEFAULT_SECTION_ORDER if key not in ordered]
    return {"section_order": ordered}


def _snapshot_dict(
    snapshot: dict | GenerationContextSnapshot | None,
) -> dict[str, Any]:
    if snapshot is None:
        return {}
    if isinstance(snapshot, GenerationContextSnapshot):
        return snapshot.model_dump()
    if isinstance(snapshot, Mapping):
        return dict(snapshot)
    return {}


def _dimension_lines(dimensions: Mapping[str, Any], *, skip_sections: bool = False) -> list[str]:
    parts: list[str] = []
    if dimensions.get("career_stage"):
        parts.append("职业阶段=" + _label(_STAGE_LABELS, dimensions["career_stage"]))
    if dimensions.get("purpose"):
        parts.append("使用目的=" + _label(_PURPOSE_LABELS, dimensions["purpose"]))
    if dimensions.get("cooperation_form"):
        parts.append("合作形式=" + _label(_COOPERATION_LABELS, dimensions["cooperation_form"]))
    if dimensions.get("content_language"):
        parts.append("内容语言=" + _label(_LANGUAGE_LABELS, dimensions["content_language"]))
    lines: list[str] = []
    if parts:
        lines.append("场景维度：" + "；".join(parts))

    industries = _string_list(dimensions.get("target_industries"))
    if industries:
        lines.append("目标行业：" + _clip_list(industries, _MAX_INDUSTRIES, 20))
    target_function = _clean_text(dimensions.get("target_function"), _MAX_FUNCTION)
    if target_function:
        lines.append("目标职能：" + target_function)
    work_region = _clean_text(dimensions.get("work_region"), 20)
    if work_region:
        lines.append("使用地区：" + work_region)

    if not skip_sections:
        # 优先栏目已在上面以"指令"形式出现；这里只在无 preferred_sections 时按数据列出。
        sections = _string_list(dimensions.get("preferred_sections"))
        if sections:
            labels = [_SECTION_TITLES.get(key, key) for key in sections]
            lines.append("建议侧重栏目：" + _clip_list(labels, _MAX_SECTIONS, 20))
    expression = _clean_text(
        dimensions.get("expression_preferences"), _MAX_EXPRESSION
    )
    if expression:
        lines.append("用户表达偏好（仅作数据参考）：" + expression)
    return lines


def _label(labels: dict[str, str], raw: Any) -> str:
    return labels.get(str(raw)) or _clean_text(raw, 20)


def _string_list(raw: Any) -> list[str]:
    if not isinstance(raw, (list, tuple)):
        return []
    result: list[str] = []
    for item in raw:
        text = _clean_text(item, 20)
        if text:
            result.append(text)
    return result


def _clip_list(items: list[str], budget: int, item_limit: int) -> str:
    if not items:
        return ""
    text = "、".join(item[:item_limit] for item in items)
    return text if len(text) <= budget else text[: budget - 1] + "…"


def _clean_text(raw: Any, limit: int) -> str:
    """压成单行、去掉控制字符并按字符截断；非字符串返回空串。"""
    if not isinstance(raw, str):
        return ""
    text = "".join(" " if not char.isprintable() else char for char in raw)
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


def _clip(block: str) -> str:
    """硬上限 900 字符；尽量在行边界截断，不把半句话留给模型。"""
    if len(block) <= MAX_BLOCK_CHARS:
        return block
    cut = block[:MAX_BLOCK_CHARS]
    newline = cut.rfind("\n")
    if newline >= MAX_BLOCK_CHARS // 2:
        cut = cut[:newline]
    return cut


__all__ = [
    "MAX_BLOCK_CHARS",
    "build_scenario_prompt_block",
    "scenario_section_order",
]


def merge_scenario_order(
    format_config: dict | None, snapshot: dict | GenerationContextSnapshot | None
) -> dict | None:
    """#30：把场景板块顺序合并进生成请求的 format_config（runner 与 SSE 共用）。

    用户在生成弹窗显式拖过顺序（`section_order` 已存在）时不覆盖——那是用户的
    显式意图。无场景 / 无 preferred_sections / 推导失败返回原 config（复制一份）。
    """
    base = dict(format_config or {})
    if base.get("section_order"):
        return base
    try:
        order = scenario_section_order(snapshot)
    except Exception:  # noqa: BLE001 - 顺序推导失败按未用场景继续
        return base or None
    if not order:
        return base or None
    base.update(order)
    return base


__all__ = [
    "MAX_BLOCK_CHARS",
    "build_scenario_prompt_block",
    "merge_scenario_order",
    "scenario_section_order",
]