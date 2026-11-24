# SPDX-License-Identifier: Apache-2.0
"""招呼语配图第一段：**回到聊天页，并选中本次投递的招聘方会话**。

## 为什么需要这一段（2026-11-24 真站实测，队列 #18 中科曙光）

真实投递里文本招呼语送达成功，图片那一步失败，站点给的诊断原文是：

    页面里没有 input[type=file]，「发送图片」按钮也没能带出它。
    当前地址：https://www.zhipin.com/job_detail/57df41aff453cc9c0nFz3Nu4GVFT.html；
    匹配到的 input 数：0；「发送图片」入口按钮数：False

原因不是选择器写错，而是**流程缺一步**：BOSS 在这个岗位上走的是"详情页弹出打招呼弹层"
形态，招呼语发出去之后弹层就**关闭**了，页面停在岗位详情页——那里从来没有上传控件。
所以发图前必须先回到 ``/web/geek/chat``，再选中**本次投递的招聘方**那条会话。

## 真站实测到的结构（不要凭 class 名猜）

- 输入框 ``DIV.chat-input``（``contenteditable=true``，**不是** textarea）；
  容器链 ``DIV.chat-input`` < ``DIV.editor-container`` < ``DIV.chat-im.chat-editor``
  < ``DIV.message-controls``；
- 发图控件 ``<input type="file" accept="image/gif,image/jpeg,image/jpg">``，父节点 class
  含 ``btn-sendimg``；页面上另有两个 ``input[type=file]`` 属于**简历附件上传**
  （``ka="user-resume-upload-file"``、父节点 ``.btn-file``）——宽泛选择器会误命中它们；
- 会话列表 ``.chat-content > .user-list > .user-list-content > 条目``，条目**没有** a/href、
  没有 data-id，只能按文本找；顶部 ``UL.label-list`` 是筛选（全部/未读/新招呼/仅沟通/更多），
  **不要点**（它不在 ``.user-list-content`` 下，所以"取列表容器的直接子节点"天然排除它）。

## 四条刻意的取舍

1. **不提供"点第一条"的兜底**。点错会话会把图片发给另一个招聘方，消息不可撤回；匹配不到
   就如实失败，并把列表里前 5 条的文本写进诊断——这是可诊断的失败，不是模糊失败。
2. **公司名为空就失败，不沿用"当前打开着的会话"**。历史队列条目可能没有公司名；那种情况下
   无法判断当前会话是不是本次投递的那个，猜错同样是不可撤回的。失败文案写明「条目缺少
   公司名，无法定位会话」。
3. **选会话走可信点击**（``Input.dispatchMouseEvent``）。``element.click()`` 发的是
   ``isTrusted=false`` 的合成事件，现版 BOSS 对这种事件不响应（见 ``boss_apply.py`` 开头的
   第 1 条实测结论）。
4. **点完必须核对"打开的是谁的会话"**（2026-11-24 事故：队列 #17 万事云回报"已发出 1 张"，
   实际图发到了另一个人的会话里）。真站上点击经常不生效而页面上早开着别人的会话，
   ``.chat-input`` / ``.btn-sendimg`` 都在——所以点完要读右侧 ``.chat-conversation`` 的标题
   比对公司名，核对不过就再点一次，仍不过就**一次都不上传**。判定逻辑在
   ``boss_chat_guard.py``。

为什么单独成模块：``boss_apply_image.py`` 已贴着 500 行预算，而"进会话 + 选会话"两段的
脚本与诊断文案都不小；对外入口仍然是 ``adapter.upload_greeting_images(...)``。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ...models.apply import FAILURE_FILE_UPLOAD_FAILED
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.interaction import trusted_click
from ..browser.page_ready import wait_for_page_state
from .base import SiteFailure
from .boss_chat_guard import verify_conversation
from .boss_page import (
    CHAT_PAGE_URL,
    SELECTOR_CHAT_IMAGE_BUTTON,
    SELECTOR_CHAT_IMAGE_INPUT,
    SELECTOR_CHAT_INPUT_BOX,
    SELECTOR_CHAT_SHELL,
    SELECTOR_CHAT_USER_LIST,
    SELECTOR_FILE_INPUT,
    _as_payload,
    _blocker_js,
    _js,
    blocker_failure,
    detect_blocker,
)

logger = logging.getLogger(__name__)

# 诊断里附几条会话文本：够定位"到底在哪个列表里找过"，又不至于把整个会话列表抄进记录。
_SAMPLE_SIZE = 5


if TYPE_CHECKING:
    from ..browser.page_ready import ReadyWait


def _chat_shell_script() -> str:
    """聊天页状态探针：是否已在聊天页、会话列表条目数、输入框与发图控件是否就绪。

    一次脚本拿全，是为了让"判断在哪一页"与"判断控件是否就绪"共用同一份证据——
    真站上这些区域是异步渲染的，多一次往返就多一次踩到"节点刚被重渲染"的机会。
    """
    return "".join(
        [
            "(() => { /* rf:chat-shell */\n",
            _blocker_js(),
            f"  const SHELL = {_js(SELECTOR_CHAT_SHELL)};\n",
            f"  const INPUT = {_js(SELECTOR_CHAT_INPUT_BOX)};\n",
            f"  const IMAGE_INPUT = {_js(SELECTOR_CHAT_IMAGE_INPUT)};\n",
            f"  const CHAT_BUTTON = {_js(SELECTOR_CHAT_IMAGE_BUTTON)};\n",
            f"  const ANY_INPUT = {_js(SELECTOR_FILE_INPUT)};\n",
            f"  const LIST = {_js(SELECTOR_CHAT_USER_LIST)};\n",
            "  const all = (sel) => [...document.querySelectorAll(sel)];\n",
            "  const present = (sel) => all(sel).length > 0;\n",
            "  const visible = (sel) => all(sel).some((node) => !!(node && node.getClientRects().length));\n",
            # 会话条目数只数列表容器的**直接子节点**（与选会话的脚本同一口径）。
            "  let listItems = 0;\n",
            "  for (const box of all(LIST)) { listItems = Math.max(listItems, box.children.length); }\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    on_chat: location.pathname.indexOf('/web/geek/chat') === 0,\n",
            "    shell_found: present(SHELL),\n",
            "    chat_input_found: visible(INPUT),\n",
            # 文件 input 是**隐藏**的（display:none 或尺寸为 0），只能按"存在"计数：
            # 按可见性判会永远 false，选择器对了也白判。
            "    image_input_found: present(IMAGE_INPUT),\n",
            "    chat_image_button_found: visible(CHAT_BUTTON),\n",
            "    file_input_count: all(ANY_INPUT).length,\n",
            "    list_items: listItems,\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def _user_list_script(company: str) -> str:
    """在会话列表里按公司名做**包含匹配**，返回命中的条目坐标与列表样本。

    匹配在页面里做（一次往返拿到"命中与否 + 坐标 + 样本"），而不是把整个列表拉回来再比对：
    坐标必须来自**同一份**渲染结果，否则"取文本"与"取坐标"之间列表一重排就点错位置。

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
            f"  const LIMIT = {_SAMPLE_SIZE};\n",
            "  const SKIP = /label-list/;\n",
            "  const norm = (text) => (text || '').replace(/\\s+/g, '').toLowerCase();\n",
            "  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();\n",
            "  const target = norm(COMPANY);\n",
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
            "  let rect = null;\n",
            "  let matchedText = '';\n",
            "  if (target) {\n",
            "    for (const node of items) {\n",
            "      if (norm(node.innerText).indexOf(target) < 0) { continue; }\n",
            # 条目可能在列表的滚动区外，坐标会落到视口之外 → 可信点击就点空了。
            # 先滚进视野再取坐标（'instant' 是刻意的：站点若设了平滑滚动，会取到中间态）。
            "      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });\n",
            "      const r = node.getBoundingClientRect();\n",
            "      if (!r || r.width <= 0 || r.height <= 0) { continue; }\n",
            "      rect = { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };\n",
            "      matchedText = clean(node.innerText).slice(0, 60);\n",
            "      break;\n",
            "    }\n",
            "  }\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    item_count: items.length,\n",
            "    matched: rect !== null,\n",
            "    matched_text: matchedText,\n",
            "    rect: rect,\n",
            "    samples: texts.slice(0, LIMIT),\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def _blocker_of(state: dict[str, Any]) -> SiteFailure | None:
    """把"登录失效 / 验证码"两类阻断转成结构化失败（与投递主链路同一套分类）。"""
    kind = detect_blocker(state)
    return blocker_failure(kind, state) if kind is not None else None


def _raise_if_blocked(state: dict[str, Any]) -> None:
    failure = _blocker_of(state)
    if failure is not None:
        raise failure


class BossChatImageMixin:
    """把浏览器带到"本次投递的会话里、且发图控件可用"的状态。"""

    # 宿主契约：由 ``BossAdapter.__init__`` 注入（见 boss.py）。只写在 ``TYPE_CHECKING`` 里，
    # 运行期不能替宿主声明一份假实现。
    if TYPE_CHECKING:
        _ready_wait: ReadyWait

    # ===== 对外（给 boss_apply_image 用）=====

    def _ensure_chat_conversation(self, client: CdpClient, *, company: str) -> dict[str, Any]:
        """确保停在**本次投递的**会话里；返回最后一次页面状态（供诊断使用）。

        ``company`` 取自队列条目（``ApplyTaskItem.company``），招聘方名通常形如
        「罗先生中科曙光HRBP」，所以用**包含匹配**而不是等值匹配。

        返回的 dict 里额外带 ``conversation_title``：那是**核对通过**的会话标题，发图成功后
        要写进结果（"发给了谁"）。真站出过"回报已发出、实际发到别人会话"的事故，只写
        "已发出 N 张"无法事后核对。
        """
        state = self._probe_chat_shell(client)
        if not state:
            # 页面可能正在重渲染 / 执行上下文刚销毁：再探一次，仍拿不到才按"不在聊天页"处理。
            state = self._probe_chat_shell(client)
        if not state.get("on_chat"):
            logger.info(
                "发图前不在聊天页（当前地址 %s），先导航到 %s",
                state.get("url") or "未知",
                CHAT_PAGE_URL,
            )
            client.navigate(CHAT_PAGE_URL)
            state = self._wait_chat_shell(client)
        _raise_if_blocked(state)
        self._select_conversation(client, company=company)
        state = self._wait_chat_editor(client)
        # 真站实测（2026-11-24 21:29，队列 #17 万事云）：点会话条目在自动化下**经常不生效**，
        # 而页面上早开着另一个人的会话（``.chat-input`` / ``.btn-sendimg`` 都在）。所以
        # "输入框在"根本不证明"会话对"——必须读右侧 ``.chat-conversation`` 的标题核对公司名；
        # 核对不过就再点一次，仍不过就**一次都不上传**（事故记录见 boss_chat_guard.py）。
        title = verify_conversation(
            client,
            company=company,
            ready_wait=self._ready_wait,
            on_mismatch=lambda: self._reselect_conversation(client, company=company),
        )
        return {**state, "conversation_title": title}

    def _reselect_conversation(self, client: CdpClient, *, company: str) -> None:
        """归属核对不过时的校正：**再点一次**会话条目，并等编辑器重新可用。

        校正的是"点击"而不是"上传"：点击不生效正是这次事故的根因。重走
        :meth:`_select_conversation`（重新取坐标，仍走可信点击），因此列表在这期间重排也
        不会点到错位置。
        """
        self._select_conversation(client, company=company)
        self._wait_chat_editor(client)

    # ===== 内部步骤 =====

    def _probe_chat_shell(self, client: CdpClient) -> dict[str, Any]:
        try:
            value = _as_payload(client.evaluate(_chat_shell_script()))
        except CdpError as exc:
            # 导航瞬间的 evaluate 可能撞上"执行上下文已销毁"：按"还没就绪"处理。
            logger.debug("探测聊天页状态失败：%s", exc)
            return {}
        return value if isinstance(value, dict) else {}

    def _wait_chat_shell(self, client: CdpClient) -> dict[str, Any]:
        """导航到聊天页后等它可用（地址已切到聊天页，且列表或输入框至少有一个出现）。

        判据里**不**要求发图控件已就绪：控件在选中会话之后才会渲染出来。
        """

        def _probe() -> dict[str, Any]:
            return self._probe_chat_shell(client)

        def _ready(state: dict[str, Any]) -> bool:
            if not state.get("on_chat"):
                return False
            return int(state.get("list_items", 0) or 0) > 0 or bool(state.get("chat_input_found"))

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(FAILURE_FILE_UPLOAD_FAILED, self._diagnose_no_chat_page(state))

        return wait_for_page_state(
            _probe,
            is_ready=_ready,
            blocker=_blocker_of,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    def _select_conversation(self, client: CdpClient, *, company: str) -> dict[str, Any]:
        """在会话列表里选中本次投递的招聘方；匹配不到就如实失败（绝不盲点第一条）。"""
        target = (company or "").strip()
        if not target:
            # 公司名是定位会话的**唯一**可靠依据。空串时既**不**退化成"按列表第一条"，也
            # **不**沿用"当前打开着的那个会话"：两条都可能把图片发给另一个招聘方，而消息
            # 不可撤回。宁可这一步失败（文本早已送达），也不赌一次。
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_missing_company(self._probe_chat_shell(client)),
            )

        state = self._wait_conversation(client, company=target)
        rect = state.get("rect")
        if not isinstance(rect, dict) or not rect:
            # 走到这里说明等待返回了"命中"却没有坐标（理论上不会）：仍按可诊断失败处理。
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED, self._diagnose_no_conversation(state, target)
            )
        trusted_click(client, float(rect["x"]), float(rect["y"]))
        logger.info("已切到招聘方「%s」的会话：%s", target, state.get("matched_text") or "")
        return state

    def _wait_conversation(self, client: CdpClient, *, company: str) -> dict[str, Any]:
        """等会话列表里出现包含 ``company`` 的条目（列表是异步渲染的，不能只探一次）。"""

        def _probe() -> dict[str, Any]:
            try:
                value = _as_payload(client.evaluate(_user_list_script(company)))
            except CdpError as exc:
                logger.debug("探测会话列表失败：%s", exc)
                return {}
            return value if isinstance(value, dict) else {}

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED, self._diagnose_no_conversation(state, company)
            )

        return wait_for_page_state(
            _probe,
            is_ready=lambda state: bool(state.get("matched")),
            blocker=_blocker_of,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    def _wait_chat_editor(self, client: CdpClient) -> dict[str, Any]:
        """等聊天输入框可用：选中会话之后编辑器才会渲染出来，发图控件与它在同一片区域。"""

        def _probe() -> dict[str, Any]:
            return self._probe_chat_shell(client)

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(FAILURE_FILE_UPLOAD_FAILED, self._diagnose_no_editor(state))

        return wait_for_page_state(
            _probe,
            is_ready=lambda state: bool(state.get("chat_input_found")),
            blocker=_blocker_of,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    # ===== 诊断文案 =====

    @staticmethod
    def _diagnose_no_chat_page(state: dict[str, Any]) -> str:
        return (
            "没能打开 BOSS 聊天页，图片没有发送。"
            f"已导航到 {CHAT_PAGE_URL}，但页面里既没有会话列表也没有聊天输入框。"
            f"当前地址：{state.get('url') or '未知'}；页面标题：{state.get('title') or '未知'}；"
            f"会话条目数：{state.get('list_items', 0)}；"
            f"聊天输入框：{state.get('chat_input_found', False)}。"
            "文本招呼语已正常送达；请把这段信息反馈给维护者。"
        )

    @staticmethod
    def _diagnose_no_editor(state: dict[str, Any]) -> str:
        return (
            "已切到目标会话，但聊天输入框没有出现，图片没有发送。"
            f"当前地址：{state.get('url') or '未知'}；"
            f"会话条目数：{state.get('list_items', 0)}；"
            f"发图控件（{SELECTOR_CHAT_IMAGE_INPUT}）：{state.get('image_input_found', False)}；"
            f"页面里 input[type=file] 数：{state.get('file_input_count', 0)}。"
            "文本招呼语已正常送达；请把这段信息反馈给维护者。"
        )

    @staticmethod
    def _diagnose_no_conversation(state: dict[str, Any], company: str) -> str:
        samples = [str(item) for item in (state.get("samples") or [])]
        if int(state.get("item_count", 0) or 0) <= 0:
            return (
                "聊天页的会话列表没有加载出来，无法定位本次投递的会话；"
                "这里不会盲点第一条（点错会话会把图片发给另一个招聘方，消息不可撤回）。"
                f"当前地址：{state.get('url') or '未知'}；会话条目数：0。"
                "文本招呼语已正常送达；请到浏览器里核对后反馈维护者。"
            )
        listing = "；".join(samples) if samples else "（读不到文本）"
        return (
            f"会话列表里没有找到包含「{company}」的会话，图片没有发送；"
            "这里不会盲点第一条（点错会话会把图片发给另一个招聘方，消息不可撤回）。"
            f"当前地址：{state.get('url') or '未知'}；会话条目数：{state.get('item_count', 0)}；"
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


__all__ = ["BossChatImageMixin"]
