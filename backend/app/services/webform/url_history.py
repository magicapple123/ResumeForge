"""网申网址历史的持久化服务。"""
from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.web_form_url_history import WebFormUrlHistory

MAX_HISTORY = 50


def normalize_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("请输入完整的 http 或 https 网申网址")
    return url[:2048]


def list_urls(db: Session, *, limit: int = MAX_HISTORY) -> list[WebFormUrlHistory]:
    return (
        db.query(WebFormUrlHistory)
        .order_by(WebFormUrlHistory.last_used_at.desc(), WebFormUrlHistory.id.desc())
        .limit(max(1, min(limit, MAX_HISTORY)))
        .all()
    )


def remember_url(db: Session, url: str, *, title: str = "") -> WebFormUrlHistory:
    normalized = normalize_url(url)
    now = utcnow()
    item = db.query(WebFormUrlHistory).filter_by(url=normalized).one_or_none()
    if item is None:
        item = WebFormUrlHistory(url=normalized, title=title[:256], last_used_at=now)
        db.add(item)
    else:
        item.title = title[:256] or item.title
        item.last_used_at = now
    db.commit()
    db.refresh(item)
    return item


def delete_url(db: Session, item_id: int) -> bool:
    item = db.get(WebFormUrlHistory, item_id)
    if item is None:
        return False
    db.delete(item)
    db.commit()
    return True


__all__ = ["MAX_HISTORY", "delete_url", "list_urls", "normalize_url", "remember_url"]
