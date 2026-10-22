# SPDX-License-Identifier: Apache-2.0
"""BOSS 搜索列表、岗位详情与网络/DOM 双通道采集（编排层；脚本构造器在
``boss_search_scripts``，此处以 ``import x as x`` 显式别名再导出保持原命名空间）。"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

from ...models.apply import FAILURE_NETWORK_TIMEOUT, FAILURE_SELECTOR_INVALID
from ..browser.cdp_client import CdpClient
from .base import CollectQuery, SearchPage, SearchResult, SiteFailure
from .boss_city import CityResolutionError
from .boss_network import DETAIL_MARKERS, SEARCH_MARKERS
from .boss_page import (
    _SELECTORS,
    BOSS_DISPLAY_NAME,
    SELECTOR_SEARCH_READY,
    _as_payload,
    _current_url,
    blocker_failure,
    detect_blocker,
    selector_diagnostic,
)
from .boss_search_filters_mixin import BossFilterMixin

# 对外兼容面：boss.py:78 显式 import 了 _with_response_bodies，其余三个由 __all__ 声明；
# 本文件的 mixin 方法也在用同一批符号，所以这一组 import 同时承担内部使用与对外兼容。
from .boss_search_parse import _raise_api_error as _raise_api_error
from .boss_search_parse import _with_response_bodies as _with_response_bodies
from .boss_search_parse import parse_job_detail as parse_job_detail
from .boss_search_parse import parse_search_payload as parse_search_payload
from .boss_search_scripts import (
    CONDITIONS_FETCH_WAIT_SECONDS as CONDITIONS_FETCH_WAIT_SECONDS,
)
from .boss_search_scripts import (
    FILTER_BAR_POLL_SECONDS as FILTER_BAR_POLL_SECONDS,
)
from .boss_search_scripts import (
    FILTER_BAR_URL as FILTER_BAR_URL,
)
from .boss_search_scripts import (
    FILTER_BAR_WAIT_SECONDS as FILTER_BAR_WAIT_SECONDS,
)
from .boss_search_scripts import (
    JOB_TYPE_QUERY_CODES as JOB_TYPE_QUERY_CODES,
)
from .boss_search_scripts import (
    NETWORK_RESPONSE_EVENT as NETWORK_RESPONSE_EVENT,
)
from .boss_search_scripts import (
    SESSION_FETCH_POLL_SECONDS as SESSION_FETCH_POLL_SECONDS,
)
from .boss_search_scripts import (
    SESSION_FETCH_TIMEOUT as SESSION_FETCH_TIMEOUT,
)
from .boss_search_scripts import (
    _bar_present as _bar_present,
)
from .boss_search_scripts import (
    _card_count_script as _card_count_script,
)
from .boss_search_scripts import (
    _collect_links_script as _collect_links_script,
)
from .boss_search_scripts import (
    _collect_script as _collect_script,
)
from .boss_search_scripts import (
    _detail_script as _detail_script,
)
from .boss_search_scripts import (
    _scroll_list_script as _scroll_list_script,
)
from .boss_search_scripts import (
    _session_conditions_result_script as _session_conditions_result_script,
)
from .boss_search_scripts import (
    _session_conditions_script as _session_conditions_script,
)

logger = logging.getLogger(__name__)


class BossSearchMixin(BossFilterMixin):
    """BOSS 搜索与详情采集实现。"""

    def build_search_url(self, query: CollectQuery, page: int) -> str:
        """拼搜索页 URL：城市名解析成站点编码，站点筛选条件与页码逐一转义拼入。"""
        keyword = quote((query.keywords[0] if query.keywords else "").strip(), safe="")
        try:
            city = self._city_resolver.resolve(query.city or "")
        except CityResolutionError as exc:
            category = (
                FAILURE_NETWORK_TIMEOUT
                if str(exc).startswith("无法获取 BOSS 城市清单")
                else FAILURE_SELECTOR_INVALID
            )
            raise SiteFailure(category, f"城市筛选无法生效：{exc}") from exc
        base = f"https://www.zhipin.com/web/geek/job?query={keyword}&city={city}"
        # 岗位类型里**能映射到站点筛选**的（实习/社招）直接带上官方编码，让站点在
        # 接口侧就筛掉，省翻页；校招没有官方参数，由采集后的本地筛选负责（如实记账）。
        job_type_param = JOB_TYPE_QUERY_CODES.get((query.job_type or "").strip())
        # 用户在「站点筛选」里明确选了求职类型时，**以他选的那一项为准**：否则同一个
        # ``jobType`` 参数会在地址里出现两次（一个来自下面的旧映射、一个来自他刚选的），
        # 站点取哪一个不确定——那正是"我明明选了实习却混进全职"的成因。
        if job_type_param and "jobType" not in query.filters:
            base = f"{base}&jobType={job_type_param}"
        # 站点筛选栏选中的条件。**编码已经过校验**（见 prepare_collect_filters），这里只负责
        # 拼进去；参数名一律转义，免得站点改个键名就把查询串拼坏。
        for name, code in sorted(query.filters.items()):
            if name and code:
                base = f"{base}&{quote(str(name), safe='')}={quote(str(code), safe='')}"
        return f"{base}&page={max(page, 1)}"

    def _capture_network(
        self, client: CdpClient, action: Callable[[], Any]
    ) -> tuple[list[Any], Any]:
        starter = getattr(client, "start_event_capture", None)
        drain = getattr(client, "drain_events", None)
        if starter is None or drain is None:
            return [], action()
        stop = getattr(client, "stop_event_capture", None)
        starter([NETWORK_RESPONSE_EVENT])
        try:
            result = action()
            events = list(drain())
        finally:
            if stop is not None:
                stop()
        try:
            return _with_response_bodies(client, events), result
        except Exception:  # noqa: BLE001 - 网络快路失败不影响 DOM 兜底
            logger.debug("解析网络响应时出错，将退回 DOM 解析", exc_info=True)
            return [], result

    def collect_search(self, client: CdpClient, query: CollectQuery, page: int) -> SearchPage:
        """采集一页搜索结果：网络响应优先、DOM 兜底；明确空结果返回空列表。

        翻页方式（2026-10-09 实测）：BOSS 搜索页不吃 URL 的 page 参数、靠下滑加载更多——只有第 1 页导航，其后滚动加载（``boss_scroll.BossScrollMixin``）。
        """
        if page > 1:
            return self._collect_scroll_page(client, page)
        target = self.build_search_url(query, page)
        previous = _current_url(client)
        outcome: dict[str, Any] = {"state": {}, "failure": None}

        def _load() -> dict[str, Any]:
            client.navigate(target)
            try:
                outcome["state"] = self._await_ready(
                    client,
                    selector=SELECTOR_SEARCH_READY,
                    expected="岗位卡片（如 li.job-card-box / .job-card-wrapper，或岗位详情链接）",
                    allow_empty=True,
                    target_url=target,
                    previous_url=previous,
                )
            except SiteFailure as exc:
                outcome["failure"] = exc
            return outcome["state"]

        responses, state = self._capture_network(client, _load)
        from ..browser.network_capture import first_json_with
        from .boss_network import looks_like_search, parse_search_response, search_has_more

        network_items = first_json_with(responses, looks_like_search)
        parsed = parse_search_response(network_items) if network_items is not None else None
        if parsed:
            has_more = search_has_more(network_items)
            return SearchPage(
                results=[
                    SearchResult(
                        title=item["title"],
                        company=item["company"],
                        location=item["location"],
                        salary=item["salary"],
                        url=item["url"],
                        source=BOSS_DISPLAY_NAME,
                        extra=item.get("extra") or {},
                    )
                    for item in parsed
                ],
                page=page,
                has_next=has_more if has_more is not None else bool(state.get("has_next")),
                unmapped_conditions=self.unmapped_conditions(query),
            )
        _raise_api_error(responses, SEARCH_MARKERS, "岗位搜索")
        failure = outcome["failure"]
        if failure is not None:
            raise failure
        if int(state.get("matched", 0) or 0) <= 0:
            return SearchPage(
                results=[],
                page=page,
                has_next=False,
                unmapped_conditions=self.unmapped_conditions(query),
            )
        payload = _as_payload(client.evaluate(_collect_script()))
        payload = payload if isinstance(payload, dict) else {}
        blocker = detect_blocker(payload)
        if blocker is not None:
            raise blocker_failure(blocker, payload)
        dom_page = parse_search_payload(payload, page, self.unmapped_conditions(query))
        if dom_page.results:
            return dom_page
        link_payload = _as_payload(client.evaluate(_collect_links_script()))
        link_payload = link_payload if isinstance(link_payload, dict) else {}
        link_items = link_payload.get("items")
        if isinstance(link_items, list) and link_items:
            return parse_search_payload(link_payload, page, self.unmapped_conditions(query))
        raise SiteFailure(
            FAILURE_SELECTOR_INVALID,
            selector_diagnostic(payload, "岗位卡片（如 li.job-card-box / .job-card-wrapper）"),
            url=str(payload.get("url") or ""),
            title=str(payload.get("title") or ""),
        )

    def fetch_job_detail(self, client: CdpClient, url: str) -> dict[str, Any]:
        """采集单个岗位详情：打开岗位页，网络响应优先解析 JD，失败退回 DOM，仍无正文则抛 SiteFailure。"""
        previous = _current_url(client)
        outcome: dict[str, Any] = {"state": {}, "failure": None}

        def _load() -> dict[str, Any]:
            client.navigate(url)
            try:
                outcome["state"] = self._await_ready(
                    client,
                    selector=_SELECTORS["detail_ready"],
                    expected="岗位详情内容（如 .job-sec-text）",
                    allow_empty=False,
                    target_url=url,
                    previous_url=previous,
                )
            except SiteFailure as exc:
                outcome["failure"] = exc
            return outcome["state"]

        responses, _ = self._capture_network(client, _load)
        from ..browser.network_capture import first_json_with
        from .boss_network import looks_like_detail, parse_detail_response

        network_detail = first_json_with(responses, looks_like_detail)
        if network_detail is not None:
            parsed = parse_detail_response(network_detail)
            if parsed is not None:
                parsed["url"] = parsed.get("url") or url
                return parsed
        _raise_api_error(responses, DETAIL_MARKERS, "岗位详情")
        if outcome["failure"] is not None:
            raise outcome["failure"]
        payload = _as_payload(client.evaluate(_detail_script()))
        parsed = parse_job_detail(payload if isinstance(payload, dict) else {})
        if parsed.get("description") or parsed.get("requirements"):
            return parsed
        state = payload if isinstance(payload, dict) else {}
        raise SiteFailure(
            FAILURE_SELECTOR_INVALID,
            selector_diagnostic(state, "岗位详情正文（职位描述 / 任职要求）"),
            url=str(state.get("url") or url),
            title=str(state.get("title") or ""),
        )


__all__ = [
    "BossSearchMixin",
    "NETWORK_RESPONSE_EVENT",
    "SESSION_FETCH_TIMEOUT",
    "_session_conditions_script",
    "parse_job_detail",
    "parse_search_payload",
]
