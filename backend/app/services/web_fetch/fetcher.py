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

四档兜底（#T06 / Q09）：用户能选的仍然是 auto / http / browser（``ENGINES``）。``auto``
下按 **http → browser → DeepSeek Fetch** 依次尝试，"都拿不到正文"才进入下一档：

- http 失败（反爬 403 / 超时 / 非网页）也会升级到 browser——招聘站要求登录时，带登录态
  的浏览器是唯一能打开的那一档；browser 在本次任务内失败过一次就不再重试（``_browser_off``），
  否则每翻一页都要重开一次浏览器、各等 20 秒；
- 最后一档是**服务端**抓取（``deepseek_fallback``）：它在另一张网络上，反爬 / 纯 JS 站点
  常常能拿到正文。只有配置了 DeepSeek 密钥才启用，且账号级不可用（401/402/429）时本次
  任务整段停用；
- 三档都拿不到时抛 ``WebFetchError``，消息里**按顺序列出每一档的原因**——``fetch_pages``
  会把它放进 `errors` / `stop_reason=http_error`，用户据此能看出是哪一档挡住了。
  ``FetchedPage.engine`` 如实写这一页是谁抓的（``http`` / ``browser`` / ``deepseek``）。
"""

from __future__ import annotations

import contextlib
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from urllib.parse import urlsplit

import httpx

from .. import net_proxy
from .browser_engine import fetch_with_browser
from .deepseek_fallback import DEEPSEEK_ENGINE, FallbackUnavailable
from .deepseek_fallback import fetch_text as fetch_deepseek_text
from .deepseek_fallback import resolve_key as resolve_deepseek_key
from .errors import WebFetchError
from .html_utils import has_spa_marker, html_to_text
from .http_engine import MAX_RESPONSE_BYTES, RawHttpPage, fetch_http, user_agent
from .pagination import find_next_page_url, same_site_host
from .url_policy import HostRateLimiter, UrlRejected, resolve_and_check

logger = logging.getLogger(__name__)

#: 单任务最多抓多少个页面（列表 1 页 + 详情 N 页都算进来）。
MAX_PAGES_PER_TASK = 10
#: 同域请求最小间隔（秒）。
SAME_HOST_INTERVAL_SECONDS = 2.0
#: 自动升级判据里的正文长度阈值（字符）。
UPGRADE_TEXT_THRESHOLD = 800
#: **用户可选**的引擎（``deepseek`` 不在其中：它是 auto 下的兜底档，不是一种"选择"）。
ENGINES = ("auto", "http", "browser")
#: 翻页停止原因（结果里如实返回，前端据此给用户看）。兜底档不新增停止原因：
#: 它成功时就是一次正常抓取，失败时仍是 ``http_error``，原因写在 ``errors`` 里。
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
    #: 是否经代理抓取（T03）。**三态**：True/False 只由 http 档给出；browser 与
    #: deepseek 档恒为 None——它们在别的进程/服务端出网，这里没有资格替它们断言。
    via_proxy: bool | None = None


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
    """带预算的抓取器；一次任务一个实例。

    ``deepseek_fetcher`` / ``deepseek_key`` 只为测试注入（与 ``browser_fetcher`` 同一
    思路）：默认走 :mod:`deepseek_fallback`，它自己读配置、自己发请求。
    """

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
        deepseek_fetcher: Callable[[str, str], str] | None = None,
        deepseek_key: Callable[[], str] | None = None,
    ) -> None:
        self._db = db
        self._config = config or FetchConfig()
        self._http_transport = http_transport
        # T04：一次导入会话复用一个客户端（连接池/ TLS 握手只做一次）。只有真正
        # 走 http 档时才建；注入了传输层的测试路径仍然每次自己造（确定性优先）。
        self._http_client: httpx.Client | None = None
        self._browser_fetcher = browser_fetcher
        self._resolver = resolver
        self._today = today or today_string
        self._limiter = limiter or HostRateLimiter(
            min_interval=self._config.min_interval, sleeper=sleeper
        )
        self._deepseek_fetcher = deepseek_fetcher
        self._deepseek_key = deepseek_key or self._key_from_config
        self._pages_fetched = 0
        # 任务级开关：某一档在本任务内已经明确不可用（浏览器起不来 / 账号级不可用），
        # 后续页面就不再试它——否则每页都要重付一次 20 秒或一次配额。
        self._browser_off = False
        self._deepseek_off = False

    @property
    def config(self) -> FetchConfig:
        return self._config

    @property
    def pages_fetched(self) -> int:
        return self._pages_fetched

    # ===== 对外入口 =====

    def fetch(self, url: str, *, engine: str | None = None) -> FetchedPage:
        """抓取一个页面；引擎非法 / 页数超预算 / 三档全失败时抛 WebFetchError。

        成功时 ``FetchedPage.engine`` 如实写 http / browser / deepseek；本地抓到页面
        但正文为空（纯画布页、只剩脚本的壳）时**如实返回空正文**而不是抛错——页面确实
        是 200，只是没有可读文字，这由抽取层按"没识别到"处理。
        """
        chosen = (engine or self._config.engine or "auto").lower()
        if chosen not in ENGINES:
            raise WebFetchError("抓取引擎只能是自动、http 或浏览器")
        if self._pages_fetched >= self._config.max_pages:
            raise WebFetchError(f"本次任务最多抓 {self._config.max_pages} 个页面，已到上限")
        validated = resolve_and_check(url, resolver=self._resolver)
        host = urlsplit(validated).hostname or ""
        self._limiter.wait(host)
        self._pages_fetched += 1

        page, reasons = self._fetch_local(validated, chosen)
        if page is not None and page.text.strip():
            return page
        fallback = self._fetch_deepseek(validated) if chosen == "auto" else None
        if fallback is not None:
            return fallback
        if page is not None:
            return page
        # 每一档的原因都要留下：用户看到的"为什么打不开"必须能解释，不能只剩一句兜底话。
        detail = "；".join(reason for reason in reasons if reason)
        raise WebFetchError(f"这个链接抓不到内容（{detail}）" if detail else "这个链接抓不到内容")

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

    def _fetch_local(self, url: str, chosen: str) -> tuple[FetchedPage | None, list[str]]:
        """本地两档（http / browser）；返回（页面, 各档失败原因）。

        页面为 ``None`` = 两档都没抓到；不为 ``None`` 但正文为空 = 抓到了壳。
        ``chosen == "http"`` / ``"browser"`` 是用户显式指定，只走那一档（显式选择时
        不偷偷换成另一档或第三方服务）。
        """
        reasons: list[str] = []
        raw_http: RawHttpPage | None = None
        if chosen in {"auto", "http"}:
            try:
                raw_http = self._fetch_http(url)
            except WebFetchError as exc:
                reasons.append(str(exc))
        if chosen == "http":
            if raw_http is None:
                return None, reasons
            return self._to_page(raw_http, url=url, html=raw_http.text), reasons

        # browser 档：显式选择，或 auto 下 http 失败 / 拿到 SPA 空壳时升级。
        needs_browser = chosen == "browser" or raw_http is None or self._should_upgrade(raw_http)
        if not needs_browser:
            if raw_http is None:  # 理论上不可达（needs_browser 已包含它），保险起见
                return None, reasons
            return self._to_page(raw_http, url=url, html=raw_http.text), reasons
        if self._browser_off:
            reasons.append("本次任务浏览器引擎已失败过，未再尝试")
            return None, reasons
        try:
            raw = self._fetch_browser(url)
        except WebFetchError as exc:
            self._browser_off = True
            reasons.append(f"浏览器引擎：{exc}")
            return None, reasons
        # 浏览器引擎会带回渲染后的 DOM HTML：规则层据此找容器/详情链接（拿不到才退回正文）。
        return (
            self._to_page(raw, url=url, html=str(getattr(raw, "html", "") or raw.text)),
            reasons,
        )

    def _fetch_deepseek(self, url: str) -> FetchedPage | None:
        """第四档：服务端抓取兜底。没密钥 / 账号级不可用 / 没正文都返回 ``None``。"""
        if self._deepseek_off:
            return None
        key = self._deepseek_key() or ""
        if not key:
            return None
        fetcher = self._deepseek_fetcher or fetch_deepseek_text
        try:
            text = fetcher(url, key)
        except FallbackUnavailable:
            # 账号级不可用（401/402/429）：本次任务剩下的页面不要再逐条重试。
            self._deepseek_off = True
            logger.info("DeepSeek 抓取账号级不可用，本次任务不再尝试服务端兜底")
            return None
        except Exception:  # noqa: BLE001 - 兜底档失败只让这一档缺席
            logger.warning("DeepSeek 兜底抓取失败：%s", url, exc_info=True)
            return None
        text = str(text or "").strip()
        if not text:
            return None
        # 复用 http 引擎的原始页面结构（不另造一套）：正文是 Markdown，`engine` 如实写 deepseek。
        raw = RawHttpPage(
            url=url,
            status_code=200,
            content_type="text/markdown",
            text=text,
            engine=DEEPSEEK_ENGINE,
        )
        return self._to_page(raw, url=url, html="")

    def _fetch_http(self, url: str) -> RawHttpPage:
        return fetch_http(
            url,
            transport=self._http_transport,
            timeout=self._config.timeout,
            max_bytes=self._config.max_bytes,
            resolver=self._resolver,
            client=self._shared_client(),
        )

    def _shared_client(self) -> httpx.Client | None:
        """本会话的 http 客户端（懒建）；注入传输层时返回 ``None``（由 fetch_http 自建）。"""
        if self._http_transport is not None:
            return None
        if self._http_client is None:
            self._http_client = net_proxy.build_client(
                timeout=self._config.timeout,
                follow_redirects=False,
                headers={
                    "User-Agent": user_agent(),
                    "Accept": "text/html,application/json;q=0.9,*/*;q=0.1",
                },
            )
        return self._http_client

    def close(self) -> None:
        """归还连接（调用方在导入/预览收尾时调用；可重复调用）。"""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None

    def _key_from_config(self) -> str:
        """默认的密钥来源：当前全局联网搜索配置里的 DeepSeek Key（未配置 = 不兜底）。"""
        return resolve_deepseek_key(self._db)

    def _should_upgrade(self, page: RawHttpPage) -> bool:
        """http 结果是否满足自动升级条件（正文太短 + 页面是前端渲染壳）。"""
        if not page.content_type.startswith("text/html"):
            return False
        if has_spa_marker(page.text) is False:
            return False
        visible = html_to_text(page.text)
        return len(visible) < UPGRADE_TEXT_THRESHOLD

    def _fetch_browser(self, url: str):
        """浏览器档：把本实例的解析器一起传下去，与 http 档用同一套 SSRF 判据。

        漏传会让浏览器档绕过注入的解析器去打真实 DNS：离线测试直接报
        ``getaddrinfo failed``，内网/保留地址的判定也会在两条档位上不一致。
        """
        fetcher = self._browser_fetcher or fetch_with_browser
        return fetcher(self._db, url, resolver=self._resolver)

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
        engine = str(getattr(raw, "engine", "http") or "http")
        return FetchedPage(
            url=str(getattr(raw, "url", "") or url),
            status_code=int(getattr(raw, "status_code", 200) or 200),
            content_type=content_type,
            text=visible,
            engine=engine,
            fetched_on=self._today(),
            html=html if content_type.startswith("text/html") else "",
            json_payloads=payloads,
            # 只有 http 档知道自己走没走代理；其余档如实留 None，不谎报 False。
            via_proxy=(bool(getattr(raw, "via_proxy", False)) if engine == "http" else None),
        )


__all__ = [
    "DEEPSEEK_ENGINE",
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
