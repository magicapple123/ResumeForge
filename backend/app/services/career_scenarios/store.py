# SPDX-License-Identifier: Apache-2.0
"""已保存职业场景的持久化：限额、条件更新、归档（A1，契约 §2.2/§2.4）。

数据边界：

- 每数据集独立（各数据集自己的 SQLite 库），本模块只操作当前会话绑定的库；
- 每数据集**未归档**场景 ≤50；归档不删除行、保留原 id，重新启用仍占原行；
- 写入全部在事务内：创建 revision=1，每次成功 PATCH（含 archived 翻转）revision+1；
- PATCH 是**条件更新**（`expected_revision` 不匹配 → 409），避免两个窗口互相覆盖。
  冲突时一个字节都不写：UPDATE 的 WHERE 同时限定 id 与 revision。

不记录场景正文到日志（计划 §15.3）：只记 id / revision / 是否归档。
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ...models.career_scenario import CareerScenario
from ...models.profile import utcnow
from ...schemas.career_scenario import (
    CAREER_SCENARIO_LIMIT_REACHED,
    CAREER_SCENARIO_NOT_FOUND,
    CAREER_SCENARIO_REVISION_CONFLICT,
    MAX_SCENARIOS_PER_DATASET,
    SCENARIO_SCHEMA_VERSION,
    CareerScenarioCreate,
    CareerScenarioUpdate,
)

logger = logging.getLogger(__name__)

NOT_FOUND_DETAIL = "场景不存在"
REVISION_CONFLICT_DETAIL = "场景已在其他窗口修改"
LIMIT_DETAIL = f"每个数据集最多保存 {MAX_SCENARIOS_PER_DATASET} 个未归档场景"


class ScenarioStoreError(Exception):
    """场景存储层的基类：带 API 层需要的 status_code / detail / code。"""

    status_code = 400
    code = ""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class ScenarioNotFound(ScenarioStoreError):
    status_code = 404
    code = CAREER_SCENARIO_NOT_FOUND


class ScenarioLimitReached(ScenarioStoreError):
    # 数量超限是请求本身不被接受（契约 §2.4："数量/格式错误 422/400"），不是版本冲突。
    status_code = 400
    code = CAREER_SCENARIO_LIMIT_REACHED

    def __init__(self) -> None:
        super().__init__(LIMIT_DETAIL)


class ScenarioRevisionConflict(ScenarioStoreError):
    status_code = 409
    code = CAREER_SCENARIO_REVISION_CONFLICT

    def __init__(self, current_revision: int) -> None:
        super().__init__(REVISION_CONFLICT_DETAIL)
        self.current_revision = current_revision


def list_scenarios(
    db: Session, *, include_archived: bool = False
) -> tuple[list[CareerScenario], int]:
    """当前数据集的场景。默认隐藏已归档；`total` 与返回集合同口径。"""
    stmt = select(CareerScenario)
    if not include_archived:
        stmt = stmt.where(CareerScenario.archived.is_(False))
    rows = list(db.scalars(stmt.order_by(CareerScenario.id)).all())
    return rows, len(rows)


def get_scenario(db: Session, scenario_id: int) -> CareerScenario | None:
    """按 id 取（含已归档——解析层要能区分"不存在"与"已归档"）。"""
    return db.get(CareerScenario, scenario_id)


def active_scenario_count(db: Session) -> int:
    """未归档场景数（限额口径；归档行不占新名额，但也不会被删除）。"""
    count = db.scalar(
        select(func.count())
        .select_from(CareerScenario)
        .where(CareerScenario.archived.is_(False))
    )
    return int(count or 0)


def create_scenario(db: Session, payload: CareerScenarioCreate) -> CareerScenario:
    """新建场景：revision=1，schema_version 取当前结构版本。"""
    if active_scenario_count(db) >= MAX_SCENARIOS_PER_DATASET:
        raise ScenarioLimitReached()
    row = CareerScenario(
        name=payload.name,
        schema_version=SCENARIO_SCHEMA_VERSION,
        revision=1,
        config=payload.config.model_dump(),
        archived=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("已新增职业场景 id=%s revision=%s", row.id, row.revision)
    return row


def update_scenario(
    db: Session, scenario_id: int, payload: CareerScenarioUpdate
) -> CareerScenario:
    """条件 PATCH：只写显式给出的字段，并原子地推进 revision。

    `expected_revision` 不匹配时返回库里**现在**的 revision（前端据此比较/刷新），
    且不做任何部分写入——条件写在同一条 UPDATE 的 WHERE 里。
    """
    values: dict[str, object] = {
        "revision": CareerScenario.revision + 1,
        "updated_at": utcnow(),
    }
    if payload.name is not None:
        values["name"] = payload.name
    if payload.config is not None:
        values["config"] = payload.config.model_dump()
    if payload.archived is not None:
        values["archived"] = payload.archived

    result = db.execute(
        update(CareerScenario)
        .where(
            CareerScenario.id == scenario_id,
            CareerScenario.revision == payload.expected_revision,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        db.rollback()
        current = get_scenario(db, scenario_id)
        if current is None:
            raise ScenarioNotFound(NOT_FOUND_DETAIL)
        raise ScenarioRevisionConflict(current.revision)

    db.commit()
    db.expire_all()
    row = get_scenario(db, scenario_id)
    if row is None:  # pragma: no cover - 条件更新刚命中，行不可能消失
        raise ScenarioNotFound(NOT_FOUND_DETAIL)
    logger.info(
        "已更新职业场景 id=%s revision=%s archived=%s", row.id, row.revision, row.archived
    )
    return row


def set_archived(
    db: Session, scenario_id: int, *, archived: bool, expected_revision: int
) -> CareerScenario:
    """归档/取消归档的薄封装（与普通 PATCH 走同一条条件更新路径）。"""
    return update_scenario(
        db,
        scenario_id,
        CareerScenarioUpdate(archived=archived, expected_revision=expected_revision),
    )


__all__ = [
    "LIMIT_DETAIL",
    "NOT_FOUND_DETAIL",
    "REVISION_CONFLICT_DETAIL",
    "ScenarioLimitReached",
    "ScenarioNotFound",
    "ScenarioRevisionConflict",
    "ScenarioStoreError",
    "active_scenario_count",
    "create_scenario",
    "get_scenario",
    "list_scenarios",
    "set_archived",
    "update_scenario",
]
