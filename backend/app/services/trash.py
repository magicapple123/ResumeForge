# SPDX-License-Identifier: Apache-2.0
"""回收站：二十四类内容的软删除、恢复与彻底删除。

**为什么是软删除**（一个 ``deleted_at`` 时间戳）而不是把行搬到另一张表：搬表意味着外键、快照
字段、去重判据全部要重建一遍，而这些现在都是好的。软删除只多一句"什么时候删的"，列表查询加
``IS NULL``、回收站看非 NULL、恢复就是清空时间戳——三处都极难写错。

**范围克制**：只覆盖用户真正会心疼的二十四类——岗位、备选岗位、简历记录、外部简历、投递记录、
事实台账条目、资料箱材料、助手会话、面经、内推、提醒、分享包、题库历史、复盘历史、知识库、
网申填充记录、资料组/自建大字段/自建小字段/资料条目、求职偏好。列级别、模板副本、数据集这类要么有明确的沿用
关系、要么本来就能重建，不做回收站；每个可删项都进回收站，只会让回收站自己变成垃圾场。

**完整性红线**：凡是模型里带 ``deleted_at`` 列的表，都必须在这里登记（``TRASH_SPECS``），否则
就会出现"半软删"——列表里消失、回收站里也找不到、既不能恢复也无法彻底删除，形成永久僵尸行。
``tests/test_trash.py::test_every_deleted_at_table_is_registered`` 用 ``Base.metadata`` 扫全库钉住
这层一一对应。

**三个最容易漏的接合点**（都在调用方，这里负责提供正确的判据）：

1. **去重必须把回收站里的也算"已存在"**。否则"删掉 → 再采集一次"会造出第二条同一岗位，
   而用户以为自己只是删了一条。判据 `job_service.find_by_job_identity` **默认不过滤**
   ``deleted_at``，调用方据此给出「在回收站里」的提示。
   **唯一的例外是备选岗位**（``candidate_job``，0050 起进回收站）：它是"还没核对的暂存
   候选"，用户删掉它往往正是为了让它从待办里消失后重新采集；把它算作"已存在"会让同一
   条岗位再也采不回来。所以 ``find_staged_candidate`` 显式传 ``skip_deleted=True``。
2. **列表 / 匹配分析 / 投递准入 / 数据集导出都不该看到已删除内容**，统一用 ``live_only()``。
3. **彻底删除是真删、不可恢复**，所以它是唯一需要用户二次确认的动作；`restore` 与 `purge`
   分开两个接口，不允许一个"删除"按钮同时具备两种语义。

删除某条内容时**不连带删除它的关联对象**（岗位删除 → 投递记录保留快照字段并按既有约定
``SET NULL``），这条行为回收站前后完全一致——回收站只改变"这条还在不在列表里"。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models.profile import utcnow
from ..runtime.log_fields import safe_log_text
from .trash_registry import (
    TRASH_SPEC_BY_KEY,
    TRASH_SPECS,
    TRASHED_TABLES,
    TrashSpec,
)
from .trash_registry import (
    labels as labels,
)
from .trash_snapshot_refs import release_snapshot_references

logger = logging.getLogger(__name__)

# 一次最多列多少条。回收站是"最近删了什么"的地方，不是归档区；
# 给上限也让"我不小心清空了"不至于变成一次巨大的响应。
MAX_TRASH_ITEMS = 500

# 活动行判据里的 state 取值：偏好档的 state 是"版本状态"，与 deleted_at 分开表达。
# 用字面量而不是 import 模型常量，是为了让这个鸭子类型分支保持"按列语义"而不是
# 绑定具体模型（以后同类表只要也有 state='active' 这一约定就自动适用）。
_ACTIVE_STATE = "active"


def spec_or_none(key: str) -> TrashSpec | None:
    return TRASH_SPEC_BY_KEY.get((key or "").strip())


def live_only(model: Any) -> Any:
    """查询条件：只取**未被软删除**的行。

    抽成一个函数是为了让"哪张表用哪个列名"只写一次——各表都写一遍 ``deleted_at.is_(None)``，
    总有一次会写成 ``is_(True)`` 或漏掉，而那种错**不会报错**，只会让回收站里的东西继续出现在
    列表里（用户以为删除失败）。
    """
    return model.deleted_at.is_(None)


def trash_only(model: Any) -> Any:
    """查询条件：只取**已被软删除**的行。"""
    return model.deleted_at.is_not(None)


def is_deleted(item: Any) -> bool:
    return getattr(item, "deleted_at", None) is not None


def get_live(db: Session, model: Any, item_id: Any) -> Any | None:
    """按 id 取一条内容；**已在回收站里的当作不存在**（返回 None）。

    给"单条读取 / 单条修改"用。``db.get`` 会绕过查询过滤，所以直接用它取单条等于开了一个
    后门：列表里看不到、但知道 id 就能打开甚至继续编辑。P5 已经在 API 层与几个服务访问器上
    堵住了，这里是**同一套语义的共用实现**——写一次，比每个工具各写一遍 ``is_deleted`` 可靠。
    """
    item = db.get(model, item_id)
    if item is None or is_deleted(item):
        return None
    return item


def soft_delete(db: Session, key: str, item: Any) -> None:
    """把一条内容移入回收站（**不 commit**，由调用方决定事务边界）。

    幂等：已经在回收站里的记录不会被刷新删除时间——否则"重复点删除"会让它在回收站里的
    位置不断上浮，看起来像刚删的。
    """
    if getattr(item, "deleted_at", None) is None:
        item.deleted_at = utcnow()
    logger.info("已移入回收站 type=%s id=%s", key, getattr(item, "id", None))


def _brief(spec: TrashSpec, item: Any) -> dict[str, Any]:
    deleted_at = getattr(item, "deleted_at", None)
    subtitle = getattr(item, spec.subtitle_field, "") if spec.subtitle_field else ""
    title = (
        spec.title_builder(item)
        if spec.title_builder is not None
        else str(getattr(item, spec.title_field, "") or "")
    )
    return {
        "type": spec.key,
        "type_label": spec.label,
        "id": item.id,
        "title": title,
        "subtitle": str(subtitle or ""),
        "deleted_at": deleted_at.isoformat() if isinstance(deleted_at, datetime) else None,
    }


def counts(db: Session) -> dict[str, int]:
    """各类内容的回收站条数（界面用它显示"回收站 (3)"这样的角标）。"""
    return {
        spec.key: db.query(spec.model).filter(trash_only(spec.model)).count()
        for spec in TRASH_SPECS
    }


def list_trashed(
    db: Session, *, key: str = "", limit: int = MAX_TRASH_ITEMS
) -> list[dict[str, Any]]:
    """列出回收站内容，**按删除时间倒序**（最近的先看到）。

    ``key`` 留空表示不限类型——界面用一张表混排所有类型，带类型标签与筛选，
    比六个页签更省事也更好找。
    """
    spec = spec_or_none(key)
    specs = (spec,) if spec else TRASH_SPECS
    items: list[dict[str, Any]] = []
    for one in specs:
        rows = (
            db.query(one.model)
            .filter(trash_only(one.model))
            .order_by(one.model.deleted_at.desc())
            .limit(max(1, limit))
            .all()
        )
        items.extend(_brief(one, row) for row in rows)
    items.sort(key=lambda item: item["deleted_at"] or "", reverse=True)
    return items[: max(1, limit)]


class RestoreConflict(Exception):
    """恢复会撞上活动行唯一约束时拒绝：给出具体原因，而不是 500 / IntegrityError。

    partial unique index 只在**活动行**之间生效，所以回收站里的同名行可以并存；一旦恢复，
    它就可能和"外面那条活动行"撞名（组/自建大字段的名称、同分区自建字段的标签、同分区
    条目的排序位）。直接写库会抛 IntegrityError——API 层拿不到可读原因，用户只看到 500。
    这里在写库前先查一遍，把冲突翻译成 `detail`（发生了什么 + 怎么办）；
    `api/trash.py` 再映射成 409 `{"detail", "code": "trash_restore_conflict"}`。
    """

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _restore_conflict_detail(db: Session, spec: TrashSpec, item: Any) -> str | None:
    """检查恢复这一条会不会撞上活动行唯一约束；返回 None = 可以恢复。

    **鸭子类型**判断（不按具体模型 isinstance 分支）：有 `name_key` 的是"活动名称唯一"
    类（组 / 自建大字段）；有 `label_key` 的是"同分区活动标签唯一"类（自建小字段）；
    有 `values` 的是条目，靠 `(section_key, sort_order)` 活动位唯一；有
    `dataset_key` 且有 `kind` 的是偏好档，靠 `(dataset_key, kind)` 的活动行唯一。
    以后同类软删表只要列语义一致就自动获得守卫，不必在恢复路径里再加分支。
    """
    model = type(item)
    active = db.query(model).filter(model.deleted_at.is_(None))
    name_key = getattr(item, "name_key", None)
    if name_key is not None:
        same = active.filter(model.name_key == name_key).first()
        if same is not None:
            return (
                f"回收站外已有同名{spec.label}「{same.name}」，"
                "请先给它改名或删除它，再恢复这条"
            )
    label_key = getattr(item, "label_key", None)
    if label_key is not None:
        same = active.filter(
            model.section_key == item.section_key, model.label_key == label_key
        ).first()
        if same is not None:
            return (
                f"同一大字段下已有同名字段「{same.label}」，"
                "请先给它改名或删除它，再恢复这条"
            )
    if hasattr(item, "values"):
        same = active.filter(
            model.section_key == item.section_key, model.sort_order == item.sort_order
        ).first()
        if same is not None:
            return (
                f"这一条原来的位置（第 {item.sort_order + 1} 位）已被其他条目占用，"
                "请先调整排序或删除占位条目，再恢复这条"
            )
    # 求职偏好（0008）：活动行唯一性是 (dataset_key, kind) 上的 partial unique index。
    # 用鸭子类型而不是 isinstance 分支：以后同类"按 dataset_key + kind 单值"的软删表
    # 自动获得守卫。恢复意味着这条要重新生效，而"让旧那条让位"是另一个动词（版本回退走
    # state 的 undone / superseded 路径），所以这里不替用户猜，直接给出可读的 409 原因。
    dataset_key = getattr(item, "dataset_key", None)
    kind = getattr(item, "kind", None)
    state = getattr(item, "state", None)
    if dataset_key is not None and kind is not None and state is not None:
        same = active.filter(
            model.dataset_key == dataset_key,
            model.kind == kind,
            model.state == _ACTIVE_STATE,
            model.id != item.id,
        ).first()
        if same is not None:
            return (
                f"回收站外已有同类的{spec.label}，"
                "请先撤销或删除它，再恢复这条"
            )
    return None


def restore(db: Session, key: str, item_id: int) -> bool:
    """把一条内容从回收站恢复（清空时间戳）。找不到返回 False。

    恢复前先检查活动行唯一性：撞名/撞排序位时抛 `RestoreConflict`（API 映射 409），
    不让数据库的 IntegrityError 变成 500，也不留下"删得掉、恢复不回来"的死角。
    """
    spec = spec_or_none(key)
    if spec is None:
        return False
    item = db.get(spec.model, item_id)
    if item is None or not is_deleted(item):
        return False
    conflict = _restore_conflict_detail(db, spec, item)
    if conflict is not None:
        logger.info("恢复被拒绝（活动行冲突） type=%s id=%s", safe_log_text(key), int(item_id))
        raise RestoreConflict(conflict)
    item.deleted_at = None
    db.commit()
    logger.info("已从回收站恢复 type=%s id=%s", safe_log_text(key), int(item_id))
    return True


def restore_many(db: Session, items: list[dict[str, Any]]) -> dict[str, Any]:
    """批量恢复（单事务提交）；逐条复用 `restore` 的 "在回收站里才算数" 语义。

    与单条 `restore` 一样**只认已在回收站里的记录**：不在回收站里（已被恢复/彻底删除/
    类型未知）的逐条记 `ok=False`，不拖累同批其它条目。

    **活动行冲突按整批拒绝**：任一选中条目恢复后会撞名/撞排序位就抛 `RestoreConflict`
    （API 映射 409），已清掉的时间戳随 `rollback()` 回滚——不出现"恢复了一半"的中间态。
    """
    restored = 0
    results: list[dict[str, Any]] = []
    for item in items:
        key = str(item.get("type_key") or "").strip()
        item_id = item.get("id")
        ok = False
        spec = spec_or_none(key)
        if spec is not None and isinstance(item_id, int):
            candidate = db.get(spec.model, item_id)
            if candidate is not None and is_deleted(candidate):
                conflict = _restore_conflict_detail(db, spec, candidate)
                if conflict is not None:
                    db.rollback()
                    logger.info(
                        "批量恢复被拒绝（活动行冲突） type=%s id=%s",
                        safe_log_text(key),
                        int(item_id),
                    )
                    raise RestoreConflict(conflict)
                candidate.deleted_at = None
                restored += 1
                ok = True
        results.append({"type_key": key, "id": item_id, "ok": ok})
    db.commit()
    logger.info("批量恢复完成：成功 %s 条 / 共 %s 条", restored, len(items))
    return {"restored": restored, "results": results}


def purge(db: Session, key: str, item_id: int) -> bool:
    """**彻底删除**一条内容（真删，不可恢复）。

    只允许删除**已经在回收站里**的记录：这样"删除"永远先经过可恢复的一步，
    不会出现"点了删除就没了"的路径。找不到或不在回收站里都返回 False。
    """
    spec = spec_or_none(key)
    if spec is None:
        return False
    item = db.get(spec.model, item_id)
    if item is None or not is_deleted(item):
        return False
    # 同事务内先解除快照引用，再删行：不留下"指向已删简历"的悬空快照。
    release_snapshot_references(db, key, [int(item.id)])
    db.delete(item)
    db.commit()
    logger.info("已彻底删除 type=%s id=%s", safe_log_text(key), int(item_id))
    return True


def purge_many(db: Session, items: list[dict[str, Any]]) -> dict[str, Any]:
    """批量彻底删除（单事务提交）；语义同单条 ``purge``（只删已在回收站里的，二次确认由前端做）。"""
    purged = 0
    results: list[dict[str, Any]] = []
    for item in items:
        key = str(item.get("type_key") or "").strip()
        item_id = item.get("id")
        ok = False
        spec = spec_or_none(key)
        if spec is not None and isinstance(item_id, int):
            candidate = db.get(spec.model, item_id)
            if candidate is not None and is_deleted(candidate):
                release_snapshot_references(db, key, [int(candidate.id)])
                db.delete(candidate)
                purged += 1
                ok = True
        results.append({"type_key": key, "id": item_id, "ok": ok})
    db.commit()
    logger.info("批量彻底删除完成：删除 %s 条 / 共 %s 条", purged, len(items))
    return {"purged": purged, "results": results}


def empty(db: Session, *, key: str = "") -> int:
    """清空回收站（``key`` 留空表示全部类型）。返回彻底删除的条数。"""
    spec = spec_or_none(key)
    specs = (spec,) if spec else TRASH_SPECS
    removed = 0
    for one in specs:
        rows = db.query(one.model).filter(trash_only(one.model)).all()
        release_snapshot_references(db, one.key, [int(row.id) for row in rows])
        for row in rows:
            db.delete(row)
            removed += 1
    db.commit()
    logger.info("已清空回收站 type=%s，彻底删除 %s 条", safe_log_text(key or "全部"), int(removed))
    return removed


__all__ = [
    "MAX_TRASH_ITEMS",
    "get_live",
    "TRASHED_TABLES",
    "TRASH_SPECS",
    "TRASH_SPEC_BY_KEY",
    "TrashSpec",
    "counts",
    "empty",
    "is_deleted",
    "list_trashed",
    "live_only",
    "purge",
    "purge_many",
    "RestoreConflict",
    "restore",
    "restore_many",
    "soft_delete",
    "spec_or_none",
    "trash_only",
]
