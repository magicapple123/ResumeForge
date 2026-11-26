# SPDX-License-Identifier: Apache-2.0
"""会话列表的**双键定位**：在 BOSS 聊天页左栏里找出"本次投递的那个招聘方"。

## 为什么需要单独一层（R23，P0：发错人不可撤回）

同一家公司常有**多个 HR 在招不同岗位**。旧实现三步全只认公司名：

1. ``_user_list_script(company)``：条目文本含公司名就命中，**命中第一条立即 break**；
2. ``boss_chat_guard.verify_conversation(company)``：右栏标题含公司名即通过；
3. ``confirm_conversation_after_send(company, fallback)``：发送后再看一次公司名。

于是第 1 步取 DOM 靠前那条（通常最近聊过），2、3 步照样绿灯 → **图发给了另一个人**，而聊天
消息不可撤回。现在的定位键是「公司名 + 岗位名」两个：二级筛完**恰好剩 1 条**才点它；多条或
零条一律明确失败（诊断里列出候选标题），绝不退化成"点第一条"。``job_title`` 为空时只按公司
筛——历史队列条目可能没有岗位名，这是唯一允许放宽的情形。

对应的核对侧（发图前 / 发图后）在 ``boss_chat_guard.py``，两处必须同口径：只改一处等于
"点对了、核对又放行别人"。

## 为什么单独成文件

``boss_chat_image.py`` 已贴着 500 行预算，而"选会话"这一段（页面脚本 + 三种失败的诊断文案）
本身就占了两百多行。对外入口仍然是 ``adapter.upload_greeting_images(...)``，本模块只提供
:class:`BossConversationMatchMixin` 给 ``BossChatImageMixin`` 继承。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ...models.apply import FAILURE_FILE_UPLOAD_FAILED
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.interaction import trusted_click
from ..browser.page_ready import wait_for_page_state
from .base import SiteFailure
from .boss_page import (
    SELECTOR_CHAT_USER_LIST,
    _as_payload,
    _blocker_js,
    _js,
    blocker_failure,
    detect_blocker,
)

logger = logging.getLogger(__name__)

# 诊断里附几条会话文本：够定位"到底在哪个列表里找过"，又不至于把整个会话列表抄进记录。
SAMPLE_SIZE = 5

if TYPE_CHECKING:
    from ..browser.page_ready import ReadyWait


def _user_list_script(company: str, job_title: str = "") -> str:
    """在会话列表里按「公司名 + 岗位名」做**包含匹配**，收集**全部**命中项再交回判定。

    匹配在页面里做（一次往返拿到"命中几条 + 坐标 + 样本"），而不是把整个列表拉回来再比对：
    坐标必须来自**同一份**渲染结果，否则"取文本"与"取坐标"之间列表一重排就点错位置。

    **绝不"命中第一条就 break"。** 两级筛：先筛公司名，再在**其中**筛岗位名（``job_title``
    为空时只按公司筛，但同样收集全部命中，不退化成"取第一条"）。

    返回结构：

    - ``match_count``：二级筛后还剩几条（判定"唯一"的唯一依据）；
    - ``matches``：全部命中项的 ``{text, rect}``（最多 ``SAMPLE_SIZE`` 条，供诊断列出候选）；
    - ``rect`` / ``matched``：**仅当恰好 1 条且坐标可用**时才给（调用方据此决定点不点）；
    - ``samples`` / ``captcha`` / ``login_required``：沿用原有字段（诊断与其它调用方在读）。

    列表容器先按实测结构找（``.user-list-content``），找不到再退一层到 ``.user-list``；
    后一层会把顶部筛选行 ``UL.label-list`` 一起圈进来，因此**显式按 class 排除它**
    （点它只会切换筛选视图，不会打开会话）。
    """
    return "".join(
        [
            "(() => { /* rf:chat-user-list */\n",
            _blocker_js(),
            f"  const LISTS = [{_js(SELECTOR_CHAT_USER_LIST)}, '.chat-content .user-list'];\n",
            f"  const COMPANY = {_js(company)};\n",
            f"  const JOB = {_js(job_title)};\n",
            f"  const LIMIT = {SAMPLE_SIZE};\n",
            "  const SKIP = /label-list/;\n",
            "  const norm = (text) => (text || '').replace(/\\s+/g, '').toLowerCase();\n",
            "  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();\n",
            "  const target = norm(COMPANY);\n",
            "  const job = norm(JOB);\n",
            "  let items = [];\n",
            "  for (const sel of LISTS) {\n",
            "    for (const box of document.querySelectorAll(sel)) {\n",
            "      const kids = [...box.children].filter((node) => {\n",
            "        if (SKIP.test(node.getAttribute('class') || '')) return false;\n",
            "        return clean(node.innerText) !== '';\n",
            "      });\n",
            "      if (kids.length > items.length) { items = kids; }\n",
            "    }\n",
            "    if (items.length) break;\n",
            "  }\n",
            "  const texts = items.map((node) => clean(node.innerText));\n",
            "  const hits = [];\n",
            "  if (target) {\n",
            "    for (const node of items) {\n",
            "      const text = norm(node.innerText);\n",
            "      if (text.indexOf(target) < 0) { continue; }\n",
            # 二级键：岗位名。空岗位名 = 只按公司筛（唯一的放宽情形），但照样收集全部命中。
            "      if (job && text.indexOf(job) < 0) { continue; }\n",
            # 条目可能在列表的滚动区外，坐标会落到视口之外 → 可信点击就点空了。
            # 先滚进视野再取坐标（'instant' 是刻意的：站点若设了平滑滚动，会取到中间态）。
            "      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });\n",
            "      const r = node.getBoundingClientRect();\n",
            "      const usable = !!r && r.width > 0 && r.height > 0;\n",
            "      hits.push({\n",
            "        text: clean(node.innerText).slice(0, 60),\n",
            "        rect: usable\n",
            "          ? { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }\n",
            "          : null,\n",
            "      });\n",
            "    }\n",
            "  }\n",
            # 只有"唯一命中且坐标可用"才允许点。多条命中 = 无法确定是哪一个招聘方 → 交回 Python
            # 侧明确失败（诊断里列出候选），绝不在这里挑一个顺手的点下去。
            "  const only = hits.length === 1 && hits[0].rect ? hits[0] : null;\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    item_count: items.length,\n",
            "    matched: only !== null,\n",
            "    matched_text: only ? only.text : '',\n",
            "    rect: only ? only.rect : null,\n",
            "    match_count: hits.length,\n",
            "    matches: hits.slice(0, LIMIT),\n",
            "    samples: texts.slice(0, LIMIT),\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def match_texts(state: dict[str, Any]) -> list[str]:
    """取会话列表命中项的标题文本（``matches`` 里可能是对象也可能是裸字符串，两种都吃）。"""
    texts: list[str] = []
    for item in state.get("matches") or []:
        text = str(item.get("text") or "") if isinstance(item, dict) else str(item)
        if text:
            texts.append(text)
    return texts


class BossConversationMatchMixin:
    """把"选中本次投递的会话"这段逻辑拆出来（宿主是 ``BossChatImageMixin``）。"""

    # 宿主契约：由 ``BossAdapter.__init__`` 注入；``_probe_chat_shell`` 由 BossChatImageMixin
    # 提供。只写在 ``TYPE_CHECKING`` 里，运行期不能替宿主声明一份假实现。
    if TYPE_CHECKING:
        _ready_wait: ReadyWait

        def _probe_chat_shell(self, client: CdpClient) -> dict[str, Any]: ...

    @staticmethod
    def _blocker_of(state: dict[str, Any]) -> SiteFailure | None:
        """把"登录失效 / 验证码"两类阻断转成结构化失败（与投递主链路同一套分类）。"""
        kind = detect_blocker(state)
        return blocker_failure(kind, state) if kind is not None else None

    def _raise_if_blocked(self, state: dict[str, Any]) -> None:
        failure = self._blocker_of(state)
        if failure is not None:
            raise failure

    def _select_conversation(
        self, client: CdpClient, *, company: str, job_title: str = ""
    ) -> dict[str, Any]:
        """选中本次投递的招聘方（公司 + 岗位双键）；**不唯一就如实失败**（绝不盲点第一条）。

        R23：同一家公司常有多个 HR 在招不同岗位。旧实现在"第一个含公司名的条目"上 break，
        于是永远取 DOM 靠前那条，这就是"图发给了另一个人"的第一步。现在要求二级筛（公司名 +
        岗位名）之后**恰好剩 1 条**：0 条或多条都明确失败，诊断里列出候选，一次点击都不做。
        图片这一步失败只是少一张图（文本招呼语早已送达），比发给别人轻得多。
        """
        target = (company or "").strip()
        title_key = (job_title or "").strip()
        if not target:
            # 公司名是定位会话的**唯一**可靠依据。空串时既**不**退化成"按列表第一条"，也
            # **不**沿用"当前打开着的那个会话"：两条都可能把图片发给另一个招聘方，而消息
            # 不可撤回。宁可这一步失败（文本早已送达），也不赌一次。
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_missing_company(self._probe_chat_shell(client)),
            )

        state = self._wait_conversation(client, company=target, job_title=title_key)
        rect = state.get("rect")
        if not isinstance(rect, dict) or not rect:
            # 走到这里说明等待返回了"命中"却没有坐标（理论上不会）：仍按可诊断失败处理。
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_no_conversation(state, target, title_key),
            )
        trusted_click(client, float(rect["x"]), float(rect["y"]))
        logger.info(
            "已切到招聘方「%s」的会话（岗位键「%s」）：%s",
            target,
            title_key or "未提供",
            state.get("matched_text") or "",
        )
        return state

    def _wait_conversation(
        self, client: CdpClient, *, company: str, job_title: str = ""
    ) -> dict[str, Any]:
        """等会话列表里出现**唯一**一条「公司 + 岗位」都命中的条目（列表是异步渲染的）。

        判据是 ``matched``（= 恰好命中 1 条且坐标可用），不是"命中了就点"：多条命中要靠
        超时把最后一次观测到的候选交回给诊断，而不是随便挑一条。也因此"同公司两个 HR"这种
        歧义会等满一个等待窗口——刻意的，多等十几秒远轻于发错人。
        """

        def _probe() -> dict[str, Any]:
            try:
                value = _as_payload(client.evaluate(_user_list_script(company, job_title)))
            except CdpError as exc:
                logger.debug("探测会话列表失败：%s", exc)
                return {}
            return value if isinstance(value, dict) else {}

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_no_conversation(state, company, job_title),
            )

        return wait_for_page_state(
            _probe,
            is_ready=lambda state: bool(state.get("matched")),
            blocker=self._blocker_of,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    @staticmethod
    def _diagnose_no_conversation(state: dict[str, Any], company: str, job_title: str = "") -> str:
        """选会话失败的统一出口：**零命中 / 多条命中 / 命中但没坐标**三种说法，绝不混用。

        R23 的硬要求：多条命中必须把**全部候选标题**写进诊断（用户据此把岗位名写清楚），
        绝不退化成"点第一条"。零命中则列出会话列表样本，便于区分"公司名写错了"与"列表没刷新"。
        """
        url = state.get("url") or "未知"
        item_count = int(state.get("item_count", 0) or 0)
        match_count = int(state.get("match_count", 0) or 0)
        samples = [str(item) for item in (state.get("samples") or [])]
        if item_count <= 0:
            return (
                "聊天页的会话列表没有加载出来，无法定位本次投递的会话；"
                "这里不会盲点第一条（点错会话会把图片发给另一个招聘方，消息不可撤回）。"
                f"当前地址：{url}；会话条目数：0。"
                "文本招呼语已正常送达；请到浏览器里核对后反馈维护者。"
            )
        if match_count > 1:
            candidates = match_texts(state) or samples
            listing = "；".join(candidates) if candidates else "（读不到文本）"
            return (
                f"同公司下匹配到 {match_count} 个会话：{listing}；"
                f"公司「{company}」（岗位键「{job_title or '未提供'}」）没能唯一确定会话，"
                "图片没有发送——这里不会点第一条（点错会话会把图片发给另一个招聘方，"
                "消息不可撤回）。"
                f"当前地址：{url}；会话条目数：{item_count}。"
                "请在建批次 / 编辑队列时把岗位名写清楚后重试；文本招呼语已正常送达。"
            )
        if match_count == 1:
            # 唯一命中但拿不到坐标（节点被重渲染 / 尺寸为 0）：仍不点，交给用户核对。
            hits = match_texts(state)
            listing = "；".join(hits) if hits else "（读不到文本）"
            return (
                f"会话列表里命中了 1 条「{company}」/「{job_title or '未提供岗位名'}」的会话，"
                "但取不到它的坐标，图片没有发送（不点第二候选、也不沿用当前打开的会话）。"
                f"当前地址：{url}；会话条目数：{item_count}；命中文本：{listing}。"
                "文本招呼语已正常送达；请到浏览器里核对后反馈维护者。"
            )
        listing = "；".join(samples) if samples else "（读不到文本）"
        if job_title:
            expected = f"同时包含公司「{company}」与岗位「{job_title}」"
        else:
            expected = f"包含「{company}」"
        return (
            f"会话列表里没有找到{expected}的会话，图片没有发送；"
            "这里不会盲点第一条（点错会话会把图片发给另一个招聘方，消息不可撤回）。"
            f"当前地址：{url}；会话条目数：{item_count}；"
            f"列表前 {len(samples)} 条：{listing}。"
            "文本招呼语已正常送达；请到浏览器里核对后反馈维护者。"
        )

    @staticmethod
    def _diagnose_missing_company(state: dict[str, Any]) -> str:
        return (
            "条目缺少公司名，无法定位会话，图片没有发送。"
            "这里不会按会话列表的第一条、也不会沿用当前打开着的会话去猜"
            "（点错会话会把图片发给另一个招聘方，消息不可撤回）。"
            f"当前地址：{state.get('url') or '未知'}；会话条目数：{state.get('list_items', 0)}。"
            "文本招呼语已正常送达；请给队列条目补上公司名后重试，或手动打开该会话。"
        )


__all__ = ["BossConversationMatchMixin", "match_texts"]
