# SPDX-License-Identifier: Apache-2.0
"""0001：ResumeForge 2.0 单基线——一次建全全部业务表、索引与 FTS 派生表。

2.0 不再保留 1.x 的迁移链：新库直接由本基线建出与 Base.metadata 完全一致的结构。
旧库不原地升级（启动闸门判到 pre-2.0 库后整包归档并建空库，见 2.0 执行方案 T04）。
downgrade() 只负责删表，不承诺降级后数据还在。

DDL 分片（migrations/baseline_v2/*.py）由 backend/scripts/dump_baseline_ddl.py 从
模型注册表生成；本文件只负责按固定顺序执行与反向执行，不手写表结构。

导入稳妥性：alembic 从 versions/ 目录加载本文件时 backend 不一定在 sys.path
（例如测试用裸 Config 读 revision 的情况），这里显式补一次，不依赖调用方 cwd。

Revision ID: 0001_baseline_v2
Revises:
Create Date: 2026-11-04
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

from alembic import op

_BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from migrations.baseline_v2 import (  # noqa: E402 - 先补 sys.path 再导入
    MODULE_ORDER,
    apply_tasks,
    core,
    fts,
    other,
    profile,
    resume,
)

revision: str = "0001_baseline_v2"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MODULES = {
    "core": core,
    "profile": profile,
    "resume": resume,
    "apply_tasks": apply_tasks,
    "other": other,
    "fts": fts,
}
_ORDERED_MODULES = tuple(_MODULES[name] for name in MODULE_ORDER)


def upgrade() -> None:
    """按分片顺序建全 2.0 结构：业务表/索引 → 其余域 → FTS 派生表 → epoch 播种。"""
    for module in _ORDERED_MODULES:
        for statement in module.STATEMENTS:
            op.execute(statement)
    # epoch 播种必须是最后一步：前面任何一句失败都意味着库不完整，不能留下"看起来
    # 已升级"的 epoch=2（启动闸门只认这一行来判定 UPGRADE）。
    for statement in other.EPOCH_SEED_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    """严格反序删表：先删 FTS 触发器/虚拟表，再按分片反序 DROP 业务表。"""
    for module in reversed(_ORDERED_MODULES):
        for statement in module.DOWN_STATEMENTS:
            op.execute(statement)
