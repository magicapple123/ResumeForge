# SPDX-License-Identifier: Apache-2.0
"""资料组 / 当前组（ProfileGroup）的出入参 schema。

**为什么组单独一个 schema 文件**：组是资料页标题区与生成面板共用的最小契约（R-52、R-27），
而「13 个大字段的定义 + 值」是另一个体量更大的编辑契约。两者拆开后，生成面板只需要
GroupBriefOut 就能渲染"本次使用：{组名}（N 个大字段）"，不必把整份工作区 DTO 拉进上下文。

**participating_keys 永远是"解析后的有序清单"**：顺序来自全局 section_order（基本信息恒首位），
不是组内顺序（R-22：组内只有"在/不在"，没有顺序）。服务端 resolve 后下发，前端不再自行排序。

**写请求一律带 expected_revision**：组是用户并行窗口最常碰的两类对象（改名/改成员/删组），
没有条件写就会出现"我删了 A，另一个窗口把 A 改名后保存回来"的幽灵组。冲突返回 409 +
revision，前端拿它去刷新比较，而不是盲目重试。

**名称规则只在前端做提示、服务端做真校验**：strip 后 1–40 字符；这里只做长度兜底，
去空白与"仅 ASCII 大小写折叠的判重键"由 services/profile/value_validation.py 唯一实现。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 组名上限（R-18：1–40 字符；服务端 trim 后判空）。
GROUP_NAME_MAX_CHARS = 40
# 外部稳定 id 的宽松上界：服务端是 UUID-hex(24)，这里只防明显异常的超长字符串。
GROUP_ID_MAX_CHARS = 32
# 一次最多提交多少个参与分区（13 内置 + 自建上限，给足余量但不接受无界数组）。
GROUP_MEMBERS_MAX = 200


class _StrictModel(BaseModel):
    """写请求统一禁止未知字段：静默忽略会表现成"保存成功但没改到"。"""

    model_config = ConfigDict(extra="forbid")


def _strip_group_name(value: str) -> str:
    """去首尾空白；trim 后为空或超长直接拒绝（不把用户输入原样带进判重键）。"""
    text = (value or "").strip()
    if not text:
        raise ValueError("组名称不能为空")
    if len(text) > GROUP_NAME_MAX_CHARS:
        raise ValueError(f"组名称不能超过 {GROUP_NAME_MAX_CHARS} 个字符")
    return text


class RevisionIn(_StrictModel):
    """删除类请求的最小版本条件（组件共享；workspace 模块直接复用）。"""

    expected_revision: int = Field(ge=0, description="客户端看到的当前 revision")


class GroupBriefOut(BaseModel):
    """组的最小只读形状：列表、当前组、生成面板只读摘要共用。"""

    group_id: str
    name: str
    is_default: bool = False
    revision: int = 0
    participating_keys: list[str] = Field(default_factory=list)
    member_count: int = 0


class GroupOut(GroupBriefOut):
    """组列表的完整只读形状（多出创建/更新时间，列表页可直接显示）。"""

    created_at: datetime | None = None
    updated_at: datetime | None = None


class GroupListOut(BaseModel):
    """组列表 + 当前组指针 + 工作区 revision（一次读取即可渲染标题区与弹层）。"""

    items: list[GroupOut] = Field(default_factory=list)
    current_group_id: str | None = None
    default_group_id: str | None = None
    workspace_revision: int = 0


class GroupCreateIn(_StrictModel):
    """新建组：只需要一个名称（R-18），参与清单可为空，读取时自动补基本信息。"""

    name: str = Field(default="", max_length=GROUP_NAME_MAX_CHARS)

    _normalize_name = field_validator("name")(_strip_group_name)


class GroupUpdateIn(_StrictModel):
    """改名（默认组也可改名，R-20；不可删除）。"""

    name: str = Field(default="", max_length=GROUP_NAME_MAX_CHARS)
    expected_revision: int = Field(ge=0)

    _normalize_name = field_validator("name")(_strip_group_name)


class GroupMembersIn(_StrictModel):
    """整份替换参与清单：只增删关系行，不动任何资料（R-17/R-19）。"""

    section_keys: list[str] = Field(default_factory=list, max_length=GROUP_MEMBERS_MAX)
    expected_revision: int = Field(ge=0)

    @field_validator("section_keys")
    @classmethod
    def _unique_keys(cls, value: list[str]) -> list[str]:
        """重复 key 没有意义，直接拒绝而不是静默去重（避免前端状态与库不一致）。"""
        if len(set(value)) != len(value):
            raise ValueError("参与清单里不能出现重复的大字段")
        return value


class CurrentGroupIn(_StrictModel):
    """切换当前组（PUT /api/profile/current-group 是唯一切换入口，R-24）。"""

    group_id: str = Field(min_length=8, max_length=GROUP_ID_MAX_CHARS)
    expected_revision: int = Field(ge=0)


class GroupDeleteOut(BaseModel):
    """删除组的结果：被删的组、是否因"删的是当前组"而切回默认组、降级告知 id。"""

    deleted_group_id: str
    switched_to: str | None = None
    notice_id: str | None = None
    current_group: GroupBriefOut | None = None


class NoticeAckOut(BaseModel):
    """确认降级告知（R-25）：acknowledged=False 表示事件已不在待展示状态。"""

    acknowledged: bool = False
