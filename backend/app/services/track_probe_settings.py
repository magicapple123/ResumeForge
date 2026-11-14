# SPDX-License-Identifier: Apache-2.0
"""申请状态回读的开关、登录凭据与补算节奏（R-15 C）。

单独一个模块，因为它和"抓页面"是两件事：这里只管**该不该跑、用什么身份跑、
隔多久再跑**，一行网络代码都没有。设置存在 `app_setting`，与其它运行时设置
同一套 JSON 行。

Cookie 是登录凭据：:func:`read_settings` 只回"有没有配"，原值只由
:func:`read_cookie` 在服务层内部取出，**从不进 API 响应**。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models.setting import AppSetting

_PROBE_ENABLED_KEY = "tracker.probe.enabled"
_PROBE_COOKIE_KEY = "tracker.probe.cookie"
_PROBE_LAST_RUN_KEY = "tracker.probe.last_run"
#: 常用的「投递记录页」：一次能读到所有公司的进度（列表页模式）。
_PROBE_PAGE_URL_KEY = "tracker.probe.page_url"

#: 自动回读的最小间隔（小时）：打开页面时补算一次，挡住频繁切换页面。
PROBE_INTERVAL_HOURS = 20


@dataclass(frozen=True)
class ProbeSettings:
    enabled: bool
    has_cookie: bool
    last_run: str
    #: 用户存的投递记录页（空串 = 没配，只用逐条岗位页回读）。
    page_url: str = ""

    @property
    def needs_cookie(self) -> bool:
        return self.enabled and not self.has_cookie


def _read_setting(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    return row.value if row is not None else ""


def _write_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def read_settings(db: Session) -> ProbeSettings:
    enabled = _read_setting(db, _PROBE_ENABLED_KEY)
    return ProbeSettings(
        enabled=bool(enabled) and json.loads(enabled) is True,
        has_cookie=bool(_read_setting(db, _PROBE_COOKIE_KEY).strip()),
        last_run=_read_setting(db, _PROBE_LAST_RUN_KEY),
        page_url=_read_setting(db, _PROBE_PAGE_URL_KEY),
    )


def write_settings(
    db: Session,
    *,
    enabled: bool | None = None,
    cookie: str | None = None,
    page_url: str | None = None,
) -> ProbeSettings:
    """更新开关、Cookie 与常用记录页。

    ``cookie`` 传空串表示清除（不回传原值，避免泄露）；``page_url`` 同理。
    """
    if enabled is not None:
        _write_setting(db, _PROBE_ENABLED_KEY, json.dumps(bool(enabled)))
    if cookie is not None:
        _write_setting(db, _PROBE_COOKIE_KEY, cookie.strip())
    if page_url is not None:
        _write_setting(db, _PROBE_PAGE_URL_KEY, page_url.strip())
    db.commit()
    return read_settings(db)


def read_cookie(db: Session) -> str:
    """取登录 Cookie。只在服务层用，**不回传前端**（`read_settings` 只给布尔）。"""
    return _read_setting(db, _PROBE_COOKIE_KEY).strip()


def mark_ran(db: Session, *, now: datetime | None = None) -> str:
    stamp = (now or datetime.now()).isoformat(timespec="seconds")
    _write_setting(db, _PROBE_LAST_RUN_KEY, stamp)
    db.commit()
    return stamp


def due_for_daily(db: Session, *, now: datetime | None = None) -> bool:
    """今天该不该自动补算一次（开关开 + 有 Cookie + 距上次超过间隔）。"""
    settings = read_settings(db)
    if not settings.enabled or not settings.has_cookie:
        return False
    if not settings.last_run:
        return True
    try:
        last = datetime.fromisoformat(settings.last_run)
    except ValueError:
        return True
    return (now or datetime.now()) - last >= timedelta(hours=PROBE_INTERVAL_HOURS)


__all__ = [
    "PROBE_INTERVAL_HOURS",
    "ProbeSettings",
    "due_for_daily",
    "mark_ran",
    "read_cookie",
    "read_settings",
    "write_settings",
]
