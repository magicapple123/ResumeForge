# SPDX-License-Identifier: Apache-2.0
"""资料消费层 DTO 与纸面投影响应（F2）。

**两套 DTO 必须物理分开**（计划 §2 第 8 条 / R-66）：
- 编辑 DTO（schemas/profile_workspace.py）含 hidden / collapsed_override，只给资料页录入用；
- 本文件的**消费 DTO**（ConsumedProfile / ConsumedSection / ConsumedEntry）只包含
  「允许参与的定义与值」，**类型里根本没有 collapsed**，并且隐藏字段、已删除自定义字段、
  未参与分区在读取时就被裁掉/不出现。投影、白名单、预算、hasText、网申、上纸函数
  只能接收消费 DTO，接收编辑 DTO 视为类型错误。

**C1 裁决（2026-10-25）**：只要分区在当前组的参与清单里，即使没有任何数据，消费 DTO 里
也保留该分区（entries 为空元组）——13 个大字段统一为「在组里就出现、没数据就是空数组」；
未参与分区则整键不出现。因此 sections 字典的键集合 == scope.participating_keys。

**纸面投影响应**：服务器解析当前组后返回确定性纸面内容（**v2 文档 JSON**，投影内部先
组装 v1 中间态再在响应边界转 v2）、逐条候选、来源分区布局、长度警告与 snapshot token。
前端不再自行拼「标签：值」或语言映射（R-37/R-72/R-79 的唯一来源在
services/profile/paper_projection.py）。

**私密字段**：consumed 值里保留 private 字段（证书编号）供本地编辑/备份，但在
ConsumedFieldSpec.private / llm_allowed / webform_allowed 上标明；下游（生成白名单、
网申取数、纸面投影）必须按标志过滤，而不是按字符串黑名单猜。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import BaseModel, Field

from .profile_editor import EditorSchemaOut


@dataclass(frozen=True)
class ConsumedFieldSpec:
    """消费层的字段定义：只有参与取数需要的属性，**没有 collapsed**。

    ``default_placement`` / ``material_only``（0069）：自定义字段的纸面默认抽屉与
    "仅素材"标记，供 v1→v2 转换器/生成结果落 v2 时决定 item 的 placement。内置字段
    这两项保持 None/False——它们的位置由文档字段目录（document_catalog）决定。
    """

    field_id: str
    key: str
    label: str
    field_type: str
    order: int
    llm_allowed: bool
    webform_allowed: bool
    private: bool
    is_builtin: bool
    default_placement: str | None = None
    material_only: bool = False


@dataclass(frozen=True)
class ConsumedEntry:
    """一个条目的消费值：只含未隐藏、未删除字段的值（field_id → 文本）。"""

    entry_id: str
    sort_order: int
    values: Mapping[str, str]


@dataclass(frozen=True)
class ConsumedSection:
    """一个大字段的消费视图；entries 为空元组表示「在组里但没数据」（C1）。"""

    key: str
    name: str
    form: str
    carrier_field_id: str | None
    material_only: bool
    primary_field_id: str | None
    fields: tuple[ConsumedFieldSpec, ...]
    entries: tuple[ConsumedEntry, ...]
    revision: int = 0


@dataclass(frozen=True)
class ConsumedProfile:
    """当前组（或全量）的消费快照：sections 键集合 == participating_keys（C1）。"""

    group_id: str
    group_name: str
    is_default: bool
    participating_keys: tuple[str, ...]
    section_order: tuple[str, ...]
    workspace_revision: int
    sections: Mapping[str, ConsumedSection]

    def section(self, key: str) -> ConsumedSection | None:
        return self.sections.get(key)


class ProjectionScopeOut(BaseModel):
    """投影响应的组元数据：生成/新建面板的只读「本次使用」摘要来源。"""

    group_id: str
    group_name: str
    is_default: bool = False
    participating_keys: list[str] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=list)
    workspace_revision: int = 0


class ProjectionCandidateOut(BaseModel):
    """一条「从资料填充」候选：只有稳定身份与可读标题，不含折叠态。"""

    section_key: str
    section_name: str
    entry_id: str
    title: str = ""
    subtitle: str = ""
    #: **v2 文档路径**（`{section}.{v2_entry_id}`；自建分区同为 `{section}.{v2_entry_id}`）。
    #: 注意：上面的 `entry_id` 是**资料条目 id**；本字段里的第二段是纸面 v2 entry 的
    #: 稳定 id，二者通常不同（v1 中间态不携带资料 entry_id）。定位以本字段为准。
    document_path: str = ""
    #: 该候选在 content 里的 **v2 entry JSON 原样**（与 document_path 指向同一对象）；
    #: 前端直接拿它拼新条目，不必再按 path 二次解析。为空 = 该条目没进纸面（如仅素材）。
    document_entry: dict | None = None


class ProjectionSourceSectionOut(BaseModel):
    """来源分区布局（新建简历的 7/13 来源面板用它渲染，不用再自己分组）。"""

    section_key: str
    section_name: str
    form: str
    entry_count: int = 0
    material_only: bool = False


class ProjectionWarningOut(BaseModel):
    """投影/承载区溢出等如实提示（R-44；不静默截断）。"""

    code: str
    section_key: str = ""
    entry_id: str = ""
    message: str = ""


class PaperProjectionOut(BaseModel):
    """GET /api/profile/current/projection 的响应：确定性纸面内容 + 候选 + 布局 + 警告。

    ``content`` 是 **v2 文档 JSON**（ResumeDocument 序列化后的 dict，D11 起存储/编辑
    唯一格式）；投影内部仍先组装 v1 中间态，再在响应边界转 v2（自定义字段元数据来自
    当前方案的定义），这样字段位置与制作台 converter 完全同源。
    """

    scope: ProjectionScopeOut
    content: dict
    candidates: list[ProjectionCandidateOut] = Field(default_factory=list)
    source_layout: list[ProjectionSourceSectionOut] = Field(default_factory=list)
    # F10/R-82 编辑器视图：参与分区的可见板块 + 每个板块的可见字段（按当前方案投影）。
    # 新建简历时由快照冻结一份副本；之后方案再改不影响已保存简历。
    editor_schema: EditorSchemaOut | None = None
    warnings: list[ProjectionWarningOut] = Field(default_factory=list)
    # 内容 + scope + 定义/资料修订的指纹，供新建态快照与迟到响应校验（F4）。
    snapshot_token: str = ""


class UpgradeStatusOut(BaseModel):
    """R-47 升级检测：只返回布尔状态，不返回任何旧资料内容。"""

    has_legacy_data: bool = False
    new_profile_has_entries: bool = False
    checked: bool = True


class WorkspaceUpgradeFieldOut(BaseModel):
    """工作区读取里的升级状态槽位（资料页顶部 Alert 的数据来源）。"""

    has_legacy_data: bool = False
    new_profile_has_entries: bool = False


__all__ = [
    "ConsumedEntry",
    "ConsumedFieldSpec",
    "ConsumedProfile",
    "ConsumedSection",
    "PaperProjectionOut",
    "ProjectionCandidateOut",
    "ProjectionScopeOut",
    "ProjectionSourceSectionOut",
    "ProjectionWarningOut",
    "UpgradeStatusOut",
    "WorkspaceUpgradeFieldOut",
]
