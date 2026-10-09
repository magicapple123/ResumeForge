"""BOSS 搜索列表的滚动加载（第 2 页起）。

**为什么存在（用户实测，2026-10-09）**：BOSS 搜索页**不吃 URL 的 page 参数**——换 page
值导航返回的永远是同一批推荐位；站点靠**向下滑动列表**加载更多。所以第 1 页导航进入
搜索页，第 2 页起由这里滚动加载：读卡片数基线 → 滚到底 → 等新卡片渲染 → 整表读取
（重复条目由采集器的去重筛掉）。滚动后没有新增 → 返回空页（``has_next=False``），
采集器据此干净收尾，而不是翻着重复页空转。

单独成文件：BossSearchMixin 已经顶着 500 行预算线，滚动是自成一体的第三种页面交互
（导航 / 滚动 / 详情），塞回去只会让下一次改动再次爆线。
"""
from __future__ import annotations

import logging
import time

from ...models.apply import FAILURE_SELECTOR_INVALID
from ..browser.cdp_client import CdpClient
from .base import SearchPage, SiteFailure
from .boss_page import (
    _as_payload,
    blocker_failure,
    detect_blocker,
    selector_diagnostic,
)
from .boss_search_scripts import (
    _card_count_script,
    _collect_script,
    _scroll_list_script,
)

logger = logging.getLogger(__name__)


class BossScrollMixin:
    """由搜索采集共用的"下滑加载更多"逻辑。"""

    def _collect_scroll_page(self, client: CdpClient, page: int) -> SearchPage:
        """第 2 页起：滚动列表加载下一批，整表读取（重复由采集器去重筛掉）。

        本方法**不导航**——导航会把列表重置回第一批，滚动加载的进度就全丢了。
        """
        baseline = self._read_card_count(client)
        if baseline is None:
            # 连卡片数都读不到（页面不在搜索页 / 结构变化）→ 按没有更多处理，
            # 让采集器收尾；报错反而会把"已经采到的"也拖成整批失败。
            return SearchPage(results=[], page=page, has_next=False)
        client.evaluate(_scroll_list_script())
        if not self._wait_card_growth(client, baseline):
            return SearchPage(results=[], page=page, has_next=False)
        payload = _as_payload(client.evaluate(_collect_script()))
        payload = payload if isinstance(payload, dict) else {}
        blocker = detect_blocker(payload)
        if blocker is not None:
            raise blocker_failure(blocker, payload)
        from .boss_search import parse_search_payload

        dom_page = parse_search_payload(payload, page)
        if not dom_page.results:
            # 滚出了新卡片却一条都解析不出来 → 按选择器失效报错，别静默当成 0 条。
            raise SiteFailure(
                FAILURE_SELECTOR_INVALID,
                selector_diagnostic(payload, "岗位卡片（如 li.job-card-box / .job-card-wrapper）"),
                url=str(payload.get("url") or ""),
                title=str(payload.get("title") or ""),
            )
        # 滚动页的翻页终止只看"滚动有没有加载出新的"（上面的 growth），DOM 脚本里的
        # has_next 是给导航页用的翻页按钮语义，这里不用。
        return SearchPage(
            results=dom_page.results,
            page=page,
            has_next=True,
            unmapped_conditions=dom_page.unmapped_conditions,
        )

    def _read_card_count(self, client: CdpClient) -> int | None:
        """读取当前搜索页上的岗位卡片数量；读不到返回 ``None``。"""
        try:
            state = _as_payload(client.evaluate(_card_count_script()))
        except Exception:  # noqa: BLE001 - 读不到卡片数就当作"没有更多"
            logger.warning("读取岗位卡片数量失败", exc_info=True)
            return None
        if not isinstance(state, dict):
            return None
        try:
            return int(state.get("count") or 0)
        except (TypeError, ValueError):
            return None

    def _wait_card_growth(self, client: CdpClient, baseline: int) -> bool:
        """滚动后等新卡片渲染：数量超过基线即成功；预算用完仍没长 → 加载到底了。

        预算沿用就绪等待的 timeout（默认 15s，弱网下"加载更多"的 XHR + 渲染都在
        这个预算内）；轮询间隔同样取自就绪等待配置。测试用极小的 ReadyWait 即可
        把这里的等待压到毫秒级。
        """
        timeout = float(self._ready_wait.timeout)
        poll = max(float(getattr(self._ready_wait, "poll_interval", 0.4)), 0.2)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            count = self._read_card_count(client)
            if count is not None and count > baseline:
                return True
            time.sleep(poll)
        return False
