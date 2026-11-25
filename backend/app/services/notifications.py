# SPDX-License-Identifier: Apache-2.0
"""通知的唯一写入口与读侧查询（CR-22 / CR-25 的共用底座）。

**唯一出口是 :func:`emit`**：任何地方要"告诉用户一件事"，都先落一行 ``notification``，
再由各通道（应用内 toast / 桌面通知 / 页头铃铛）按自己的方式呈现。这样"窗口不在就错过"
不再等于"事件丢了"，也避免每个调用方各写一套去重与未读逻辑。

幂等口径由 ``dedupe_key`` 唯一索引保证：同一次事件重复投递（60 秒扫描、开机补扫、
并发扫描）只留第一行，``emit`` 返回既有行。**不吞异常**：调用方事务里的 ``emit`` 只
``flush`` 不 ``commit``——提醒的 ``last_notified_at`` 与通知行必须在同一事务里落库，
否则会出现"标记已提醒但通知没写进去"的永久静默。

读侧一律按当前数据集过滤，并过滤掉已过期的行：``expires_at`` 只是读时窗口，
真正的物理清理由后台任务另做（inbox 保留 30 天）。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.notification import NOTIFICATION_SEVERITY_INFO, Notification
from ..models.profile import utcnow

logger = logging.getLogger(__name__)

MAX_NOTIFICATION_LIST = 200

#: inbox 保留窗口（CR-25 口径）：超过 30 天的行不再出现在列表，并由清理任务物理删除。
#: 判定基准是 ``created_at``（"这件事什么时候发生的"），不是 ``read_at``——用户一直没点开
#: 的旧通知也不该无限堆在库里。
NOTIFICATION_RETENTION = timedelta(days=30)


def _as_naive_utc(value: datetime) -> datetime:
    """全库时间口径是 naive UTC；注入的 aware 时钟先归一。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _current_dataset_key() -> str:
    """当前数据集标识；未初始化运行时（脚本/单测直调）时退回主数据。"""
    from ..runtime import dataset_scope

    try:
        return dataset_scope.current_dataset_id()
    except Exception:  # noqa: BLE001 - 读不到数据集身份时按主数据落，不阻断投递
        return "main"


def emit(
    db: Session,
    *,
    type: str,
    severity: str = NOTIFICATION_SEVERITY_INFO,
    title: str,
    body: str = "",
    deep_link: str = "",
    dedupe_key: str,
    expires_at: datetime | None = None,
) -> Notification:
    """写一条通知（幂等）：同 ``dedupe_key`` 已存在则返回既有行，否则插入返回。

    只 ``flush`` 不 ``commit``：调用方负责提交，才能让"业务标记"与"通知行"同事务。
    并发下唯一索引冲突时回滚到保存点并读回既有行——不把 IntegrityError 抛给扫描线程。
    """
    existing = db.query(Notification).filter(Notification.dedupe_key == dedupe_key).one_or_none()
    if existing is not None:
        return existing

    row = Notification(
        type=type,
        severity=severity,
        title=title[:200],
        body=body,
        deep_link=deep_link[:500],
        dedupe_key=dedupe_key[:200],
        # 没显式给期限的行按 inbox 保留窗口过期：读侧即便按 created_at 已经过滤，
        # 这一列仍让"清理"与"读时过滤"两个口径指向同一刻（迁移前写入的旧行也能被收掉）。
        expires_at=expires_at or (utcnow() + NOTIFICATION_RETENTION),
        dataset_key=_current_dataset_key(),
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        logger.info("通知 dedupe_key 并发命中，返回既有行 key=%s", dedupe_key)
        existing = (
            db.query(Notification).filter(Notification.dedupe_key == dedupe_key).one_or_none()
        )
        if existing is None:  # 唯一冲突却查不到，只可能是别的数据集；交给调用方继续
            raise
        return existing
    return row


def _live_query(db: Session, now: datetime | None = None):
    """当前数据集 + 保留窗口内；读侧的唯一过滤口径。

    ``now`` 可注入（测试与补扫用同一个"现在"）：窗口按 ``created_at`` 判，
    不依赖后台清理是否已经跑过——"到期但还没删"的行不会短暂可见。
    """
    moment = _as_naive_utc(now or utcnow())
    return db.query(Notification).filter(
        Notification.dataset_key == _current_dataset_key(),
        Notification.created_at >= moment - NOTIFICATION_RETENTION,
        or_(Notification.expires_at.is_(None), Notification.expires_at > moment),
    )


def list_notifications(
    db: Session, *, limit: int = 50, before: datetime | None = None, now: datetime | None = None
) -> list[Notification]:
    """按时间倒序分页；``before`` 是上一页最后一条的 ``created_at``。"""
    query = _live_query(db, now=now)
    if before is not None:
        query = query.filter(Notification.created_at < before)
    return (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(max(1, min(limit, MAX_NOTIFICATION_LIST)))
        .all()
    )


def unread_count(db: Session, *, now: datetime | None = None) -> int:
    """未读数（只算当前数据集、窗口内、未读）。"""
    return int(
        _live_query(db, now=now)
        .filter(Notification.read_at.is_(None))
        .with_entities(func.count(Notification.id))
        .scalar()
        or 0
    )


def mark_read(
    db: Session, notification_id: int, *, now: datetime | None = None
) -> Notification | None:
    """标记单条已读（幂等）；不存在/非当前数据集/已过期返回 None。"""
    row = _live_query(db, now=now).filter(Notification.id == notification_id).one_or_none()
    if row is None:
        return None
    if row.read_at is None:
        row.read_at = utcnow()
        db.commit()
        db.refresh(row)
    return row


def mark_all_read(db: Session, *, now: datetime | None = None) -> int:
    """全部标记已读，返回本次实际改动的行数。"""
    updated = (
        _live_query(db, now=now)
        .filter(Notification.read_at.is_(None))
        .update({Notification.read_at: utcnow()}, synchronize_session=False)
    )
    db.commit()
    return int(updated or 0)


def purge_expired(db: Session, *, now: datetime | None = None) -> int:
    """物理删除窗口外的行（只删当前数据集），返回删掉的行数。

    与读侧同一份窗口常量：读侧决定"看得见什么"，这里决定"库里留多久"。两个口径
    指向同一刻，才不会出现"列表里看不到、库里永远删不掉"的幽灵行。
    """
    moment = _as_naive_utc(now or utcnow())
    removed = (
        db.query(Notification)
        .filter(
            Notification.dataset_key == _current_dataset_key(),
            or_(
                Notification.created_at < moment - NOTIFICATION_RETENTION,
                Notification.expires_at.is_not(None) & (Notification.expires_at <= moment),
            ),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(removed or 0)


#: 惰性清理的最小间隔：inbox 只在"有人在看"时才需要准确，没必要每 30 秒扫一遍全表。
CLEANUP_INTERVAL = timedelta(hours=1)
_last_cleanup_at: datetime | None = None


def cleanup_if_due(db: Session, *, now: datetime | None = None) -> int:
    """至多每小时物理清理一次窗口外的行；返回本次删除数（未到期则 0）。

    挂在读侧（列表 / 未读数）而不是另起线程：清理的目的只是"库里别无限长"，而这件事
    只对打开过应用的人有意义。读侧本来已经按 ``created_at`` 过滤，所以清理晚一拍也不
    会让过期行"可见"。**失败不抛出**：清理是旁路，绝不能把读接口拖成 500。
    """
    global _last_cleanup_at
    moment = _as_naive_utc(now or utcnow())
    if _last_cleanup_at is not None and moment - _last_cleanup_at < CLEANUP_INTERVAL:
        return 0
    _last_cleanup_at = moment
    try:
        return purge_expired(db, now=moment)
    except Exception:  # noqa: BLE001 - 清理失败不能影响读接口
        logger.warning("通知过期清理失败", exc_info=True)
        db.rollback()
        return 0


__all__ = [
    "CLEANUP_INTERVAL",
    "MAX_NOTIFICATION_LIST",
    "NOTIFICATION_RETENTION",
    "cleanup_if_due",
    "emit",
    "list_notifications",
    "mark_all_read",
    "mark_read",
    "purge_expired",
    "unread_count",
]
