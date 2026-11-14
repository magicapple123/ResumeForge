# SPDX-License-Identifier: Apache-2.0
"""抓取编排：引擎选择 / 自动升级 / SSRF 校验 / 同域限速 / 页数上限。

一次抓取任务是「一次列表页 + 若干详情页」，全部由同一个 JobFetcher 实例完成，于是
限速与页数预算天然按任务生效：

- 每个 URL 先做 SSRF 校验（http 引擎在重定向每一跳还会再校验）；
- 同域名请求间隔 ≥2s（HostRateLimiter，时间源可注入，测试不必真等）；
- 单任务最多抓 10 个页面（硬上限，超出直接拒绝，不静默截断）。

分页（#16 收尾任务 2）：`fetch_pages` 只跟随页面自己声明的「下一页」（rel=next /
文案 / 常见分页容器 / JSON 显式 next 字段），**不猜 URL 模板**；每页都走同一套
SSRF + 限速 + 页数预算。翻页中途某页失败时保留已抓到的页，并给出
`pages_fetched / truncated / stop_reason`，不整体回滚、不伪造。

自动升级判据（#16A）：http 引擎返回 HTML、可见正文 <800 字符、且页面带 SPA 标记
（__NEXT_DATA__ / __NUXT__ / 空 root div）→ 改用浏览器引擎。静态页永远不会启动
浏览器，这条由测试钉住。
"""

from __future__ import annotations

import contextlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from urllib.parse import urlsplit

import httpx

from .browser_engine import fetch_with_browser
from .errors import WebFetchError
from .html_utils import has_spa_marker, html_to_text
from .http_engine import MAX_RESPONSE_BYTES, RawHttpPage, fetch_http
from .pagination import find_next_page_url, same_site_host
from .url_policy import HostRateLimiter, UrlRejected, resolve_and_check

#: 单任务最多抓多少个页面（列表 1 页 + 详情 N 页都算进来）。
MAX_PAGES_PER_TASK = 10
#: 同域请求最小间隔（秒）。
SAME_HOST_INTERVAL_SECONDS = 2.0
#: 自动升级判据里的正文长度阈值（字符）。
UPGRADE_TEXT_THRESHOLD = 800
#: 支持的引擎选择。
ENGINES = ("auto", "http", "browser")
#: 翻页停止原因（结果里如实返回，前端据此给用户看）。
STOP_REASONS = ("no_next", "limit", "http_error", "rejected")


@dataclass(frozen=True)
class FetchConfig:
    """一次抓取任务的预算与引擎选择。"""

    engine: str = "auto"
    timeout: float = 5.0
    max_bytes: int = MAX_RESPONSE_BYTES
    max_pages: int = MAX_PAGES_PER_TASK
    min_interval: float = SAME_HOST_INTERVAL_SECONDS


@dataclass(frozen=True)
class FetchedPage:
    """统一后的页面快照（两个引擎的产出都收敛成这个形状）。"""

    url: str
    status_code: int
    content_type: str
    #: 人可读正文：HTML 是可见文本，JSON 是原文（由抽取层再解析）。
    text: str
    engine: str
    #: 抓取日（YYYY-MM-DD）：相对日期（3天前/昨天）换算的基准，也是预览里的标注依据。
    fetched_on: str
    html: str = ""
    json_payloads: list[Any] = field(default_factory=list)


@dataclass(frozen=True)
class FetchedPages:
    """一次列表抓取的翻页结果（#16 分页）。

    `stop_reason` 四值：`no_next`（页面没有下一页）/ `limit`（达到请求页数或任务
    10 页上限，`truncated=True`）/ `http_error`（某一页抓取失败，保留之前的页）/
    `rejected`（下一页未通过 SSRF 校验，不泄露内网细节）。
    """

    pages: tuple[FetchedPage, ...]
    pages_fetched: int
    truncated: bool
    stop_reason: str
    errors: tuple[str, ...] = ()

    @property
    def first(self) -> FetchedPage | None:
        return self.pages[0] if self.pages else None


def today_string() -> str:
    return date.today().isoformat()


class JobFetcher:
    """带预算的抓取器；一次任务一个实例。"""

    def __init__(
        self,
        db: Any = None,
        *,
        config: FetchConfig | None = None,
        http_transport: httpx.BaseTransport | None = None,
        browser_fetcher: Callable[..., Any] | None = None,
        resolver: Callable[[str, int], list[str]] | None = None,
        limiter: HostRateLimiter | None = None,
        today: Callable[[], str] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._db = db
        self._config = config or FetchConfig()
        self._http_transport = http_transport
        self._browser_fetcher = browser_fetcher
        self._resolver = resolver
        self._today = today or today_string
        self._limiter = limiter or HostRateLimiter(
            min_interval=self._config.min_interval, sleeper=sleeper
        )
        self._pages_fetched = 0

    @property
    def config(self) -> FetchConfig:
        return self._config

    @property
    def pages_fetched(self) -> int:
        return self._pages_fetched

    # ===== 对外入口 =====

    def fetch(self, url: str, *, engine: str | None = None) -> FetchedPage:
        """抓取一个页面；引擎非法 / 页数超预算时抛 WebFetchError。"""
        chosen = (engine or self._config.engine or "auto").lower()
        if chosen not in ENGINES:
            raise WebFetchError("抓取引擎只能是自动、http 或浏览器")
        if self._pages_fetched >= self._config.max_pages:
            raise WebFetchError(f"本次任务最多抓 {self._config.max_pages} 个页面，已到上限")
        validated = resolve_and_check(url, resolver=self._resolver)
        host = urlsplit(validated).hostname or ""
        self._limiter.wait(host)
        self._pages_fetched += 1
        if chosen == "browser":
            raw = self._fetch_browser(validated)
            # 浏览器引擎会带回渲染后的 DOM HTML：规则层据此找容器/详情链接（拿不到才退回正文）。
            return self._to_page(raw, url=validated, html=str(getattr(raw, "html", "") or raw.text))
        raw_http = fetch_http(
            validated,
            transport=self._http_transport,
            timeout=self._config.timeout,
            max_bytes=self._config.max_bytes,
            resolver=self._resolver,
        )
        if chosen == "auto" and self._should_upgrade(raw_http):
            raw = self._fetch_browser(validated)
            return self._to_page(raw, url=validated, html=str(getattr(raw, "html", "") or raw.text))
        return self._to_page(raw_http, url=validated, html=raw_http.text)

    def fetch_pages(
        self,
        url: str,
        *,
        pages: int = 1,
        engine: str | None = None,
        stop_after_first: Callable[[FetchedPage], bool] | None = None,
    ) -> FetchedPages:
        """抓 1–10 页：只跟随页面自己给出的「下一页」，每页重新做 SSRF 校验。

        第一页失败照常抛错（调用方按 502 处理）；第 2 页起失败则保留已抓页面并
        返回 `stop_reason=http_error` / `rejected`，不让整批结果回滚。
        """
        requested = max(1, min(int(pages or 1), self._config.max_pages))
        first = self.fetch(url, engine=engine)
        if stop_after_first is not None and stop_after_first(first):
            return FetchedPages(
                pages=(first,), pages_fetched=1, truncated=False, stop_reason="no_next"
            )
        fetched: list[FetchedPage] = [first]
        errors: list[str] = []
        next_url = find_next_page_url(first)
        stop_reason = "no_next"
        while len(fetched) < requested:
            if not next_url:
                stop_reason = "no_next"
                break
            # 下一页的安全校验要在「同站判断」之前：内网/回环地址必须归为 rejected
            # （如实拒绝且不泄露地址），而不是被当成"跨站链接"轻描淡写地跳过。
            try:
                resolve_and_check(next_url, resolver=self._resolver)
            except UrlRejected as exc:
                errors.append(f"下一页未通过安全校验，已停止翻页：{exc}")
                stop_reason = "rejected"
                break
            if not same_site_host(first.url, next_url):
                # 跨站「下一页」不静默跟随：如实停止，避免把用户带去另一个站点。
                errors.append("页面声明的下一页指向其他站点，已停止翻页")
                stop_reason = "no_next"
                break
            try:
                page = self.fetch(next_url, engine=engine)
            except UrlRejected as exc:
                errors.append(f"下一页未通过安全校验，已停止翻页：{exc}")
                stop_reason = "rejected"
                break
            except WebFetchError as exc:
                errors.append(
                    f"抓取第 {len(fetched) + 1} 页失败，已保留前 {len(fetched)} 页：{exc}"
                )
                stop_reason = "http_error"
                break
            fetched.append(page)
            next_url = find_next_page_url(page)
        else:
            # 正常抓满请求页数：后面还有下一页就标 limit（truncated），否则就是到底了。
            stop_reason = "limit" if next_url else "no_next"
        return FetchedPages(
            pages=tuple(fetched),
            pages_fetched=len(fetched),
            truncated=stop_reason in {"limit", "http_error", "rejected"},
            stop_reason=stop_reason,
            errors=tuple(errors),
        )

    # ===== 内部步骤 =====

    def _should_upgrade(self, page: RawHttpPage) -> bool:
        """http 结果是否满足自动升级条件（正文太短 + 页面是前端渲染壳）。"""
        if not page.content_type.startswith("text/html"):
            return False
        if has_spa_marker(page.text) is False:
            return False
        visible = html_to_text(page.text)
        return len(visible) < UPGRADE_TEXT_THRESHOLD

    def _fetch_browser(self, url: str):
        fetcher = self._browser_fetcher or fetch_with_browser
        return fetcher(self._db, url)

    def _to_page(self, raw: Any, *, url: str, html: str) -> FetchedPage:
        content_type = str(getattr(raw, "content_type", "text/html") or "text/html")
        text = str(getattr(raw, "text", "") or "")
        payloads = list(getattr(raw, "json_payloads", []) or [])
        if content_type.startswith("application/json") and text.strip():
            with contextlib.suppress(ValueError):
                payloads = [json.loads(text), *payloads]
        visible = html_to_text(html) if content_type.startswith("text/html") else text
        if not visible.strip() and text.strip():
            # 渲染后的 HTML 可能被上限截断/整段在脚本里：正文以引擎给的 innerText 为准。
            visible = text
        return FetchedPage(
            url=str(getattr(raw, "url", "") or url),
            status_code=int(getattr(raw, "status_code", 200) or 200),
            content_type=content_type,
            text=visible,
            engine=str(getattr(raw, "engine", "http") or "http"),
            fetched_on=self._today(),
            html=html if content_type.startswith("text/html") else "",
            json_payloads=payloads,
        )


__all__ = [
    "ENGINES",
    "FetchConfig",
    "FetchedPage",
    "FetchedPages",
    "JobFetcher",
    "MAX_PAGES_PER_TASK",
    "SAME_HOST_INTERVAL_SECONDS",
    "STOP_REASONS",
    "UPGRADE_TEXT_THRESHOLD",
    "today_string",
]
