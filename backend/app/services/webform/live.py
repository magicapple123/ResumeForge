"""「点哪个填哪个」：页面里的焦点监听 + 提示面板的驱动。

## 与批量模式的根本差别

批量模式先给整页控件打上 ``data-rf-index``（DOM 顺序号）再统一匹配。而网申页面是联动的
——选了国家，省份下拉重渲染，后面的序号就可能全部错位。那是我最初设计里**最大的风险**。

这个模式**不做预先快照**：你点到哪个框，才在现场描述那个框、现场匹配。序号从哪来、页面
怎么变，都与它无关。

## 分工

- **页面里**（``FOCUS_LISTENER_SCRIPT``）：只听焦点、只渲染面板。它**不填值**。
- **这里**：轮询页面状态 → 用 ``service.suggest_for`` 算建议 → 写回面板 → 用户点了「填入」
  才真正写值，走的是与批量模式**同一套**哑执行器与回读校验。

之所以让写入绕回 Python，而不是在页面里直接写：写入、回读校验、失败上报就都只有一份实现。

## 安全

- 面板只显示**这一个控件**该填什么，绝不自动写。
- 密码 / 验证码 / 同意条款 / 声明类勾选 / 他人信息：``suggest_for`` 直接判为 blocked，
  面板只说明原因、不给「填入」按钮。
- 页面**不直接访问本地 API**（那会让任何网站都能读到用户资料），一切经 CDP 来回传。
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import unicodedata
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Callable

from ..browser.cdp_client import CdpClient
from ._base import WebFormConflict
from .engine import (
    FOCUS_LISTENER_SCRIPT,
    Control,
    FormEngine,
    excluded_by_hints,
    foreign_marker,
    has_ambiguous_field_evidence,
)
from .fields import FIELD_LABELS
from .live_control import (
    install_live_control_script,
    set_assistant_reply_script,
    set_autofill_status_script,
    set_live_enabled_script,
)
from .live_autofill import AutoFillProgress, AutoFillWorker, fill_current_page
from . import live_assistant
from .live_ai_worker import _AiWorker
from .live_memory_panel import REMEMBER_EDITOR_SCRIPT, memory_targets_script
from .live_remember import LiveRememberMixin
from .live_scripts import (
    _ACK_ASSISTANT_ASK_SCRIPT,
    _ACK_AUTOFILL_SCRIPT,
    _HIDE_SCRIPT,
    _STATE_SCRIPT,
    _UNINSTALL_SCRIPT,
    _catalog_script,
    _clear_state_script,
    _show_panel_script,
)
from .repeated_fields import field_key_for_block, field_label_for_key, split_repeated_key
from .service import (
    AI_NOTE,
    SOURCE_AI,
    SOURCE_RULE,
    FillSelection,
    apply_fill,
    recognize_field,
    related_entries,
    resolve_value_for,
    suggest_for,
    Suggestion,
)
from .session import Snapshot

if TYPE_CHECKING:
    # 仅供静态检查：运行时的 MultiLiveSession 经下方模块级 ``__getattr__`` 延迟提供
    # （live_multi 单向依赖本模块的 LiveSession，模块级导入会成环）。
    from .live_multi import MultiLiveSession

logger = logging.getLogger(__name__)

# 轮询间隔。CDP 是本地回环，350ms 足够跟手，又不至于把一秒钟塞满几十次往返。
POLL_INTERVAL_SECONDS = 0.35

# 空闲退避（2026-10-05 性能审查）：0.35s 恒定轮询在页面完全静止时也在持续消耗
# 前后端 CPU——每轮都是 WebSocket 往返 + 整页状态序列化 + JSON 解析。连续
# IDLE_AFTER_QUIET_TICKS 轮没有任何事件（约 2.8 秒）就把间隔放大到
# IDLE_POLL_INTERVAL_SECONDS；任何事件（焦点 / 请求 / 页面跳转 / 开关变更 /
# 出错）立刻回到快档，交互手感不变。
IDLE_POLL_INTERVAL_SECONDS = 1.5
IDLE_AFTER_QUIET_TICKS = 8

# 一次会话最多问几次模型。**这是钱**：一个长表单上认不出的框可能有几十个，而用户来回点
# 同一个框也会重复触发。到顶就停止询问并如实说明，不静默变成"没认出来"。
# 同一控件重复问不会真的再花一次（``ai.fingerprint`` 的语义缓存挡在前面），所以这个数
# 大致等于"这一页最多能问多少个**不同的**框"。
MAX_AI_CALLS = 30

# 规则认不出、也没问 AI（没开或问不成）时的兜底措辞。
UNMATCHED_NOTE = "没认出来这个框要填什么"
class LiveSession(LiveRememberMixin):
    """点哪个填哪个的一次会话：装上监听、轮询、按用户确认写入。"""

    def __init__(
        self,
        client: CdpClient,
        data: dict[str, str],
        catalog: list[dict[str, str]] | None = None,
        *,
        provider: Any = None,
        ai_enabled: bool = False,
        store: Callable[[dict[str, str]], bool] | None = None,
        require_memory_choice: bool = False,
        data_loader: Callable[[], tuple[dict[str, str], list[dict[str, str]]]] | None = None,
        autofill_data_loader: Callable[[], dict[str, str]] | None = None,
        memory_targets: list[dict[str, Any]] | None = None,
        memory_targets_loader: Callable[[], list[dict[str, Any]]] | None = None,
    ) -> None:
        self._client = client
        self._data = dict(data)
        # 给人挑的完整清单（按分区、逐条列出）。**在启动时一次性推给页面**：面板不能反过来
        # 请求本地 API（那会让任何网站都能读到用户资料），所以数据只能由这边主动送过去。
        self._catalog = list(catalog or [])
        # 「记住这条」的落库回调。**是个回调而不是直接依赖 extra_profile**：那样这个模块就
        # 得知道 session 从哪来，而它活在后台线程里、与请求的 session 生命周期无关。由
        # ``api`` 层用一次性 session 闭一个进来，"怎么写"的事仍留在那一层。
        # 为 None（单测直接用 LiveSession 时）⇒ 「记住这条」如实说"存不了"，不静默假成功。
        self._store = store
        # 默认由 API 根据字段 key 自动落到已有资料或网申资料自定义字段；
        # require_memory_choice 仅保留给需要显式选目标的兼容调用与单元测试。
        self._require_memory_choice = require_memory_choice
        self._memory_targets = list(memory_targets or [])
        self._memory_targets_loader = memory_targets_loader
        # 资料可能在另一个界面被补充；每次聚焦新控件前按需重新读取，避免会话持有旧快照。
        self._data_loader = data_loader
        # 悬浮球的整页快捷填充必须使用主界面的可复用资料口径；逐框建议仍可包含“本次”资料。
        self._autofill_data_loader = autofill_data_loader
        self._engine = FormEngine()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._seq = 0
        # AI 兜底。``provider`` 为 None（没配模型）时整条路都不存在：**零调用**。
        self._provider = provider
        self._ai_enabled = bool(ai_enabled and provider is not None)
        self._ai_calls = 0
        # 模型调用要 1~3 秒，而 ``_on_focus`` 跑在 350ms 一轮的轮询线程上（``_loop`` 只
        # ``except Exception`` 兜底）。在那里同步等一次网络调用会把整个轮询卡死——用户点到
        # 下一个框时面板纹丝不动，看起来就是"卡了"。所以真正的调用挪到自己的工作线程上。
        self._ai_worker = _AiWorker(self._run_ai)
        self._autofill_worker = AutoFillWorker(self._run_autofill)
        # 「问投投」的工作线程。**独立于填表 AI 开关**：只要配了模型（provider 有值）
        # 就可以问——ai_enabled 管的是自动字段识别的成本，而问答是用户逐条显式发起的
        # 单次调用，语义不同。provider 为 None 时 ask() 会如实回「未配置模型服务」。
        self._ask_worker = _AiWorker(self._run_ask, name="webform-ask")
        # 问答历史与问题游标都是**每文档**一份：页面跳转即重置（见 _tick 的重装分支），
        # 否则上一页的对话会接到新页面上、旧 seq 会吞掉新页的第一次提问。
        self._ask_history = live_assistant.new_history()
        self._last_ask_sequence: int | None = None
        self._enabled = True
        self._last_control_sequence: int | None = None
        self._last_autofill_sequence: int | None = None
        # 「可能是这几个」——按**当前焦点控件**从完整清单里挑出的前几条，随面板一起推给页面。
        #
        # 存在这里而不是每次现算：`_publish` 会被好几个分支调用（命中 / 认不出 / AI 在想 /
        # AI 回来了），它们都得带上同一份；而重算一遍要遍历整个清单。
        self._related: list[dict[str, str]] = []
        # 给 ResumeForge 页面看的状态（页面上要能显示"正在做什么"）。
        self.state: dict[str, Any] = {
            "running": False,
            "enabled": False,
            "field_label": "",
            "value": "",
            "status": "",
            "note": "",
            "source": "",
            "remember_field_key": "",
            "alternatives": [],
            "filled": 0,
            "remember_pending": None,
        }

    # ===== 生命周期 =====

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            raise WebFormConflict("点击填表模式已经在运行")
        # 刻意**不**在这里把窗口唤到前台：实时填表现在随浏览器启动自动开启，
        # 用户可能把窗口最小化/切走了并不想被打断——启动时强行 activateTarget
        # 就是用户反馈的"加载出来的时候又弹出一次专用浏览器"。焦点问题（Chrome
        # 无系统焦点时不派发 focusin）在用户真正点击窗口时自然消失：点击本身
        # 就会让窗口获得焦点。
        self._attach()
        # 上一轮可能留下了面板，先收干净。
        self._client.evaluate(_clear_state_script())
        self._stop.clear()
        self._ai_worker.start()
        self._autofill_worker.start()
        self._ask_worker.start()
        self._thread = threading.Thread(target=self._loop, name="webform-live", daemon=True)
        self._thread.start()
        self.state["running"] = True
        self.state["enabled"] = self._enabled

    def update_data(
        self, data: dict[str, str], catalog: list[dict[str, str]] | None = None
    ) -> None:
        """更新当前会话使用的资料与人工挑选清单。"""
        with self._lock:
            self._data = dict(data)
            if catalog is not None:
                self._catalog = list(catalog)
                next_catalog = list(self._catalog)
            else:
                next_catalog = None
        if next_catalog is not None:
            # 资料页可能在实时会话仍运行时被另一个界面更新。除了匹配数据要刷新，
            # 浏览器里的「换个资料」清单也必须立刻看到新条目。
            try:
                self._client.evaluate(_catalog_script(next_catalog))
            except Exception as error:  # noqa: BLE001 - 页面跳转时下一轮会重新装载
                logger.debug("网申填表：刷新浏览器资料清单失败：%s", error)

    def set_data_loader(
        self, loader: Callable[[], tuple[dict[str, str], list[dict[str, str]]]] | None
    ) -> None:
        """替换资料刷新回调，供页面切换回来时复用同一会话。"""
        self._data_loader = loader

    def set_autofill_data_loader(
        self, loader: Callable[[], dict[str, str]] | None
    ) -> None:
        """替换悬浮球整页快捷填充使用的批量资料读取回调。"""
        self._autofill_data_loader = loader

    def set_client(self, client: CdpClient) -> None:
        """切换到当前浏览器客户端。

        浏览器管理器每次取 ``client()`` 都会创建一个新的 CDP 客户端；浏览器重启或
        配置变化后，旧会话不能继续持有旧实例。
        """
        with self._lock:
            self._client = client

    def set_enabled(self, enabled: bool) -> None:
        """切换当前标签页是否响应焦点；保留悬浮球，避免关闭后无法重新打开。"""
        next_enabled = bool(enabled)
        self.state["enabled"] = next_enabled
        if self._enabled == next_enabled:
            return
        self._enabled = next_enabled
        try:
            self._client.evaluate(_clear_state_script())
            self._client.evaluate(set_live_enabled_script(next_enabled))
        except Exception as error:  # noqa: BLE001 - 页面跳转时下一轮会重新注入
            logger.debug("网申填表：同步浏览器内开关失败：%s", error)

    def set_memory_choice_required(self, required: bool) -> None:
        """更新「记住这条」是否需要人工选目标的兼容开关。"""
        self._require_memory_choice = bool(required)

    def set_memory_targets_loader(
        self, loader: Callable[[], list[dict[str, Any]]] | None
    ) -> None:
        """替换浏览器内联编辑器的资料目标刷新回调。"""
        self._memory_targets_loader = loader

    def update_memory_targets(self, targets: list[dict[str, Any]]) -> None:
        """把最新的完整资料目录推给目标浏览器。"""
        self._memory_targets = list(targets)
        try:
            self._client.evaluate(memory_targets_script(self._memory_targets))
        except Exception as error:  # noqa: BLE001 - 页面跳转时下一轮会重新装载
            logger.debug("网申填表：刷新浏览器记忆目标失败：%s", error)

    def _refresh_data(self) -> None:
        if self._data_loader is not None:
            try:
                data, catalog = self._data_loader()
                self.update_data(data, catalog)
            except Exception as error:  # noqa: BLE001 - 资料刷新失败不应弄死实时监听
                logger.warning("网申填表：刷新实时资料失败，继续使用上一份资料：%s", error)
        if self._memory_targets_loader is not None:
            try:
                self.update_memory_targets(self._memory_targets_loader())
            except Exception as error:  # noqa: BLE001 - 资料刷新失败不应弄死实时监听
                logger.warning("网申填表：刷新记忆目标失败，继续使用上一份目录：%s", error)

    def _attach(self) -> None:
        """把「给人挑」的清单与焦点监听装进**当前文档**。

        **幂等**：监听脚本自己会看 ``__rfInstalled``，装过就早退。所以页面跳转后重新调一次
        是安全的——这正是 :meth:`_tick` 自愈的方式。

        两件事必须成对做：清单先送进去，再装监听。少了清单，用户第一次点「换个资料…」
        会看到空列表；少了监听，点哪个框都没反应。
        """
        self._client.evaluate(_catalog_script(self._catalog))
        self._client.evaluate(FOCUS_LISTENER_SCRIPT)
        self._client.evaluate(install_live_control_script(self._enabled))
        self._client.evaluate(memory_targets_script(self._memory_targets))
        self._client.evaluate(REMEMBER_EDITOR_SCRIPT)

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=2.0)
        # 还在飞的模型调用不等它（那是网络时间，等下去只会卡住停用按钮），但要丢掉排队中的
        # 那些——不然用户关了模式之后，某个回调还会往页面上推一个已经没人看的面板。
        self._ai_worker.close()
        self._autofill_worker.close()
        self._ask_worker.close()
        try:
            # 真正把监听与面板从页面上撤掉，而不是只藏起来。
            self._client.evaluate(_UNINSTALL_SCRIPT)
        except Exception:  # noqa: BLE001 - 页面可能已经关了
            pass
        self.state["running"] = False
        self.state["enabled"] = False

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ===== 主循环 =====

    def _loop(self) -> None:
        quiet = 0
        while not self._stop.is_set():
            try:
                busy = bool(self._tick())
            except Exception as error:  # noqa: BLE001 - 单轮失败不该让会话整个垮掉
                logger.warning("点击填表的一轮出错了：%s", error)
                # 出错保持快档：连接恢复、页面跳转这类情况要尽快跟上。
                busy = True
            if busy:
                quiet = 0
                delay = POLL_INTERVAL_SECONDS
            else:
                quiet += 1
                delay = (
                    POLL_INTERVAL_SECONDS
                    if quiet < IDLE_AFTER_QUIET_TICKS
                    else IDLE_POLL_INTERVAL_SECONDS
                )
            self._stop.wait(delay)

    def _tick(self) -> bool:
        """拉一次页面状态并处理；返回本轮是否遇到需要跟进的事件（供空闲退避判断）。"""
        busy = False
        payload = self._client.evaluate(_STATE_SCRIPT)
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            # 状态拿不到（假客户端 / 旧页面 / 异常返回）：按"有事"处理保持快档。
            return True

        control = payload.get("live_control")
        if isinstance(control, dict):
            sequence = int(control.get("seq") or 0)
            if self._last_control_sequence is None:
                self._last_control_sequence = sequence
            elif sequence != self._last_control_sequence:
                self._last_control_sequence = sequence
                self.set_enabled(bool(control.get("enabled", True)))
                busy = True
        # 页面跳转或刷新会把监听与面板一起带走。这里**自己发现、自己装回去**——
        # 否则模式会一直显示「运行中」而实际上什么都点不动（用户看到的就是"没生效"，
        # 且没有任何提示能解释为什么）。
        #
        # 判据用 ``installed is False`` 而不是 ``not installed``：假客户端与旧版页面可能
        # 不返回这个字段，那种情况下**不该**每轮都重装一遍。
        if payload.get("installed") is False:
            logger.info("网申填表：页面已跳转，重新装上「点哪个填哪个」的监听")
            self._attach()
            # 新文档的焦点序号从 0 开始，跟着归零；否则可能正好撞上旧序号而漏掉第一次聚焦。
            self._seq = 0
            # 新文档里的悬浮球从 1 重新编号；不清这个游标时，上一页已经用过 seq=1
            # 的情况下，新页第一次点击「自动填写当前页面」会被误认为是旧请求，按钮就会
            # 永远停在「正在填写中」。控制序号也一并重置，避免把新文档的默认状态当成
            # 上一页的开关变更。
            self._last_control_sequence = None
            self._last_autofill_sequence = None
            # 「问投投」同样是**每文档**一份：历史与问题游标跟着重置，防止新文档的
            # seq 从 1 重新编号时被旧游标误判为"已处理过"。
            self._ask_history = live_assistant.new_history()
            self._last_ask_sequence = None
            # 上一页的建议已经失效，别让它继续挂在界面上。
            self._publish(
                {
                    "field_label": "",
                    "value": "",
                    "status": "",
                    "note": "",
                    "source": "",
                    "alternatives": [],
                }
            )
            return True

        autofill = payload.get("autofill")
        if self._enabled and isinstance(autofill, dict):
            sequence = int(autofill.get("seq") or 0)
            if (
                sequence
                and (
                    self._last_autofill_sequence is None
                    or sequence != self._last_autofill_sequence
                )
            ):
                self._last_autofill_sequence = sequence
                busy = True
                try:
                    self._client.evaluate(_ACK_AUTOFILL_SCRIPT)
                except Exception as error:  # noqa: BLE001 - ACK 失败不应阻止后台任务
                    logger.debug("网申填表：确认自动填写请求失败：%s", error)
                if not self._autofill_worker.request(sequence):
                    self._publish_autofill(
                        AutoFillProgress(
                            state="error",
                            total=0,
                            completed=0,
                            filled=0,
                            failed=0,
                            message="已有自动填写正在进行，请稍后再试",
                        )
                    )

        # 「问投投」与自动填写同层处理：即便实时填表开关是关的，悬浮球还在，
        # 问答就应当可用（它是悬浮球的独立能力，不随填表开关一起下线）。
        assistant_ask = payload.get("assistant_ask")
        if isinstance(assistant_ask, dict):
            ask_sequence = int(assistant_ask.get("seq") or 0)
            ask_text = str(assistant_ask.get("text") or "")
            if (
                ask_sequence
                and ask_text
                and (
                    self._last_ask_sequence is None
                    or ask_sequence != self._last_ask_sequence
                )
            ):
                self._last_ask_sequence = ask_sequence
                busy = True
                try:
                    self._client.evaluate(_ACK_ASSISTANT_ASK_SCRIPT)
                except Exception as error:  # noqa: BLE001 - ACK 失败不应阻止后台任务
                    logger.debug("网申填表：确认问投投请求失败：%s", error)
                self._ask_worker.push(ask_sequence, ask_text)

        # 关闭实时填表后仍要保留悬浮球，这样用户可以在专用浏览器里重新开启；
        # 因此即使当前是关闭状态，也要先把新文档里的控制球重新装回去，再跳过焦点处理。
        if not self._enabled:
            return busy

        seq = int(payload.get("seq") or 0)
        if seq != self._seq:
            self._seq = seq
            busy = True
            self._on_focus(payload.get("control"))

        accept = payload.get("accept")
        if isinstance(accept, dict):
            busy = True
            self._on_accept(accept)

        remember = payload.get("remember")
        if isinstance(remember, dict):
            busy = True
            self._on_remember(remember)
        return busy

    # ===== 焦点变化：算建议、显示面板 =====

    def _on_focus(self, raw: Any) -> None:
        if not isinstance(raw, dict):
            # 焦点落到了**不填**的控件上（单选、复选、下拉、附件…）。页面那边已经把面板
            # 收掉了，这边也要跟着清——否则 ResumeForge 页面上还挂着上一条"将填入"，
            # 而用户眼前的浏览器里什么都没有，两边对不上。
            self._related = []
            self._publish(
                {
                    "status": "",
                    "field_label": "",
                    "value": "",
                    "note": "",
                    "source": "",
                    "alternatives": [],
                }
            )
            return
        control = self._build_control(raw)
        if control is None:
            return
        self._refresh_data()
        with self._lock:
            data = dict(self._data)
            catalog = list(self._catalog)
        # 「可能是这几个」：**在算建议之前定下来**，所以每一个分支（命中 / 认不出 /
        # AI 在想 / AI 回来了）推出去的面板都带着同一份。
        self._related = related_entries(control, catalog)
        suggestion = self._suggest_custom_field(control, data) or suggest_for(
            control, data, engine=self._engine
        )
        if suggestion.status != "unmatched":
            self._publish(
                {
                    "status": suggestion.status,
                    "remember_field_key": suggestion.field,
                    "field_label": suggestion.field_label,
                    "value": suggestion.value,
                    "note": suggestion.note,
                    "source": SOURCE_RULE,
                }
            )
            return

        # `suggest_for` 把"认得出字段但资料里没值"和"压根认不出"都报成 unmatched
        # （``match_fields`` 对空值字段直接跳过）。**这两件事要分开**：前者去「我的资料」
        # 补一下就好了，问模型纯属白花钱；只有后者才值得交给 AI。
        if known := recognize_field(control):
            shown_key = field_key_for_block(known, control.block_family, control.block_index)
            label = field_label_for_key(
                shown_key, FIELD_LABELS.get(split_repeated_key(shown_key)[0], shown_key)
            )
            self._publish_unmatched(
                f"认出来是「{label}」，但你的资料里还没填这一项",
                source=SOURCE_RULE,
                field_label=label,
                field_key=shown_key,
            )
            return

        if has_ambiguous_field_evidence(control):
            self._publish_unmatched(
                "页面附近有多个相似字段，未自动猜测，请从资料清单中选择",
                source=SOURCE_RULE,
            )
            return

        # **三种"没问成"要分开说**：没开 AI、次数用完、模型没帮上忙。混成一句话的话，
        # 用户分不清"是不是我哪里没设置"和"它尽力了"。
        if not self._ai_enabled:
            self._publish_unmatched(UNMATCHED_NOTE)
            return
        if not self._begin_ai_call():
            self._publish_unmatched(f"没认出来（这一页问 AI 的次数已用完，上限 {MAX_AI_CALLS} 次）")
            return
        # 先把面板切到"AI 在看"，别让用户对着一个静止的"正在看这个框…"等三秒。
        self._publish(
            {
                "status": "ai_thinking",
                "note": "AI 正在识别这个框…",
                "source": SOURCE_AI,
                "remember_field_key": "",
            }
        )
        self._dispatch_ai(control)

    def _begin_ai_call(self) -> bool:
        """还能不能再花一次调用。**先扣再问**，避免并发下的双花。"""
        with self._lock:
            if self._ai_calls >= MAX_AI_CALLS:
                return False
            self._ai_calls += 1
            return True

    @staticmethod
    def _normalize_label(label: str) -> str:
        normalized = unicodedata.normalize("NFKC", str(label or "")).casefold()
        return "".join(char for char in normalized if char.isalnum())

    def _suggest_custom_field(self, control: Control, data: dict[str, str]) -> Suggestion | None:
        """只对**唯一精确同名**的自定义字段提供逐框建议。

        自定义字段没有内置同义词表，不能把模糊相似当成自动填写依据；字段重命名后，
        目标浏览器拿到的新标签会在下一次聚焦时立即参与这条精确匹配。
        """
        signature = self._normalize_label(
            " ".join(
                part
                for part in (control.label, control.placeholder, control.aria_label, control.name)
                if part
            )
        )
        if not signature:
            return None
        candidates = [*self._memory_targets, *self._catalog]
        matches = []
        seen: set[str] = set()
        for target in candidates:
            source = str(target.get("source") or "extra")
            if source != "extra":
                continue
            key = str(target.get("field_key") or target.get("key") or "")
            label = str(target.get("label") or "")
            if not key.startswith("CUSTOM_") or self._normalize_label(label) != signature:
                continue
            if key in seen:
                continue
            seen.add(key)
            matches.append((key, label))
        if len(matches) != 1:
            return None
        key, label = matches[0]
        value = str(data.get(key) or "").strip()
        if not value:
            return Suggestion("unmatched", field=key, field_label=label)
        return Suggestion("matched", field=key, field_label=label, value=value)

    def _publish_unmatched(
        self,
        note: str,
        *,
        source: str = "",
        field_label: str = "",
        field_key: str = "",
    ) -> None:
        """"这个框没认出来"的统一出口——面板上永远留着一个「换个资料…」，不会是死路。"""
        self._publish(
            {
                "status": "unmatched",
                "field_label": field_label,
                "remember_field_key": field_key,
                "note": f"{note}，点「换个资料…」自己挑一条",
                "source": source,
            }
        )

    @staticmethod
    def _build_control(raw: dict[str, Any]) -> Control | None:
        controls = FormEngine().snapshot_controls([raw])
        return controls[0] if controls else None

    # ===== AI 兜底 =====
    #
    # 三条纪律，写在实现里而不只是注释里：
    # 1. **不阻塞轮询**——真正的调用在单槽执行器里跑，``_tick`` 立刻返回；
    # 2. **过期即丢**——提交时记下 ``seq``，回调里比对，用户已经点到别的框就丢弃；
    # 3. **失败不抛**——执行器里的异常没人接，``_publish`` 自己兜住。

    def _dispatch_ai(self, control: Control) -> None:
        self._ai_worker.push(self._seq, control)

    def _run_ai(self, seq: int, control: Control) -> None:
        # 惰性导入：``ai`` 会连带拉起 ``services/llm``，而本模块是「网申」包的导入入口之一。
        from .ai import identify_fields

        try:
            matches = asyncio.run(identify_fields(self._provider, [control]))
        except Exception as error:  # noqa: BLE001 - 工作线程里的异常没人接
            logger.warning("网申填表的 AI 识别失败：%s", error)
            if seq == self._seq and not self._stop.is_set():
                self._publish_unmatched("AI 没能识别这个框")
            return
        if seq != self._seq or self._stop.is_set():
            # 用户已经点到别的框了（或模式已经停用）。丢掉的这一份不能推——否则面板上会
            # 显示上一个框的答案，而那看起来就像是程序答错了。
            return
        self._publish_ai(control, matches.get(control.index, ()))

    def _publish_ai(self, control: Control, candidates: tuple[str, ...]) -> None:
        """把模型的候选落成面板上的一行主推 + 若干备选。

        **能不能填仍由本地决定**：每个候选都过一遍 ``resolve_value_for``，装不下这个控件的
        候选（下拉没那一项、日期解不出来）不进面板——模型只贡献了字段名。
        """
        with self._lock:
            data = dict(self._data)
        # 采纳前逐个候选过守卫，与规则引擎、批量预览共用同一实现：负向词
        # （"紧急联系人姓名"框不该认成"姓名"）与跨族否决（"区号"框之于日期字段）
        # 不因为答案来自模型就免检。
        usable = tuple(
            key
            for key in candidates
            if not excluded_by_hints(control, key) and foreign_marker(control, key) is None
        )
        fillable: list[tuple[str, str]] = []
        for key in usable:
            value = resolve_value_for(control, key, data)
            if value:
                shown_key = field_key_for_block(key, control.block_family, control.block_index)
                fillable.append(
                    (
                        field_label_for_key(
                            shown_key, FIELD_LABELS.get(split_repeated_key(shown_key)[0], shown_key)
                        ),
                        value,
                    )
                )

        if not fillable:
            if usable:
                key = usable[0]
                note = self._ai_dead_end(usable)
            elif candidates:
                # 所有候选都被守卫拦下：这是"猜的和框对不上"，不是"资料里没填"。
                key = candidates[0]
                note = "AI 猜的字段和这个框的语义对不上，未采纳"
            else:
                key = ""
                note = self._ai_dead_end(())
            shown_key = field_key_for_block(key, control.block_family, control.block_index) if key else ""
            self._publish_unmatched(
                note,
                source=SOURCE_AI,
                field_label=(
                    field_label_for_key(
                        shown_key, FIELD_LABELS.get(split_repeated_key(shown_key)[0], shown_key)
                    )
                    if shown_key
                    else ""
                ),
                field_key=shown_key,
            )
            return

        (label, value), *rest = fillable
        self._publish(
            {
                "status": "matched",
                "field_label": label,
                "value": value,
                # AI 给的答案**必须标明是猜的**：规则命中至少证明页面上有字对上了，
                # 这一条可能纯粹是上下文推的，用户核对时的怀疑程度应当不同。
                "note": AI_NOTE,
                "source": SOURCE_AI,
                "alternatives": [
                    {"label": alt_label, "value": alt_value} for alt_label, alt_value in rest
                ],
            }
        )

    def _ai_dead_end(self, candidates: tuple[str, ...]) -> str:
        """一个候选都填不了时，如实说明**是哪一种**填不了。"""
        if not candidates:
            return "AI 也认不出这个框"
        key = candidates[0]
        label = FIELD_LABELS.get(key, key)
        with self._lock:
            data = dict(self._data)
        if not (data.get(key) or "").strip():
            return f"AI 认出来是「{label}」，但你的资料里还没填这一项"
        return f"AI 认出来是「{label}」，但页面上的选项没有对应的值"

    def _publish(self, panel: dict[str, Any]) -> None:
        """推面板并同步本状态。

        **两件事必须一起做**：只推页面的话，ResumeForge 那边显示的还是上一条；只更新状态的话，
        用户眼前的浏览器窗口和页面上写的对不上。任一种都会让人以为程序在乱来。

        这个函数会在**执行器线程**里被调用（AI 结果回来时），所以它自己得兜住异常——
        那里的异常没人接，会静默消失。
        """
        payload = {
            "status": str(panel.get("status", "")),
            "field_label": str(panel.get("field_label", "")),
            "value": str(panel.get("value", "")),
            "note": str(panel.get("note", "")),
            "source": str(panel.get("source", "")),
            "remember_field_key": str(panel.get("remember_field_key", "")),
            "alternatives": list(panel.get("alternatives", [])),
            "remember_pending": panel.get("remember_pending"),
            # 「可能是这几个」。**跟着每一次推送走**：面板上那几个状态（给出建议 / 认不出 /
            # AI 在想）都会用到它，漏一次那一栏就会空掉。
            "related": list(panel.get("related", self._related)),
        }
        try:
            self._client.evaluate(_show_panel_script(payload))
        except Exception as error:  # noqa: BLE001 - 页面可能已经跳走
            logger.warning("没能把面板内容写进页面：%s", error)
        with self._lock:
            self.state.update(payload)

    # ===== 用户点了「填入」 =====

    def _on_accept(self, accept: dict[str, Any]) -> None:
        """写入并回读校验，然后把结果写回面板。

        写入走 ``service.apply_fill``——与批量模式**同一条**路径：同样的重建逻辑、
        同样的哑执行器、同样的回读校验。在这里另写一份"填一个框"的实现，就等于把
        那三样都复制一遍，日后必然分叉。
        """
        # 先把"用户点了填入"这件事清掉，否则下一轮会重复执行。
        self._client.evaluate(_HIDE_SCRIPT)
        value = str(accept.get("value") or "")
        # 用户可能从清单里挑了任意一条，所以标签以他挑的那条为准。
        picked_label = str(accept.get("label") or self.state.get("field_label", ""))
        # **控件描述以选择里带的那份为准**：点面板会让页面输入框失焦，此刻再去问
        # `window.__rfFocus` 可能已经被清掉了（实测到"挑了一条却写入失败"）。只有选择里
        # 没带（老版本脚本）才退回现场取。
        raw = accept.get("control")
        control = self._build_control(raw) if isinstance(raw, dict) else self._current_control()
        if control is None or not value:
            return
        # 页面在选定时打了一个**不会被焦点搬走**的标记，以它为准。`data-rf-focus` 会在
        # 下一次聚焦时移走，而点面板本身就会引起焦点变化——用它会写不到目标上。
        if selector := str(accept.get("selector") or ""):
            control = replace(control, selector=selector)

        snapshot = Snapshot(id="live", controls=[control])
        results = apply_fill(
            self._client,
            snapshot,
            [FillSelection(index=control.index, field="", value=value)],
            # 逐项模式不等"落定复读"：用户正对着这个框看，即时反馈优先；
            # 批量的伪已填复读（settle_recheck）留给整页填充那条路。
            settle_recheck=0,
        )
        outcome = results[0] if results else None
        ok = outcome is not None and outcome.status == "filled"
        note = "已填入，请核对" if ok else (outcome.detail if outcome else "没能写入")

        # 「已填入」之后不再留候选——那几个备选是针对"该填什么"的，已经填完了。
        self._publish(
            {
                "status": "filled" if ok else "blocked",
                "field_label": picked_label,
                "value": value if ok else "",
                "note": note,
                "source": self.state.get("source", ""),
            }
        )
        with self._lock:
            # `_publish` 写的是 `status`，但这里要的是"这一次写入的结果"，两者不同名：
            # `filled` 是给 ResumeForge 页面看的（它认的是 matched/filled/failed 那套）。
            self.state["status"] = "filled" if ok else "failed"
            if ok:
                self.state["filled"] = int(self.state.get("filled", 0)) + 1

    def _current_control(self) -> Control | None:
        """重新取一次当前焦点控件的描述——用户可能已经点到别处去了。"""
        payload = self._client.evaluate(_STATE_SCRIPT)
        if isinstance(payload, str):
            payload = json.loads(payload)
        raw = (payload or {}).get("control") if isinstance(payload, dict) else None
        return self._build_control(raw) if isinstance(raw, dict) else None

    # ===== 悬浮球的当前页面自动填写 =====

    def _publish_autofill(self, progress: AutoFillProgress) -> None:
        payload = {
            "state": progress.state,
            "total": progress.total,
            "form_control_total": progress.form_control_total,
            "recognized_total": progress.recognized_total,
            "completed": progress.completed,
            "filled": progress.filled,
            "failed": progress.failed,
            "current_label": progress.current_label,
            "message": progress.message,
        }
        try:
            self._client.evaluate(set_autofill_status_script(payload))
        except Exception as error:  # noqa: BLE001 - 页面关闭时进度无需再推送
            logger.debug("网申填表：更新自动填写进度失败：%s", error)

    def _run_autofill(self, _sequence: int) -> None:
        # 自动填写按钮可能在本轮焦点事件之前被点击；先读取最新资料，避免使用启动会话时的旧快照。
        self._refresh_data()
        with self._lock:
            data = dict(self._data)
        if self._autofill_data_loader is not None:
            try:
                data = dict(self._autofill_data_loader())
            except Exception as error:  # noqa: BLE001 - 快捷填充失败时沿用当前会话资料
                logger.warning("网申填表：刷新快捷填充资料失败，继续使用当前资料：%s", error)
        try:
            fill_current_page(
                self._client,
                data,
                engine=self._engine,
                on_progress=self._publish_autofill,
                should_stop=self._stop.is_set,
            )
        except Exception as error:  # noqa: BLE001 - 失败要回显在悬浮球而不是吞掉
            logger.warning("网申填表：自动填写当前页面失败：%s", error)
            self._publish_autofill(
                AutoFillProgress(
                    state="error",
                    total=0,
                    completed=0,
                    filled=0,
                    failed=1,
                    message="读取当前页面失败，请刷新页面后重试",
                )
            )

    # ===== 「问投投」：精简版问答 =====
    #
    # 与 AI 兜底同一套纪律：不阻塞轮询（真调用在 _ask_worker 上）、失败不抛（转成
    # 页面可见的 error 文案）、过期回答由页面侧 seq 比对丢弃。

    def _run_ask(self, sequence: int, question: str) -> None:
        """跑一次问答并把结果（或错误）写回页面。provider 未配置时 ask() 会如实报错。"""
        try:
            reply = live_assistant.ask(self._provider, self._ask_history, question)
        except live_assistant.AssistantAskError as error:
            self._publish_assistant_reply({"seq": sequence, "error": str(error)})
            return
        # 只有**成功**的一轮才进历史；失败的问题留在上下文里只会污染下一轮。
        live_assistant.append_exchange(self._ask_history, question, reply)
        self._publish_assistant_reply({"seq": sequence, "text": reply})

    def _publish_assistant_reply(self, payload: dict[str, Any]) -> None:
        try:
            self._client.evaluate(set_assistant_reply_script(payload))
        except Exception as error:  # noqa: BLE001 - 页面可能已经跳走
            logger.debug("网申填表：回写问投投的回答失败：%s", error)



#
# 同一时刻只允许一个实时会话；会话内部可以绑定多个网申标签页。
_session: LiveSession | MultiLiveSession | None = None
_session_lock = threading.Lock()


def start_live(
    client: CdpClient,
    data: dict[str, str],
    catalog: list[dict[str, str]] | None = None,
    *,
    provider: Any = None,
    ai_enabled: bool = False,
    store: Callable[[dict[str, str]], bool] | None = None,
    require_memory_choice: bool = False,
    data_loader: Callable[[], tuple[dict[str, str], list[dict[str, str]]]] | None = None,
    autofill_data_loader: Callable[[], dict[str, str]] | None = None,
    memory_targets: list[dict[str, Any]] | None = None,
    memory_targets_loader: Callable[[], list[dict[str, Any]]] | None = None,
    target_clients_loader: Callable[[], list[tuple[str, CdpClient]]] | None = None,
) -> LiveSession | MultiLiveSession:
    """开一次会话。**已经在跑就直接返回它**——注意 ``provider`` / ``ai_enabled`` 也一并
    被忽略，AI 开关是"开启时"的设置，改动要停掉再开才生效（界面上有这句提示）。"""
    global _session
    with _session_lock:
        if _session is not None and _session.is_running:
            _session.set_client(client)
            _session.update_data(data, catalog)
            _session.set_data_loader(data_loader)
            _session.set_autofill_data_loader(autofill_data_loader)
            _session.set_memory_choice_required(require_memory_choice)
            _session.set_memory_targets_loader(memory_targets_loader)
            if memory_targets is not None:
                _session.update_memory_targets(memory_targets)
            return _session
        # 延迟导入：``live_multi`` 单向依赖本模块的 ``LiveSession``，模块级导入会成环。
        from .live_multi import MultiLiveSession

        session_type = MultiLiveSession if target_clients_loader is not None else LiveSession
        _session = session_type(
            client,
            data,
            catalog,
            provider=provider,
            ai_enabled=ai_enabled,
            store=store,
            require_memory_choice=require_memory_choice,
            data_loader=data_loader,
            autofill_data_loader=autofill_data_loader,
            memory_targets=memory_targets,
            memory_targets_loader=memory_targets_loader,
            **(
                {"target_clients_loader": target_clients_loader}
                if target_clients_loader is not None
                else {}
            ),
        )
        _session.start()
        return _session


def stop_live() -> None:
    global _session
    with _session_lock:
        if _session is not None:
            _session.stop()
            _session = None


def set_live_enabled(enabled: bool) -> None:
    """只切换智能逐项填表，不销毁会话和悬浮球。"""
    with _session_lock:
        if _session is not None and _session.is_running:
            _session.set_enabled(bool(enabled))


def live_status() -> dict[str, Any]:
    # 延迟导入：``live_multi`` 单向依赖本模块的 ``LiveSession``，模块级导入会成环。
    from .live_multi import MultiLiveSession

    with _session_lock:
        if _session is None:
            return {
                "running": False,
                "enabled": False,
                "field_label": "",
                "value": "",
                "status": "",
                "note": "",
                "source": "",
                "remember_field_key": "",
                "alternatives": [],
                "filled": 0,
                "remember_pending": None,
            }
        if isinstance(_session, MultiLiveSession):
            return dict(_session._active_state())
        return dict(_session.state)


def remember_live_choice(
    *,
    target_id: str,
    value: str,
    label: str = "",
    reuse: str = "general",
) -> bool:
    with _session_lock:
        if _session is None or not _session.is_running:
            return False
        return _session.remember_choice(
            target_id=target_id, value=value, label=label, reuse=reuse
        )


def is_live_running() -> bool:
    with _session_lock:
        return _session is not None and _session.is_running


__all__ = [
    "MAX_AI_CALLS",
    "POLL_INTERVAL_SECONDS",
    "IDLE_POLL_INTERVAL_SECONDS",
    "IDLE_AFTER_QUIET_TICKS",
    "LiveSession",
    "MultiLiveSession",
    "is_live_running",
    "live_status",
    "remember_live_choice",
    "set_live_enabled",
    "start_live",
    "stop_live",
]


def __getattr__(name: str) -> Any:
    """PEP 562：恢复「任何时候 ``from ...webform.live import MultiLiveSession`` 都可导入」的契约。

    ``live_multi`` 单向依赖本模块的 ``LiveSession``，模块级导入会成环；真实使用点
    （``start_live`` / ``live_status``）已在函数体内延迟导入，这里只兜住外部导入路径。
    """
    if name == "MultiLiveSession":
        from .live_multi import MultiLiveSession

        return MultiLiveSession
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
