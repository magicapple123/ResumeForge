# SPDX-License-Identifier: Apache-2.0
"""横向对比结论的随批次存储（复用 ``app_setting`` 的 JSON 值，不新增表/列）。

**为什么不是加一列**：对比结论是"某一批分析"的附属快照，读写都只在批次创建与回看时
发生；而 500 行预算与迁移链的成本都由一次加列承担（迁移、旧备份兼容、head revision
字面量、表覆盖守卫）。``app_setting`` 已经是本应用存放小型 JSON 运行时状态的既有位置
（后台任务状态、投递配置同在此表），用它可以让本次改动**零迁移**，旧库/旧备份照常打开。

键空间是独立的 ``job_match_comparison:<batch_id>``：不与设置项混用，也不会被设置页读取。
批次不提供删除入口，因此这里不需要级联清理；即使批次行被外部删掉，残留的键也只是一段
无法被引用的只读 JSON（读路径只按现存批次 id 查询）。
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from ...models.setting import AppSetting
from ...schemas.job_comparison import JobComparisonResult

logger = logging.getLogger(__name__)

_KEY_PREFIX = "job_match_comparison:"


def _key(batch_id: int) -> str:
    return f"{_KEY_PREFIX}{batch_id}"


def save_comparison(db: Session, batch_id: int, comparison: JobComparisonResult | None) -> None:
    """写入（覆盖）某批次的对比结论；``None`` 表示这一批没有对比（纯逐岗分析）。"""
    if comparison is None:
        return
    serialized = json.dumps(comparison.model_dump(mode="json"), ensure_ascii=False)
    row = db.get(AppSetting, _key(batch_id))
    if row is None:
        db.add(AppSetting(key=_key(batch_id), value=serialized))
    else:
        row.value = serialized


def load_comparison(db: Session, batch_id: int) -> JobComparisonResult | None:
    row = db.get(AppSetting, _key(batch_id))
    if row is None or not row.value:
        return None
    try:
        return JobComparisonResult.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("横向对比结论损坏，已忽略 batch_id=%s", batch_id)
        return None


def load_comparisons(db: Session, batch_ids: list[int]) -> dict[int, JobComparisonResult]:
    """批量读取（历史列表用），一次查询而不是 N 次。"""
    ids = [batch_id for batch_id in batch_ids if batch_id]
    if not ids:
        return {}
    keys = [_key(batch_id) for batch_id in ids]
    rows = db.query(AppSetting).filter(AppSetting.key.in_(keys)).all()
    found: dict[int, JobComparisonResult] = {}
    for row in rows:
        try:
            batch_id = int(str(row.key).removeprefix(_KEY_PREFIX))
        except ValueError:
            continue
        try:
            found[batch_id] = JobComparisonResult.model_validate(json.loads(row.value or ""))
        except (json.JSONDecodeError, TypeError, ValueError):
            logger.warning("横向对比结论损坏，已忽略 batch_id=%s", batch_id)
    return found


__all__ = ["load_comparison", "load_comparisons", "save_comparison"]
