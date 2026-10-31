# SPDX-License-Identifier: Apache-2.0
"""DocumentPlan 输出结构（planner -> 四出口的唯一数据形状）。

从 schemas/resume_document.py 拆出的唯一原因是单文件 500 行预算；这些模型与 v2 文档模型
是两组消费者：resume_document 描述“存什么”，本文件描述“画什么”（Inline/Cell/Block/
Head/Entry/Section/Header/DocumentPlan）。resume_document 仍 re-export 本文件的全部名字，
既有导入路径不变。
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .resume_document import (
    BodyStyle,
    EntryLayout,
    HeadLayout,
    SectionKind,
    SectionLayout,
)

__all__ = [
    "BlockPlan",
    "CellPlan",
    "DocumentPlan",
    "EntryPlan",
    "HeadPlan",
    "HeaderPlan",
    "Inline",
    "SectionPlan",
]


# 计划输出结构（DocumentPlan）放在 document_plan.py；这里定义纯数据模型，避免 planner
# 与渲染器各建一套（模板/PDF/Word/Markdown 共享同一份 shape）。
class Inline(BaseModel):
    text: str = ""
    role: str = "body"
    strong: bool = False
    italic: bool = False
    link: str | None = None
    path: str = ""


class CellPlan(BaseModel):
    segments: list[Inline] = Field(default_factory=list)
    solo: bool = False


class BlockPlan(BaseModel):
    kind: BodyStyle = "bullet"
    segments: list[Inline] = Field(default_factory=list)
    path: str = ""


class HeadPlan(BaseModel):
    layout: HeadLayout = "split"
    title: list[Inline] = Field(default_factory=list)
    meta: list[Inline] = Field(default_factory=list)
    path: str = ""


class EntryPlan(BaseModel):
    id: str = ""
    # 生效布局（分区默认叠上条目覆盖），渲染器不再自己算继承。
    layout: EntryLayout = Field(default_factory=EntryLayout)
    head: HeadPlan = Field(default_factory=HeadPlan)
    lead_rows: list[list[CellPlan]] = Field(default_factory=list)
    body: list[BlockPlan] = Field(default_factory=list)
    trail_rows: list[list[CellPlan]] = Field(default_factory=list)


class SectionPlan(BaseModel):
    key: str = ""
    title: str = ""
    kind: SectionKind = "entries"
    layout: SectionLayout = Field(default_factory=SectionLayout)
    entries: list[EntryPlan] = Field(default_factory=list)
    # inline kind：每个元素是一个条目的已拼好段落（条目之间由 renderer 用 row_separator
    # 连接；row_separator 由 planner 按语言给定，renderer 不写语言文案）。
    rows: list[list[CellPlan]] = Field(default_factory=list)
    row_separator: str = ""


class HeaderPlan(BaseModel):
    name: list[Inline] = Field(default_factory=list)
    name_meta: list[Inline] = Field(default_factory=list)
    subtitle: list[Inline] = Field(default_factory=list)
    contact_lines: list[list[Inline]] = Field(default_factory=list)
    photo: str | None = None


class DocumentPlan(BaseModel):
    language: str = "zh-CN"
    header: HeaderPlan = Field(default_factory=HeaderPlan)
    sections: list[SectionPlan] = Field(default_factory=list)
