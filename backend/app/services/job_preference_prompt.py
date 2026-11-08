# SPDX-License-Identifier: Apache-2.0
"""求职偏好注入块（计划 §6.3.4）：渲染 + 预算 + 两段降级。

**为什么单独成模块**：系统提示装配（assistant_system_prompt）只负责"把块放在哪"，
渲染规则（目录标签、来源/日期后缀、截断与降级）需要一个可单独测试的纯实现。

格式的三个结构特征缺一不可（计划 §6.3.4）：
1. 标题写明「用户设定，不是发生过的事实」——偏好是意图，不得被当成经历引用；
2. 每条带**目录中文标签**（不是模型自由文本），来源/更新时间随行；
3. 块尾有结束标记——防止模型把后面的技能/界面上下文误读成偏好的一部分。

预算：硬上限 24 条、单值截断 120 字符、列表最多 8 项、整块 ≤900 字符。超限时**两段降级**：
先省来源/更新时间后缀（丢时间戳只是少一句废话），再按 inject_priority 裁尾——不先丢条目
（丢条目会让助手忘掉用户明确设过的约束）。

**权限：四档全注入（含 read_only）。** 本模块不看任何权限开关：read_only 锁的是"服务端
替用户读出的敏感资料"，而偏好是用户主动设定并期待被遵守的指令。不注入的话，read_only
（新用户默认档）下偏好档等于不存在——功能上线、默认配置下静默失效，是最坏的失败方式。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models.job_preference import JobPreference
from . import job_preference_catalog as catalog
from .job_preference_service import PREF_SOURCE_LABELS, list_active_preferences

# ===== 预算常量（计划 §6.3.4 的硬数字；改它们等于改提示词成本契约，必须同步测试） =====
MAX_BLOCK_CHARS = 900
MAX_LINES = 24
MAX_VALUE_CHARS = 120
MAX_LIST_ITEMS = 8

# 这些 kind 的条目即使 active 也不进注入块（session_note 只服务「这次」按钮）。
_SKIP_KINDS = frozenset({"session_note"})

TITLE = "【求职偏好（用户设定，不是发生过的事实）】"
INTRO = (
    '以下条目是用户为"你该怎么做"设定的约束，来自用户确认，不是他的经历；'
    "不得作为事实引用，不得写进简历正文/事实台账/对外表述。"
)
FOOTER = "【求职偏好结束】"


@dataclass
class PreferenceLine:
    """注入块里的一行（已渲染成标签 + 值；来源/日期是可选后缀）。"""

    label: str
    display: str
    source_label: str
    updated_label: str
    priority: int


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def _format_list_value(value) -> str:
    items = value if isinstance(value, list) else [value]
    texts = [str(item) for item in items[:MAX_LIST_ITEMS]]
    if len(items) > MAX_LIST_ITEMS:
        return "、".join(texts) + f" 等 {len(items)} 项"
    return "、".join(texts)


def _format_display(kind: str, value) -> str:
    spec = catalog.spec_for_kind(kind)
    if spec.value_kind == catalog.PREF_VALUE_KIND_LIST:
        display = _format_list_value(value)
    else:
        display = catalog.describe_value(kind, value)
    return _truncate(display, MAX_VALUE_CHARS)


def _updated_label(pref: JobPreference) -> str:
    moment = pref.updated_at or pref.created_at
    if not hasattr(moment, "strftime"):
        return ""
    return moment.strftime("%m-%d")


def build_preference_lines(preferences: list[JobPreference]) -> list[PreferenceLine]:
    """把活动偏好转成可渲染的行（已按 inject_priority 排序、跳过 session_note）。"""
    lines: list[PreferenceLine] = []
    for pref in preferences:
        if pref.kind in _SKIP_KINDS:
            continue
        try:
            spec = catalog.spec_for_kind(pref.kind)
        except catalog.PreferenceValidationError:
            # 目录是代码闭集，库里的未知 kind 只可能来自手工改库：跳过而不是让整块注入失败。
            continue
        lines.append(
            PreferenceLine(
                label=spec.label,
                display=_format_display(pref.kind, pref.value),
                source_label=PREF_SOURCE_LABELS.get(pref.source, pref.source),
                updated_label=_updated_label(pref),
                priority=spec.inject_priority,
            )
        )
    lines.sort(key=lambda line: line.priority)
    return lines


def compose_preference_block(lines: list[PreferenceLine], *, with_suffix: bool = True) -> str:
    """把行渲染成整块；空列表返回空串（0 条不注入空块）。"""
    if not lines:
        return ""
    ordered = sorted(lines, key=lambda line: line.priority)
    hidden = max(0, len(ordered) - MAX_LINES)
    shown = ordered[:MAX_LINES]
    bullets: list[str] = []
    for line in shown:
        suffix = ""
        if with_suffix and line.updated_label:
            suffix = f"（{line.source_label}，{line.updated_label} 更新）"
        elif with_suffix and line.source_label:
            suffix = f"（{line.source_label}）"
        bullets.append(f"- {line.label}：{line.display}{suffix}")
    body: list[str] = [TITLE, INTRO, *bullets]
    if hidden:
        body.append(f"（另有 {hidden} 条未列出）")
    body.append(FOOTER)
    return "\n".join(body)


def fit_preference_budget(lines: list[PreferenceLine]) -> str:
    """两段降级：先省来源/更新时间后缀，再按优先级从低到高裁尾。"""
    text = compose_preference_block(lines, with_suffix=True)
    if len(text) <= MAX_BLOCK_CHARS:
        return text
    text = compose_preference_block(lines, with_suffix=False)
    if len(text) <= MAX_BLOCK_CHARS:
        return text
    kept = sorted(lines, key=lambda line: line.priority)
    while kept:
        kept = kept[:-1]
        text = compose_preference_block(kept, with_suffix=False)
        if len(text) <= MAX_BLOCK_CHARS:
            return text
    return ""


def render_preference_block(db: Session) -> str:
    """当前数据集的偏好注入块；0 条返回空串。**不看权限开关**（见模块注释）。"""
    preferences = list_active_preferences(db)
    lines = build_preference_lines(preferences)
    return fit_preference_budget(lines)


__all__ = [
    "FOOTER",
    "INTRO",
    "MAX_BLOCK_CHARS",
    "MAX_LINES",
    "MAX_LIST_ITEMS",
    "MAX_VALUE_CHARS",
    "PreferenceLine",
    "TITLE",
    "build_preference_lines",
    "compose_preference_block",
    "fit_preference_budget",
    "render_preference_block",
]
