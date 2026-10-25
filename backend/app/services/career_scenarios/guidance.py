# SPDX-License-Identifier: Apache-2.0
"""场景"允许采用的表达重点"白名单（契约 §2.5 的 approved_guidance，计划 §9.1）。

规则：短句只由**服务端**按维度生成，不拼接用户自由文本，也不生成"补齐证书/强调年限"
这类会诱导推断的建议。内置场景目录自带的 guidance（受版本控制的数据）可以合并进来，
但同样经过同样的裁剪与去重；用户填写的 expression_preferences 属于维度数据，
**不**冒充 approved_guidance。

独立成模块的原因：这是提示词安全边界的一部分（改动需要同时看 prompt_fragment_version），
与 id/revision 解析逻辑分开更容易审查，也让 resolve.py 保持在模块行数预算内。
"""

from __future__ import annotations

from collections.abc import Iterable

from ...schemas.career_scenario import CareerScenarioConfig

# 一次生成最多采用的表达重点条数（每条 ≤40 字，避免把提示词预算吃满）。
MAX_APPROVED_GUIDANCE = 6

# 元组第三项为 None 表示"该字段非空就成立"，否则为允许的取值集合。
_GUIDANCE_RULES: tuple[tuple[str, tuple[str, ...] | None, str], ...] = (
    ("career_stage", ("student",), "用课程项目与校园实践证明能力"),
    ("career_stage", ("entry",), "突出早期职责与可核实的成长证据"),
    ("career_stage", ("senior",), "突出职责范围与复杂决策中的实际贡献"),
    ("purpose", ("internship",), "突出实习或课程项目的真实参与"),
    ("purpose", ("career_change",), "解释可转移技能，不编造相关资历"),
    ("purpose", ("internal_transfer",), "强调内部协作与目标岗位的相关经验"),
    ("purpose", ("research_application",), "按证据陈述研究经历与成果"),
    ("purpose", ("career_return",), "用事实说明职业间歇期的技能保持"),
    ("cooperation_form", ("self_employed",), "用项目交付而不是雇佣关系描述合作"),
    ("content_language", ("en-US",), "按英文习惯组织表达，事实保持原样"),
    ("target_function", None, "围绕目标职能组织相关证据"),
)


def derived_guidance(config: CareerScenarioConfig) -> list[str]:
    """按已保存/内置的维度生成白名单短句（顺序固定，保证同输入同 hash）。"""
    guidance: list[str] = []
    for field, expected, phrase in _GUIDANCE_RULES:
        value = getattr(config, field)
        matched = bool(value) if expected is None else value in expected
        if matched:
            guidance.append(phrase)
    return guidance


def merge_guidance(items: Iterable[str]) -> list[str]:
    """合并多组建议：strip、去重、保留顺序，并截到上限。"""
    result: list[str] = []
    for item in items:
        text = (item or "").strip()
        if text and text not in result:
            result.append(text)
        if len(result) >= MAX_APPROVED_GUIDANCE:
            break
    return result


__all__ = ["MAX_APPROVED_GUIDANCE", "derived_guidance", "merge_guidance"]
