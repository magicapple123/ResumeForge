# SPDX-License-Identifier: Apache-2.0
"""回收站彻底删除简历时解除使用快照的逻辑引用（与 services.trash 的接合点）。

**为什么单独成模块**：trash.py 已到单文件 500 行预算边缘，而这段逻辑与回收站的主职责
（软删 / 恢复 / 彻底删除）只有一个接合点——删简历前解绑快照引用；拆出后两边都保持
单一职责，行为与日志逐字不变。

**为什么必须解绑**：profile_usage_snapshot 的 resume_id 只是逻辑引用（刻意不建外键，
快照要能脱离父行存活，R-33），而 SQLite 的 INTEGER PRIMARY KEY 没有 AUTOINCREMENT：
简历被彻底删除后 rowid 会被下一条新简历复用，旧快照行若仍占着同一个 resume_id，
回写时就撞 UNIQUE 约束（2026-10-26 用户真实库的 P0 故障）。这里只把逻辑引用置 NULL，
快照其余字段（组名 / 参与清单 / 顺序 / 两枚 revision / layout）原样保留（R-34）。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# 需要解绑快照引用的回收站类型：当前只有简历记录是 profile_usage_snapshot 的父行。
_SNAPSHOT_PARENT_KEY = "resume"


def release_snapshot_references(db: Session, key: str, item_ids: list[int]) -> None:
    """彻底删除某类内容前解除快照行的逻辑引用（不删历史快照行）。

    调用方保证在 db.delete(...) 之前、同一事务里调用；key 不是简历（或没有 id）时
    什么都不做。解除失败时让异常向上抛——删除不能因历史行状态半途而废。
    """
    if key != _SNAPSHOT_PARENT_KEY or not item_ids:
        return
    # 延迟导入：回收站出现在 services 的公共装配链上，而快照模块只依赖模型层，
    # 这里不在模块级建立方向依赖。
    from .resume.generate_snapshot import detach_snapshot_resume

    detached = sum(detach_snapshot_resume(db, int(resume_id)) for resume_id in item_ids)
    if detached:
        logger.info(
            "彻底删除简历前解除快照引用：解除 %s 行 / 简历 %s 条",
            detached,
            len(item_ids),
        )


__all__ = ["release_snapshot_references"]
