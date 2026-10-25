# SPDX-License-Identifier: Apache-2.0
"""自动备份保护状态（A02）的响应 Schema。

为什么要有显式模型：这个接口从"随手返回一个 dict"改成有契约的响应，是为了让
"自动备份被部署配置关掉"（disabled）成为可被前端依赖的字段，而不是靠界面自己从
几个布尔值里猜。旧字段一个不少地保留，新增字段全部有默认值，旧客户端不受影响。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 与 services/data_backup/status.py 的 PROTECTION_STATE_* 常量逐字对应（有测试钉住）。
ProtectionState = Literal[
    "protected",
    "overdue",
    "never",
    "empty",
    "unreadable",
    "failing",
    "disabled",
]
SnapshotState = Literal["ok", "empty", "unreadable"]


class BackupSnapshotOut(BaseModel):
    """一份自动备份快照（文件摘要，不含内容）。"""

    name: str
    size_bytes: int
    modified_at: float


class BackupStatusOut(BaseModel):
    """当前数据集的备份保护摘要（GET /api/settings/backup-status）。

    - auto_backup_enabled：部署配置 Settings.auto_backup_enabled 的真实值；没有 UI
      开关，界面必须如实标注"由部署配置控制"；
    - disabled：auto_backup_enabled 取反（给已经读 enabled 的旧前端少一次取反）；
    - state：单一枚举，disabled 优先于一切其它状态；界面按它决定主文案；
    - protected 在 disabled 时为 False——历史快照还能恢复，但"后台还在继续保护"不成立。
    """

    dataset_id: str = ""
    protected: bool
    coverage: Literal["database_only"] = "database_only"
    last_success: float | None = None
    last_attempt: float | None = None
    consecutive_failures: int = 0
    last_error: str = ""
    interval_days: int = 0
    overdue: bool = False
    snapshot_state: SnapshotState = "empty"
    snapshot_count: int = 0
    snapshots: list[BackupSnapshotOut] = Field(default_factory=list)
    # 新增字段给默认值：旧后端/旧 mock 的响应被新模型验证时不会炸。
    auto_backup_enabled: bool = True
    disabled: bool = False
    state: ProtectionState = "never"


__all__ = ["BackupSnapshotOut", "BackupStatusOut", "ProtectionState", "SnapshotState"]
