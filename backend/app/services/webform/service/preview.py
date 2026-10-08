"""快照读取与预览构建（read_snapshot / build_preview）。

AI 兜底采纳（``enrich_preview_with_ai`` / ``_adopt_ai_match`` / ``_adopt_ai_relaxed_match``
/ ``_same_value``）在 ``preview_ai``——规则预览是纯计算、不碰模型，采纳是独立的第二阶段。
本模块按**原命名空间**再导出这几个名字，``service`` 包门面与既有调用方 / 测试的
导入路径零改动；``preview_ai`` 不反向导入本模块，无循环。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...browser.cdp_client import CdpClient
from ..engine import FieldMapping, FormEngine, MatchResult
from ..fields import FIELD_LABELS
from ..matching import is_placeholder
from ..repeated_fields import (
    field_key_for_block,
    field_label_for_key,
    split_repeated_key,
)
from ..session import Snapshot, SnapshotStore, get_snapshot_store
from .models import (
    STATUS_CONFLICT,
    STATUS_LOW_CONFIDENCE,
    STATUS_READY,
    PendingItem,
    PreviewItem,
    PreviewReport,
)
from .preview_ai import (
    _adopt_ai_match as _adopt_ai_match,
)
from .preview_ai import (
    _adopt_ai_relaxed_match as _adopt_ai_relaxed_match,
)
from .preview_ai import (
    _same_value as _same_value,
)
from .preview_ai import (
    enrich_preview_with_ai as enrich_preview_with_ai,
)
from .relaxed import is_relaxed_ai_candidate, relaxed_route
from .relaxed_matching import (
    RELAXED_TEXT_NOTE,
    logical_field_slot,
    relaxed_text_mappings,
)
from .suggest import _describe, recognize_field, relative_hint


def read_snapshot(
    client: CdpClient,
    *,
    store: SnapshotStore | None = None,
    timeout: float | None = None,
) -> tuple[Snapshot, dict[str, Any]]:
    """读取当前页面上的控件清单并存档，返回 ``(快照, 页面信息)``。"""
    payload = client.evaluate(_PAGE_INFO_SCRIPT, timeout=timeout)
    page = payload if isinstance(payload, dict) else {}
    controls = FormEngine().read_controls(client, timeout=timeout)
    snapshot = (store or get_snapshot_store()).save(
        controls,
        url=str(page.get("url", "")),
        title=str(page.get("title", "")),
    )
    return snapshot, {"url": snapshot.url, "title": snapshot.title, "control_count": len(controls)}


# 带标记注释，与其它注入脚本一致——离线测试靠它把不同的调用区分开。
_PAGE_INFO_SCRIPT = "(() => { /* rf:page-info */ return { url: location.href, title: document.title || '' }; })()"


def build_preview(
    snapshot: Snapshot,
    data: dict[str, str],
    *,
    engine: FormEngine | None = None,
    relaxed: bool = False,
    custom_labels: Mapping[str, str] | None = None,
) -> PreviewReport:
    """把"资料 vs 页面控件"算成一份可核对的预览（**纯计算，不碰页面**）。

    ``relaxed`` 是用户在设置里显式开启的「放宽模式」（默认关）：开启时，``skip_reason``
    挡下的点选类控件若能匹配到字段+值，就不再进 ``blocked``，而是以「放宽代选」
    （默认勾选）或「需你确认」（同意/声明类，默认不勾）进入预览行。判类与取值在
    ``service.relaxed``；开关关闭时本函数行为与从前**完全一致**。
    """
    engine = engine or FormEngine()
    result: MatchResult = engine.match_fields(snapshot.controls, data)

    relaxed_text = (
        relaxed_text_mappings(
            result.unmatched,
            data,
            custom_labels=custom_labels,
            engine=engine,
            occupied_indexes={mapping.control.index for mapping in result.mappings},
            occupied_fields={logical_field_slot(mapping.field) for mapping in result.mappings},
        )
        if relaxed
        else []
    )
    relaxed_text_indexes = {mapping.control.index for mapping in relaxed_text}

    report = PreviewReport()
    for mapping in result.mappings:
        control = mapping.control
        item = PreviewItem(
            index=control.index,
            field=mapping.field,
            field_label=field_label_for_key(
                mapping.field,
                FIELD_LABELS.get(split_repeated_key(mapping.field)[0], mapping.field),
            ),
            value=mapping.write_value(),
            control_label=_describe(control),
            control_type=control.type,
            status=STATUS_LOW_CONFIDENCE if mapping.low_confidence else STATUS_READY,
            current_value=control.current_display(),
            options=[
                {"value": option.value, "text": option.display()} for option in control.options
            ],
            note=_mapping_note(mapping),
        )
        # 页面上已经有值、且与我们要写的不同 → 冲突，**默认不勾选**。
        if control.is_filled() and not _same_value(mapping):
            item.status = STATUS_CONFLICT
            item.note = f"页面上已填“{control.current_display()}”，默认保留它"
        report.items.append(item)

    for mapping in relaxed_text:
        base_field, _index = split_repeated_key(mapping.field)
        if mapping.low_confidence:
            report.requires_confirmation.add(mapping.control.index)
        field_label = (
            (custom_labels or {}).get(
                mapping.field, mapping.field.removeprefix("CUSTOM_")
            )
            if mapping.field.startswith("CUSTOM_")
            else field_label_for_key(mapping.field, FIELD_LABELS.get(base_field, base_field))
        )
        report.items.append(
            PreviewItem(
                index=mapping.control.index,
                field=mapping.field,
                field_label=field_label,
                value=mapping.write_value(),
                control_label=_describe(mapping.control),
                control_type=mapping.control.type,
                status=(
                    STATUS_LOW_CONFIDENCE
                    if mapping.low_confidence
                    else STATUS_READY
                ),
                current_value=mapping.control.current_display(),
                note=RELAXED_TEXT_NOTE,
            )
        )

    for control in result.unmatched:
        if control.index in relaxed_text_indexes:
            continue
        label = _describe(control)
        # 下拉 / 单选 / 复选 / 日期 / 弹层选择器到不了这里——``skip_reason`` 在匹配层
        # 就把它们收进 ``result.skipped`` 并给了"需要你自己点选"的说法（见下方循环）。
        #
        # 只是个"请选择"的占位控件：多半是框架渲染的自定义下拉，程序按普通输入框填不进去。
        # 如实说明比归到"没认出来"更有用。
        #
        # **判据必须是"自述文本非空且本身就是占位词"**：自述为空只说明标签在别处（比如相邻
        # 文字里），那是另一回事——早先写成"自述为空也算下拉"，把「请输入您父亲的姓名」
        # 误判成了下拉框。
        own_text = control.own_text().strip()
        if own_text and is_placeholder(own_text):
            report.blocked.append(
                PendingItem(
                    index=control.index,
                    label=label,
                    required=control.required,
                    field_label="这是个下拉选择框，需要你在页面上自己点选",
                )
            )
            continue
        # 问别人的栏目（紧急联系人 / 父母 / 推荐人）：这不是"资料为空"，是刻意不填。
        if hinted := relative_hint(control):
            report.blocked.append(
                PendingItem(
                    index=control.index,
                    label=label,
                    required=control.required,
                    field_label=f"看起来要填别人的信息（{FIELD_LABELS.get(hinted, hinted)}相关），不会自动填",
                )
            )
            continue
        field_name = recognize_field(control)
        if field_name:
            field_name = field_key_for_block(
                field_name, control.block_family, control.block_index
            )
        base_field = split_repeated_key(field_name)[0] if field_name else ""
        pending = PendingItem(
            index=control.index,
            label=label,
            required=control.required,
            field=field_name or "",
            field_label=(
                field_label_for_key(field_name, FIELD_LABELS.get(base_field, base_field))
                if field_name
                else ""
            ),
        )
        # 认得出字段 → 用户知道去资料里补什么；认不出 → 如实说"没认出来"。
        (report.missing_data if field_name else report.unrecognized).append(pending)

    for note in result.skipped:
        if relaxed:
            # 放宽模式：blocked 集合内部放行——能匹配到字段+值的点选类控件进预览行；
            # 认得出字段但资料没值 → missing_data（如实引导去补值）；规则没认出字段的
            # 点选类仍留在 blocked 并记成 AI 兜底候选（enrichment 阶段问模型）；其余
            # （含文件 / 日期 / 密码类等终局判定）仍留在 blocked 并保持原文案。
            route = relaxed_route(note.control, data)
            if route is not None:
                kind, payload = route
                if kind == "row":
                    report.items.append(payload)
                else:
                    report.missing_data.append(payload)
                continue
            if is_relaxed_ai_candidate(note.control):
                report.blocked.append(
                    PendingItem(
                        index=note.control.index,
                        label=_describe(note.control),
                        required=note.control.required,
                        field_label=note.reason,
                    )
                )
                report.relaxed_ai_candidates.append(note.control.index)
                continue
        report.blocked.append(
            PendingItem(
                index=note.control.index,
                label=_describe(note.control),
                required=note.control.required,
                field_label=note.reason,
            )
        )
    return report


def _mapping_note(mapping: FieldMapping) -> str:
    if mapping.date is not None and mapping.date.assumed_day:
        return mapping.date.reason
    if not mapping.control.label.strip() and mapping.control.nearby_text.strip():
        return "靠控件附近的文字认出来的，请留意"
    return ""
