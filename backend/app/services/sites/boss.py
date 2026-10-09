"""BOSS 直聘适配器门面与兼容导出。

站点页面探针、搜索采集和投递流程分别位于 boss_page、boss_search 与 boss_apply；
本模块保留原有导入路径，避免调用方因内部拆分失效。
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..browser.page_ready import ReadyWait
from .base import RiskProfile, SiteAdapter
from .boss_apply import (
    BossApplyMixin,
    _apply_entry_script,
    _chat_state_script,
    _click_script,
    _entry_rect_script,
    _fill_greeting_script,
    _greeting_state_script,
    _send_rect_script,
    _submit_state_script,
    classify_submit_state,
)
from .boss_city import CityResolver
from .boss_network import DETAIL_MARKERS, SEARCH_MARKERS
from .boss_page import (
    _SELECTORS,
    BOSS_DISPLAY_NAME,
    BOSS_ENTRY_URL,
    BOSS_HOSTS,
    BOSS_KEY,
    CHAT_PAGE_PATH,
    SELECTOR_APPLY_ENTRY,
    SELECTOR_CAPTCHA,
    SELECTOR_DETAIL_READY,
    SELECTOR_FILE_INPUT,
    SELECTOR_GREETING_INPUT,
    SELECTOR_GREETING_SEND,
    SELECTOR_JOB_DESCRIPTION,
    SELECTOR_JOB_LINK,
    SELECTOR_JOB_REQUIREMENTS,
    SELECTOR_LOGIN,
    SELECTOR_MY_MESSAGE,
    SELECTOR_SEARCH_CARD,
    SELECTOR_SEARCH_COMPANY,
    SELECTOR_SEARCH_EMPTY,
    SELECTOR_SEARCH_LINK,
    SELECTOR_SEARCH_LOCATION,
    SELECTOR_SEARCH_NEXT,
    SELECTOR_SEARCH_READY,
    SELECTOR_SEARCH_SALARY,
    SELECTOR_SEARCH_TITLE,
    SELECTOR_SUBMIT_BUTTON,
    BossPageMixin,
    _as_payload,
    _current_url,
    _js,
    _page_probe_script,
    _readiness_script,
    _url_probe_script,
    blocker_failure,
    detect_blocker,
    diagnostic_tail,
    query_params,
    readiness_timeout_failure,
    same_target_page,
    selector_diagnostic,
)
from .boss_scroll import BossScrollMixin
from .boss_search import (
    NETWORK_RESPONSE_EVENT,
    BossSearchMixin,
    _collect_links_script,
    _collect_script,
    _detail_script,
    _with_response_bodies,
    parse_job_detail,
    parse_search_payload,
)


class BossAdapter(BossSearchMixin, BossScrollMixin, BossApplyMixin, BossPageMixin, SiteAdapter):
    """BOSS 直聘适配器。"""

    key = BOSS_KEY
    display_name = BOSS_DISPLAY_NAME
    hosts = BOSS_HOSTS
    entry_url = BOSS_ENTRY_URL
    supports_collect = True
    supports_apply = True
    requires_resume = False
    # 2026-10-09 用户决定下线「采集后筛选」：条件过滤全权交给站点侧筛选（``filters``，
    # 网站在搜索时就筛掉）。这里不再声明任何本地筛选条件；``evaluate_filters`` 及其
    # 离线测试保留，供未来站点接入时复用。存量配置里的 salary_min / experience /
    # education / job_type 因此不再参与筛选（schema 字段保留以兼容旧请求）。
    post_filter_conditions: tuple[str, ...] = ()
    sample_markers = (("search", SEARCH_MARKERS), ("detail", DETAIL_MARKERS))

    def __init__(
        self,
        *,
        ready_wait: ReadyWait | None = None,
        city_resolver: CityResolver | None = None,
        city_fetcher: Callable[[str, float], Any] | None = None,
        city_timeout: float = 5.0,
        filter_fetcher: Callable[[str, float], Any] | None = None,
        filter_timeout: float = 6.0,
    ) -> None:
        self._ready_wait = ready_wait or ReadyWait()
        self._city_resolver = city_resolver or CityResolver(
            fetcher=city_fetcher, timeout=city_timeout
        )
        # 筛选清单的取数口子：与 city_fetcher 同一个思路——离线测试注入假数据，
        # 生产走默认的网络实现。不注入就等于"没有浏览器时去读公开接口"。
        self._filter_fetcher = filter_fetcher
        self._filter_timeout = filter_timeout

    def risk_profile(self) -> RiskProfile:
        """BOSS 风控画像：投递限速与「需登录」声明，供任务运行器限速。"""
        return RiskProfile(
            key=self.key,
            min_interval_seconds=25,
            max_per_hour=60,
            needs_login=True,
            notes="BOSS 直聘对高频操作敏感，投递间隔过短可能触发验证码或临时限制。",
        )


__all__ = [
    "BOSS_DISPLAY_NAME",
    "BOSS_ENTRY_URL",
    "BOSS_HOSTS",
    "BOSS_KEY",
    "CHAT_PAGE_PATH",
    "BossAdapter",
    "NETWORK_RESPONSE_EVENT",
    "SELECTOR_APPLY_ENTRY",
    "SELECTOR_CAPTCHA",
    "SELECTOR_DETAIL_READY",
    "SELECTOR_FILE_INPUT",
    "SELECTOR_GREETING_INPUT",
    "SELECTOR_GREETING_SEND",
    "SELECTOR_JOB_DESCRIPTION",
    "SELECTOR_JOB_LINK",
    "SELECTOR_JOB_REQUIREMENTS",
    "SELECTOR_LOGIN",
    "SELECTOR_MY_MESSAGE",
    "SELECTOR_SEARCH_CARD",
    "SELECTOR_SEARCH_COMPANY",
    "SELECTOR_SEARCH_EMPTY",
    "SELECTOR_SEARCH_LINK",
    "SELECTOR_SEARCH_LOCATION",
    "SELECTOR_SEARCH_NEXT",
    "SELECTOR_SEARCH_READY",
    "SELECTOR_SEARCH_SALARY",
    "SELECTOR_SEARCH_TITLE",
    "SELECTOR_SUBMIT_BUTTON",
    "_SELECTORS",
    "_apply_entry_script",
    "_as_payload",
    "_chat_state_script",
    "_click_script",
    "_collect_links_script",
    "_collect_script",
    "_current_url",
    "_detail_script",
    "_entry_rect_script",
    "_fill_greeting_script",
    "_greeting_state_script",
    "_js",
    "_page_probe_script",
    "_readiness_script",
    "_send_rect_script",
    "_submit_state_script",
    "_url_probe_script",
    "_with_response_bodies",
    "blocker_failure",
    "classify_submit_state",
    "detect_blocker",
    "diagnostic_tail",
    "parse_job_detail",
    "parse_search_payload",
    "query_params",
    "readiness_timeout_failure",
    "same_target_page",
    "selector_diagnostic",
]
