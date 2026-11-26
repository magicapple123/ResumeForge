# SPDX-License-Identifier: Apache-2.0
"""发图前/后的**会话归属校验**：确认右侧打开的就是本次投递的公司。

## 为什么必须有这一步（2026-11-24 真站事故，队列 #17 万事云）

真站跑完回报 ``image_status=sent``（"已随招呼语发出 1 张图片"），用户肉眼核对却发现：

- 万事云的会话里**没有**图；
- 图片出现在**另一个人（张岩）**的会话里，已被用户手动撤回。

根因不是选择器写错，而是"点会话条目**没有真正切换**"：左侧列表条目的点击在自动化下经常
不生效（真站实测条目**没有** active/selected 类名、没有 data-id，只能按文本找 + 可信点击），
而当时页面上**早开着另一个人的会话**——``.chat-input``、``.btn-sendimg`` 都在。上一版只检查
"输入框存在"就开始上传，于是图发给了不相关的人，而聊天消息**不可撤回**。

## 真站实测到的锚点（2026-11-24 21:29，万事云会话已打开）

- 右侧会话容器 ``.chat-conversation``，``innerText`` 形如
  ``杨女士 万事云 招聘人事 更多 PC 服务工具开发工程师 双休 六险一金 …``——**含公司名**，
  所以"公司名在标题文本里"可以断言"当前打开的就是目标会话"；
- 左侧列表条目**没有** active/selected 类名（实测为空），**不能**靠选中态判断；
- 左栏 ``.user-list-content`` 里的头像 ``img`` 会污染全文档的图片统计 → 气泡统计的扫描根
  必须限定在右侧会话容器里（见 :func:`chat_scope_js`）。

## R23（2026-11-26）：二级键 = 公司 + 岗位名

只按公司名核对是不够的：**同一家公司常有多个 HR 在招不同岗位**，右栏标题里"公司名在"证明
不了"打开的是这条投递对应的那个岗位的会话"。所以核对键是「公司名 + 岗位名」两个，标题里
**同时**包含两者才算通过（``job_title`` 为空时只校验公司名——历史队列条目可能没岗位名，
这是唯一允许放宽的情形）。

三处判定必须同步：选会话（``boss_conversation_match._user_list_script``）、发图前核对
（:func:`verify_conversation`）、发图后核对（:func:`confirm_conversation_after_send`）。
只改其中一处等于"点对了、核对又放行别人"，仍然会把图发给另一个人。

## 三条取舍

1. **核对不过就一次都不上传**。误发的消息不可撤回；"少发一张图"远轻于"发给别人"——文本
   招呼语早已送达，图片这一步失败只是少一张图，而且诊断里写清了原因。
2. **校正动作是"再点一次会话条目"，不是"再上传一次"**。点击不生效既是本次事故的根因，
   就校正点击；最多核对 2 次，仍不匹配就如实失败，并把**实际标题**写进诊断（可核对）。
3. **拿不到右栏就判失败，绝不退回全文档统计**。右栏找不到时气泡数记 0（失败可重试、可诊断），
   绝不退回 ``document``/``body``——那正是这次"误报已发出"的形状。
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from typing import Any

from ...models.apply import FAILURE_FILE_UPLOAD_FAILED
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.page_ready import ReadyWait, wait_for_page_state
from .base import SiteFailure
from .boss_page import _as_payload, _blocker_js, _js, blocker_failure, detect_blocker

logger = logging.getLogger(__name__)

# 右侧会话容器：真站实测它的 innerText 里带着"招聘方 + 公司名 + 岗位"，可用来判断归属。
SELECTOR_CHAT_CONVERSATION = ".chat-conversation"
# 左侧会话列表（条目与头像都在这一支下面）：气泡统计显式把它整支排除在外。
SELECTOR_CHAT_USER_SCOPE = ".user-list-content, .user-list"
# 诊断里摘多少字标题（够核对，不把整段会话摘要抄进记录）；写进结果的标题只留 40 字。
TITLE_SAMPLE_CHARS = 60
TITLE_KEEP_CHARS = 40
# 归属最多核对两次：第一次用刚才点完的页面，第二次在"再点一次会话条目"之后。
_TITLE_CHECK_ATTEMPTS = 2
# 单次核对最多等多久（秒）：见 _confirm_wait 的说明。
_TITLE_CONFIRM_TIMEOUT_SECONDS = 5.0
_WHITESPACE = re.compile(r"\s+")


def squash(text: str) -> str:
    """压掉所有空白并转小写：比较"公司名在不在标题里"用（真站标题里是全角空格）。"""
    return _WHITESPACE.sub("", text or "").lower()


def clip(text: str, limit: int) -> str:
    """把多行标题压成一行并截断到 ``limit`` 字（诊断用 60，落库用 40）。"""
    return _WHITESPACE.sub(" ", text or "").strip()[:limit]


def match_keys(company: str, job_title: str) -> list[str]:
    """本次定位会话要**同时**命中的键（压掉空白并转小写）；空键不算键。

    岗位名是 R23 加的二级键：同一家公司常有多个 HR 在招不同岗位，只按公司名匹配会把图片发给
    另一个人（消息不可撤回）。岗位名为空时只保留公司名——这是**唯一**允许放宽的情形。
    """
    return [key for key in (squash(company), squash(job_title)) if key]


def describe_target(company: str, job_title: str) -> str:
    """把两个键写成诊断里的一小段人话：``公司「X」+ 岗位「Y」`` / ``公司「X」``。"""
    company_name = (company or "").strip()
    title = (job_title or "").strip()
    if title:
        return f"公司「{company_name}」+ 岗位「{title}」"
    return f"公司「{company_name}」"


def conversation_script() -> str:
    """读右侧会话容器的文本：公司名就在里面，用来判断"当前打开的是谁的会话"。"""
    return "".join(
        [
            "(() => { /* rf:chat-conversation */\n",
            _blocker_js(),
            f"  const CONVERSATION = {_js(SELECTOR_CHAT_CONVERSATION)};\n",
            "  const flatten = (text) => (text || '').replace(/\\s+/g, ' ').trim();\n",
            "  let found = false;\n",
            "  let conversationTitle = '';\n",
            # 取**最后一个可见**节点：重渲染瞬间可能同时存在两个同 class 的容器，前一个已脱离
            # 文档流（getClientRects 为空），后一个才是当前会话——取错就把旧会话当成当前会话。
            "  for (const node of document.querySelectorAll(CONVERSATION)) {\n",
            "    if (!node || !node.getClientRects().length) { continue; }\n",
            "    found = true;\n",
            "    conversationTitle = flatten(node.innerText);\n",
            "  }\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    conversation_found: found,\n",
            "    conversation_title: conversationTitle,\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def chat_scope_js() -> str:
    """在页面脚本里定义 ``chatScope()`` / ``outsideChatList()``：气泡统计的扫描根。

    **扫描根只能是右侧会话容器，绝不能是 ``document``/``body``。** 左栏
    ``.user-list-content`` 里每个会话条目都带头像 ``img``，全文档统计会把头像算成"图片
    气泡"——只要列表在发图前后重渲染一次（发消息会让列表重排、头像懒加载），计数就会从
    3 变成 6，被误判成"图片发出去了"。真站实测 ``.chat-conversation`` 的文本里含公司名，
    说明它至少覆盖标题区；消息区可能在它的父级，所以取父级，并显式排除左栏任何位置的 img。
    """
    return "".join(
        [
            f"  const CONVERSATION = {_js(SELECTOR_CHAT_CONVERSATION)};\n",
            f"  const USER_SCOPE = {_js(SELECTOR_CHAT_USER_SCOPE)};\n",
            "  const chatScope = () => {\n",
            "    const node = document.querySelector(CONVERSATION);\n",
            "    if (!node) return null;\n",
            "    return node.parentElement || node;\n",
            "  };\n",
            "  const outsideChatList = (node) => {\n",
            "    for (const part of USER_SCOPE.split(',')) {\n",
            "      const sel = part.trim();\n",
            "      if (sel && node.closest && node.closest(sel)) return false;\n",
            "    }\n",
            "    return true;\n",
            "  };\n",
        ]
    )


def _blocker_of(state: dict[str, Any]) -> SiteFailure | None:
    """登录失效 / 验证码 → 立刻失败（与投递主链路同一套分类）。"""
    kind = detect_blocker(state)
    return blocker_failure(kind, state) if kind is not None else None


def probe_conversation(client: CdpClient) -> dict[str, Any]:
    """探一次右栏会话（不等待）：脚本抛错（上下文被销毁）就当"没读到"。"""
    try:
        value = _as_payload(client.evaluate(conversation_script()))
    except CdpError as exc:
        logger.debug("读取会话标题失败：%s", exc)
        return {}
    return value if isinstance(value, dict) else {}


class _TitleNotMatched(Exception):
    """内部信号：等"标题命中目标公司"的预算用完了。

    它不是对外失败——调用方还要决定"再点一次"还是如实报错，所以把最后一次观测到的状态
    一起带出来（诊断文案要用实际标题，不能只说"没匹配上"）。
    """

    def __init__(self, state: dict[str, Any]) -> None:
        super().__init__("conversation title did not match")
        self.state = state


def _confirm_wait(ready_wait: ReadyWait) -> ReadyWait:
    """核对用的等待窗口：比默认的页面就绪预算更紧。

    右栏换内容确实是异步的，但"点完条目到标题变成目标公司"通常只需几百毫秒；核对失败的前置
    代价是"再点一次 + 再等一轮"，用满 15 秒的默认预算会让一次失败拖到 30 秒。5 秒足够覆盖弱网
    下的重渲染，又不至于把整批投递拖慢。
    """
    return ReadyWait(
        timeout=min(ready_wait.timeout, _TITLE_CONFIRM_TIMEOUT_SECONDS),
        poll_interval=ready_wait.poll_interval,
    )


def await_conversation_match(
    client: CdpClient, *, company: str, job_title: str = "", ready_wait: ReadyWait
) -> tuple[str | None, dict[str, Any]]:
    """等右栏标题里**同时**出现公司名与岗位名；返回 ``(命中的标题 或 None, 最后一次观测到的状态)``。

    **必须"等"而不是"读一次"**：点完条目后右栏是异步换内容的，立刻读到的往往是**上一个会话**
    残留的标题——那会把"其实已经切过去了"误判成"还是别人的会话"，白丢一张图。

    判据是"标题同时包含两个键"（R23）：只看到公司名时可能是同公司的另一位 HR 的会话，
    放行就等于把图发给另一个人。``job_title`` 为空时只校验公司名（唯一的放宽情形）。
    """
    keys = match_keys(company, job_title)

    def _probe() -> dict[str, Any]:
        return probe_conversation(client)

    def _ready(state: dict[str, Any]) -> bool:
        title = squash(str(state.get("conversation_title") or ""))
        return bool(keys) and all(key in title for key in keys)

    def _timeout(state: dict[str, Any]) -> Exception:
        return _TitleNotMatched(state)

    try:
        state = wait_for_page_state(
            _probe,
            is_ready=_ready,
            blocker=_blocker_of,
            on_timeout=_timeout,
            config=_confirm_wait(ready_wait),
        )
    except _TitleNotMatched as exc:
        return None, exc.state
    return str(state.get("conversation_title") or ""), state


def verify_conversation(
    client: CdpClient,
    *,
    company: str,
    job_title: str = "",
    ready_wait: ReadyWait,
    on_mismatch: Callable[[], None] | None = None,
) -> str:
    """核对"当前打开的会话"就是本次投递（公司 + 岗位）的会话；返回实际标题（截到 40 字）。

    不匹配时的校正动作是 ``on_mismatch``（由调用方**再点一次会话条目**）——点击在自动化下
    不生效是这次事故的根因。最多核对 ``_TITLE_CHECK_ATTEMPTS`` 次，仍不匹配就抛
    :class:`SiteFailure`：调用方拿到的是一次**明确的**失败，一张图都不会上传。

    Args:
        client: CDP 客户端。
        company: 本次投递的公司名（队列条目里的 ``ApplyTaskItem.company``），包含匹配。
        job_title: 本次投递的岗位名（``ApplyTaskItem.job_title``），包含匹配；**空串时只校验
            公司名**——同一家公司多个 HR 的场景下，岗位名才是把会话唯一确定下来的那把键。
        ready_wait: 等待参数（标题是异步渲染的）。
        on_mismatch: 标题不匹配时的校正回调；``None`` 表示不做校正、直接失败。

    Returns:
        实际会话标题（已压成一行并截断）。

    Raises:
        SiteFailure: 读不到标题、或公司名 / 岗位名没有同时出现在标题里。
    """
    attempts = _TITLE_CHECK_ATTEMPTS if on_mismatch is not None else 1
    state: dict[str, Any] = {}
    for attempt in range(attempts):
        matched, state = await_conversation_match(
            client, company=company, job_title=job_title, ready_wait=ready_wait
        )
        if matched is not None:
            return clip(matched, TITLE_KEEP_CHARS)
        logger.info(
            "会话归属核对未通过（第 %s 次）：期望包含%s，实际标题：%s",
            attempt + 1,
            describe_target(company, job_title),
            clip(str(state.get("conversation_title") or ""), TITLE_SAMPLE_CHARS) or "（读不到）",
        )
        if on_mismatch is not None and attempt + 1 < attempts:
            on_mismatch()
    raise SiteFailure(
        FAILURE_FILE_UPLOAD_FAILED, diagnose_no_target_conversation(state, company, job_title)
    )


def confirm_conversation_after_send(
    client: CdpClient, *, company: str, job_title: str = "", fallback: str
) -> str:
    """上传后再核对一次归属；返回"到底发给了谁"的标题（给结果文案用）。

    **这一次刻意不等待**：图已经交给页面了，再挂 15 秒没意义。判据分两种：

    - 读到了标题且**同时**含公司名与岗位名 → 返回该标题；
    - 读到了标题但键不全 → 说明发图途中会话被切走了（或本来就是同公司另一位 HR 的会话），
      图片可能落在了别人的会话里（不可撤回，必须让用户去核对/撤回），如实抛失败，**绝不**
      把它记成"已发出"；
    - 读不到标题（容器消失 / 上下文刚销毁）→ 退回上传前已核对通过的标题：那一步已经证明
      过归属，这里没有新证据时不该凭猜测推翻它。
    """
    state = probe_conversation(client)
    title = str(state.get("conversation_title") or "")
    if not title:
        return clip(fallback, TITLE_KEEP_CHARS)
    keys = match_keys(company, job_title)
    squashed = squash(title)
    if keys and all(key in squashed for key in keys):
        return clip(title, TITLE_KEEP_CHARS)
    raise SiteFailure(
        FAILURE_FILE_UPLOAD_FAILED, diagnose_moved_after_send(title, company, job_title)
    )


# ===== 诊断文案 =====


def diagnose_no_target_conversation(
    state: dict[str, Any], company: str, job_title: str = ""
) -> str:
    """核对失败的统一出口：按"右栏有没有渲染出来"给两种说法，绝不混用。

    - 右栏压根没渲染（``conversation_found`` 为假）→ 「读不到标题」；
    - 右栏有标题但不是目标会话 → 「当前打开的会话不是目标…」+ 实际标题。
    """
    if not state.get("conversation_found"):
        return diagnose_unreadable_title(state)
    return diagnose_wrong_conversation(
        str(state.get("conversation_title") or ""), company, job_title
    )


def diagnose_wrong_conversation(title: str, company: str, job_title: str = "") -> str:
    """会话归属不匹配：写清"期望包含什么 / 实际标题是什么"，并说明一次都没发。"""
    actual = clip(title, TITLE_SAMPLE_CHARS) or "（读不到文本）"
    if (job_title or "").strip():
        # R23：同公司多 HR —— 这时必须把「岗位」也写进期望，否则用户会以为公司名对就够了。
        return (
            f"当前打开的会话不是目标会话（期望标题里同时包含"
            f"{describe_target(company, job_title)}，实际标题：{actual}），图片没有发送；"
            "不会在别的会话里发图（消息不可撤回）。"
            "文本招呼语已正常送达；请到浏览器里打开该公司 + 该岗位的会话后重试。"
        )
    return (
        f"当前打开的会话不是目标公司（期望包含「{company}」，"
        f"实际标题：{actual}），图片没有发送；"
        "不会在别的会话里发图（消息不可撤回）。"
        "文本招呼语已正常送达；请到浏览器里打开该公司的会话后重试。"
    )


def diagnose_unreadable_title(state: dict[str, Any]) -> str:
    """读不到右栏标题：无法证明归属就不发图（不能靠"输入框在"猜）。"""
    return (
        "读不到当前会话的标题，无法确认打开的是不是本次投递的会话，图片没有发送"
        "（不靠「输入框存在」猜会话：发错人不可撤回）。"
        f"当前地址：{state.get('url') or '未知'}；页面标题：{state.get('title') or '未知'}；"
        f"会话容器（{SELECTOR_CHAT_CONVERSATION}）：{state.get('conversation_found', False)}。"
        "文本招呼语已正常送达；请到浏览器里核对后反馈维护者。"
    )


def diagnose_moved_after_send(title: str, company: str, job_title: str = "") -> str:
    """发出后发现会话变了：图片可能落在别人的会话里，提示去核对/撤回。"""
    actual = clip(title, TITLE_SAMPLE_CHARS) or "（读不到文本）"
    if (job_title or "").strip():
        # 有岗位名时"公司名对、岗位不对"同样是发错了人，所以说法统一用「目标会话」。
        wording = f"当前打开的会话不是目标会话（期望标题里同时包含{describe_target(company, job_title)}"
    else:
        wording = f"当前打开的会话不是目标公司（期望包含「{company}」"
    return (
        f"图片已交给页面，但{wording}，实际标题：{actual}）——"
        "图片可能发到了别的会话里（聊天消息不可撤回），请到浏览器里核对并手动撤回；"
        "本工具不会再往该会话发任何内容。"
    )


__all__ = [
    "SELECTOR_CHAT_CONVERSATION",
    "SELECTOR_CHAT_USER_SCOPE",
    "TITLE_KEEP_CHARS",
    "TITLE_SAMPLE_CHARS",
    "await_conversation_match",
    "chat_scope_js",
    "clip",
    "confirm_conversation_after_send",
    "conversation_script",
    "diagnose_moved_after_send",
    "diagnose_no_target_conversation",
    "diagnose_unreadable_title",
    "diagnose_wrong_conversation",
    "describe_target",
    "match_keys",
    "probe_conversation",
    "squash",
    "verify_conversation",
]
