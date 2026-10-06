"""快照读取与预览构建（read_snapshot / build_preview / AI 兜底采纳）。"""
from __future__ import annotations

import logging
from typing import Any

from ...browser.cdp_client import CdpClient
from ..engine import (
    Control,
    FieldMapping,
    FormEngine,
    MatchResult,
    excluded_by_hints,
    foreign_marker,
    has_ambiguous_field_evidence,
)
from ..fields import FIELD_LABELS
from ..matching import is_placeholder, resolve_select_option
from ..repeated_fields import (
    compatible_block,
    field_key_for_block,
    field_label_for_key,
    split_repeated_key,
)
from ..session import Snapshot, SnapshotStore, get_snapshot_store
from .fill import _rebuild_mapping, resolve_value_for
from .models import (
    AI_NOTE,
    SOURCE_AI,
    STATUS_CONFLICT,
    STATUS_LOW_CONFIDENCE,
    STATUS_READY,
    STATUS_RELAXED_READY,
    PendingItem,
    PreviewItem,
    PreviewReport,
)
from .relaxed import (
    RELAXED_NOTE,
    _own_text_contains,
    is_relaxed_ai_candidate,
    relaxed_route,
)
from .suggest import _describe, recognize_field, relative_hint

logger = logging.getLogger(__name__)


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
) -> PreviewReport:
    """把"资料 vs 页面控件"算成一份可核对的预览（**纯计算，不碰页面**）。

    ``relaxed`` 是用户在设置里显式开启的「放宽模式」（默认关）：开启时，``skip_reason``
    挡下的点选类控件若能匹配到字段+值，就不再进 ``blocked``，而是以「放宽代选」
    （默认勾选）或「需你确认」（同意/声明类，默认不勾）进入预览行。判类与取值在
    ``service.relaxed``；开关关闭时本函数行为与从前**完全一致**。
    """
    engine = engine or FormEngine()
    result: MatchResult = engine.match_fields(snapshot.controls, data)

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

    for control in result.unmatched:
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


async def enrich_preview_with_ai(
    snapshot: Snapshot,
    data: dict[str, str],
    report: PreviewReport,
    provider: Any,
    *,
    relaxed: bool = False,
) -> int:
    """把规则没认出或置信度不足的控件交给模型复核。

    返回**问过模型**的控件数（0 表示没有可问的，或模型没帮上忙）。

    ``blocked`` 是终局判定，模型没有投票权；``missing_data`` 是"已经认出来了、只是资料里
    没填"，问模型纯属浪费调用。对规则的低置信度结果，模型只作为第二意见；返回不一致时，
    仍要经过本地的区块、选项和日期校验才会替换。

    ``relaxed`` 是「放宽模式」开关（与 ``build_preview`` 同一个值）：开启时，``build_preview``
    记下的放宽 AI 候选（点选类控件、规则没认出字段的那批）也一并交给模型——命中后走
    **放宽代选**语义采纳（``_adopt_ai_relaxed_match``），而不是普通文本写入。关闭时本函数
    行为与从前**完全一致**。

    **失败不抛**：AI 是兜底，它挂了不该让整个预览打不开——回落到今天的行为，用户仍能看到
    「没认出来」那一栏，也仍能用「换个资料…」。所以这里吞掉异常只记 warning，
    ``/preview`` 的 HTTP 面在配了模型和没配模型时完全一样。
    """
    # 惰性导入：``ai`` 会连带拉起 ``services/llm`` 与 ``settings_service``，而本模块是
    # 「网申」包的导入入口之一，不该为了一个可选的兜底把整条依赖链拽进导入期。
    from ..ai import MAX_AI_CONTROLS, identify_fields

    by_index = {control.index: control for control in snapshot.controls}
    low_confidence = {
        item.index: item for item in report.items if item.status == STATUS_LOW_CONFIDENCE
    }
    relaxed_candidates = set(report.relaxed_ai_candidates) if relaxed else set()
    target_indexes: list[int] = []
    for item in report.unrecognized:
        if item.index in by_index and item.index not in target_indexes:
            target_indexes.append(item.index)
    for index in low_confidence:
        if index in by_index and index not in target_indexes:
            target_indexes.append(index)
    for index in report.relaxed_ai_candidates:
        if index in by_index and index not in target_indexes:
            target_indexes.append(index)
    targets = [by_index[index] for index in target_indexes[:MAX_AI_CONTROLS]]
    if not targets:
        return 0

    try:
        matches = await identify_fields(provider, targets)
    except Exception as error:  # noqa: BLE001 - AI 是兜底，挂了不该让预览打不开
        logger.warning("网申表单的 AI 字段识别失败，已回落为本地规则：%s", error)
        return 0

    accepted_matches: dict[int, tuple[str, ...]] = {}
    for index, candidates in sorted(matches.items()):
        control = by_index.get(index)
        if control is None or not candidates:
            continue
        # 采纳前逐个候选过守卫：区块兼容、负向词（"紧急联系人姓名"之于姓名）、
        # 跨族否决（"区号"框之于日期字段）。模型只是兜底，不是绕过这些闸门的许可。
        allowed = tuple(
            key
            for key in candidates
            if compatible_block(key, control.block_family, control.block_index)
            and not excluded_by_hints(control, key)
            and foreign_marker(control, key) is None
        )
        if not allowed:
            continue
        # AI is a fallback, not permission to guess when the page's shared
        # nearby text names several unrelated fields (e.g. 姓名 + 手机号码).
        if has_ambiguous_field_evidence(control):
            continue
        accepted_matches[index] = allowed

    report.unrecognized = [
        item for item in report.unrecognized if item.index not in accepted_matches
    ]
    for index, candidates in sorted(accepted_matches.items()):
        control = by_index[index]
        if index in low_confidence:
            # AI 对低置信规则结果有投票权，但不是最终裁判。
            report.items = [item for item in report.items if item.index != index]
        if index in relaxed_candidates:
            # 放宽候选：命中后按代选语义采纳；采纳不了（值装不下 / 事实类勾选
            # 自述对不上）就留在 blocked，与"AI 不识别"同一结果。
            _adopt_ai_relaxed_match(report, control, candidates[0], data)
            continue
        # 批量模式一行只能有一个字段，取模型排在第一的那个。**其余候选不是丢掉**——
        # 用户在预览里可以改这一行的字段，而「换个资料…」在实时模式下也给得到全部可能。
        # 把第二名也铺成一行会让同一份资料在预览里出现两次，勾选行为就没法解释了。
        _adopt_ai_match(report, control, candidates[0], data)
    # 返回值是"成功送到模型面前的控件数"，**不是"命中的数量"**——模型答 `__none__` 也是
    # 问过了，把它算成 0 会让调用方以为这次没帮上忙而给出误导性的提示。
    return len(targets)


def _adopt_ai_relaxed_match(
    report: PreviewReport, control: Control, field_name: str, data: dict[str, str]
) -> bool:
    """把"AI 说这个点选类框是 X"按**放宽代选**语义落进预览。

    与 ``_adopt_ai_match`` 的分工：那边走普通文本写入（``skip_reason`` 已挡掉点选类），
    这边专为放宽候选服务——AI 只贡献字段名，值仍走 ``resolve_value_for`` 与规则命中
    **同一条路径**；事实类勾选还要过"值必须出现在控件自述里"这道闸。

    返回是否已从 blocked 搬出（``True`` = 进了 items / missing_data；``False`` = 留在
    blocked，与"AI 不识别"同一结果）。
    """
    if has_ambiguous_field_evidence(control):
        return False
    value = resolve_value_for(control, field_name, data)
    kind = FormEngine.relaxed_kind(control)
    if kind == "choice" and (not value or not _own_text_contains(control, value)):
        return False
    shown_field = field_key_for_block(field_name, control.block_family, control.block_index)
    base_field = split_repeated_key(shown_field)[0]
    label = field_label_for_key(shown_field, FIELD_LABELS.get(base_field, base_field))
    report.blocked = [item for item in report.blocked if item.index != control.index]
    report.relaxed_ai_candidates = [
        index for index in report.relaxed_ai_candidates if index != control.index
    ]
    if value:
        report.items.append(
            PreviewItem(
                index=control.index,
                field=shown_field,
                field_label=label,
                value=value,
                control_label=_describe(control),
                control_type=control.type,
                status=STATUS_RELAXED_READY,
                # AI 认出来的字段 + 程序代点：两层都要向用户交代。
                note=f"{AI_NOTE}；{RELAXED_NOTE}",
                source=SOURCE_AI,
            )
        )
    else:
        # 认出来了、资料里没有——与规则命中的措辞一致，如实引导去补值。
        report.missing_data.append(
            PendingItem(
                index=control.index,
                label=_describe(control),
                required=control.required,
                field=shown_field,
                field_label=label,
            )
        )
    return True


def _adopt_ai_match(
    report: PreviewReport, control: Control, field_name: str, data: dict[str, str]
) -> None:
    """把"AI 说这个框是 X"落成预览里的一条。

    取值走 ``_rebuild_mapping``——**与用户手动改值、与填充时是同一条路径**。模型只贡献了
    一个字段名，能不能填、写什么字符串仍由这套纯函数决定。
    """
    if has_ambiguous_field_evidence(control):
        return
    # 「只填不点」在这里兜一道：这类控件根本到不了模型面前（``enrich_preview_with_ai``
    # 只问「没认出来」与低置信两桶），但采纳点自己也不该成为绕过边界的缺口。
    if FormEngine.skip_reason(control) is not None:
        return
    if not compatible_block(field_name, control.block_family, control.block_index):
        return
    shown_field = field_key_for_block(field_name, control.block_family, control.block_index)
    base_field = split_repeated_key(shown_field)[0]
    label = field_label_for_key(shown_field, FIELD_LABELS.get(base_field, base_field))
    lookup_field = shown_field if shown_field in data else field_name
    value = (data.get(lookup_field) or "").strip()
    mapping = _rebuild_mapping(control, shown_field, value) if value else None

    if mapping is not None:
        item = PreviewItem(
            index=control.index,
            field=shown_field,
            field_label=label,
            value=mapping.write_value(),
            control_label=_describe(control),
            control_type=control.type,
            current_value=control.current_display(),
            options=[
                {"value": option.value, "text": option.display()} for option in control.options
            ],
            note=AI_NOTE,
            source=SOURCE_AI,
        )
        # 冲突规则与规则命中**一视同仁**：页面上已经有别的值时不覆盖。
        if control.is_filled() and not _same_value(mapping):
            item.status = STATUS_CONFLICT
            item.note = f"页面上已填“{control.current_display()}”，默认保留它"
        report.items.append(item)
        return

    if not value:
        # 认出来了、资料里没有。与规则命中的那一栏**用完全相同的措辞**——对用户来说
        # "页面要「导师」而你没填"这件事，不因我们是怎么认出来的而不同，该做的事也一样。
        report.missing_data.append(
            PendingItem(
                index=control.index,
                label=_describe(control),
                required=control.required,
                field=shown_field,
                field_label=label,
            )
        )
        return

    # 最尴尬的一种：认出来了、资料里也有，但这个框装不下（下拉没有对应选项、日期解不出来）。
    # **留在「没认出来」里但把原因写清楚**——否则用户看到"没认出来"会以为是模型没帮上忙，
    # 而其实它答对了，是页面选项对不上。
    report.unrecognized.append(
        PendingItem(
            index=control.index,
            label=_describe(control),
            required=control.required,
            field=shown_field,
            field_label=f"AI 认出来是「{label}」，但页面上的选项没有对应的值",
        )
    )


def _mapping_note(mapping: FieldMapping) -> str:
    if mapping.date is not None and mapping.date.assumed_day:
        return mapping.date.reason
    if not mapping.control.label.strip() and mapping.control.nearby_text.strip():
        return "靠控件附近的文字认出来的，请留意"
    return ""


def _same_value(mapping: FieldMapping) -> bool:
    """页面上现在的值，和我们打算写的是不是同一个。"""
    current = (mapping.control.current_display() or "").strip()
    expected = (mapping.value or "").strip()
    if not current:
        return False
    if current == expected:
        return True
    # 下拉：页面上显示的是选项文本，我们手里可能是另一个写法。
    if mapping.control.type == "select" and mapping.control.options:
        resolution = resolve_select_option(mapping.control.options, expected)
        return (
            resolution.status == "matched"
            and resolution.option is not None
            and resolution.option.value == mapping.control.value
        )
    return False
