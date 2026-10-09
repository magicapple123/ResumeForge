"""BOSS 搜索/详情采集用的页面脚本构造器与常量（``rf:filter-conditions`` / ``rf:collect`` /
``rf:collect-links`` / ``rf:detail`` 等页面协议；JS 字符串逐字符原样保留）。"""
from __future__ import annotations

import json

from ..browser.cdp_client import CdpClient
from .boss_filters import CONDITIONS_ENDPOINT, FILTER_BAR_SCRIPT, parse_filter_bar
from .boss_page import _SELECTORS, SELECTOR_JOB_LINK, _js

NETWORK_RESPONSE_EVENT = "Network.responseReceived"

# 站点官方「求职类型」筛选参数（`jobType`）的编码。2026-09-20 用真实登录会话从站点自己的
# 筛选条件接口（`/wapi/zpgeek/pc/all/filter/conditions.json`）拿到，并逐档实测：三个编码各
# 跑一次搜索，返回 15 条全部为对应类型（响应 `jobType` 字段 1902→全 4、1901→全 0、
# 1903→全 6）。**官方没有「校招」档**（校招是独立专区），校招走采集后本地筛选
# （见 ``collect_filters.JOB_TYPE_EXPECTED_CODES``）。
JOB_TYPE_QUERY_CODES = {"实习": "1902", "社招": "1901"}

# 在用户当前页面上读筛选项的超时。比默认命令超时短：这只是配置界面的一次"顺手读"，
# 读不到就退回公开清单，不该让用户对着一个转圈的弹窗等半分钟。
SESSION_FETCH_TIMEOUT = 12.0
# 轮询那次 fetch 结果的间隔，以及总预算。它是页面内的一次网络请求，正常几百毫秒就回来；
# 拿不到就迅速收手——**它的失败方式是"永远不回来"，等下去没有任何意义**。
SESSION_FETCH_POLL_SECONDS = 0.4
CONDITIONS_FETCH_WAIT_SECONDS = 4.0

# 读筛选栏用的落地页。**不带任何条件**：不触发一次真实搜索，只把筛选栏渲染出来。
FILTER_BAR_URL = "https://www.zhipin.com/web/geek/jobs"
# 等筛选栏渲染出来的上限与轮询间隔。渲染是本地行为，几秒足够；等太久不如直接退回公开清单。
FILTER_BAR_WAIT_SECONDS = 8.0
FILTER_BAR_POLL_SECONDS = 0.6


def _bar_present(client: CdpClient) -> bool:
    """当前页面是不是已经有筛选栏了（有就不必再开一次页面）。读不出来按"没有"处理。"""
    try:
        return bool(parse_filter_bar(client.evaluate(FILTER_BAR_SCRIPT, timeout=5.0)))
    except Exception:  # noqa: BLE001 - 页面不在搜索页 / 读不到，都当作没有
        return False


def _session_conditions_script() -> str:
    """在**已登录**的页面上请求筛选条件接口。

    ``credentials: 'include'`` 是关键：同一个 URL，带上登录态才会返回"这个账号可见"的完整
    清单（实测差异见 ``boss_filters`` 模块说明）。

    **刻意不返回 Promise**：CDP 那边支持 ``awaitPromise``，但实测（2026-09-20）在 BOSS 的
    geek 页面（搜索结果页、岗位详情页）上这个 fetch **永远不 resolve**——await 它会把每一次
    读取都拖成一次完整超时，而失败方式看起来像"浏览器卡住了"。所以这里改成"发出去、
    把结果写进全局变量"，由调用方轮询取值：读不到就当作没读到，代价是一次短等待，
    不会挂住任何东西。落到首页之类 fetch 正常的页面上照样能用。
    """
    return "".join(
        [
            "(() => { /* rf:filter-conditions */\n",
            "  try { window.__rfFilterConditions = null; } catch (error) { return 1; }\n",
            f"  fetch({json.dumps(CONDITIONS_ENDPOINT)}, {{credentials: 'include'}})\n",
            "    .then((response) => (response.ok ? response.text() : ''))\n",
            "    .then((text) => { window.__rfFilterConditions = text || ''; })\n",
            "    .catch(() => { window.__rfFilterConditions = ''; });\n",
            "  return 1;\n",
            "})()",
        ]
    )


def _session_conditions_result_script() -> str:
    """取上面那次 fetch 的结果；还没回来时返回 ``null``。"""
    return "(() => { try { return window.__rfFilterConditions ?? null; } catch (error) { return null; } })()"


def _collect_script() -> str:
    return "".join(
        [
            "(() => { /* rf:collect */\n",
            f"  const CARD = {_js(_SELECTORS['search_card'])};\n",
            f"  const TITLE = {_js(_SELECTORS['search_title'])};\n",
            f"  const COMPANY = {_js(_SELECTORS['search_company'])};\n",
            f"  const SALARY = {_js(_SELECTORS['search_salary'])};\n",
            f"  const LOCATION = {_js(_SELECTORS['search_location'])};\n",
            f"  const LINK = {_js(_SELECTORS['search_link'])};\n",
            "  const visible = (n) => !!(n && n.getClientRects().length);\n",
            "  const pick = (root, sel) => { const n = root.querySelector(sel);\n",
            "    return n ? (n.textContent || '').trim() : ''; };\n",
            "  const items = [...document.querySelectorAll(CARD)].filter(visible).map((card) => {\n",
            "    const a = card.querySelector(LINK);\n",
            "    return {\n",
            "      title: pick(card, TITLE),\n",
            "      company: pick(card, COMPANY),\n",
            "      salary: pick(card, SALARY),\n",
            "      location: pick(card, LOCATION),\n",
            "      url: a ? a.href : '',\n",
            "    };\n",
            "  }).filter((item) => item.title && (!item.url || item.url.includes('/job_detail/')));\n",
            "  const next = document.querySelector(" + _js(_SELECTORS["search_next"]) + ");\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    items,\n",
            "    has_next: !!(next && !next.classList.contains('disabled')),\n",
            "  });\n",
            "})()",
        ]
    )


def _collect_links_script() -> str:
    return "".join(
        [
            "(() => { /* rf:collect-links */\n",
            f"  const LINK = {_js(SELECTOR_JOB_LINK)};\n",
            "  const scope = document.querySelector('.job-list-container, .search-job-result, main') || document;\n",
            "  const seen = new Set();\n",
            "  const items = [];\n",
            "  for (const a of scope.querySelectorAll(LINK)) {\n",
            "    const href = a.href || '';\n",
            "    const excluded = a.closest('.recommend-job-list, .recommend-list, aside, [class*=recommend]');\n",
            "    if (!href || seen.has(href) || excluded || !a.getClientRects().length) continue;\n",
            "    seen.add(href);\n",
            "    const title = (a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || '').trim();\n",
            "    if (!title) continue;\n",
            "    items.push({ title, company: '',\n",
            "      salary: '', location: '', url: href });\n",
            "  }\n",
            "  const next = document.querySelector(" + _js(_SELECTORS["search_next"]) + ");\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    items,\n",
            "    has_next: !!(next && !next.classList.contains('disabled')),\n",
            "  });\n",
            "})()",
        ]
    )


def _detail_script() -> str:
    return "".join(
        [
            "(() => { /* rf:detail */\n",
            f"  const TITLE = {_js(_SELECTORS['search_title'])};\n",
            f"  const COMPANY = {_js(_SELECTORS['search_company'])};\n",
            f"  const DESC = {_js(_SELECTORS['job_description'])};\n",
            f"  const REQ = {_js(_SELECTORS['job_requirements'])};\n",
            "  const root = document.querySelector('.job-detail-box, .job-detail-body, main') || document;\n",
            "  const pick = (sel) => { const n = root.querySelector(sel);\n",
            "    return n ? (n.textContent || '').trim() : ''; };\n",
            "  const byHeading = (words) => {\n",
            "    for (const section of root.querySelectorAll('section, .job-detail-section, .job-sec')) {\n",
            "      const heading = section.querySelector('h1,h2,h3,h4,.title,.section-title');\n",
            "      const label = heading ? (heading.textContent || '').trim() : '';\n",
            "      if (words.some((word) => label.includes(word))) return (section.innerText || '').trim();\n",
            "    } return ''; };\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    job_title: pick(TITLE),\n",
            "    company: pick(COMPANY),\n",
            "    description: pick(DESC) || byHeading(['职位描述', '岗位职责', '工作内容']),\n",
            "    requirements: pick(REQ) || byHeading(['任职要求', '职位要求', '岗位要求']),\n",
            "  });\n",
            "})()",
        ]
    )


def _card_count_script() -> str:
    """数当前搜索页上的岗位卡片，顺带探测"没有更多"标志。

    BOSS 的搜索列表在分栏视图下是**内部滚动容器**（左列表 + 右详情），所以只数
    卡片数量，不关心滚动发生在窗口还是容器上。
    """
    return "".join(
        [
            "(() => { /* rf:card-count */\n",
            f"  const CARD = {_js(_SELECTORS['search_card'])};\n",
            f"  const LINK = {_js(_SELECTORS['search_link'])};\n",
            "  const cards = document.querySelectorAll(CARD + ', ' + LINK);\n",
            "  const noMore = document.body.innerText.includes('没有更多');\n",
            "  return JSON.stringify({ count: cards.length, no_more: noMore });\n",
            "})()",
        ]
    )


def _scroll_list_script() -> str:
    """把岗位列表滚到底部，触发站点的"下滑加载更多"。

    滚动目标按优先级：岗位卡片的**可滚动祖先**（分栏视图下的左列表容器）→ 页面
    窗口。BOSS 的加载由滚动到底触发，一次滚动通常加载一批（约一页的量）。
    """
    return "".join(
        [
            "(() => { /* rf:scroll-list */\n",
            f"  const CARD = {_js(_SELECTORS['search_card'])};\n",
            f"  const LINK = {_js(_SELECTORS['search_link'])};\n",
            "  const card = document.querySelector(CARD + ', ' + LINK);\n",
            "  let el = card ? card.parentElement : null;\n",
            "  let scrolled = '';\n",
            "  while (el && el !== document.body) {\n",
            "    if (el.scrollHeight > el.clientHeight + 4) {\n",
            "      el.scrollTop = el.scrollHeight;\n",
            "      scrolled = 'container';\n",
            "      break;\n",
            "    }\n",
            "    el = el.parentElement;\n",
            "  }\n",
            "  if (!scrolled) { window.scrollTo(0, document.body.scrollHeight); scrolled = 'window'; }\n",
            "  return JSON.stringify({ scrolled: scrolled });\n",
            "})()",
        ]
    )
