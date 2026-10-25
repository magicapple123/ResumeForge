# SPDX-License-Identifier: Apache-2.0
"""简历自建分区（C2/R-79）的内容结构。

自建大字段在纸面上独立成一栏，与 13 个系统大字段同级，因此需要一份与系统分区
并列的内容结构。它只回答"渲染端要画什么"：分区标题、条目主文本、其余字段的
「标签：值」行——**顺序由投影层冻结**（分区顺序 = 13 系统之后、资料页全局顺序；
条目顺序 = sort_order），渲染端不再排序，与系统分区"顺序由 resume_section_order
决定"是同一口径。

为什么单独一个文件：``schemas/resume.py`` 已贴近 500 行硬预算，本仓库对超预算的
schema 模块沿用"拆文件 + re-export"的先例（resume_entries / resume_research /
resume_generation）。``from app.schemas.resume import ResumeCustomSection`` 的既有
导入路径保持不变。

校验只拦"画不出来"的内容：标题为空、条目既无正文也无标签行、标签为空。标签行
允许空值（投影层本就不会为无值字段生成行），空 ``entries`` 的分区也允许存在——
模板按"跳过空条目的分区"处理，避免把历史内容判成非法而让整个导出 500。
"""

from pydantic import BaseModel, Field, field_validator, model_validator


def _strip_non_blank(value: str, message: str) -> str:
    """去掉首尾空白后仍为空则拒绝；返回值也顺带做规范化（模板不再自己 strip）。"""
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(message)
    return cleaned


class ResumeCustomLine(BaseModel):
    """一条「标签：值」行（自建字段在纸面上的呈现单位）。"""

    label: str = Field(default="", max_length=64)
    value: str = Field(default="", max_length=2000)

    @field_validator("label")
    @classmethod
    def label_must_not_be_blank(cls, value: str) -> str:
        return _strip_non_blank(value, "自定义字段标签不能为空")


class ResumeCustomEntry(BaseModel):
    """自建分区的一条：主文本 + 其余非空字段的「标签：值」行。"""

    entry_id: str = Field(default="", max_length=32)
    text: str = Field(default="", max_length=4000)
    lines: list[ResumeCustomLine] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def text_or_lines_required(self) -> "ResumeCustomEntry":
        if not self.text.strip() and not self.lines:
            raise ValueError("自建条目至少需要正文或一行字段")
        return self


class ResumeCustomSection(BaseModel):
    """一个自建分区：标题 = 大字段名，key 形如 ``custom:<section_id>``。"""

    key: str = Field(default="", max_length=64)
    title: str = Field(default="", max_length=40)
    entries: list[ResumeCustomEntry] = Field(default_factory=list, max_length=200)

    @field_validator("title")
    @classmethod
    def title_must_not_be_blank(cls, value: str) -> str:
        return _strip_non_blank(value, "自建分区标题不能为空")
