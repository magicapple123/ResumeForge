# SPDX-License-Identifier: Apache-2.0
"""条目可见性的**唯一**过滤实现（W06）。

W06 的"隐藏"是**不删除内容**：编辑态（简历详情、大纲、表单、历史、撤销）仍保留原文
与稳定身份，只是不出现在**投递类产物**里——HTML、两种 PDF（精确预览与下载）、Word、
Markdown、TXT、交付 JSON。内部快照（交付记录里的 content 副本）、备份包与工程数据
保留隐藏正文，否则"恢复显示"就变不回来了。

**为什么必须只有这一处实现**：渲染入口有六个（HTML/Markdown/JSON 走 ``exporter.py``，
PDF 走 ``pdf_exporter/fit.py``，Word 走 ``docx_exporter.py``，TXT 复用 Markdown），
每个入口各自写一遍 ``if entry.hidden`` 是"四套渲染器各说各话"的老路——改了一个格式、
漏了另一个，用户看到的就是"预览里没有、下载的 Word 里还在"。这里提供一个纯函数，
六个入口在**开始排版之前**各调用一次，拿到的就是同一份过滤结果。

**过滤发生在导出口，不在保存口**：源内容一个字节都不动。这样隐藏/恢复显示是无损的，
也不会因为一次导出把隐藏正文从数据库里抹掉（那等于"隐藏"变成了"删除"）。
"""

from __future__ import annotations

from typing import Any

from ...schemas.resume import ResumeContent
from .document_identity import ENTRY_FIELDS


def is_hidden_entry(entry: Any) -> bool:
    """这一条是否被用户隐藏。

    三态口径（见 ``schemas/resume_visibility.py``）：只有 ``hidden is True`` 才算隐藏；
    缺省与 ``False`` 都可见——``None`` 表示"旧记录或从未设置"，不是"隐藏"。
    同时接受 pydantic 模型与原始 dict，因为渲染入口拿到的可能是已验证模型，而
    W07/W11 的检查链可能直接看内容 JSON；两种形态必须得到同一个答案。
    """
    if isinstance(entry, dict):
        return entry.get("hidden") is True
    return getattr(entry, "hidden", None) is True


def visible_resume(resume: ResumeContent) -> ResumeContent:
    """返回"投递视角"的简历：六类条目里 ``hidden`` 的那些被剔除，其余原样。

    没有隐藏条目时**原对象原样返回**（不复制）：预览是热路径，而"没有隐藏"是最常见
    的情况——复制一份只为得到同样的内容没有意义。有隐藏条目时用 ``model_copy`` 换掉
    受影响的列表，不就地改入参（调用方可能还要用完整内容做交付快照/内容指纹）。

    返回的是 ``ResumeContent``，所以六个渲染器拿到的仍是既有类型：不需要在每个排版
    函数里增加"这一条要不要跳过"的分支，隐藏条目的空板块也自然不再渲染标题——与
    "该板块本来就没有内容"完全同一条路径。
    """
    updates: dict[str, list[Any]] = {}
    for field in ENTRY_FIELDS:
        entries = getattr(resume, field, None)
        if not entries:
            continue
        kept = [entry for entry in entries if not is_hidden_entry(entry)]
        if len(kept) != len(entries):
            updates[field] = kept
    if not updates:
        return resume
    return resume.model_copy(update=updates)


__all__ = ["is_hidden_entry", "visible_resume"]
