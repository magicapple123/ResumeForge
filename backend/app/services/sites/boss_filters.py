"""BOSS 筛选栏的选项目录：把站点自己的筛选项读成界面可用的下拉表，再映射成查询参数。

**为什么由站点提供选项，而不是我们写死一份**：这份清单一改，写死的那份就会**静默筛错**——
用户以为按「本科」筛了，实际站点认的是另一个编码。所以选项一律读站点自己的数据，
读不到就如实说"不可用"，绝不猜。

三条来源，按可信度排序（``Source`` 常量）：

1. ``SESSION``——在用户**已登录**的浏览器页面上发一次带凭据的请求，拿到**这个账号可见**的
   清单。**这一条是必需的**：2026-09-20 实测，「求职类型」的选项因人而异（登录账号能看到
   「实习」，未登录看不到），写死一份就等于替所有用户决定了他们能选什么。
2. ``PUBLIC``——同一批接口的**免登录**版本。全网一致的公共清单，浏览器没启动时用它。
3. ``SNAPSHOT``——内置快照，联网失败时的兜底。**只覆盖 6 个短清单**；行业有 134 条，
   放进代码里是纯粹的体积负担，拿不到就如实标 ``UNAVAILABLE``。

**参数名从哪来**：全部由**真实点击**得到——打开站点自己的筛选栏、点一个选项、读地址栏。
不是从 HTML 属性推的：埋点属性写的是 ``sel-job-rec-exp``，而地址栏里的参数名是
``experience``，照 HTML 抄就错了。见 ``FILTER_GROUPS`` 的逐条注释。

本模块是纯函数 + 一次可注入的网络调用（无浏览器、无数据库），因此可以离线逐条测。

本文件承接原 ``boss_filters`` 的网络获取三件套（``default_fetcher`` /
``fetch_catalogue`` / ``_fetch_public``，conftest 对 ``boss_filters.default_fetcher``
有全局 patch 契约，必须留在本模块命名空间）与 ``FILTER_BAR_SCRIPT``；数据模型、
离线快照与解码/解析纯函数在 ``boss_filters_catalog``，此处以 ``import x as x``
显式别名再导出保持原命名空间全集。"""
from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from typing import Any
from urllib.request import Request, urlopen

from .base import (
    SOURCE_PUBLIC as SOURCE_PUBLIC,
)
from .base import (
    SOURCE_SESSION as SOURCE_SESSION,
)
from .base import (
    SOURCE_SNAPSHOT as SOURCE_SNAPSHOT,
)
from .base import (
    SOURCE_UNAVAILABLE as SOURCE_UNAVAILABLE,
)
from .boss_filters_catalog import (
    CONDITIONS_ENDPOINT as CONDITIONS_ENDPOINT,
)
from .boss_filters_catalog import (
    DEFAULT_TIMEOUT_SECONDS as DEFAULT_TIMEOUT_SECONDS,
)
from .boss_filters_catalog import (
    GROUP_SPECS as GROUP_SPECS,
)
from .boss_filters_catalog import (
    INDUSTRY_ENDPOINT as INDUSTRY_ENDPOINT,
)
from .boss_filters_catalog import (
    MAX_RESPONSE_BYTES as MAX_RESPONSE_BYTES,
)
from .boss_filters_catalog import (
    UNLIMITED_CODE as UNLIMITED_CODE,
)
from .boss_filters_catalog import (
    FilterGroup as FilterGroup,
)
from .boss_filters_catalog import (
    FilterOption as FilterOption,
)
from .boss_filters_catalog import (
    ResolvedFilters as ResolvedFilters,
)
from .boss_filters_catalog import (
    build_catalogue as build_catalogue,
)
from .boss_filters_catalog import (
    parse_conditions as parse_conditions,
)
from .boss_filters_catalog import (
    parse_filter_bar as parse_filter_bar,
)
from .boss_filters_catalog import (
    parse_industries as parse_industries,
)
from .boss_filters_catalog import (
    resolve_codes as resolve_codes,
)
from .boss_filters_catalog import (
    snapshot_catalogue as snapshot_catalogue,
)

logger = logging.getLogger(__name__)

Fetcher = Callable[[str, float], Any]

# 读站点筛选栏的脚本。**只读不点**：选项清单是站点自己渲染出来的那份，正是用户看到的那份。
# 按标题（而不是按 DOM 顺序）认分组——站点调换顺序、增删格子都不会取错。
FILTER_BAR_SCRIPT = """(() => { /* rf:filters */
  const push = (out, title, options) => { out.push({ title, options }); };
  const groups = [];
  for (const box of document.querySelectorAll('.condition-filter-select, .condition-industry-select')) {
    const titleNode = box.querySelector('.current-select .placeholder-text, .current-select');
    const title = titleNode ? (titleNode.textContent || '').trim() : '';
    const options = [];
    for (const li of box.querySelectorAll('.filter-select-dropdown li')) {
      const groupNode = li.querySelector('.label');
      const group = groupNode ? (groupNode.textContent || '').trim() : '';
      const children = li.querySelectorAll('.select-list a');
      const nodes = children.length ? children : [li];
      for (const node of nodes) {
        const label = (node.textContent || '').replace(/\\s+/g, ' ').trim();
        const ka = node.getAttribute('ka') || '';
        const code = ka ? ka.split('-').pop() : '';
        if (label && code && /^\\d+$/.test(code)) options.push({ code, label, group });
      }
    }
    if (title && options.length) push(groups, title, options);
  }
  return JSON.stringify({ url: location.href, groups });
})()"""



def default_fetcher(url: str, timeout: float) -> Any:
    """免登录公开接口获取筛选清单。"""
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 ResumeForge"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - 固定 https 站点
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        return {}
    return raw



def fetch_catalogue(
    *,
    fetcher: Fetcher | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    session_values: Mapping[str, Any] | None = None,
    bar_payload: Any = None,
) -> tuple[FilterGroup, ...]:
    """按可信度取选项：页面筛选栏 > 带凭据的接口 > 免登录接口 > 内置快照。

    ``session_values`` 是**在用户已登录的页面上**取到的接口响应（``{url: 响应体}``），
    ``bar_payload`` 是同一页面上筛选栏的读取结果。两者都由适配器层提供——本模块不认识
    浏览器，只认识数据；拿不到就退回免登录那条路。
    """
    fetched = dict(session_values or {})
    bar = parse_filter_bar(bar_payload)
    # 会话里读到的（带登录态）优先：它是"这个账号可见"的那份，正是用户自己看到的东西。
    session_conditions = parse_conditions(fetched.get(CONDITIONS_ENDPOINT))
    if session_conditions or bar:
        get = fetcher or default_fetcher
        # **仍然补一次免登录请求**：会话那份拿不到行业（行业不在 conditions.json 里），
        # 只靠页面筛选栏又不可信（见 ``GroupSpec.dom_codes``）。缺什么补什么，补不到就算了。
        public_conditions, industries = _fetch_public(get, timeout)
        return build_catalogue(
            conditions=public_conditions,
            industries=industries,
            bar={**session_conditions, **bar},
            source=SOURCE_SESSION,
        )

    conditions, industries = _fetch_public(fetcher or default_fetcher, timeout)
    if conditions or industries:
        return build_catalogue(conditions=conditions, industries=industries, source=SOURCE_PUBLIC)
    return snapshot_catalogue()



def _fetch_public(
    get: Fetcher, timeout: float
) -> tuple[dict[str, tuple[FilterOption, ...]], tuple[FilterOption, ...]]:
    """免登录读两个公开接口。任何失败都折成"没读到"，由调用方决定退回哪一层。"""
    conditions: dict[str, tuple[FilterOption, ...]] = {}
    industries: tuple[FilterOption, ...] = ()
    try:
        conditions = parse_conditions(get(CONDITIONS_ENDPOINT, timeout))
    except Exception as exc:  # noqa: BLE001 - 网络失败退回快照，不影响界面可用
        logger.info("免登录读取 BOSS 筛选条件失败：%s", exc)
    try:
        industries = parse_industries(get(INDUSTRY_ENDPOINT, timeout))
    except Exception as exc:  # noqa: BLE001
        logger.info("读取 BOSS 行业清单失败：%s", exc)
    return conditions, industries



__all__ = [
    "CONDITIONS_ENDPOINT",
    "FILTER_BAR_SCRIPT",
    "GROUP_SPECS",
    "INDUSTRY_ENDPOINT",
    "SOURCE_PUBLIC",
    "SOURCE_SESSION",
    "SOURCE_SNAPSHOT",
    "SOURCE_UNAVAILABLE",
    "UNLIMITED_CODE",
    "FilterGroup",
    "FilterOption",
    "ResolvedFilters",
    "build_catalogue",
    "default_fetcher",
    "fetch_catalogue",
    "parse_conditions",
    "parse_filter_bar",
    "parse_industries",
    "resolve_codes",
    "snapshot_catalogue",
]
