"""填充互斥与执行（_fill_lock / is_filling / apply_fill / _rebuild_mapping）与字段目录查询。"""
from __future__ import annotations

import threading
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ...browser.cdp_client import CdpClient
from .._base import WebFormBadRequest, WebFormConflict
from ..engine import ApplyOutcome, Control, FieldMapping, FormEngine
from ..extra_profile import custom_fields_of
from ..fields import FORM_FIELDS, SOURCE_EXTRA
from ..matching import format_date, meaningful_options, resolve_select_option
from ..repeated_fields import field_key_for_block, split_repeated_key
from ..session import Snapshot
from .models import FillSelection

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
    from ...apply.task_runner import get_task_runner

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
                "options": list(field_item.options),
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
            "options": list(field_item.options),
            "sensitive": field_item.sensitive,
            "matchable": True,
        }
        for field_item in FORM_FIELDS
        if field_item.source == SOURCE_EXTRA
    ]

    if db is not None:
        fields.extend(custom_fields_of(db, groups))

    return {"fields": fields, "groups": groups}


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
        if (
            resolution.status == "no_option"
            and control.linked_select
            and not meaningful_options(control.options)
        ):
            # 联动原生下拉在父级选中前只有占位项；保留映射，填充阶段会重新读取
            # 当前 DOM 的选项，而不是把这条安全的延迟匹配误报成“资料没有”。
            return FieldMapping(control=control, field=field_name, value=text, select=resolution)
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
