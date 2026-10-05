"""预览数据模型与状态常量（STATUS_* / SOURCE_* / AI_NOTE）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# 预览里一条映射的状态。
STATUS_READY = "ready"
STATUS_LOW_CONFIDENCE = "low_confidence"
STATUS_CONFLICT = "conflict"

# 单选/复选的处理方式：**一律不自动填**（"只填不点"，2026-10-05）。
#
# 规则本身不在这里，而在 `engine.skip_reason()`——它先按**控件类型**挡下所有值由
# "点选"产生的控件（下拉 / 单选 / 复选 / 日期 / 弹层选择器），再挡住「我已阅读并同意」
# 这类**同意项**（``CONSENT_HINTS``）与「至今 / 在职」「无…经历」这类**声明项**
# （``CLAIM_LABELS``）。这里曾经反过来：只挡表态类，性别这类事实性单选照常填
# ——那也是当时的维护者定下的边界，2026-10-05 收成了现在这条。
#
# 规则只该有一处：服务层不再按类型补刀，用 `skip_reason` 的说法就行。

# 这条映射是怎么来的。**与 status 正交**：AI 命中的照样可能是 ready / conflict。
SOURCE_RULE = "rule"
SOURCE_AI = "ai"

# AI 命中的行在预览里的说明。**必须写明它是猜的**——规则命中至少证明页面上有字对上了，
# AI 命中可能纯粹是上下文推的，用户核对时的怀疑程度应当不同。
AI_NOTE = "AI 认出来的，请重点核对"


@dataclass
class PreviewItem:
    """一条"将填入"的映射。"""

    index: int
    field: str
    field_label: str
    value: str
    control_label: str
    control_type: str
    status: str = STATUS_READY
    current_value: str = ""
    options: list[dict[str, str]] = field(default_factory=list)
    note: str = ""
    # rule | ai —— 界面据此打「AI 建议」标签，并且**不默认勾选**。
    source: str = SOURCE_RULE


@dataclass
class PendingItem:
    """页面要求、但这一轮不会自动填的控件。"""

    index: int
    label: str
    required: bool = False
    field: str = ""
    field_label: str = ""


@dataclass
class PreviewReport:
    items: list[PreviewItem] = field(default_factory=list)
    missing_data: list[PendingItem] = field(default_factory=list)
    unrecognized: list[PendingItem] = field(default_factory=list)
    blocked: list[PendingItem] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "items": [item.__dict__ for item in self.items],
            "missing_data": [item.__dict__ for item in self.missing_data],
            "unrecognized": [item.__dict__ for item in self.unrecognized],
            "blocked": [item.__dict__ for item in self.blocked],
        }


@dataclass
class FillSelection:
    """用户在预览里确认过的一条选择。"""

    index: int
    field: str
    value: str


def default_selections(report: PreviewReport) -> list[FillSelection]:
    """预览里**默认勾选**的那些条（冲突项与 AI 建议不在其中）。

    AI 建议默认不勾，理由与冲突项同源但方向相反：规则命中至少证明页面上有字对上了，
    AI 命中可能纯粹是上下文推的。**默认不勾的失败形态是"我忘了勾"，默认勾的失败形态是
    "悄悄写了个错值"**——后者正是这个功能一直在防的那类。界面上另给一个「全选 AI 建议」，
    用户想批量采纳仍然只是一次点击。
    """
    return [
        FillSelection(index=item.index, field=item.field, value=item.value)
        for item in report.items
        if item.status != STATUS_CONFLICT and item.source != SOURCE_AI
    ]
