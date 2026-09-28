"""网申填表的编排：读表单 → 预览 → 填充。

三段彼此独立，中间靠 ``session.SnapshotStore`` 串起来：

1. ``read_snapshot`` 读当前标签页的控件清单并存档；
2. ``build_preview`` 只做计算、**不碰页面**，产出"哪些能填、哪些需要你补、哪些永不自动填"；
3. ``apply_fill`` 严格按用户确认过的那份选择写入，并逐条回读校验。

**不覆盖用户已填的值**：预览里把这种标成 ``conflict`` 且默认不勾选。页面上的值可能是
用户上一轮填了一半的草稿，在"点提交之前"覆盖它是用户看不见的破坏。
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ..browser.cdp_client import CdpClient
from ._base import WebFormBadRequest, WebFormConflict
from .engine import ApplyOutcome, Control, FieldMapping, FormEngine, MatchResult, evidence_key
from .extra_profile import custom_fields_of
from .fields import (
    FIELD_LABELS,
    FIELD_SYNONYMS,
    FORM_FIELDS,
    RELATIVE_HINTS,
    SOURCE_EXTRA,
)
from .matching import (
    format_date,
    is_placeholder,
    normalize_option_text,
    resolve_select_option,
)
from .repeated_fields import (
    compatible_block,
    field_key_for_block,
    field_label_for_key,
    split_repeated_key,
)
from .session import Snapshot, SnapshotStore, get_snapshot_store

logger = logging.getLogger(__name__)

# 预览里一条映射的状态。
STATUS_READY = "ready"
STATUS_LOW_CONFIDENCE = "low_confidence"
STATUS_CONFLICT = "conflict"

# 单选/复选的处理方式：**只挡表态类，不挡事实类**。
#
# 规则本身不在这里，而在 `engine.skip_reason()`——它认得出「我已阅读并同意」这类
# **同意项**（``CONSENT_HINTS``）、「至今 / 在职」与「无…经历」这类**声明项**
# （``CLAIM_LABELS``），那些永不代勾。**性别、政治面貌这类事实性的单选照常填**。
#
# 这里曾经额外加过一条"单选/复选一律不填"，那是**过宽**的：`skip_reason` 已经把
# 表态类挡住并给出具体理由（"涉及「同意」的确认项，需要你本人勾选"），再按控件类型
# 一刀切只会把性别这种能填的也挡掉。规则只该有一处。

# 这条映射是怎么来的。**与 status 正交**：AI 命中的照样可能是 ready / conflict。
SOURCE_RULE = "rule"
SOURCE_AI = "ai"

# AI 命中的行在预览里的说明。**必须写明它是猜的**——规则命中至少证明页面上有字对上了，
# AI 命中可能纯粹是上下文推的，用户核对时的怀疑程度应当不同。
AI_NOTE = "AI 认出来的，请重点核对"

# 同一时刻只允许一次填充：两个请求交错会往同一个页面里写两套值。
_fill_lock = threading.Lock()


def is_filling() -> bool:
    """当前是否有填充正在进行（供投递链路做互斥）。"""
    return _fill_lock.locked()


def is_apply_running() -> bool:
    """投递/采集任务是否在跑。

    两条链路会驱动**同一个受控浏览器窗口**，同时跑会互相抢页面。这里做单向检查
    （填充前看投递），反向的那一半在 ``apply/_tasks.py`` 里（建批次前看填充）——
    两套互斥各管一头，两边都要有才闭合。**残留风险**：先点「开始投递」再立刻点「填充」
    时，检查通过后投递线程才起来。窗口极小但存在，所以文档里也写明了不要同时用。
    """
    from ..apply.task_runner import get_task_runner

    try:
        return get_task_runner().is_running()
    except Exception:  # noqa: BLE001 - 取不到运行器不该拦住填充
        return False


def list_fields() -> dict[str, Any]:
    """字段目录（供界面渲染录入表单）。"""
    groups: list[str] = []
    for field_item in FORM_FIELDS:
        if field_item.group not in groups:
            groups.append(field_item.group)
    return {
        "fields": [
            {
                "key": field_item.key,
                "label": field_item.label,
                "group": field_item.group,
                "kind": field_item.kind,
                "sensitive": field_item.sensitive,
            }
            for field_item in FORM_FIELDS
        ],
        "groups": groups,
    }


def list_extra_fields(db: Session | None = None) -> dict[str, Any]:
    """「网申资料」要用户自己录的那批字段（``source="extra"``）。

    与 ``list_fields()`` 共用同一份目录，只是筛出 ``extra`` 那一批——**加字段仍然只改
    ``fields.py`` 一处**，两个界面同时生效。

    ``db`` 给了就**再把库里攒出来的自定义字段并进去**（``CUSTOM_`` 前缀那些）。它们没有
    目录条目，但用户记下了就得在「网申资料」里看得见、改得掉、删得掉——只存在库里而界面
    不显示，等于"记住了却找不着"，那比不记还糟。

    自定义字段统一归到 ``自定义`` 那一组（放最后），``kind`` 给 ``text``：它们是用户在填表
    时攒的，没有目录里那份"这是长文本还是电话"的信息。``matchable=False`` 是给界面看的
    ——**它们不参与自动匹配**（理由见 ``extra_profile`` 模块说明），界面据此不要承诺
    "下次自动填"。
    """
    groups: list[str] = []
    for field_item in FORM_FIELDS:
        if field_item.source != SOURCE_EXTRA:
            continue
        if field_item.group not in groups:
            groups.append(field_item.group)

    fields: list[dict[str, Any]] = [
        {
            "key": field_item.key,
            "label": field_item.label,
            "group": field_item.group,
            "kind": field_item.kind,
            "sensitive": field_item.sensitive,
            "matchable": True,
        }
        for field_item in FORM_FIELDS
        if field_item.source == SOURCE_EXTRA
    ]

    if db is not None:
        fields.extend(custom_fields_of(db, groups))

    return {"fields": fields, "groups": groups}


def _describe(control: Control) -> str:
    """给用户看的"这是页面上的哪个框"。"""
    for candidate in (control.label, control.placeholder, control.aria_label):
        if candidate.strip():
            return candidate.strip()
    if control.nearby_text.strip():
        return control.nearby_text.strip()[:40]
    return control.name or f"第 {control.index + 1} 个控件"


def recognize_field(control: Control) -> str | None:
    """这个控件能看出是哪个字段吗（不看有没有值）。

    用于把"认得出字段但资料为空"和"压根认不出"分开——前者用户知道该去补什么，
    后者只能如实说"没认出来"，并**交给 AI 兜底**。

    **判据与引擎的 ``_rank_controls`` 共用 ``evidence_key``，不能各写一份。**
    先前这里按"签名里最长的那个同义词"一维比较，于是「导师」框的旁文里装着邻居的
    「研究方向」，4 字压过自己的 2 字 → 报成「研究方向」。那不只是显示错：调用方看到
    "认得出"就直接返回、不再问模型，**认错反而把 AI 兜底挡在了门外**。
    """
    best_field = ""
    best_key = (0, 0)
    for field_name, synonyms in FIELD_SYNONYMS.items():
        if not compatible_block(field_name, control.block_family, control.block_index):
            continue
        key = evidence_key(control, field_name, synonyms)
        if key is not None and key > best_key:
            best_field, best_key = field_name, key
    return best_field or None


def relative_hint(control: Control) -> str:
    """这个控件是不是**问别人**的（紧急联系人 / 父母 / 推荐人…）。命中就返回那个词。

    单独拎出来是因为它和"资料为空"完全不同：用户不是没填，而是**这本来就不该由资料回答**。
    混为一谈会让界面写出"你的姓名没填"这种让人困惑的提示。

    **只能用 ``RELATIVE_HINTS``**，不能用 ``FIELD_EXCLUDE_HINTS``：后者是各字段自己的
    排除词表，里面混着"这个框不是那个字段"这类语义（例如 ``phone_country_code`` 的
    ("手机", "号码")），拿它判断"是否在问别人"会把「手机号」误判成亲属栏。
    """
    signature = control.signature()
    # “内推码/推荐人”是求职者自己的招聘来源字段，不是让程序代填他人的个人信息。
    # 只有出现内推/推荐码语境时才放行；单独的“推荐人姓名/联系电话”仍按他人信息拦截。
    if any(token in signature for token in ("内推码", "推荐码", "内推编号", "内推人")):
        return ""
    return next((word for word in RELATIVE_HINTS if word in signature), "")


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
) -> PreviewReport:
    """把"资料 vs 页面控件"算成一份可核对的预览（**纯计算，不碰页面**）。"""
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
        # 勾选/单选类：目录里没有任何字段是"勾选值"，所以**未匹配到的勾选一定不该由程序动**。
        # 它们通常是"接受调剂""服从分配"这类**表态**，与同意条款同性质，交给用户自己决定。
        # 放进「没认出来」是错的——那个措辞会让人以为程序没看懂，其实是刻意不碰。
        if control.type in ("checkbox", "radio"):
            report.blocked.append(
                PendingItem(
                    index=control.index,
                    label=label,
                    required=control.required,
                    field_label="这是个勾选项（多为表态或声明），需要你自己判断",
                )
            )
            continue
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
) -> int:
    """把规则没认出或置信度不足的控件交给模型复核。

    返回**问过模型**的控件数（0 表示没有可问的，或模型没帮上忙）。

    ``blocked`` 是终局判定，模型没有投票权；``missing_data`` 是"已经认出来了、只是资料里
    没填"，问模型纯属浪费调用。对规则的低置信度结果，模型只作为第二意见；返回不一致时，
    仍要经过本地的区块、选项和日期校验才会替换。

    **失败不抛**：AI 是兜底，它挂了不该让整个预览打不开——回落到今天的行为，用户仍能看到
    「没认出来」那一栏，也仍能用「换个资料…」。所以这里吞掉异常只记 warning，
    ``/preview`` 的 HTTP 面在配了模型和没配模型时完全一样。
    """
    # 惰性导入：``ai`` 会连带拉起 ``services/llm`` 与 ``settings_service``，而本模块是
    # 「网申」包的导入入口之一，不该为了一个可选的兜底把整条依赖链拽进导入期。
    from .ai import MAX_AI_CONTROLS, identify_fields

    by_index = {control.index: control for control in snapshot.controls}
    low_confidence = {
        item.index: item for item in report.items if item.status == STATUS_LOW_CONFIDENCE
    }
    target_indexes: list[int] = []
    for item in report.unrecognized:
        if item.index in by_index and item.index not in target_indexes:
            target_indexes.append(item.index)
    for index in low_confidence:
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

    report.unrecognized = [item for item in report.unrecognized if item.index not in matches]
    for index, candidates in sorted(matches.items()):
        control = by_index.get(index)
        if control is None or not candidates:
            continue
        if not compatible_block(candidates[0], control.block_family, control.block_index):
            continue
        if index in low_confidence:
            # AI 对低置信规则结果有投票权，但不是最终裁判。
            report.items = [item for item in report.items if item.index != index]
        # 批量模式一行只能有一个字段，取模型排在第一的那个。**其余候选不是丢掉**——
        # 用户在预览里可以改这一行的字段，而「换个资料…」在实时模式下也给得到全部可能。
        # 把第二名也铺成一行会让同一份资料在预览里出现两次，勾选行为就没法解释了。
        _adopt_ai_match(report, control, candidates[0], data)
    # 返回值是"成功送到模型面前的控件数"，**不是"命中的数量"**——模型答 `__none__` 也是
    # 问过了，把它算成 0 会让调用方以为这次没帮上忙而给出误导性的提示。
    return len(targets)


def _adopt_ai_match(
    report: PreviewReport, control: Control, field_name: str, data: dict[str, str]
) -> None:
    """把"AI 说这个框是 X"落成预览里的一条。

    取值走 ``_rebuild_mapping``——**与用户手动改值、与填充时是同一条路径**。模型只贡献了
    一个字段名，能不能填、写什么字符串仍由这套纯函数决定。
    """
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


def apply_fill(
    client: CdpClient,
    snapshot: Snapshot,
    selections: Iterable[FillSelection],
    *,
    engine: FormEngine | None = None,
    timeout: float | None = None,
) -> list[ApplyOutcome]:
    """按用户确认过的选择写入页面。

    ``selections`` 里出现快照中不存在的控件索引一律拒绝——那说明前端的预览与后端这份
    快照对不上了，继续写就是往未知的框里填值。
    """
    engine = engine or FormEngine()
    by_index = {control.index: control for control in snapshot.controls}
    mappings: list[FieldMapping] = []
    for selection in selections:
        control = by_index.get(selection.index)
        if control is None:
            raise WebFormBadRequest(
                f"页面上的第 {selection.index + 1} 个控件已不在这次读取的表单里，请重新读取"
            )
        mapping = _rebuild_mapping(control, selection.field, selection.value)
        if mapping is None:
            # 值对不上页面的选项（例如联动下拉换了内容）——跳过并如实说明，不硬填。
            continue
        mappings.append(mapping)

    if not _fill_lock.acquire(blocking=False):
        raise WebFormConflict("另一次填充正在进行，请稍候")
    try:
        return engine.apply(client, mappings, timeout=timeout)
    finally:
        _fill_lock.release()


def _rebuild_mapping(control: Control, field_name: str, value: str) -> FieldMapping | None:
    """把用户在预览里给的值重新整理成可写入的形状（下拉要重新落到某个选项上）。"""
    text = (value or "").strip()
    if not text:
        return None
    if control.type == "select":
        resolution = resolve_select_option(control.options, text)
        if resolution.status != "matched":
            return None
        return FieldMapping(control=control, field=field_name, value=text, select=resolution)
    if control.type in ("date", "month"):
        resolution = format_date(text, kind=control.type)
        if resolution.status != "matched":
            return None
        return FieldMapping(control=control, field=field_name, value=text, date=resolution)
    return FieldMapping(control=control, field=field_name, value=text)


def resolve_value_for(control: Control, field_name: str, data: dict[str, str]) -> str:
    """资料里 ``field_name`` 的值，整理成**这个控件真正能接受的字符串**。

    整理不出来时返回空串。两种情况要分得开，调用方靠"资料里到底有没有这一项"来区分：
    资料里没有（用户还没填）／资料里有但这个框装不下（下拉没这个选项、日期解不出来）。

    走的是 ``_rebuild_mapping``——**与用户手动改值、与真正写入时是同一条路径**，
    所以"面板上显示的值"和"填进去的值"不可能对不上。
    """
    base_field, explicit_index = split_repeated_key(field_name)
    dynamic_field = field_key_for_block(
        base_field, control.block_family, control.block_index
    )
    lookup_key = field_name
    if explicit_index is None and dynamic_field in data:
        lookup_key = dynamic_field
    value = (data.get(lookup_key) or data.get(field_name) or "").strip()
    if not value:
        return ""
    mapping = _rebuild_mapping(control, lookup_key, value)
    return mapping.write_value() if mapping is not None else ""


# 国际区号：`+86` / `+1` / `+886` 这种形状（框里现有的值就是它）。
_DIAL_CODE_RE = re.compile(r"^\+\d{1,3}$")


@dataclass
class Suggestion:
    """「点哪个填哪个」模式下，对一个控件的判定。"""

    status: str  # matched | blocked | unmatched
    field: str = ""
    field_label: str = ""
    value: str = ""
    note: str = ""


def suggest_for(
    control: Control, data: dict[str, str], *, engine: FormEngine | None = None
) -> Suggestion:
    """就**一个**控件算出该填什么（点哪个填哪个模式的核心）。

    与批量模式共用同一套匹配器与同一套"永不自动填"的判据——两份实现就会分叉。
    """
    engine = engine or FormEngine()

    reason = engine.skip_reason(control)
    if reason:
        return Suggestion("blocked", note=reason, field_label="不会自动填")
    # 单选/复选**不在这里按类型一刀切**——「只挡表态类」的判据是 `skip_reason`，上面已经
    # 过了一遍。（实时模式实际压根不会把选择框报进焦点——注入脚本的 `allowed` 白名单里
    # 没有它们——所以这里按类型再挡一次既够不到、又和那条判据说法不一。）
    if hinted := relative_hint(control):
        return Suggestion(
            "blocked",
            note="看起来要填别人的信息",
            field_label=f"他人信息（{FIELD_LABELS.get(hinted, hinted)}相关）",
        )

    # 区号框：**框里现有值本身就是判据**（`+86`、`+1` 这种形状）。
    #
    # 只看文本认不出它——字节那个区号框的上下文里反而含「手机号码*」，于是会被建议填
    # 完整手机号（实测到的）。而"当前值是个国际区号"这件事是它自己说的，比任何旁文都硬。
    if _DIAL_CODE_RE.match(control.value.strip()) and data.get("phone_country_code"):
        return Suggestion(
            "matched",
            field="phone_country_code",
            field_label=FIELD_LABELS.get("phone_country_code", "手机区号"),
            value=data["phone_country_code"],
        )

    result = engine.match_fields([control], data)
    if not result.mappings:
        # 没匹配上的选择框**不是"没认出来"**：目录里压根没有"勾选值"这种字段，
        # 「接受其他职位调剂」这类本来就该由用户表态。归到「没认出来」会让人以为程序
        # 没看懂——其实是刻意不碰。批量模式早就这么分了，这里用同一句话。
        if control.type in ("radio", "checkbox"):
            return Suggestion(
                "blocked",
                note="这是选项框，需要你自己点选",
                field_label="需要你自己点",
            )
        return Suggestion("unmatched", note="没认出来这个框要填什么")

    mapping = result.mappings[0]
    note = ""
    if mapping.date is not None and mapping.date.assumed_day:
        note = mapping.date.reason
    base_field, _index = split_repeated_key(mapping.field)
    return Suggestion(
        "matched",
        field=mapping.field,
        field_label=field_label_for_key(
            mapping.field, FIELD_LABELS.get(base_field, base_field)
        ),
        value=mapping.write_value(),
        note=note,
    )


# 「可能是这几个」最多列几条。太多了就失去"一眼扫完"的意义。
RELATED_LIMIT = 5


def related_entries(
    control: Control, catalog: Iterable[dict[str, str]], *, limit: int = RELATED_LIMIT
) -> list[dict[str, str]]:
    """按**当前控件的文字**从清单里挑最像的几条，供「换个资料…」置顶。

    为什么值得做：「换个资料…」是程序认不出或认错时才打开的，而清单通常有几十条、
    面板只露得下八九行——用户得滚着找或打字搜。但**"他此刻点在哪个框"本身就是个强信号**，
    多数情况下要找的就是其中一条。

    **判据复用 `engine.evidence_key` 和同一份 `FIELD_SYNONYMS`**，不另写一套文本相似度。
    这个仓库吃过"两份匹配实现各自分叉"的亏：``recognize_field`` 与 ``_rank_controls``
    曾经各写一份，同一个框在批量预览和实时面板里认成两个字段（记在
    ``engine.evidence_key`` 的注释里）。

    **只排顺序、不做取舍。** 没进前几名的条目仍然在下面的完整清单里，一条都没少——
    所以这里判错一条的代价只是"多看一眼"，不会让人找不到东西。
    """
    signature = normalize_option_text(control.signature())
    ranked: list[tuple[int, int, dict[str, str]]] = []
    for entry in catalog:
        label = str(entry.get("label") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not label or not value:
            continue
        key = str(entry.get("key") or "")
        synonyms = FIELD_SYNONYMS.get(key, ())
        if synonyms:
            evidence = evidence_key(control, key, synonyms)
            if evidence is not None:
                ranked.append((evidence[0], evidence[1], entry))
            continue
        # 子表里有几个字段**没有同义词表**（工作内容、项目描述、担任角色…），退回按标签
        # 本身比：只认"控件的文字里明确出现了这个标签"，不做模糊。这里只是排序，但把
        # 不相干的推到顶上照样是帮倒忙。
        normalized = normalize_option_text(label)
        if normalized and normalized in signature:
            ranked.append((1, len(normalized), entry))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [
        {
            "group": str(entry.get("group") or ""),
            "label": str(entry.get("label") or ""),
            "value": str(entry.get("value") or ""),
        }
        for _tier, _score, entry in ranked[:limit]
    ]


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


__all__ = [
    "AI_NOTE",
    "SOURCE_AI",
    "list_extra_fields",
    "SOURCE_RULE",
    "STATUS_CONFLICT",
    "STATUS_LOW_CONFIDENCE",
    "STATUS_READY",
    "FillSelection",
    "PendingItem",
    "PreviewItem",
    "PreviewReport",
    "Suggestion",
    "apply_fill",
    "build_preview",
    "default_selections",
    "enrich_preview_with_ai",
    "is_apply_running",
    "is_filling",
    "list_fields",
    "read_snapshot",
    "recognize_field",
    "resolve_value_for",
    "suggest_for",
]
