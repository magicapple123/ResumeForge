# SPDX-License-Identifier: Apache-2.0
"""申请状态回读的编排（R-15 C）：取地址 → 抓页面 → 认状态 → 写回。

三条硬规则：

1. **只走 ``resolve_status``**。回读和粘贴通知是同一个合并口径（只能前进、拒信覆盖、
   已结束是终态），所以乱序读到旧页面不会把进度打回去。
2. **读不到就不动**。``ProbeKind.UNKNOWN`` / ``CLOSED`` 一律不改状态，只带一句说明
   回去给界面显示——把"岗位下线"写成"被拒"是这套功能最容易造成的误伤。
3. **事件留痕但不冒充用户确认**。写回用 ``EVENT_SOURCE_SYSTEM`` 且
   ``user_confirmed=False``，时间线上能分清"我自己改的"和"系统读到的"。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

import httpx
from sqlalchemy.orm import Session

from ..models.job import Job
from ..models.tracker import (
    EVENT_SOURCE_SYSTEM,
    STATUS_LABELS,
    ApplicationTrack,
    normalize_key,
    resolve_status,
)
from .track_events import record_status_change
from .track_portal import (
    LOGIN_NOTE,
    ProbeKind,
    ProbeResult,
    detect_portal,
    locate_excerpt,
    looks_like_login_page,
    probe_status,
)
from .track_probe_settings import (
    PROBE_INTERVAL_HOURS,
    ProbeSettings,
    due_for_daily,
    mark_ran,
    read_cookie,
    read_settings,
    write_settings,
)
from .web_fetch.url_policy import UrlRejected, resolve_and_check

logger = logging.getLogger(__name__)

#: 单次最多回读多少条：门户有限速，串行抓取时 8 条已要一两分钟；界面按批循环调用，
#: 既能显示「3/18」的进度，也不会让单个请求挂到超时。
MAX_PROBE_PER_RUN = 8
_PROBE_TIMEOUT_SECONDS = 20.0
_PROBE_MAX_REDIRECTS = 5
#: 按「公司 + 岗位」回查岗位链接时扫多少条（新→旧）。超出就当作没有链接。
_JOB_LOOKUP_LIMIT = 2000

#: 抓页面：`(url, cookie) -> Fetched | str`。测试注入假实现，不必真的联网。
Fetcher = Callable[[str, str], "Fetched | str"]

#: 正文短于这个长度就认为"只拿到了空壳"（门户列表页正常都有几百字以上）。
THIN_TEXT_CHARS = 200


@dataclass(frozen=True)
class Fetched:
    """一次抓取的产出。`engine` 说明是直连拿到的还是浏览器渲染出来的。"""

    text: str
    engine: str = "http"


@dataclass(frozen=True)
class RefreshOutcome:
    """一条记录的回读结果。``outcome`` 四值给界面分组用。"""

    track_id: int
    company: str
    title: str
    url: str
    platform: str
    #: `changed`（状态真的变了）/ `unchanged`（读到但没变）/
    #: `skipped`（没有链接或读不出状态）/ `failed`（抓取失败）。
    outcome: str
    before: str
    after: str
    note: str = ""

    def as_dict(self) -> dict[str, object]:
        return {
            "track_id": self.track_id,
            "company": self.company,
            "title": self.title,
            "url": self.url,
            "platform": self.platform,
            "outcome": self.outcome,
            "before": self.before,
            "before_label": STATUS_LABELS.get(self.before, self.before),
            "after": self.after,
            "after_label": STATUS_LABELS.get(self.after, self.after),
            "note": self.note,
        }


# ===== 目标地址 =====


def track_url(db: Session, track: ApplicationTrack) -> str:
    """这条进度该去哪个页面看。

    优先用它关联的岗位（投递台记下的原始链接）；没关联时按「公司 + 岗位」在岗位库里
    找最近一条同名的，**找不到就返回空串**——不去猜网址。
    """
    if track.job_id:
        job = db.get(Job, track.job_id)
        if job is not None and job.source_url:
            return job.source_url
    if not track.company_key or not track.title_key:
        return ""
    # 岗位表没有归一化键列（`normalize_key` 只存在于进度模块），所以在 Python 侧比：
    # 本地单用户的岗位库最多几千条，一次全取再筛比在 SQL 里复刻一遍归一化规则安全。
    jobs = (
        db.query(Job)
        .filter(Job.source_url != "")
        .order_by(Job.id.desc())
        .limit(_JOB_LOOKUP_LIMIT)
        .all()
    )
    for job in jobs:
        if (
            normalize_key(job.company) == track.company_key
            and normalize_key(job.title) == track.title_key
        ):
            return job.source_url
    return ""


# ===== 抓取 =====


def _render_page(db: Session, url: str):
    """用投递浏览器渲染一页（单独包装一层，测试可以替换掉）。"""
    from .web_fetch.browser_engine import fetch_with_browser

    return fetch_with_browser(db, url)


def _fetch_html(
    url: str,
    cookie: str,
    *,
    db: Session | None = None,
    render: Callable[[Session, str], object] | None = None,
) -> Fetched:
    """抓一页：先直连；只拿到空壳时改走**投递浏览器**（复用里面的登录态）。

    为什么要升级：飞书招聘、字节自研这类站是前端渲染，直连只能拿到
    ``<div id="app"></div>``。投递浏览器是用户自己登录过的那个实例，所以浏览器路径
    **不需要 Cookie**——登录态已经在 profile 里。两条路径的结果都交给同一套
    文案识别，因此不依赖任何站点的 DOM 选择器。
    """
    html = _http_get(url, cookie)
    if db is None:
        return Fetched(html)
    from .web_fetch.html_utils import has_spa_marker, html_to_text

    if not has_spa_marker(html) and len(html_to_text(html).strip()) >= THIN_TEXT_CHARS:
        return Fetched(html)
    renderer = render or _render_page
    try:
        page = renderer(db, url)
    except Exception as exc:  # noqa: BLE001 - 浏览器不可用不能阻断回读
        logger.warning("浏览器渲染失败，回落到直连结果：%s", exc)
        return Fetched(html)
    text = str(getattr(page, "text", "") or "")
    return Fetched(text or html, "browser")


def _http_get(url: str, cookie: str) -> str:
    """带登录 Cookie 直连抓一页；每一跳都做 SSRF 校验（与 web_fetch 同一条策略）。

    刻意不跟随 httpx 的自动重定向：``follow_redirects=True`` 只校验首跳，第二跳可以
    被引到内网地址。这里自己走，每跳都过 :func:`resolve_and_check`。
    """
    headers = {
        "User-Agent": "ResumeForge/1.0 (application status check)",
        "Accept": "text/html,application/xhtml+xml",
    }
    if cookie:
        headers["Cookie"] = cookie
    current = url
    with httpx.Client(timeout=_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
        for _ in range(_PROBE_MAX_REDIRECTS):
            current = resolve_and_check(current)
            response = client.get(current, headers=headers)
            if response.is_redirect and response.headers.get("location"):
                current = str(httpx.URL(current).join(response.headers["location"]))
                continue
            response.raise_for_status()
            return response.text
    raise UrlRejected("重定向次数过多")


# ===== 单条与批量 =====


def _merge_note(previous: str, line: str) -> str:
    """把回读依据追加到 `evidence`：原文保留，新的在上（`evidence` 是纯文本）。"""
    body = (previous or "").strip()
    return f"{line}\n\n{body}" if body else line


def _apply_result(
    db: Session,
    track: ApplicationTrack,
    result: ProbeResult,
    engine: str,
    base: dict,
    *,
    note: str = "",
) -> RefreshOutcome:
    """把一次识别结果写回记录：只走 `resolve_status`，只写真变了的状态。

    单条岗位页与投递记录页共用这一段——两条路径的差别只在"从哪段文字里读出状态"，
    合并规则必须完全一致，否则同一个状态从两个入口进来会有两种结果。
    """
    if not result.usable:
        return RefreshOutcome(
            **base,
            platform=result.platform,
            outcome="skipped",
            after=track.status,
            note=note or result.note,
        )
    resolved = resolve_status(track.status, result.status)
    if resolved == track.status:
        return RefreshOutcome(
            **base,
            platform=result.platform,
            outcome="unchanged",
            after=track.status,
            note=note
            or result.note
            or f"页面显示「{STATUS_LABELS.get(result.status, result.status)}」，与当前一致。",
        )

    track.status = resolved
    track.evidence = _merge_note(
        track.evidence,
        f"{date.today().isoformat()} 自动回读（{result.platform or '公开页'}）："
        f"命中「{result.evidence}」",
    )
    record_status_change(
        db,
        track,
        from_status=base["before"],
        to_status=resolved,
        # `status_date` 留空：回读只知道"今天读到了"，不知道对方是哪天变的，
        # 写今天会污染「通知口径」的阶段耗时。
        status_date="",
        source=EVENT_SOURCE_SYSTEM,
        user_confirmed=False,
    )
    db.commit()
    return RefreshOutcome(
        **base,
        platform=result.platform,
        outcome="changed",
        after=resolved,
        note=f"命中「{result.evidence}」（{'浏览器渲染' if engine == 'browser' else '直连'}）",
    )


def _read_page(db: Session, url: str, cookie: str, fetch: Fetcher | None) -> tuple[str, str] | str:
    """抓一次页面，返回 `(正文, 引擎)`；失败时返回可直接展示的原因字符串。"""
    fetcher = fetch or (lambda target, secret: _fetch_html(target, secret, db=db))
    try:
        raw = fetcher(url, cookie)
    except Exception as exc:  # noqa: BLE001 - 单个站点失败不能让整批中断
        return f"抓取失败：{exc}"
    if isinstance(raw, Fetched):
        return raw.text, raw.engine
    return str(raw), "http"


def refresh_track(
    db: Session,
    track: ApplicationTrack,
    *,
    cookie: str = "",
    fetch: Fetcher | None = None,
) -> RefreshOutcome:
    """回读一条记录；**只有真变了的才写库**。"""
    url = track_url(db, track)
    base = {
        "track_id": track.id,
        "company": track.company,
        "title": track.title,
        "url": url,
        "before": track.status,
    }
    if not url:
        return RefreshOutcome(
            **base,
            platform="",
            outcome="skipped",
            after=track.status,
            note="这条没有关联岗位链接，无法回读。",
        )

    page = _read_page(db, url, cookie, fetch)
    if isinstance(page, str):
        return RefreshOutcome(
            **base,
            platform=detect_portal(url),
            outcome="failed",
            after=track.status,
            note=page,
        )
    html, engine = page
    result: ProbeResult = probe_status(url, html)
    note = ""
    if (
        result.kind == ProbeKind.UNKNOWN
        and engine == "http"
        and len(html.strip()) < THIN_TEXT_CHARS
    ):
        # 只有"什么都没读出来"才归因于空壳：短小但完整的静态页（例如只写一句
        # 「这个岗位已下线」）是有结论的，不能被这条提示盖掉。
        note = "这一页是前端渲染的空壳。请在投递浏览器里登录该网站，再点一次刷新。"
    return _apply_result(db, track, result, engine, base, note=note)


def refresh_from_page(
    db: Session,
    url: str,
    tracks: list[ApplicationTrack],
    *,
    cookie: str = "",
    fetch: Fetcher | None = None,
    limit: int = MAX_PROBE_PER_RUN * 4,
) -> list[RefreshOutcome]:
    """读**一次**投递记录页，把页面上的进度分给已知的各条记录。

    为什么不做"解析页面结构"：每个 ATS 的 DOM 都不同，改版就失效。这里反过来做——
    拿已知的「公司 + 岗位」去页面里定位，定位规则见
    :func:`track_portal.locate_excerpt`（相邻 + 不跨卡片 + 找不到就跳过）。
    于是**只更新已有记录，绝不新建**，也不依赖任何站点的选择器。
    """
    if not tracks:
        return []
    page = _read_page(db, url, cookie, fetch)
    base_platform = detect_portal(url)
    if isinstance(page, str):
        return [
            RefreshOutcome(
                track_id=track.id,
                company=track.company,
                title=track.title,
                url=url,
                platform=base_platform,
                outcome="failed",
                before=track.status,
                after=track.status,
                note=page,
            )
            for track in tracks[:limit]
        ]
    text, engine = page
    if looks_like_login_page(text):
        # 登录态过期是**整页**的问题，不是某一条记录的问题：不先说的话，
        # 每条都会得到"记录页里没找到这家公司+这个岗位"，看起来像是识别错了页面。
        return [
            RefreshOutcome(
                track_id=track.id,
                company=track.company,
                title=track.title,
                url=url,
                platform=base_platform,
                outcome="skipped",
                before=track.status,
                after=track.status,
                note=LOGIN_NOTE,
            )
            for track in tracks[:limit]
        ]
    outcomes: list[RefreshOutcome] = []
    for track in tracks[:limit]:
        base = {
            "track_id": track.id,
            "company": track.company,
            "title": track.title,
            "url": url,
            "before": track.status,
        }
        others = tuple(
            mark
            for other in tracks
            if other.id != track.id
            for mark in (other.company, other.title)
            if mark.strip()
        )
        window = locate_excerpt(text, track.company, track.title, others=others)
        if not window:
            # 分开两种"没找到"：页面上压根没这个岗位 vs 有这个岗位但确认不了归属。
            # 后者在"整站只有一家公司、公司名只出现在页脚"的站点上是常态（字节校招），
            # 直接说"没找到"会让人以为读错了页面——这里明确给出替代做法。
            flat_title = "".join(track.title.split())
            seen = bool(flat_title) and flat_title in "".join(text.split())
            note = (
                "页面上有这个岗位，但确认不了它是不是这家公司的（可能整站只有一家公司、"
                "公司名只出现在页脚）。为避免张冠李戴未改动，请改用岗位详情页的链接。"
                if seen
                else "记录页里没找到「这家公司 + 这个岗位」，未改动。"
            )
            outcomes.append(
                RefreshOutcome(
                    **base,
                    platform=base_platform,
                    outcome="skipped",
                    after=track.status,
                    note=note,
                )
            )
            continue
        outcomes.append(_apply_result(db, track, probe_status(url, window), engine, base))
    return outcomes


def refresh_tracks(
    db: Session,
    tracks: list[ApplicationTrack],
    *,
    cookie: str = "",
    fetch: Fetcher | None = None,
    limit: int = MAX_PROBE_PER_RUN,
) -> list[RefreshOutcome]:
    """批量回读。逐条提交：一条失败不影响已写入的结果（门户本来就常超时）。"""
    outcomes: list[RefreshOutcome] = []
    for track in tracks[:limit]:
        outcomes.append(refresh_track(db, track, cookie=cookie, fetch=fetch))
    return outcomes


def probe_candidates(db: Session, track_ids: list[int] | None = None) -> list[ApplicationTrack]:
    """待回读的记录：显式 id 优先；否则取所有未结束、未删除的记录（新→旧）。"""
    query = db.query(ApplicationTrack).filter(ApplicationTrack.deleted_at.is_(None))
    if track_ids:
        return list(query.filter(ApplicationTrack.id.in_(track_ids)).all())
    terminal = {"rejected"}
    rows = query.order_by(ApplicationTrack.id.desc()).all()
    return [row for row in rows if row.status not in terminal]


__all__ = [
    "MAX_PROBE_PER_RUN",
    "PROBE_INTERVAL_HOURS",
    "ProbeSettings",
    "Fetched",
    "RefreshOutcome",
    "due_for_daily",
    "mark_ran",
    "probe_candidates",
    "read_cookie",
    "read_settings",
    "refresh_from_page",
    "refresh_track",
    "refresh_tracks",
    "track_url",
    "write_settings",
]
