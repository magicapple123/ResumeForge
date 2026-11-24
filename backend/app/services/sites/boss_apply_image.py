# SPDX-License-Identifier: Apache-2.0
"""BOSS 聊天页补发图片：进会话 → 定位上传控件 → 把本地文件塞进去 → 等图片气泡出现。

**真站实测进度（2026-11-24，务必先读）**

第一次真站实跑（队列 #18 中科曙光）把两处推断一次性钉成了事实：

1. **"发完文字后还在聊天页"是错的。** 招呼语送达后打招呼弹层**关闭**，页面停在岗位详情页
   （``/job_detail/...html``），那里没有任何上传控件。原实现在详情页上找控件，必然失败
   （真站记录："匹配到的 input 数：0；「发送图片」入口按钮数：False"）。修复不是换选择器，
   而是**补一步流程**：先回 ``/web/geek/chat`` 并选中本次投递的招聘方会话
   （见 ``boss_chat_image.py``）。
2. **上传控件的真实 DOM。** 它是 ``<input type="file" accept="image/gif,image/jpeg,image/jpg">``，
   父节点 class 含 ``btn-sendimg``；页面上另有两个 ``input[type=file]`` 属于**简历附件上传**
   （``ka="user-resume-upload-file"``、父节点 ``.btn-file``）——所以这一支只用精确的
   ``.btn-sendimg input[type=file]``，绝不用宽泛的 ``input[type=file]``。

**2026-11-24 第二次真站验证（队列 #17 万事云）补了两处**：

3. **"发出去"的判据必须是右栏的图，而且必须核对发给了谁。** 那一次回报 ``image_status=sent``
   而用户肉眼确认图不在这家公司的会话里，出现在了**另一个人**的会话里（已手动撤回）。原因
   是点会话条目没真正切换、页面早开着别人的会话。于是：塞文件前读右侧 ``.chat-conversation``
   的标题核对公司名（不过就再点一次，仍不过就一张都不发），气泡统计的扫描根也从 ``document``
   收紧到右侧会话容器（见 ``boss_chat_guard.py``），发出后再核对一次归属。

**仍未实测的一项（不要当成已知事实）**：选完图后是否需要**预览态二次确认**、以及图片消息
气泡的真实 class。代码按"只在真的看到确认按钮时才点"、"两层气泡判据 + 尺寸过滤"写，
两处都在真机 smoke 时优先核对。**保留这份说明**：把未实测的推断写成"已知事实"是比慢一步
更贵的事故。

为什么单独成模块：``boss_apply.py`` 贴着 500 行预算，而"点哪个按钮、怎么塞文件、怎么确认
发出去了"这三件事的代码量与诊断文案都不小；本模块只做发图，由 :class:`BossApplyMixin`
继承进来（调用方仍然是 ``adapter.upload_greeting_images(...)``）。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from ...models.apply import FAILURE_FILE_UPLOAD_FAILED
from ..browser.cdp_client import CdpClient, CdpError
from ..browser.interaction import trusted_click
from ..browser.page_ready import wait_for_page_state
from .base import SiteFailure
from .boss_chat_guard import TITLE_KEEP_CHARS, chat_scope_js, confirm_conversation_after_send
from .boss_chat_image import BossChatImageMixin
from .boss_page import (
    SELECTOR_CHAT_IMAGE_BUTTON,
    SELECTOR_CHAT_IMAGE_INPUT,
    SELECTOR_CHAT_INPUT_BOX,
    SELECTOR_FILE_INPUT,
    SELECTOR_IMAGE_BUBBLE,
    SELECTOR_IMAGE_CONFIRM_BUTTON,
    _as_payload,
    _blocker_js,
    _js,
    blocker_failure,
    detect_blocker,
)

logger = logging.getLogger(__name__)

# 等"input 出现"与"图片气泡出现"的两次等待共用同一份就绪参数（见 boss.py 注入）。
_STRATEGY_DOM_INPUT = "dom_input"
_STRATEGY_INTERCEPTED_CLICK = "intercepted_click"

# 图片气泡的尺寸下限（CSS 像素）。**这是一个刻意保守的启发式**：真站没测到图片缩略图的
# 实际尺寸，而 ``SELECTOR_IMAGE_BUBBLE`` 的第二层（会话区里的 img）会连头像 / 图标 / 表情
# 一起命中。头像一般 32-40px、表情 16-24px，聊天图片远大于 56px，所以用它把噪声挡掉。
# 真机若发现图片气泡本身就小于这个值（极小图预览），把这里调小——否则会误报"没发出去"。
_MIN_BUBBLE_SIDE = 56

if TYPE_CHECKING:
    from ..browser.page_ready import ReadyWait


def _bubble_count_js() -> str:
    """统计"**右侧会话容器里**的大图"数量的 JS 片段（供两个脚本共用同一口径）。

    2026-11-24 的第二处修复：扫描根从 ``document`` 收紧到右侧会话容器。左栏
    ``.user-list`` 里每个会话条目都带头像 ``img``，全文档统计会把头像数成"图片气泡"——列表
    只要在发图前后重渲染一次（发消息会让列表重排、头像懒加载），计数就会凭空变大，被误判成
    "图片发出去了"。真站实测左栏条目没有 active/selected 类名，也没有 data-id，无从排除，
    只能从**扫描根**上切开。
    """
    return "".join(
        [
            f"  const BUBBLE = {_js(SELECTOR_IMAGE_BUBBLE)};\n",
            f"  const MIN_SIDE = {_MIN_BUBBLE_SIDE};\n",
            chat_scope_js(),
            "  const countBubbles = () => {\n",
            "    const root = chatScope();\n",
            # 右栏没渲染出来就记 0（判"没发出去"：可重试、可诊断），**绝不**退回 document。
            "    if (!root) return 0;\n",
            "    return [...root.querySelectorAll(BUBBLE)].filter((node) => {\n",
            "      if (!node || !outsideChatList(node)) return false;\n",
            "      const r = node.getBoundingClientRect();\n",
            "      return !!r && r.width >= MIN_SIDE && r.height >= MIN_SIDE;\n",
            "    }).length;\n",
            "  };\n",
        ]
    )


def _image_probe_script() -> str:
    """探测图片上传的入口形态：发图 input、发送图片按钮坐标、确认按钮坐标、气泡数。

    一次脚本拿全部项，是为了让"看形态"与"点按钮"之间少一次往返——真站上这个工具栏
    是异步渲染的，多一次往返就多一次踩到"节点刚被重渲染"的机会。
    """
    return "".join(
        [
            "(() => { /* rf:image-probe */\n",
            _blocker_js(),
            _bubble_count_js(),
            f"  const IMAGE_INPUT = {_js(SELECTOR_CHAT_IMAGE_INPUT)};\n",
            f"  const CHAT_BUTTON = {_js(SELECTOR_CHAT_IMAGE_BUTTON)};\n",
            f"  const ANY_INPUT = {_js(SELECTOR_FILE_INPUT)};\n",
            f"  const CONFIRM = {_js(SELECTOR_IMAGE_CONFIRM_BUTTON)};\n",
            f"  const CHAT_INPUT = {_js(SELECTOR_CHAT_INPUT_BOX)};\n",
            "  const all = (sel) => [...document.querySelectorAll(sel)];\n",
            # 注意：**不能再声明一个 ``shown``**——``_blocker_js`` 里已经有同名 const，
            # 同一作用域重复声明 ``const`` 是 SyntaxError，整个脚本会直接抛错
            # （表现是"探测不到控件"，而不是明显的语法错误）。这条由单测逐脚本钉住。
            "  const visible = (sel) => all(sel).some((node) => !!(node && node.getClientRects().length));\n",
            "  const rectOf = (node) => {\n",
            "    if (!node || !node.getClientRects().length) return null;\n",
            "    const r = node.getBoundingClientRect();\n",
            "    if (!r || r.width <= 0 || r.height <= 0) return null;\n",
            "    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };\n",
            "  };\n",
            "  const imageInputs = all(IMAGE_INPUT);\n",
            # 文件 input 是隐藏的，只能按"存在"判；按可见性判会永远 false。
            "  let sendRect = null;\n",
            "  for (const node of all(CHAT_BUTTON)) { sendRect = rectOf(node); if (sendRect) break; }\n",
            "  let confirmRect = null;\n",
            "  for (const node of all(CONFIRM)) { confirmRect = rectOf(node); if (confirmRect) break; }\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    input_found: imageInputs.length > 0,\n",
            "    input_count: imageInputs.length,\n",
            # 宽口径计数只进诊断：真站上它还含简历附件上传，**不能**当就绪判据。
            "    file_input_count: all(ANY_INPUT).length,\n",
            "    send_found: sendRect !== null,\n",
            "    send_rect: sendRect,\n",
            "    confirm_rect: confirmRect,\n",
            "    chat_input_found: shown(CHAT_INPUT),\n",
            "    image_bubbles: countBubbles(),\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def _bubble_script() -> str:
    """只数图片气泡数量（等待循环用：短脚本、可反复调）。"""
    return "".join(
        [
            "(() => { /* rf:image-bubble */\n",
            _bubble_count_js(),
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    title: document.title || '',\n",
            "    image_bubbles: countBubbles(),\n",
            "  });\n",
            "})()",
        ]
    )


class BossGreetingImageMixin(BossChatImageMixin):
    """聊天页补发图片的最小实现：进会话 → 核对归属 → 塞文件 → （可选）确认 → 等气泡。"""

    # 最近一次**核对通过**的会话标题（"图片到底发给了谁"）。成功发图后由
    # :meth:`upload_greeting_images` 写入，供 ``task_apply`` 把"发给了谁"写进 ``image_detail``：
    # 2026-11-24 出过"回报已发出、实际发到别人会话"的事故，结果里只写"已发出 N 张"无法事后核对。
    greeting_image_target: str = ""

    if TYPE_CHECKING:
        # 宿主契约：由 ``BossApplyMixin`` / ``BossAdapter`` 提供（本模块只调用，不实现）。
        _ready_wait: ReadyWait

        def _wait_state(
            self, client: CdpClient, initial: dict[str, Any], script: str, **kwargs: Any
        ) -> dict[str, Any]: ...

    # ===== 对外入口 =====

    def upload_greeting_images(
        self, client: CdpClient, paths: Sequence[str], *, company: str = ""
    ) -> str:
        """把本地临时文件作为一条图片消息发到**本次投递的**会话；返回实际用到的策略名。

        ``company`` 取自队列条目（``ApplyTaskItem.company``），用来在聊天页的会话列表里定位
        招聘方（包含匹配）。**空串就直接失败**（``file_upload_failed`` + 「条目缺少公司名，
        无法定位会话」）：既不点列表第一条，也不沿用当前打开的会话——两者都可能把图片发给
        另一个招聘方，而消息不可撤回。

        失败一律抛 :class:`SiteFailure`（分类 ``file_upload_failed``）：调用方据此把这一支标成
        ``upload_failed``，但**不会**把投递判失败——文本早就送达了。
        """
        files = [str(path) for path in paths if str(path).strip()]
        if not files:
            raise SiteFailure(FAILURE_FILE_UPLOAD_FAILED, "没有可发送的图片文件")

        # 1) 先回到聊天页、选中本次投递的会话，并**核对归属**。真站实测（队列 #18）：招呼语
        #    送达后弹层关闭、页面停在岗位详情页，那里没有任何上传控件——这一步以前是缺的。
        #    队列 #17 又证明"点完不一定真的切过去了"：归属核对不过就抛失败，一张都不会上传。
        state = self._ensure_chat_conversation(client, company=company)
        target_title = str(state.get("conversation_title") or "")

        # 2) 探一次控件与气泡基线。基线必须在**切到目标会话之后**取：换会话会整片换掉消息
        #    列表，"上传前的图片数"在别的会话里量出来毫无意义。
        #    残留风险（写在这里以免被当成"已验证"）：若目标会话的历史消息在基线之后才异步
        #    渲染出来，气泡数会因为"旧图出现"而增加，被误判成发送成功。真机 smoke 时请留意。
        probe = self._probe_image_tools(client)
        blocker = detect_blocker(probe)
        if blocker is not None:
            raise blocker_failure(blocker, probe)

        strategy = _STRATEGY_DOM_INPUT
        if not probe.get("input_found"):
            # 真站实测里控件**本来就在** DOM 里；这条兜底只为上传形态再变时保留一次机会。
            strategy = self._open_file_chooser(client, probe)
            probe = self._probe_image_tools(client)
            if not probe.get("input_found"):
                raise SiteFailure(FAILURE_FILE_UPLOAD_FAILED, self._diagnose_missing_input(probe))

        baseline = int(probe.get("image_bubbles", 0) or 0)
        try:
            client.set_file_input(SELECTOR_CHAT_IMAGE_INPUT, files)
        except CdpError as exc:
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                f"把图片交给页面上传控件时失败：{exc}。若浏览器里弹出了系统文件选择器，"
                "请手动选一次，或把这条诊断反馈给维护者（真站上传形态可能与实现不同）。",
            ) from exc

        self._confirm_if_needed(client)
        self._wait_image_bubble(client, baseline=baseline)
        # 3) 发出后再核对一次归属：万一会话在发图途中被切走，宁可如实报"可能发错人"并要求
        #    用户去撤回，也绝不把"已发出"记在别人的会话上（队列 #17 就是这么被误记成 sent 的）。
        #    核对通过的标题写进 ``greeting_image_target``，最终落成「已向「某某」发出 N 张图片」。
        self.greeting_image_target = confirm_conversation_after_send(
            client, company=company, fallback=target_title
        )
        logger.info(
            "招呼语配图已发出，策略=%s，会话=「%s」",
            strategy,
            self.greeting_image_target[:TITLE_KEEP_CHARS],
        )
        return strategy

    # ===== 内部步骤 =====

    def _probe_image_tools(self, client: CdpClient) -> dict[str, Any]:
        try:
            value = _as_payload(client.evaluate(_image_probe_script()))
        except CdpError as exc:
            # 页面正在重渲染 / 执行上下文被销毁：按"还没就绪"处理，交给等待循环重试。
            logger.debug("探测图片上传入口失败：%s", exc)
            value = {}
        return value if isinstance(value, dict) else {}

    def _open_file_chooser(self, client: CdpClient, probe: dict[str, Any]) -> str:
        """点一次「发送图片」（``.btn-sendimg``），让页面把 file input 创建出来。

        真站实测里不需要这一步（``.btn-sendimg input[type=file]`` 一直在 DOM 里），所以它只是
        "形态又变了"时的最后一次机会。**只点精确的 ``.btn-sendimg``**，不再用宽口径选择器：
        同一排工具栏还有「发简历 / 换电话 / 换微信」，点错会把一次真实投递搞脏。

        先开 ``Page.setInterceptFileChooser``：它把"点击 → 系统文件选择器"拦成一个事件，
        页面不会弹原生对话框（原生对话框 CDP 关不掉，会一直挂在窗口前面）。个别内核不认这条
        命令（会抛 ``CdpError``），那种情况下仍然点——只是可能同时弹出选择器；诊断文案里会
        提一句"请手动选一次"，不假装我们知道点了以后一定发生什么。
        """
        intercepted = True
        try:
            client.send("Page.setInterceptFileChooser", {"enabled": True})
        except CdpError as exc:
            intercepted = False
            logger.info("当前内核不支持拦截文件选择器，将直接点击「发送图片」：%s", exc)

        rect = probe.get("send_rect")
        if not isinstance(rect, dict) or not rect:
            raise SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                self._diagnose_missing_input(probe),
            )
        trusted_click(client, float(rect["x"]), float(rect["y"]))

        # 点完之后 input 可能是**异步**挂上的；给它一个就绪等待窗口，而不是 sleep。
        try:
            self._wait_state(
                client,
                {},
                _image_probe_script(),
                ready=lambda state: bool(state.get("input_found")),
                expected="「发送图片」点击后出现的文件上传控件",
            )
        except SiteFailure as exc:
            # ``_wait_state`` 的超时分类是"选择器失效"；这一支的语义是**图片没发出去**，
            # 换个分类免得记录里出现与事实不符的原因。
            raise SiteFailure(FAILURE_FILE_UPLOAD_FAILED, exc.detail) from exc
        return _STRATEGY_DOM_INPUT if intercepted else _STRATEGY_INTERCEPTED_CLICK

    def _confirm_if_needed(self, client: CdpClient) -> None:
        """预览态二次确认：**只在真的看到确认按钮时才点**。

        是否需要这一步真站仍未实测（见模块开头）。所以这里既不假定它一定存在（找不到
        就什么都不做，直接等气泡），也不假定它不存在（出现了就点一次，否则图永远发不出去）。
        """
        probe = self._probe_image_tools(client)
        rect = probe.get("confirm_rect")
        if not isinstance(rect, dict) or not rect:
            return
        trusted_click(client, float(rect["x"]), float(rect["y"]))
        logger.info("图片预览态出现确认按钮，已点击一次")

    def _wait_image_bubble(self, client: CdpClient, *, baseline: int) -> None:
        """等**会话里**出现新的图片（数量超过上传前的基线）。

        判据是"图片出现"，不是"点击成功"：站点接受点击不代表消息进了会话，而"发送图片"
        失败时页面通常毫无反馈。
        """

        def _probe() -> dict[str, Any]:
            try:
                value = _as_payload(client.evaluate(_bubble_script()))
            except CdpError:
                return {}
            return value if isinstance(value, dict) else {}

        def _timeout(state: dict[str, Any]) -> SiteFailure:
            return SiteFailure(
                FAILURE_FILE_UPLOAD_FAILED,
                "已把图片交给页面，但没有看到图片消息出现在会话里。"
                f"当前地址：{state.get('url') or '未知'}；页面标题：{state.get('title') or '未知'}；"
                f"图片气泡数：{state.get('image_bubbles', 0)}（上传前 {baseline}）。"
                "请到浏览器里核对这条会话，并把这段诊断反馈给维护者。",
            )

        wait_for_page_state(
            _probe,
            is_ready=lambda state: int(state.get("image_bubbles", 0) or 0) > baseline,
            on_timeout=_timeout,
            config=self._ready_wait,
        )

    @staticmethod
    def _diagnose_missing_input(probe: dict[str, Any]) -> str:
        """找不到上传控件时的诊断：把人一眼能核对的项目写清楚。"""
        return (
            "聊天页上找不到图片上传控件（既没有 "
            f"{SELECTOR_CHAT_IMAGE_INPUT}，"
            "也没能靠点「发送图片」把控件带出来）。"
            f"当前地址：{probe.get('url') or '未知'}；页面标题：{probe.get('title') or '未知'}；"
            f"匹配到的发图 input 数：{probe.get('input_count', 0)}；"
            f"页面里 input[type=file] 总数（含简历附件上传）：{probe.get('file_input_count', 0)}；"
            f"「发送图片」入口按钮（{SELECTOR_CHAT_IMAGE_BUTTON}）：{probe.get('send_found', False)}。"
            "文本招呼语不受影响，已正常送达。请把这段信息反馈给维护者，以便更新站点选择器。"
        )


__all__ = ["BossGreetingImageMixin"]
