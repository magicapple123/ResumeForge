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
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from .browser.page_ready import ReadyWait, wait_for_page_state
from .login_status import (
    LoginStatusValue,
    _judge,
    _now,
    _parse_status_record,
    _read_setting,
    _take_cooldown,
    _write_setting,
)

#: 清单上限：超出按最近使用截断，界面提示"还有 N 个没列出来"。
MAX_WEBFORM_SITES = 12

#: 一个 host 一行状态；值里带 `probe_url`，地址变了就作废旧结论。
_SITE_STATUS_KEY = "login_status.webform_site.{host}"

#: host → **登录后才可见**的受限页相对路径。
#:
#: 只收"①无痕访问必跳登录 ②已登录能出内容"两条都成立的站点（证据见
#: `deliverables/execution/evidence/I-29/sites.md`）。**不要猜 URL**：猜错会把
#: "页面不存在"误判成"已失效"，比不检测更糟。留空 = 走回退，回退最多 `unknown`。
GATED_PROBE: dict[str, str] = {
    "jobs.bytedance.com": "/campus/position/application",
}

#: 受限页 404/空壳的特征（站点改版时首选落 `unknown`，不能因为"没看到登录页"又回到 `ok`）。
_MISSING_PAGE_MARKERS = ("404", "页面不存在", "页面未找到", "not found", "page not found")

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
    """站点判定＝与 Cookie / 投递浏览器**同一份** ``_judge``（I-29）。

    公开页即使正文完整也不会再给 `ok`：`ok` 只能来自账号标记，或受限页可访问
    （见 :func:`_probe_gated_site`）。
    """
    return _judge(
        str(state.get("text") or ""),
        href=str(state.get("href") or ""),
        has_password=bool(state.get("hasPassword")),
    )


def _read_state(db: Session, url: str) -> dict[str, Any] | str:
    """打开 URL 并**等页面真的就绪**再读。

    不能沿用 `_probe_browser` 的"navigate 完立刻 evaluate"：那会读到上一页，静默报 ok。
    这里复用 `open_url` 拿到的 target_id，只读**这个**标签页；等待用 `wait_for_page_state`。
    失败时返回一句人话（str），调用方一律落 `unknown`。
    """
    if not url:
        return "没有可用的探测地址"
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
                return wait_for_page_state(
                    lambda: client.evaluate(_PROBE_SCRIPT),
                    is_ready=lambda value: bool(value.get("ready")),
                    on_timeout=_ProbeTimeout,
                    config=ReadyWait(timeout=10.0),
                )
            except _ProbeTimeout as timeout:
                return timeout.state
        finally:
            client.close()
    except Exception as error:  # noqa: BLE001 - 起不来就是"无法判断"，不是"已失效"
        return f"浏览器没能打开探测页（{type(error).__name__}）"


def _probe_webform_site(db: Session, url: str) -> tuple[LoginStatusValue, str]:
    """回退路径（未配置受限页）：打开站点入口/岗位页。**最多 `unknown`**。"""
    state = _read_state(db, url)
    if isinstance(state, str):
        return "unknown", state
    return _judge_site(state)


def _gated_url(probe_url: str, host: str, path: str) -> str:
    """受限页地址：scheme 沿用站点探测地址，**host 必须是站点 host**（不接受任意 URL）。"""
    try:
        parts = urlsplit(str(probe_url or ""))
    except ValueError:
        return ""
    scheme = parts.scheme if parts.scheme in ("http", "https") else "https"
    url = f"{scheme}://{host}{path}"
    return url if _host_of(url) == host else ""


def _looks_like_missing_page(text: str) -> bool:
    lowered = text.lower()
    return len(text) < 600 and any(marker in lowered for marker in _MISSING_PAGE_MARKERS)


def _probe_gated_site(db: Session, site: dict[str, Any]) -> tuple[LoginStatusValue, str]:
    """探测登录后才可见的受限页：跳登录 → `logged-out`；出内容 → `ok`；打不开 → `unknown`。

    受限页上"有内容"本身就是登录证据，所以这里可以给 `ok`（detail 明写"受限页可访问"）。
    """
    path = GATED_PROBE.get(site["host"], "")
    url = _gated_url(site["probe_url"], site["host"], path) if path else ""
    if not url:
        return "unknown", "受限页地址无效"
    state = _read_state(db, url)
    if isinstance(state, str):
        return "unknown", state
    text = str(state.get("text") or "")
    status, detail = _judge_site(state)
    if status == "logged-out":
        return "logged-out", detail or "停在登录页"
    if len(text.strip()) < 20:
        return "unknown", "受限页内容过少，无法判断"
    if _looks_like_missing_page(text):
        # 站点改版后受限页可能 404：宁可"无法判断"，也不能因为"没看到登录页"又回到 ok。
        return "unknown", "受限页可能不存在（站点改版？）"
    return "ok", "受限页可访问"


def find_webform_site(db: Session, host: str) -> dict[str, Any] | None:
    wanted = str(host or "").strip().lower()
    return next((site for site in webform_sites(db) if site["host"] == wanted), None)


def check_webform_site(db: Session, host: str) -> dict[str, Any]:
    """检测一个网申站点并写回；host 必须命中服务端派生的清单（不接受任意 URL）。

    配置了受限页的站点优先探测受限页；其余退回岗位页（回退路径最多 `unknown`）。
    """
    site = find_webform_site(db, host)
    if site is None:
        raise KeyError(host)
    _take_cooldown(f"webform_site:{site['host']}")
    if site["host"] in GATED_PROBE:
        status, detail = _probe_gated_site(db, site)
    else:
        status, detail = _probe_webform_site(db, site["probe_url"])
    _save_site_status(db, site["host"], status, detail, site["probe_url"])
    return {**site, **_read_site_status(db, site["host"], site["probe_url"])}


__all__ = [
    "GATED_PROBE",
    "MAX_WEBFORM_SITES",
    "check_webform_site",
    "find_webform_site",
    "site_probe_url",
    "webform_sites",
    "webform_sites_payload",
]
