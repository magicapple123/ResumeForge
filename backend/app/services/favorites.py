# SPDX-License-Identifier: Apache-2.0
"""收藏状态与收藏时间的唯一写入口（#28E，T15/R2）。

收藏现在涉及两个字段：favorite 布尔列（查询条件）与 favorited_at 时间戳（排序/展示依据）。
任何一处只改布尔列，症状都是静默的：收藏成功了但「按收藏时间」排到最后；取消收藏了却还留着
一个时间戳。所以所有写入点（岗位 PUT / 岗位收藏夹批量 / 简历收藏端点 / 助手工具）统一走这里。

语义三条：① 收藏写当前时间并置 estimated=False；② 取消清空时间（与「从未收藏」同形）；
③ 幂等：已收藏再次提交收藏不刷新时间——重新点一次星星不该把它顶到列表最前面。

**第四件事：收藏不许改写 ``updated_at``**（T15 / 排查报告 §3.1 R2）。三张表的 ``updated_at``
都带 ``onupdate=utcnow``，一次 ORM 属性赋值收藏就会在 flush 时顺手把它刷成"刚刚"；而简历
列表默认按 ``updated_desc`` 排序，于是用户点一下星星，那一行就带着星星跳到组首——看起来
像"收藏错了行"。收藏是**标记**不是**编辑**：它不改变文档内容，不该参与"最近修改"排序。

两个写入口都留在本模块，取舍各自写在文档串里：

- ``update_favorite(db, Model, record_id, favorite)``：**所有已落库的行**都走它
  （Core UPDATE + 把 ``updated_at`` 列自身写回 SET 子句 → 抑制 ``onupdate``）；
- ``apply_favorite(target, favorite)``：只给**还没进库的新行**用（INSERT 本来就在写
  ``updated_at``，没有"被刷新"的问题），以及需要纯对象语义的调用方。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models.profile import utcnow


def resolve_favorite(
    favorite: bool,
    *,
    current_favorite: bool,
    current_timestamp: datetime | None,
    now: datetime | None = None,
) -> tuple[bool, datetime | None, bool] | None:
    """算出收藏三个标的列的目标值 ``(favorite, favorited_at, estimated)``。

    返回 ``None`` 表示"不需要写库"——两个写入口（对象版与 Core 版）共用这一份判据，
    幂等语义因此不会在两个入口之间漂移。

    幂等判据只有一条：**目标状态与现状完全一致**（布尔相等，且"有没有时间戳"也相等）。
    历史行 ``favorite=True`` 但没有时间戳（28E 之前写的老数据）不算一致——那正是要补
    时间戳的那一种（见 ``test_resume_favorite_backfills_missing_timestamp``）。
    """
    value = bool(favorite)
    if value == bool(current_favorite) and value == (current_timestamp is not None):
        return None
    if not value:
        # 取消收藏：清回 NULL，与「从未收藏」同形（estimated 一并归零）。
        return False, None, False
    # 已收藏再收藏：保留原时间（幂等）；只有缺时间时才补一个"现在"。
    stamp = current_timestamp if current_timestamp is not None else (now or utcnow())
    return True, stamp, False


def apply_favorite(target: object, favorite: bool, *, now: datetime | None = None) -> None:
    """把 favorite 与 favorited_at 一起改在**对象**上（Job / ResumeRecord 同一套语义）。

    target 只要求具备 ``favorite`` / ``favorited_at``（可选 ``favorited_at_estimated``）
    三个属性；不返回值、不 commit——事务边界留在调用方（与 job_service 的其余更新一致）。

    **不要拿它去改已经落库的行**：ORM 赋值之后 flush 会照常触发 ``updated_at`` 的
    ``onupdate``，那正是 T15 要消灭的"点星星跳行"。已存在的行走 ``update_favorite``。
    """
    resolved = resolve_favorite(
        favorite,
        current_favorite=bool(getattr(target, "favorite", False)),
        current_timestamp=getattr(target, "favorited_at", None),
        now=now,
    )
    if resolved is None:
        return
    value, stamp, estimated = resolved
    target.favorite = value  # type: ignore[attr-defined]
    target.favorited_at = stamp  # type: ignore[attr-defined]
    # external_resume 没有 estimated 列（它的收藏时间都是精确值），存在才写。
    if hasattr(target, "favorited_at_estimated"):
        target.favorited_at_estimated = estimated  # type: ignore[attr-defined]


def update_favorite(
    db: Session,
    model: Any,
    record_id: int,
    favorite: bool,
    *,
    now: datetime | None = None,
) -> bool:
    """按主键写收藏，**不改写 ``updated_at``**；返回是否真的写了库。

    ``model`` 是映射类（``Job`` / ``ResumeRecord`` / ``ExternalResume``），只要求它具备
    ``id`` / ``favorite`` / ``favorited_at`` 三列（``favorited_at_estimated`` 有则一起写）。
    不 commit——事务边界仍在调用方；调用方需要对象时用 ``db.refresh(obj)`` 后再序列化
    （本函数已用 ``synchronize_session="fetch"`` 把新值同步回会话内的对象，refresh 只是
    把"库里到底是什么"这件事也确认一遍）。

    为什么是 Core UPDATE：``updated_at`` 的 ``onupdate=utcnow`` 只在"该列没有出现在
    UPDATE 的 SET 子句里"时才生效。把列**自身**写回去（``updated_at = job.updated_at``）
    生成的是 `updated_at = job.updated_at`，值不变、onupdate 被抑制。**绝不能**在这里写
    Python 侧的 ``utcnow()``——那等于手动刷新，与直接用 ORM 赋值是同一个 bug。
    """
    current = db.execute(
        select(model.favorite, model.favorited_at).where(model.id == record_id)
    ).first()
    if current is None:
        # 行不存在（被并发彻底删除）：不建行、不改库，由调用方的 404/跳过逻辑处理。
        return False
    resolved = resolve_favorite(
        favorite,
        current_favorite=bool(current[0]),
        current_timestamp=current[1],
        now=now,
    )
    if resolved is None:
        return False
    value, stamp, estimated = resolved
    values: dict[str, Any] = {
        "favorite": value,
        "favorited_at": stamp,
        # 抑制 onupdate 的那一行，理由见文档串末尾。
        "updated_at": model.updated_at,
    }
    if hasattr(model, "favorited_at_estimated"):
        values["favorited_at_estimated"] = estimated
    db.execute(
        update(model)
        .where(model.id == record_id)
        .values(**values)
        # 会话里可能已经加载了这一行（调用方先取对象再改）：用 fetch 把新值同步回去，
        # 免得调用方忘了 refresh 时序列化出旧值——那会变成"点了星星但界面还是空的"。
        .execution_options(synchronize_session="fetch")
    )
    return True


__all__ = ["apply_favorite", "resolve_favorite", "update_favorite"]
