# SPDX-License-Identifier: Apache-2.0
"""BOSS 站点侧筛选项读取（页面 / 登录态接口两条路）——由 ``BossSearchMixin`` 继承。

2026-10-22（行数预算审计 A2）：从 ``boss_search`` 的 ``# ===== 站点侧筛选项 =====``
分段原样搬出。单独成 mixin 而不是模块级函数：这些方法要读 ``self._filter_fetcher`` /
``self._filter_timeout``（由 ``BossAdapter`` 注入），且 ``prepare_collect_filters`` 会
回调 ``self.fetch_filter_options``——它们本来就是"挂在适配器上的能力"。
``BossSearchMixin`` 改成继承本 mixin，``boss.py`` 的 MRO 与属性查找对调用方透明。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from typing import Any

from ..browser.cdp_client import CdpClient
from .base import CollectQuery, FilterResolution
from .boss_filters import (
    CONDITIONS_ENDPOINT,
    FILTER_BAR_SCRIPT,
    fetch_catalogue,
    parse_filter_bar,
    resolve_codes,
)
from .boss_search_scripts import (
    CONDITIONS_FETCH_WAIT_SECONDS,
    FILTER_BAR_POLL_SECONDS,
    FILTER_BAR_URL,
    FILTER_BAR_WAIT_SECONDS,
    SESSION_FETCH_POLL_SECONDS,
    SESSION_FETCH_TIMEOUT,
    _bar_present,
    _session_conditions_result_script,
    _session_conditions_script,
)

logger = logging.getLogger(__name__)


class BossFilterMixin:
    """BOSS 站点侧筛选项读取（页面 / 登录态接口两条路）——由 ``BossSearchMixin`` 继承。"""

    # ===== 站点侧筛选项 =====
    #
    # 两条读取路径，优先"用户自己看到的那份"：
    # - **页面上直接读**（``FILTER_BAR_SCRIPT``）：筛选栏是站点渲染出来的，正是用户看到的选项；
    # - **带登录态的接口请求**（``_session_conditions_script``）：在已登录页面上发一次 fetch，
    #   拿到**这个账号可见**的清单。这一条是必需的——「求职类型」的选项因人而异
    #   （2026-09-20 实测：登录账号能看到「实习」，未登录看不到），写死一份就等于替所有
    #   用户决定了他们能选什么。
    # 浏览器没启动时退回免登录的公开清单（``boss_filters.fetch_catalogue`` 自己会退）。

    def _read_session_filters(self, client: CdpClient) -> tuple[dict[str, Any], Any]:
        """在用户当前的页面上读筛选项。**三条路各读各的**，谁成功用谁，互不牵连。

        - 页面筛选栏（``FILTER_BAR_SCRIPT``）：搜索页上一定有，且是"这个账号能看到"的那份；
        - 带登录态的接口请求（``_session_conditions_script``）：任何 zhipin 页面上都能发，
          但结果要靠轮询取（见那个脚本的说明——它的 Promise 在 geek 页面上不 resolve）。
        """
        bar: Any = None
        try:
            bar = client.evaluate(FILTER_BAR_SCRIPT, timeout=SESSION_FETCH_TIMEOUT)
        except Exception:  # noqa: BLE001 - 页面不在搜索结果页时本来就读不到筛选栏
            logger.debug("读取 BOSS 页面筛选栏失败（页面可能不在搜索结果页）", exc_info=True)
        if parse_filter_bar(bar):
            # **页面上已经有清单了，就不再发那次接口请求。** 筛选栏是更完整、更直接的那一份
            # （它连接口不给的三级行业都有），而且**那次 fetch 在 geek 页面上根本不 resolve**
            # ——继续等它只会白等满一个轮询预算。
            return {}, bar

        values: dict[str, Any] = {}
        try:
            client.evaluate(_session_conditions_script(), timeout=SESSION_FETCH_TIMEOUT)
            body = self._await_conditions(client)
            if isinstance(body, str) and body.strip():
                values[CONDITIONS_ENDPOINT] = body
        except Exception:  # noqa: BLE001 - 读不到就走公开清单，不打断界面
            logger.debug("带登录态读取 BOSS 筛选条件失败，将退回公开清单", exc_info=True)
        return values, bar

    def _await_conditions(self, client: CdpClient) -> Any:
        """短轮询取那次 fetch 的结果；超时就放弃（**不等满一个命令超时**）。"""
        deadline = time.monotonic() + CONDITIONS_FETCH_WAIT_SECONDS
        while time.monotonic() < deadline:
            try:
                result = client.evaluate(_session_conditions_result_script(), timeout=5.0)
            except Exception:  # noqa: BLE001 - 取不到就是"没读到"
                return None
            if result is not None:
                return result
            time.sleep(SESSION_FETCH_POLL_SECONDS)
        return None

    def fetch_filter_options(self, client: CdpClient | None = None) -> tuple[Any, ...]:
        """当前筛选清单。**有浏览器就优先读页面上的那份**（含账号可见的完整选项）。"""
        fetcher = getattr(self, "_filter_fetcher", None)
        timeout = getattr(self, "_filter_timeout", 6.0)
        if client is not None:
            values, bar = self._read_session_filters(client)
            if values or bar:
                return fetch_catalogue(
                    fetcher=fetcher, timeout=timeout, session_values=values, bar_payload=bar
                )
        return fetch_catalogue(fetcher=fetcher, timeout=timeout)

    def prepare_collect_filters(
        self, selected: Mapping[str, str] | None, client: CdpClient | None = None
    ) -> FilterResolution:
        """解析站点筛选条件。**只在必要时才多走一次页面**。

        采集开始那一刻，浏览器通常停在上一轮留下的岗位上（岗位详情页）——那上面没有筛选栏。
        免登录的公开清单里又没有「求职类型：实习」这类**只对某些账号可见**的选项，于是用户
        明明选了、却会被判成"没能生效"。

        所以：先用手头能读到的清单校验一遍；**只有确实有没校验过的项、且浏览器在的时候**，
        才去搜索页读一次筛选栏再校验一遍。没配站点筛选、或者选的项公开清单就能确认时，
        一次多余的页面都不会开。
        """
        if not selected:
            return FilterResolution()
        resolved = resolve_codes(selected, self.fetch_filter_options(client))
        # 还有没校验过的项、当前页面又没有筛选栏 → 去搜索页读一次再校验。
        if (
            resolved.unapplied
            and client is not None
            and not _bar_present(client)
            and self._load_filter_bar(client)
        ):
            resolved = resolve_codes(selected, self.fetch_filter_options(client))
        if resolved.unapplied:
            logger.warning(
                "这些筛选条件本次没能生效（编码不在站点当前清单里）：%s", resolved.unapplied
            )
        return FilterResolution(
            params=resolved.params, applied=resolved.applied, unapplied=resolved.unapplied
        )

    def _load_filter_bar(self, client: CdpClient) -> bool:
        """去搜索页把筛选栏读出来。**这是唯一一次为读选项而开的页面**，读不到就作罢。"""
        try:
            client.navigate(FILTER_BAR_URL)
        except Exception:  # noqa: BLE001 - 开不了就当没读到，后面照样能采
            logger.debug("为读取筛选栏打开搜索页失败", exc_info=True)
            return False
        deadline = time.monotonic() + FILTER_BAR_WAIT_SECONDS
        while time.monotonic() < deadline:
            time.sleep(FILTER_BAR_POLL_SECONDS)
            try:
                payload = client.evaluate(FILTER_BAR_SCRIPT, timeout=5.0)
            except Exception:  # noqa: BLE001 - 页面还在加载
                continue
            if parse_filter_bar(payload):
                return True
        logger.info("搜索页上没能读到筛选栏，本次按公开清单校验筛选条件")
        return False

    def unmapped_conditions(self, query: CollectQuery) -> list[str]:
        return []
