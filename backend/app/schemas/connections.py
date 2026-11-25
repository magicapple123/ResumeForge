# SPDX-License-Identifier: Apache-2.0
"""「外部连接」页的响应模型（T11 / T12）。

两个维度分开表达，因为用户的疑问本来就是两句不同的话：

1. **``status``**：这条连接现在有效吗（``saved`` / ``not_configured`` / ``session_only``）；
2. **``protection``**：它在本机是怎么存的（``dpapi`` / ``plaintext`` / ``memory_only``）。

把两者揉成一个字符串就会出现"已保存（明文）"这种既不是状态也不是存储方式的混合值
（见 `services/credentials/types.py` 的同一条理由）。

``*_label`` 一律由后端给中文，前端仍应经 i18n 包一层（registry 的 ``label`` 字段注释
写的就是这条约定）；``status`` / ``protection`` 是**稳定协议值**，前端按它选分支。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 分组类型：凭据组（A/B）与系统来源组（C）的编辑入口不同，前端据此选控件。
GroupKind = Literal["credential", "system"]


class ConnectionItemOut(BaseModel):
    """一条外部连接：状态、掩码、存储方式，以及"能不能在这里改"。"""

    id: str
    label: str
    kind: GroupKind
    # --- 状态（三态，协议值 + 中文标签）---
    status: str
    status_label: str
    detail: str = ""
    # --- 密钥展示：语义检索只给布尔，不给掩码 ---
    masked: str = ""
    # CR-07：只读展示提示（前 4 后 4，短于 16 位回退 ``********``）。它与 ``masked``
    # 用途不同：掩码是写回协议，hint 只给人辨认，写路径一律不接受它。
    hint: str = ""
    key_configured: bool = False
    # CR-06：这条来源没有单独配置，实际生效的是「AI 模型」里的 DeepSeek Key。
    borrowed_key: bool = False
    # --- 存储方式 ---
    protection: str
    protection_label: str
    protection_description: str = ""
    # --- 编辑能力：就地改/清除时前端走哪个域端点，由 id 决定（不在响应里泄漏路由）---
    editable: bool = False
    write_hint: str = ""
    # 命名配置的来源 id（语音 / 大模型）：前端调用对应端点时要用它定位那一条。
    target_id: str = ""
    # 人类可读的存放位置（排障用：`global_settings.json → web_search.x`）。
    location: str = ""
    # --- 系统来源（C 组）用 ---
    value: str = ""
    default_value: str = ""
    is_default: bool = True


class ConnectionGroupOut(BaseModel):
    """一组外部连接。A/B 组是凭据，C 组是系统下载源与端口。"""

    id: str
    label: str
    kind: GroupKind
    hint: str = ""
    items: list[ConnectionItemOut] = Field(default_factory=list)


class KeyMapRowOut(BaseModel):
    """密钥地图的一行（CR-12）：来源 / 在哪配 / 谁在用 / 空串含义。

    全部由后端从 ``credentials.registry`` 投影：前端只渲染，不再手写一份清单
    （手写的那份一定会落后于新增的来源）。
    """

    id: str
    label: str
    group: str = ""
    group_label: str = ""
    #: 界面上去哪改（"设置 → 联网搜索 → DeepSeek"）。
    configure_at: str = ""
    #: 哪些功能在用这把 Key。
    used_by: str = ""
    #: 留空 / 清除时会发生什么（四套写语义本来就不同）。
    empty_meaning: str = ""
    #: 文件里存哪（排障用，与 ``configure_at`` 是两件事）。
    where: str = ""


class StorageSummaryOut(BaseModel):
    """整页共用的一句存储说明：这台机器上的密钥是加密还是明文。"""

    kind: str
    label: str
    description: str = ""


class ConnectionsOut(BaseModel):
    """「外部连接」页的一次性快照：三组 + 全局存储说明。"""

    groups: list[ConnectionGroupOut] = Field(default_factory=list)
    #: CR-12：由 registry 生成的地图，长度为凭据来源数。
    key_map: list[KeyMapRowOut] = Field(default_factory=list)
    storage: StorageSummaryOut
    # 数据库会话缺失时如实说明（页面据此提示"状态不可判定"，而不是假装全部未配置）。
    retrieved: bool = True


class SystemSourceWriteIn(BaseModel):
    """改一项系统来源（C 组）的请求体。"""

    value: str = Field(default="", max_length=2048)


__all__ = [
    "ConnectionGroupOut",
    "ConnectionItemOut",
    "ConnectionsOut",
    "GroupKind",
    "KeyMapRowOut",
    "StorageSummaryOut",
    "SystemSourceWriteIn",
]
