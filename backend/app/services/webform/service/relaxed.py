"""放宽模式（代点下拉与确认勾选）：预览行构建与实时建议。

「只填不点」（2026-10-05）把值由点选产生的控件一律如实列出让用户自己点。放宽模式是
维护者 2026-10-06 定下的边界调整：**把其中一部分选择权交回用户**——用户显式开启后，
程序才尝试代点自定义下拉等弹层控件，并把同意/声明类勾选变成"逐条显式确认"项，以提高
填充率。准确率优先，所以这里的三条纪律不可省：

1. **严格解析**：下拉/弹层选项仍走 ``resolve_select_option``（精确 → 别名 → 包含，
   纯数字不猜），弹层在填充时点开读选项后同样口径；
2. **回读验证**：代点后读回显示值与期望比对，一致才算 filled（engine ``_verify``）；
3. **绝不静默代勾**：同意/声明类只出现在「需确认」行或「帮我勾选」按钮后面，
   用户显式动作即视为本人确认。

本模块只做**分类与取值**（纯计算，不碰页面）；真正的点击、选项读取与回读复用
``engine`` 既有路径（``_apply_select`` / ``select_combobox_option`` / ``_apply_choice``），
不另写一份执行器。
"""
from __future__ import annotations

from ..engine import Control, FormEngine, relaxed_kind
from ..fields import FIELD_LABELS
from ..matching import normalize_option_text
from ..repeated_fields import (
    field_key_for_block,
    field_label_for_key,
    split_repeated_key,
)
from .fill import resolve_value_for
from .models import STATUS_NEEDS_CONFIRM, STATUS_RELAXED_READY, PreviewItem
from .suggest import Suggestion, _describe, recognize_field, relative_hint

# 放宽代选行的说明文案（预览与实时面板共用同一说法，两处各写一份迟早分叉）。
RELAXED_NOTE = "放宽模式：程序将代点，填完请核对"
CONFIRM_NOTE = "同意/声明类：默认不勾，你勾选后才由程序代点"


def _own_text_contains(control: Control, value: str) -> bool:
    """值是否出现在控件**自己说的**文本里（事实类 checkbox/radio 的代点闸门）。

    事实类勾选没有选项列表可解析（每个勾选项就是它自己的标签），只能靠"资料值与
    这个勾选框自述文字对得上"来确认点的是哪一个。只看自述、不看邻近文本——
    邻近文本是别的框也可能共用的，靠它代勾就成猜了。
    """
    needle = normalize_option_text(value)
    if not needle:
        return False
    for text in (control.label, control.placeholder, control.aria_label):
        if needle and needle in normalize_option_text(text):
            return True
    return False


def _resolve_relaxed_value(control: Control, kind: str, data: dict[str, str]) -> tuple[str, str] | None:
    """认字段 + 取值。返回 ``(field_key, value)``；认不出或值装不下返回 ``None``。

    取值走 ``resolve_value_for``——与实时建议、填充重建**同一条路径**，原生下拉在这里
    就完成严格选项解析；弹层控件的选项在填充时才存在，这里只带值，严格解析留给
    ``select_combobox_option``。
    """
    if kind == "confirm":
        return None
    field_name = recognize_field(control)
    if not field_name:
        return None
    value = resolve_value_for(control, field_name, data)
    if not value:
        return None
    if kind == "choice" and not _own_text_contains(control, value):
        return None
    shown_field = field_key_for_block(field_name, control.block_family, control.block_index)
    return shown_field, value


def relaxed_preview_item(control: Control, data: dict[str, str]) -> PreviewItem | None:
    """放宽模式下把一个被 ``skip_reason`` 挡住的控件整理成预览行；整理不出返回 ``None``。

    调用方（``build_preview``）只在开关开启时调用，且只喂 ``result.skipped`` 里的控件
    ——放宽只会在 blocked 集合**内部**放行，不扩大匹配的边界。
    """
    kind = relaxed_kind(control)
    if kind is None:
        return None
    # 问别人的栏目即使在放宽模式下也不代填：那不是"资料为空"，是刻意不填。
    if relative_hint(control):
        return None
    if kind == "confirm":
        label = control.label.strip() or _describe(control)
        return PreviewItem(
            index=control.index,
            field="",
            field_label=label,
            value=label,
            control_label=_describe(control),
            control_type=control.type,
            status=STATUS_NEEDS_CONFIRM,
            note=CONFIRM_NOTE,
        )
    resolved = _resolve_relaxed_value(control, kind, data)
    if resolved is None:
        return None
    shown_field, value = resolved
    base_field = split_repeated_key(shown_field)[0]
    return PreviewItem(
        index=control.index,
        field=shown_field,
        field_label=field_label_for_key(shown_field, FIELD_LABELS.get(base_field, base_field)),
        value=value,
        control_label=_describe(control),
        control_type=control.type,
        status=STATUS_RELAXED_READY,
        # 原生下拉的选项原样带上：用户可以在预览里把值改成页面上真正存在的另一项，
        # 与 ready 行的手改能力一致。
        options=[
            {"value": option.value, "text": option.display()} for option in control.options
        ],
        note=RELAXED_NOTE,
    )


def relaxed_suggestion(
    control: Control, data: dict[str, str], *, engine: FormEngine | None = None
) -> Suggestion | None:
    """实时面板的放宽建议；不适用返回 ``None``（调用方沿用原 blocked 文案）。

    - 下拉 / 弹层 / 事实类勾选：给出「代点选择」建议，用户点「填入」即执行；
    - 同意 / 声明类：``accept_label`` 带上字段名（如「帮我勾选：我已阅读并同意隐私政策」），
      **点按即视为用户本人确认**。
    """
    del engine  # 与 suggest_for 同签名；匹配判据在 recognize_field/resolve_value_for 里
    kind = relaxed_kind(control)
    if kind is None:
        return None
    if relative_hint(control):
        return None
    if kind == "confirm":
        label = control.label.strip() or _describe(control)
        return Suggestion(
            "matched",
            field="",
            field_label=label,
            value=label,
            note=f"{CONFIRM_NOTE}，点按即视为你本人确认",
            accept_label=f"帮我勾选：{label}",
        )
    resolved = _resolve_relaxed_value(control, kind, data)
    if resolved is None:
        return None
    shown_field, value = resolved
    base_field = split_repeated_key(shown_field)[0]
    return Suggestion(
        "matched",
        field=shown_field,
        field_label=field_label_for_key(shown_field, FIELD_LABELS.get(base_field, base_field)),
        value=value,
        note=RELAXED_NOTE,
    )
