# SPDX-License-Identifier: Apache-2.0
"""编辑器视图 DTO（F10/R-82）：简历创建时冻结的「可见板块 + 可见字段」只读清单。

**为什么单独成模块且只 import pydantic**：`schemas/resume.py` 会 import
`resume_profile_usage.ProfileUsageOut`，而后者要暴露本 DTO；若本模块反向 import
`schemas.resume` 就会形成 resume ⇄ resume_profile_usage 的循环导入（计划 §2 的红线）。
因此这里只描述纯数据形状，不引用任何简历正文模型。

**语义**：这份视图只表达「当时方案允许的可见定义」——隐藏字段在消费 DTO 读取时已被
裁掉，所以 `fields` 天然只含可见字段；`resume_attr` 是编辑器把它写进 ResumeContent
的属性名，None = 编辑器没有独立输入框（仅素材 / 私密 / 自定义字段 / 承载区追加）。
已保存简历用创建时冻结的副本渲染，方案之后怎么改都不影响它。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EditorFieldOut(BaseModel):
    """一个可见字段：稳定 id + 定义顺序 + 它在 ResumeContent 里的属性名。"""

    field_id: str
    key: str
    label: str
    field_type: str = "single_line"
    # ResumeContent 条目/标量里的属性名；None = 编辑器没有独立输入框
    # （仅素材/私密/自定义字段/承载区追加）。
    resume_attr: str | None = None


class EditorSectionOut(BaseModel):
    """一个可见板块：形态、纸面分区、是否仅素材 + 可见字段（定义顺序）。"""

    section_key: str
    section_name: str
    form: str = "multi"  # singleton | multi
    # education/experience/...；None = 标量分区（基本信息/个人总结）或自建板块。
    resume_field: str | None = None
    material_only: bool = False
    fields: list[EditorFieldOut] = Field(default_factory=list)


class EditorSchemaOut(BaseModel):
    """一份方案投影出的编辑器视图；workspace_revision 是它对应的定义修订。"""

    sections: list[EditorSectionOut] = Field(default_factory=list)
    workspace_revision: int = 0


__all__ = ["EditorFieldOut", "EditorSchemaOut", "EditorSectionOut"]
