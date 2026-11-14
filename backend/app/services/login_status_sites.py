# SPDX-License-Identifier: Apache-2.0
"""网申登录态的**逐站点**口径（F07）：清单派生、逐站点检测、判定与缓存。

为什么要从 `login_status` 拆出来：站点这件事有自己的一组常量（上限、URL 特征、英文登录词）
与一条独立的探测链（`open_url` → 等页面就绪 → 读三样证据），与"三个来源"的 KV 结构不是同一层。
拆开后两边都在 500 行预算内，`login_status` 仍是面板的唯一入口。

**零迁移**：清单来自既有的 `web_form_fill_record` 与 `web_form_url_history`，状态存
`AppSetting` 的 `login_status.webform_site.<host>`。新增站点不需要登记任何东西。

三条与 `login_status` 同源的硬约束：

1. **只读缓存**：清单接口绝不触发检测（浏览器类会弹窗）。
2. **`unknown` 不写成 `expired`**：英文 ATS 可能长期"无法判断"，这是不误报的代价。
3. **host 必须命中服务端派生的清单**：不接受前端传任意 URL。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from .browser.page_ready import ReadyWait, wait_for_page_state
from .login_status import (
    LoginStatusValue,
    _now,
    _parse_status_record,
    _read_setting,
    _take_cooldown,
    _write_setting,
)
from .track_portal import looks_like_login_page

#: 清单上限：超出按最近使用截断，界面提示"还有 N 个没列出来"。
MAX_WEBFORM_SITES = 12

#: 一个 host 一行状态；值里带 `probe_url`，地址变了就作废旧结论。
_SITE_STATUS_KEY = "login_status.webform_site.{host}"

# 判定登录页的 URL path 特征（只认路径段，避免 `?redirect=/login` 这类参数误伤）。
_LOGIN_PATH = re.compile(r"/(login|signin|sign-in|passport|sso|auth)(/|$)", re.IGNORECASE)
# 英文 ATS 的登录页措辞：命中 >=2 个 **且** 短页 **且** 有密码框才判 expired。
_LOGIN_WORDS = (
    "sign in",
    "log in",
    "login",
    "password",
    "forgot password",
    "create account",
    "username",
    "email address",
)
#: 页面脚本：一次拿齐"最终地址 / 正文 / 是否有密码框"（判定只看这三样）。
_PROBE_SCRIPT = (
    "(() => ({ ready: document.readyState === 'complete',"
    " href: location.href,"
    " text: ((document.body && document.body.innerText) || '').slice(0, 6000),"
    " hasPassword: !!document.querySelector('input[type=\"password\"]') }))()"
)


def _host_of(url: str) -> str:
    try:
        return (urlsplit(str(url or "")).hostname or "").lower()
    except ValueError:
        return ""


def _site_label(title: str, host: str) -> str:
    return (str(title or "").strip() or host)[:80]


def webform_sites(db: Session) -> list[dict[str, Any]]:
    """按 host 去重出网申站点清单。

    两张表合并：`WebFormFillRecord`（真的填过，带页面标题）与 `WebFormUrlHistory`
    （打开过）。显示名优先 `page_title`，探测 URL 优先最新填充记录；按最近使用排序，
    上限 `MAX_WEBFORM_SITES`，超出部分由 :func:`webform_sites_payload` 报给界面。
    """
    from .webform import history as webform_history
    from .webform import url_history

    candidates: dict[str, dict[str, Any]] = {}

    def entry(host: str) -> dict[str, Any]:
        return candidates.setdefault(
            host, {"host": host, "label": "", "probe_url": "", "latest": None, "title": ""}
        )

    # 填充记录按时间倒序：第一条即该 host 最近一次填充（探测 URL 取它）。
    for record in webform_history.list_records(db, limit=webform_history.MAX_LIST_LIMIT):
        host = _host_of(record.url)
        if not host:
            continue
        item = entry(host)
        if not item["probe_url"]:
            item["probe_url"] = record.url
            item["title"] = record.page_title
            item["latest"] = record.created_at
    for row in url_history.list_urls(db):
        host = _host_of(row.url)
        if not host:
            continue
        item = entry(host)
        if not item["probe_url"]:
            item["probe_url"] = row.url
            item["title"] = row.title
        if item["latest"] is None or row.last_used_at > item["latest"]:
            item["latest"] = row.last_used_at

    ordered = sorted(candidates.values(), key=lambda item: item["latest"] or datetime.min)
    ordered.reverse()
    sites: list[dict[str, Any]] = []
    for item in ordered[:MAX_WEBFORM_SITES]:
        host = item["host"]
        sites.append(
            {
                "host": host,
                "label": _site_label(item["title"], host),
                "probe_url": item["probe_url"],
                **_read_site_status(db, host, item["probe_url"]),
            }
        )
    return sites


def webform_sites_payload(db: Session) -> dict[str, Any]:
    """清单 + 截断信息（界面要能说"还有 N 个没列出来"）。"""
    sites = webform_sites(db)
    total = len(_all_webform_hosts(db))
    return {"items": sites, "total": total, "truncated": max(0, total - len(sites))}


def _all_webform_hosts(db: Session) -> set[str]:
    from .webform import history as webform_history
    from .webform import url_history

    hosts = {
        _host_of(row.url)
        for row in webform_history.list_records(db, limit=webform_history.MAX_LIST_LIMIT)
    }
    hosts.update(_host_of(row.url) for row in url_history.list_urls(db))
    return {host for host in hosts if host}


def site_probe_url(db: Session) -> str:
    """父行的探测地址（"重新登录"用）：清单里最新那个站点的地址。"""
    sites = webform_sites(db)
    return sites[0]["probe_url"] if sites else ""


def _site_status_key(host: str) -> str:
    return _SITE_STATUS_KEY.format(host=host)


def _read_site_status(db: Session, host: str, probe: str) -> dict[str, Any]:
    return _parse_status_record(
        _read_setting(db, _site_status_key(host)),
        current_probe_url=probe,
        reset_legacy=True,
    )


def _save_site_status(
    db: Session, host: str, status: LoginStatusValue, detail: str, probe: str
) -> dict[str, Any]:
    payload = {"status": status, "checked_at": _now(), "detail": detail, "probe_url": probe}
    _write_setting(db, _site_status_key(host), json.dumps(payload, ensure_ascii=False))
    db.commit()
    return payload


class _ProbeTimeout(Exception):
    """页面一直没就绪：带上最后一次观测，交给判定逻辑按证据说话。"""

    def __init__(self, state: dict[str, Any]) -> None:
        super().__init__("probe timeout")
        self.state = state


def _judge_site(state: dict[str, Any]) -> tuple[LoginStatusValue, str]:
    """站点判定：顺序固定，`unknown` 优先于误报 `expired`。"""
    href = str(state.get("href") or "")
    text = str(state.get("text") or "")
    path = urlsplit(href).path if href else ""
    if path and _LOGIN_PATH.search(path):
        return "expired", "停在登录页"
    if looks_like_login_page(text):
        return "expired", "停在登录页"
    lowered = text.lower()
    hits = sum(1 for word in _LOGIN_WORDS if word in lowered)
    if hits >= 2 and len(text) < 600 and bool(state.get("hasPassword")):
        return "expired", "页面像登录页（英文）"
    if len(text.strip()) < 20:
        return "unknown", "页面内容过少，无法判断"
    return "ok", ""


def _probe_webform_site(db: Session, url: str) -> tuple[LoginStatusValue, str]:
    """打开站点并**等页面真的就绪**再读。

    不能沿用 `_probe_browser` 的"navigate 完立刻 evaluate"：那会读到上一页，静默报 ok。
    这里复用 `open_url` 拿到的 target_id，只读**这个**标签页；等待用 `wait_for_page_state`。
    """
    if not url:
        return "unknown", "没有可用的探测地址"
    try:
        from .webform import browser as webform_browser

        opened = webform_browser.open_url(db, url)
        target_id = str(opened.get("target_id") or "")
        client = (
            webform_browser.client_for_target(db, target_id)
            if target_id
            else webform_browser.get_browser_manager(db).client()
        )
        try:
            try:
                state = wait_for_page_state(
                    lambda: client.evaluate(_PROBE_SCRIPT),
                    is_ready=lambda value: bool(value.get("ready")),
                    on_timeout=_ProbeTimeout,
                    config=ReadyWait(timeout=10.0),
                )
            except _ProbeTimeout as timeout:
                state = timeout.state
        finally:
            client.close()
    except Exception as error:  # noqa: BLE001 - 起不来就是"无法判断"，不是"已失效"
        return "unknown", f"浏览器没能打开探测页（{type(error).__name__}）"
    return _judge_site(state)


def find_webform_site(db: Session, host: str) -> dict[str, Any] | None:
    wanted = str(host or "").strip().lower()
    return next((site for site in webform_sites(db) if site["host"] == wanted), None)


def check_webform_site(db: Session, host: str) -> dict[str, Any]:
    """检测一个网申站点并写回；host 必须命中服务端派生的清单（不接受任意 URL）。"""
    site = find_webform_site(db, host)
    if site is None:
        raise KeyError(host)
    _take_cooldown(f"webform_site:{site['host']}")
    status, detail = _probe_webform_site(db, site["probe_url"])
    _save_site_status(db, site["host"], status, detail, site["probe_url"])
    return {**site, **_read_site_status(db, site["host"], site["probe_url"])}


__all__ = [
    "MAX_WEBFORM_SITES",
    "check_webform_site",
    "find_webform_site",
    "site_probe_url",
    "webform_sites",
    "webform_sites_payload",
]
