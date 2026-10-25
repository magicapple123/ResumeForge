# SPDX-License-Identifier: Apache-2.0
"""条目/要点可见性的**唯一**过滤实现（W06）。

W06 的"隐藏"是**不删除内容**：编辑态（简历详情、大纲、表单、历史、撤销）仍保留原文
与稳定身份，只是不出现在**投递类产物**里——HTML、两种 PDF（精确预览与下载）、Word、
Markdown、TXT、交付 JSON。内部快照（交付记录里的 content 副本）、备份包与工程数据
保留隐藏正文，否则"恢复显示"就变不回来了。

**要点级隐藏**（hidden_points）与条目级 hidden 是同一语义的两层：条目的
hidden_points 存 point_ids 映射里的要点 id（不是下标），这里按 id 把对应要点从
POINT_FIELDS 声明的数组里剔除，并同步裁剪 point_ids 映射，保证"数组与 id 等长"
这条不变量在过滤结果里继续成立。旧记录没有 point_ids 时无从定位，该字段不生效
（不猜、不按顺序号回填——那会把隐藏挂到错误的要点上）。

**为什么必须只有这一处实现**：渲染入口有六个（HTML/Markdown/JSON 走 exporter.py，
PDF 走 pdf_exporter/fit.py，Word 走 docx_exporter.py，TXT 复用 Markdown），每个入口
各自写一遍 if entry.hidden 是"四套渲染器各说各话"的老路——改了一个格式、漏了另一个，
用户看到的就是"预览里没有、下载的 Word 里还在"。这里提供一个纯函数，六个入口在
**开始排版之前**各调用一次，拿到的就是同一份过滤结果。

**过滤发生在导出口，不在保存口**：源内容一个字节都不动。这样隐藏/恢复显示是无损的，
也不会因为一次导出把隐藏正文从数据库里抹掉（那等于"隐藏"变成了"删除"）。
"""

from __future__ import annotations

from typing import Any

from ...schemas.resume import ResumeContent
from .document_identity import ENTRY_FIELDS, POINT_FIELDS


def _field(entry: Any, name: str) -> Any:
    """同时接受 pydantic 模型与原始 dict（检查链可能直接看内容 JSON）。"""
    if isinstance(entry, dict):
        return entry.get(name)
    return getattr(entry, name, None)


def is_hidden_entry(entry: Any) -> bool:
    """这一条是否被用户隐藏。

    三态口径（见 schemas/resume_visibility.py）：只有 hidden is True 才算隐藏；
    缺省与 False 都可见——None 表示"旧记录或从未设置"，不是"隐藏"。
    同时接受 pydantic 模型与原始 dict，因为渲染入口拿到的可能是已验证模型，而
    W07/W11 的检查链可能直接看内容 JSON；两种形态必须得到同一个答案。
    """
    return _field(entry, "hidden") is True


def hidden_point_ids(entry: Any) -> frozenset[str]:
    """这条条目的隐藏要点 id 集合；没设置/空列表返回空集（旧记录零成本）。"""
    values = _field(entry, "hidden_points")
    if not isinstance(values, (list, tuple)):
        return frozenset()
    return frozenset(value for value in values if isinstance(value, str))


def is_hidden_point(entry: Any, point_id: str) -> bool:
    """某个要点 id 是否被隐藏（调用方通常先取 hidden_point_ids 批量判断）。"""
    return isinstance(point_id, str) and point_id in hidden_point_ids(entry)


def _visible_entry(entry: Any, field: str) -> Any:
    """裁掉这一条里被隐藏的要点；没有可裁的返回原对象（不复制）。"""
    hidden = hidden_point_ids(entry)
    if not hidden:
        return entry
    point_fields = POINT_FIELDS.get(field, ())
    if not point_fields:
        return entry
    point_ids = _field(entry, "point_ids")
    mapping = dict(point_ids) if isinstance(point_ids, dict) else {}
    updates: dict[str, Any] = {}
    trimmed = False
    for key in point_fields:
        values = _field(entry, key)
        if not isinstance(values, list) or not values:
            continue
        ids = mapping.get(key)
        if not isinstance(ids, list) or len(ids) != len(values):
            # 数组与 id 不等长：定位不可信。宁可整段保留，也不按位置猜。
            continue
        pairs = zip(values, ids, strict=True)
        kept = [(value, point_id) for value, point_id in pairs if point_id not in hidden]
        if len(kept) == len(values):
            continue
        updates[key] = [value for value, _point_id in kept]
        mapping[key] = [point_id for _value, point_id in kept]
        trimmed = True
    if not trimmed:
        return entry
    updates["point_ids"] = mapping
    if isinstance(entry, dict):
        return {**entry, **updates}
    return entry.model_copy(update=updates)


def visible_resume(resume: ResumeContent) -> ResumeContent:
    """返回"投递视角"的简历：隐藏条目剔除、隐藏要点从对应数组里裁掉，其余原样。

    没有隐藏条目/要点时**原对象原样返回**（不复制）：预览是热路径，而"没有隐藏"是最
    常见的情况——复制一份只为得到同样的内容没有意义。有变化时用 model_copy 换掉受影响
    的列表，不就地改入参（调用方可能还要用完整内容做交付快照/内容指纹）。

    返回的是 ResumeContent，所以六个渲染器拿到的仍是既有类型：不需要在每个排版函数里
    增加"这一条要不要跳过"的分支，隐藏条目的空板块也自然不再渲染标题——与"该板块本来
    就没有内容"完全同一条路径。
    """
    updates: dict[str, list[Any]] = {}
    for field in ENTRY_FIELDS:
        entries = getattr(resume, field, None)
        if not entries:
            continue
        kept = []
        changed = False
        for entry in entries:
            if is_hidden_entry(entry):
                changed = True
                continue
            visible = _visible_entry(entry, field)
            if visible is not entry:
                changed = True
            kept.append(visible)
        if changed:
            updates[field] = kept
    if not updates:
        return resume
    return resume.model_copy(update=updates)


__all__ = [
    "hidden_point_ids",
    "is_hidden_entry",
    "is_hidden_point",
    "visible_resume",
]
