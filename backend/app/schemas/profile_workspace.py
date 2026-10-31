# SPDX-License-Identifier: Apache-2.0
"""资料工作区（13 个大字段 + 自建定义 + 条目 + 偏好）的编辑 DTO。

**这是"编辑 DTO"，不是"消费 DTO"**（计划 §2 第 8 条）：
- 编辑 DTO 含 hidden / collapsed_override / 字段定义，只服务资料页的录入与恢复清单；
- 消费 DTO（生成 / 新建填充 / 网申）将在 F2 的 schemas/profile_projection.py 里单独定义，
  **类型中没有 collapsed**，并且由服务端先裁剪 hidden 与未参与分区。两者不得混用：
  投影、白名单、预算、hasText、网申、上纸函数一律不能接收本文件的模型。

**collapsed 与 hidden 是两个独立布尔**（R-66/R-67）：本文件的 FieldOut 同时给出
default_collapsed（代码定义的默认折叠）、collapsed_override（用户展开过/又收起）
与 hidden（用户隐藏）。服务端永远不下发"折叠=隐藏"这种合并态，前端也不得自行合并。

**条目值用 {field_id: string} 而不是固定字段**：字段定义可以增删（自定义字段），
固定列会重演"删除定义就丢值"的老问题；缺失键表示"本次未提交"，与显式空串清空严格区分
（R-15 与计划 §2 第 4 条）。

**这里的上限只是请求体兜底**：真正的 200 条 / 20 个自定义字段 / 2000 字符上限由
services/profile/value_validation.py 唯一实现（服务层是唯一写入入口，schema 不能成为
第二份规则）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .profile_groups import GroupBriefOut, RevisionIn  # noqa: F401 - RevisionIn 供 API 层复用
from .profile_projection import WorkspaceUpgradeFieldOut

FieldTypeLiteral = Literal["single_line", "multi_line", "date_text", "photo"]
CustomFieldTypeLiteral = Literal["single_line", "multi_line", "date_text"]
# 自定义字段的纸面默认位置（v2 文档模型 D6）：null = 按 field_type 自动
# （单行/日期 → trail，多行 → body）；hidden = 只保留数据、不上纸面。
CustomFieldPlacementLiteral = Literal["title", "meta", "lead", "trail", "body", "hidden"]
SectionFormLiteral = Literal["singleton", "multi"]

SECTION_NAME_MAX_CHARS = 40
CUSTOM_FIELD_LABEL_MAX_CHARS = 40
# 一次批量保存的条目数兜底（前端一次最多提交整页 13 个分区；给足余量防超长请求）。
BULK_ENTRIES_MAX = 500
SECTION_ORDER_MAX = 200
REORDER_ENTRIES_MAX = 200


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PendingNoticeOut(BaseModel):
    """待展示的降级事件（R-25）：当前组被删除/不可用时，下次进入资料页告知。"""

    notice_id: str
    kind: str
    group_id: str | None = None
    group_name: str | None = None
    message: str | None = None


class FieldOut(BaseModel):
    """一个字段的编辑视图：定义 + 该用户的隐藏/展开偏好。"""

    field_id: str
    section_key: str
    key: str
    label: str
    field_type: FieldTypeLiteral
    order: int = 0
    default_collapsed: bool = False
    enum_suggestions: list[str] = Field(default_factory=list)
    is_builtin: bool = True
    # 私密字段（证书编号）：可以本地录入与备份，但永不进模型/网申/纸面（需求 §3.1 细则 2）。
    private: bool = False
    # 纸面默认位置（0069）：null = 按 field_type 自动；仅对自建字段可写（内置字段由
    # 文档字段目录决定，见 /api/profile/field-placement-catalog）。
    default_placement: str | None = None
    # 有效位置（只读计算值）：自建字段 = 仅素材→hidden、显式值优先、否则按类型默认；
    # 内置字段为 null（由字段目录接口给）。前端显示"纸面位置"时读它，不自行复制默认规则。
    effective_placement: str | None = None
    # 仅素材（0069）：只进 AI / 网申素材、不上纸面；只有自建字段可为 true。
    material_only: bool = False
    llm_allowed: bool = True
    webform_allowed: bool = True
    hidden: bool = False
    collapsed_override: bool | None = None
    preference_revision: int = 0
    revision: int = 0


class SectionOut(BaseModel):
    """一个大字段的编辑视图；fields 顺序即界面顺序（默认字段在前、自建字段在后）。"""

    key: str
    name: str
    form: SectionFormLiteral
    is_builtin: bool = True
    carrier_field_id: str | None = None
    material_only: bool = False
    provenance: list[str] = Field(default_factory=list)
    fields: list[FieldOut] = Field(default_factory=list)
    revision: int = 0
    deleted_at: datetime | None = None


class EntryOut(BaseModel):
    """一个条目（含单例）的编辑视图；values 的键是稳定 field_id。"""

    entry_id: str
    section_key: str
    sort_order: int = 0
    values: dict[str, str] = Field(default_factory=dict)
    revision: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LimitsOut(BaseModel):
    """服务端真实上限（前端只做提示，不自行裁断）。"""

    max_entries_per_section: int = 200
    max_custom_fields_per_section: int = 20
    max_groups: int = 20
    single_line_chars: int = 200
    multi_line_chars: int = 2000


class WorkspaceStateOut(BaseModel):
    """只涉及工作区状态本身的响应（切组/写顺序/降级告知）：不重复下发整份资料。"""

    section_order: list[str] = Field(default_factory=list)
    current_group_id: str
    default_group_id: str
    workspace_revision: int = 0
    pending_notice: PendingNoticeOut | None = None


class WorkspaceOut(BaseModel):
    """GET /api/profile/workspace 的响应：一次拿全编辑所需数据。"""

    sections: list[SectionOut] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=list)
    current_group: GroupBriefOut | None = None
    groups: list[GroupBriefOut] = Field(default_factory=list)
    entries: list[EntryOut] = Field(default_factory=list)
    workspace_revision: int = 0
    pending_notice: PendingNoticeOut | None = None
    # R-47 升级状态槽位：资料页顶部 Alert 的数据来源（每次读取现算，不单独请求）。
    upgrade: WorkspaceUpgradeFieldOut = Field(default_factory=WorkspaceUpgradeFieldOut)
    limits: LimitsOut = Field(default_factory=LimitsOut)


class EntryCreateIn(_StrictModel):
    """新增一条条目（单例分区也会被服务端收敛成 upsert，绝不建第二条）。"""

    values: dict[str, str] = Field(default_factory=dict)
    sort_order: int | None = Field(default=None, ge=0)
    expected_revision: int | None = Field(default=None, ge=0)


class EntryUpdateIn(_StrictModel):
    """更新一条条目：values 只提交本次改动字段，未提交键由服务端保留旧值。"""

    values: dict[str, str] | None = None
    sort_order: int | None = Field(default=None, ge=0)
    expected_revision: int = Field(ge=0)


class BulkEntryItem(_StrictModel):
    """批量保存中的一项：有 entry_id = 更新；无 entry_id = 新建（单例分区自动 upsert）。"""

    section_key: str = Field(min_length=1, max_length=64)
    entry_id: str | None = Field(default=None, min_length=8, max_length=32)
    values: dict[str, str] = Field(default_factory=dict)
    expected_revision: int | None = Field(default=None, ge=0)


class BulkEntriesIn(_StrictModel):
    """一次保存本轮多分区改动集（R-15：同一事务，失败一起回滚）。"""

    entries: list[BulkEntryItem] = Field(default_factory=list, max_length=BULK_ENTRIES_MAX)
    expected_workspace_revision: int | None = Field(default=None, ge=0)


class BulkEntriesOut(BaseModel):
    """批量保存后的最新条目（顺序与提交一致，便于前端逐项刷新 revision）。"""

    entries: list[EntryOut] = Field(default_factory=list)
    workspace_revision: int = 0


class SectionCreateIn(_StrictModel):
    """自建大字段：名称 1–40、形态固定 multi（R-04）。"""

    name: str = Field(default="", max_length=SECTION_NAME_MAX_CHARS)
    expected_revision: int | None = Field(default=None, ge=0)


class SectionUpdateIn(_StrictModel):
    """自建大字段改名；内置定义由服务端拒绝（R-05/R-12）。"""

    name: str = Field(default="", max_length=SECTION_NAME_MAX_CHARS)
    expected_revision: int = Field(ge=0)


class CustomFieldCreateIn(_StrictModel):
    """自定义小字段：只允许三种文本类型（R-10/R-11）。

    ``default_placement`` / ``material_only`` 是 v2 文档模型的纸面属性（0069）：
    缺省 = 按 field_type 自动（单行/日期 → trail、多行 → body）且不是仅素材，
    旧客户端不传这两个字段时行为逐字节不变。
    """

    label: str = Field(default="", max_length=CUSTOM_FIELD_LABEL_MAX_CHARS)
    field_type: CustomFieldTypeLiteral
    default_placement: CustomFieldPlacementLiteral | None = None
    material_only: bool | None = None
    expected_revision: int | None = Field(default=None, ge=0)


class CustomFieldUpdateIn(_StrictModel):
    """自定义字段改名/排序/纸面位置；排序只作用于同分区自建字段之间。

    纸面属性用 ``model_fields_set`` 区分三态：没传 = 不改；
    ``default_placement=null`` = 恢复"按类型自动"；传具体值 = 改到该位置。
    """

    label: str | None = Field(default=None, max_length=CUSTOM_FIELD_LABEL_MAX_CHARS)
    sort_order: int | None = Field(default=None, ge=0)
    default_placement: CustomFieldPlacementLiteral | None = None
    material_only: bool | None = None
    expected_revision: int = Field(ge=0)


class FieldDeletionIn(_StrictModel):
    """删除自定义字段：含已录值时必须二次确认（R-14）。"""

    expected_revision: int = Field(ge=0)
    confirm_with_values: bool = False


class PreferencePatchIn(_StrictModel):
    """hidden 与 collapsed_override 局部独立更新（R-67/R-74）。

    collapsed_override 的三态靠 model_fields_set 区分：
    没传 = 保持原值；传 null = 恢复"跟随代码默认"；传 true/false = 用户显式展开/收起。
    """

    section_key: str = Field(min_length=1, max_length=64)
    hidden: bool | None = None
    collapsed_override: bool | None = None
    expected_revision: int | None = Field(default=None, ge=0)


class SectionOrderIn(_StrictModel):
    """全局唯一顺序（R-08）：基本信息恒首位、自建分区固定尾部（服务端强校验）。"""

    order: list[str] = Field(default_factory=list, min_length=1, max_length=SECTION_ORDER_MAX)
    expected_revision: int = Field(ge=0)

    @field_validator("order")
    @classmethod
    def _unique_keys(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("大字段顺序里不能出现重复项")
        return value


class ReorderIn(_StrictModel):
    """多条分区内重排：entry_ids 必须恰好是该分区全部活动条目（服务端校验）。"""

    entry_ids: list[str] = Field(default_factory=list, max_length=REORDER_ENTRIES_MAX)
    expected_revision: int = Field(ge=0)


class SectionDeletionImpactOut(BaseModel):
    """删除自建大字段前的影响面（R-07：动作 + 对象/条数 + 保留后果 + 去哪恢复）。"""

    entry_count: int = 0
    filled_entry_count: int = 0
    can_delete: bool = False
    restore_path: str = "回收站"
    revision: int = 0


class FieldDeletionImpactOut(BaseModel):
    """删除自定义小字段前的影响面（R-14：条数 + 保留后果 + 恢复位置）。"""

    affected_entries: int = 0
    can_delete: bool = False
    restore_path: str = "回收站"
    revision: int = 0
