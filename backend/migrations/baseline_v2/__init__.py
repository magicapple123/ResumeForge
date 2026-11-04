# SPDX-License-Identifier: Apache-2.0
"""2.0 单基线迁移的 DDL 分片包。

版本文件 versions/0001_baseline_v2.py 按 MODULE_ORDER 顺序执行各分片的
STATEMENTS，downgrade 时严格反序执行 DOWN_STATEMENTS。本包内容全部由
backend/scripts/dump_baseline_ddl.py 生成，不要手工编辑。
"""

from __future__ import annotations

MODULE_ORDER: tuple[str, ...] = (
    "core",
    "profile",
    "resume",
    "apply_tasks",
    "other",
    "fts",
)

__all__ = ["MODULE_ORDER"]
