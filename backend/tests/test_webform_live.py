"""「点哪个填哪个」：单控件建议与轮询会话。

这个模式与批量模式共用同一套匹配器、同一套"永不自动填"判据、同一套写入与回读校验——
测试的重点因此有两头：**单控件判定要对**，以及**它真的复用了那条路径**（而不是自己又写了
一份"填一个框"的实现）。
"""
import asyncio
import json
import re
import time

import pytest

from app.services.browser.cdp_client import CdpClient
from app.services.llm.base import LLMError
from app.services.webform import ai as ai_module
from app.services.webform import live as live_module
from app.services.webform.engine import Control
from app.services.webform.live import LiveSession, is_live_running, live_status, start_live, stop_live
from app.services.webform.service import suggest_for


class FakeLiveClient(CdpClient):
    """按脚本标记分派的假客户端；带一点状态，够跑完"聚焦 → 建议 → 接受 → 写入"一整轮。"""

    def __init__(self):
        self.installed = False
        self.seq = 0
        self.focus: dict | None = None
        self.accept: dict | None = None
        self.remember: dict | None = None
        self.panels: list[dict] = []
        self.written = ""
        self.expressions: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url="about:blank"):
        return "TAB"

    def send(self, method, params=None, *, timeout=None):
        return {}

    def set_file_input(self, selector, files, *, timeout=None):
        pass

    def close(self):
        pass

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        if "rf:live-listener" in expression:
            self.installed = True
            return '{"ok": true}'
        if "rf:live-uninstall" in expression:
            self.installed = False
            self.focus = None
            return "1"
        if "rf:live-state" in expression:
            return json.dumps(
                {
                    "seq": self.seq,
                    "control": self.focus,
                    "accept": self.accept,
                    "remember": self.remember,
                    "installed": self.installed,
                }
            )
        if "rf:live-panel" in expression:
            start = expression.index("window.__rfShowPanel(") + len("window.__rfShowPanel(")
            end = expression.index(");", start)          # 面板载荷到此为止
            self.panels.append(json.loads(expression[start:end]))
            return "1"
        # 这一条**必须排在 `rf:live-hide` 前面**：`"rf:live-hide" in "rf:live-hide-remember"`
        # 是真的，排后面的话「记住这条」的回执会被当成「填入」的回执、把 accept 也清掉。
        if "rf:live-hide-remember" in expression:
            self.remember = None
            return "1"
        if "rf:live-hide" in expression:
            self.accept = None
            return "1"
        if "rf:set-value" in expression:
            # 如实记住写进去的值——回读时要原样吐回来，否则会被（正确地）判成"未确认"。
            match = re.search(r"setter\.call\(el, (\".*?\")\);", expression)
            self.written = json.loads(match.group(1)) if match else ""
            return '{"ok": true, "value": %s}' % json.dumps(self.written, ensure_ascii=False)
        if "rf:read-back" in expression:
            return '{"ok": true, "value": %s}' % json.dumps(self.written, ensure_ascii=False)
        return None

    def focus_on(self, control: dict) -> None:
        self.focus = control
        self.seq += 1

    def remember_on(self, control: dict, value: str, *, label: str = "") -> None:
        """模拟用户点了面板上的「记住这条」——与 ``accept`` 是两个独立全局。"""
        self.remember = {
            "label": label or str(control.get("label") or ""),
            "value": value,
            "control": control,
            "selector": control.get("selector") or "",
        }


def raw_control(**overrides) -> dict:
    base = {
        "index": 0,
        "type": "text",
        "name": "",
        "label": "姓名",
        "placeholder": "",
        "aria_label": "",
        "required": False,
        "selector": '[data-rf-focus="1"]',
        "options": [],
        "nearby_text": "",
        "group": "",
        "value": "",
        "display": "",
        "checked": False,
    }
    base.update(overrides)
    return base


# ===== 单控件建议 =====


def test_a_plain_field_gets_a_value():
    suggestion = suggest_for(Control(index=0, type="text", label="姓名"), {"name": "张三"})
    assert suggestion.status == "matched"
    assert suggestion.field_label == "姓名"
    assert suggestion.value == "张三"


def test_denylisted_controls_are_blocked_with_the_reason_not_silently_skipped():
    suggestion = suggest_for(Control(index=0, type="text", label="验证码"), {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "验证码" in suggestion.note


@pytest.mark.parametrize("label", ["我已阅读并同意隐私政策", "无实习经历", "接受其他职位调剂"])
def test_consent_and_declaration_controls_are_blocked(label):
    """同意项代勾是替用户做法律意义上的同意；声明项是替他陈述事实。两类都不给「填入」。"""
    control = Control(index=0, type="checkbox", label=label, nearby_text=label)
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"


def test_a_factual_radio_is_not_blocked_for_being_a_radio():
    """**事实类的单选不再因为"它是单选"被挡**——分界在"是不是替你表态"，不在控件类型。

    实时模式实际不会把选择框报进焦点（注入脚本的 `allowed` 白名单里没有它们），所以这条
    守的是**判据本身**：将来若把选择框放进来，性别这种该填的不会被误挡。

    **只断言状态，不断言值**：单选的"选哪个"要靠**同组兄弟**才定得下来（页面上是「男」
    「女」两个 radio），而 `suggest_for` 是单控件接口、拿不到兄弟——值恒为空。带兄弟的
    那条链在批量预览里，值由 `test_a_matched_factual_radio_is_still_filled` 覆盖。
    真要把选择框接进实时模式，`suggest_for` 需要能拿到同组控件，那是另一件事。
    """
    control = Control(index=0, type="radio", label="男", nearby_text="性别 男 女")
    suggestion = suggest_for(control, {"gender": "男"})
    assert suggestion.status == "matched"
    assert suggestion.field == "gender"


def test_an_unmatched_choice_control_is_your_call_not_unrecognized():
    """没匹配上的选择框**不是"没认出来"**：目录里没有"勾选值"这种字段，
    「接受其他职位调剂」这类本来就该由用户表态。措辞与批量模式保持一致。"""
    control = Control(
        index=0, type="checkbox", label="接受其他职位调剂", nearby_text="接受其他职位调剂"
    )
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "自己点" in suggestion.note


def test_relative_fields_are_blocked_as_someone_elses_information():
    control = Control(index=0, type="text", nearby_text="请输入您父亲的姓名")
    suggestion = suggest_for(control, {"name": "张三"})
    assert suggestion.status == "blocked"
    assert "别人" in suggestion.note


def test_a_dial_code_box_is_recognized_by_its_own_current_value():
    """区号框只看文本认不出——它的旁文里反而含「手机号码*」，会被建议填完整手机号
    （字节页面上实测到的）。而"框里现在就是个国际区号"是它自己说的，比旁文硬。"""
    control = Control(index=0, type="text", value="+86", nearby_text="+86 +86 手机号码*")
    data = {"phone": "13800000000", "phone_country_code": "+86"}

    suggestion = suggest_for(control, data)

    assert suggestion.field == "phone_country_code"
    assert suggestion.value == "+86"


def test_a_dial_code_box_is_not_guessed_when_the_profile_has_none():
    control = Control(index=0, type="text", value="+86", nearby_text="+86 +86 手机号码*")
    suggestion = suggest_for(control, {"phone": "13800000000"})
    assert suggestion.field != "phone_country_code"


def test_an_unknown_control_is_reported_as_unrecognized():
    suggestion = suggest_for(Control(index=0, type="text", label="某某编号"), {"name": "张三"})
    assert suggestion.status == "unmatched"


def test_a_select_suggestion_carries_the_option_value_not_the_label():
    from app.services.webform.engine import SelectOption

    control = Control(
        index=0,
        type="select",
        label="学历",
        options=(SelectOption("3", "本科"), SelectOption("4", "硕士")),
    )
    suggestion = suggest_for(control, {"degree": "本科"})
    assert suggestion.status == "matched"
    assert suggestion.value == "3"


# ===== 会话 =====


def test_starting_installs_the_listener_and_stopping_removes_it():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})

    session.start()
    assert client.installed is True
    assert session.is_running is True

    session.stop()
    assert client.installed is False
    assert session.is_running is False


def test_focusing_a_field_produces_a_panel_with_the_matching_value():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert client.panels[-1]["status"] == "matched"
        assert client.panels[-1]["value"] == "张三"
        assert client.panels[-1]["field_label"] == "姓名"
    finally:
        session.stop()


def test_the_panel_payload_carries_the_related_picks():
    """「可能是这几个」**跟着每一帧推送走**——命中 / 认不出 / AI 在想，那几个分支都会用到它。

    漏一帧那一栏就会空掉，而空掉的样子（整块不显示）与"确实没挑出来"**长得一模一样**，
    所以只有这条断言能区分。
    """
    client = FakeLiveClient()
    catalog = [{"group": "联系方式", "label": "当前所处地", "value": "天津", "key": "city"}]
    session = LiveSession(client, {"city": "天津"}, catalog)
    session.start()
    try:
        client.focus_on(raw_control(label="当前所处地"))
        session._tick()

        assert client.panels[-1]["status"] == "matched"
        assert [item["label"] for item in client.panels[-1]["related"]] == ["当前所处地"]
        assert [item["label"] for item in session.state["related"]] == ["当前所处地"]
    finally:
        session.stop()


def test_focusing_a_user_choice_control_clears_the_related_picks_too():
    """焦点离开可填控件时，推荐栏也要清掉——否则它挂在下一个框上指错方向。"""
    client = FakeLiveClient()
    catalog = [{"group": "联系方式", "label": "当前所处地", "value": "天津", "key": "city"}]
    session = LiveSession(client, {"city": "天津"}, catalog)
    session.start()
    try:
        client.focus_on(raw_control(label="当前所处地"))
        session._tick()
        assert session.state["related"], "前提不成立：上一帧就没有推荐"

        client.focus = None
        client.seq += 1
        session._tick()

        assert session.state["related"] == []
    finally:
        session.stop()


def test_focusing_a_user_choice_control_clears_the_panel():
    """焦点落到**不填**的控件上（单选/复选/下拉/附件）时，面板要清掉。

    注入脚本遇到这类控件会收掉面板并把焦点序号 +1，**但不带控件描述**——这里接住那个
    信号。"序号变了 + 没有控件"就是"用户点到了一个不填的框"。

    不清的话：浏览器里面板已经收了，而 ResumeForge 页面上还挂着上一条"将填入：姓名=张三"，
    两边对不上；用户回到浏览器看见的又是一片空白，只会以为程序卡住了。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        assert session.state["status"] == "matched"

        # 用户点到了一个单选框：页面侧 `__rfFocus` 被清成 null、序号 +1。
        client.focus = None
        client.seq += 1
        session._tick()

        assert session.state["status"] == ""
        assert session.state["field_label"] == ""
        assert session.state["value"] == ""
        assert session.state["note"] == ""
    finally:
        session.stop()


def test_the_same_field_is_not_recomputed_on_every_poll():
    """轮询每 350ms 一次；只有焦点真的变了才重算，否则会把页面刷爆。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        first = len(client.panels)

        session._tick()
        session._tick()

        assert len(client.panels) == first, "焦点没变却又算了一遍"
    finally:
        session.stop()


def test_accepting_writes_through_the_same_path_as_the_bulk_mode():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()

        # 走的是 service.apply_fill：同样的哑执行器 + 回读校验。
        joined = "\n".join(client.expressions)
        assert "rf:set-value" in joined
        assert "rf:read-back" in joined
        assert client.panels[-1]["status"] == "filled"
        assert session.state["filled"] == 1
    finally:
        session.stop()


def test_a_failed_write_is_reported_rather_than_claimed_as_done():
    class ReadbackMismatch(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            if "rf:read-back" in expression:
                self.expressions.append(expression)
                return '{"ok": true, "value": "别的东西"}'
            return super().evaluate(expression, timeout=timeout)

    client = ReadbackMismatch()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()

        assert client.panels[-1]["status"] == "blocked"
        assert session.state["status"] == "failed"
        assert session.state["filled"] == 0
    finally:
        session.stop()


def test_the_accept_flag_is_cleared_so_a_click_is_not_replayed():
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        client.accept = {"value": "张三"}
        session._tick()
        filled_once = session.state["filled"]

        session._tick()

        assert session.state["filled"] == filled_once, "同一次点击被重复执行了"
    finally:
        session.stop()


# ===== 单例 =====


def test_only_one_session_can_run_at_a_time():
    client = FakeLiveClient()
    try:
        first = start_live(client, {"name": "张三"})
        second = start_live(client, {"name": "张三"})
        assert first is second
        assert is_live_running() is True
        assert live_status()["running"] is True
    finally:
        stop_live()
    assert is_live_running() is False
    assert live_status()["running"] is False


def test_stop_is_safe_when_nothing_is_running():
    stop_live()
    stop_live()
    assert is_live_running() is False


def test_the_poller_survives_a_page_that_went_away():
    """用户在轮询期间关掉标签页 / 跳走了——单轮失败不该让会话整个垮掉。"""

    class Exploding(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            self.expressions.append(expression)
            if "rf:live-state" in expression:
                raise RuntimeError("target closed")
            return super().evaluate(expression, timeout=timeout)

    client = Exploding()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        # 异常在**主循环**里被接住：单轮失败只会记一条日志，会话继续活着
        # （用户在轮询期间关掉标签页或跳走是常事）。
        with pytest.raises(RuntimeError):
            session._tick()
        assert session.is_running is True
        assert live_module.POLL_INTERVAL_SECONDS > 0
    finally:
        session.stop()


def test_a_reloaded_page_gets_the_listener_reinstalled():
    """页面跳转/刷新会把注入的监听带走，会话要**自己发现并装回去**。

    真实故障：用户在 Edge 里开着「点哪个填哪个」，页面一跳转（SPA 整页跳转、登录回跳、
    或自己点了个链接），页面上的监听与面板就全没了——而会话仍然报告「运行中」，
    ResumeForge 那边也显示着"已开启"。用户点到哪个框都毫无反应，且**没有任何提示**
    能解释为什么。这条钉住自愈。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        assert client.installed is True

        # 模拟一次整页跳转：文档换了，注入的东西随之消失。
        client.installed = False
        client.focus = None
        session._seq = 7  # 旧文档留下的序号，新文档不会从 7 开始

        session._tick()

        assert client.installed is True, "页面跳转后应该重新装上监听"
        # 序号要归零：新文档的 __rfFocusSeq 从 0 开始，留着旧值可能正好撞上而漏掉第一次聚焦。
        assert session._seq == 0
    finally:
        session.stop()


def test_the_reinstall_also_pushes_the_catalog_again():
    """重装时要连「换个资料…」的清单一起送——新文档里那份也随旧文档没了。

    只装监听不送清单的话，用户跳转后第一次点「换个资料…」会看到**空列表**，
    而那看起来像"你的资料不见了"。
    """
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"}, [{"label": "姓名", "value": "张三"}])
    session.start()
    try:
        client.installed = False
        client.expressions.clear()

        session._tick()

        pushed = [e for e in client.expressions if "rf:live-catalog" in e]
        assert pushed, "重装时没有重新推送清单"
        assert "张三" in pushed[0]
    finally:
        session.stop()


def test_a_page_that_never_reports_installed_is_not_reinstalled_every_tick():
    """探测里**没有** ``installed`` 字段时不该每轮重装。

    （旧版注入脚本、或测试里的假客户端可能不返回这个字段。判据必须是 ``is False``
    而不是"假值"，否则每一轮都会白发一次注入。）
    """

    class NoFlag(FakeLiveClient):
        def evaluate(self, expression, *, timeout=None):
            if "rf:live-state" in expression:
                # 老形状：没有 installed 字段。
                return json.dumps({"seq": self.seq, "control": self.focus, "accept": self.accept})
            return super().evaluate(expression, timeout=timeout)

    client = NoFlag()
    session = LiveSession(client, {"name": "张三"})
    session.start()
    try:
        client.expressions.clear()
        session._tick()
        session._tick()

        assert not [e for e in client.expressions if "rf:live-listener" in e], (
            "探测没报 installed 时不该反复重装"
        )
    finally:
        session.stop()


# ===== AI 兜底 =====
#
# 实时链路上 AI 的接缝在 ``_on_focus``。这里守四件事：
# **只在真认不出时才问**、**不阻塞轮询**、**过期的答案丢掉**、**挂了要降级**。

AI_DATA = {"name": "张三", "research_direction": "分布式系统", "advisor": "王教授"}
# 一个**任何目录字段的同义词都够不到**的标签——规则认不出、留给 AI 的典型。
#
# 原先这里写的是「实验室名称」。2026-09-27 给「实验室」补了同义词之后它变得认得出了，
# 于是这五条"AI 兜底"的测试全都悄悄改了走法（不再问模型），红成一片。
# **换成一个没被收录的标签、而不是把同义词撤掉**：要测的是"认不出时交给 AI"这条机制，
# 机制没变，变的是"什么算认不出"。
UNKNOWN_LABEL = "所在部门意见"


class ScriptedProvider:
    """记录调用次数、按脚本回答的假模型。"""

    def __init__(self, reply=None, *, delay: float = 0.0, error: Exception | None = None):
        self.reply = {"matches": []} if reply is None else reply
        self.delay = delay
        self.error = error
        self.calls = 0

    async def chat(self, messages):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return json.dumps(self.reply)


def _ai_control(**overrides) -> Control:
    raw = raw_control(label=overrides.pop("label", UNKNOWN_LABEL))
    raw.update(overrides)
    control = LiveSession._build_control(raw)
    assert control is not None
    return control


def _ai_session(client, provider, data=None) -> LiveSession:
    return LiveSession(client, data or AI_DATA, provider=provider, ai_enabled=True)


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """语义缓存是模块级的，用例之间会互相串。"""
    ai_module.clear_cache()
    yield
    ai_module.clear_cache()


def test_the_model_is_asked_only_when_the_rules_come_up_empty():
    """规则能确定就不调用模型——**这是省钱那条纪律的落点**。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "advisor"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert client.panels[-1]["status"] == "matched"
        assert provider.calls == 0
    finally:
        session.stop()


def test_recognized_but_empty_does_not_waste_a_call():
    """认得出字段、只是资料里没填 → 提示去补，**不问模型**（问了也是白问）。"""
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider, data={"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="研究方向"))
        session._tick()

        assert provider.calls == 0
        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert "资料里还没填" in panel["note"]
        assert panel["field_label"] == "研究方向"
        assert panel["source"] == "rule"
    finally:
        session.stop()


def test_a_confidently_wrong_rule_match_is_not_rechecked_by_the_model():
    """**已知限制**：规则"自信但认错"时 AI 不会来纠正。

    「导师姓名」会被同义词「姓名」抢走，于是程序自信地建议填**本人**姓名。这不是本次引入
    的行为——AI 只在**规则认不出**时出手，而这类"认得出但认错"要靠「换个资料…」自己挑。

    把它写成用例是为了把现状摆在明处：哪天改了触发策略，这条会红，改的人就会看到这条权衡。
    """
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider, data={"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="导师姓名"))
        session._tick()

        assert provider.calls == 0
        assert client.panels[-1]["status"] == "matched"
        assert client.panels[-1]["value"] == "张三", "规则确实自信地填了本人姓名"
    finally:
        session.stop()


def test_an_ai_answer_becomes_the_panel_suggestion():
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "matched"
        assert panel["source"] == "ai"
        assert panel["field_label"] == "研究方向"
        assert panel["value"] == "分布式系统"
        assert "核对" in panel["note"]
        assert session.state["source"] == "ai"
    finally:
        session.stop()


def test_extra_candidates_are_listed_as_alternatives():
    """模型拿不准时给的 2、3 名要**列出来**，每一条在面板上自带「填入」。"""
    provider = ScriptedProvider(
        {
            "matches": [
                {"index": 0, "field": "research_direction"},
                {"index": 0, "field": "advisor"},
            ]
        }
    )
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["value"] == "分布式系统"
        assert panel["alternatives"] == [{"label": "导师", "value": "王教授"}]
    finally:
        session.stop()


def test_an_unfillable_candidate_gives_way_to_the_next_one():
    """模型只给了字段名——**能不能填仍由本地决定**。

    第 1 名"学历"用户资料里没有，于是由第 2 名顶上；填不了的那条不出现在面板上。
    """
    provider = ScriptedProvider(
        {
            "matches": [
                {"index": 0, "field": "degree"},
                {"index": 0, "field": "research_direction"},
            ]
        }
    )
    client = FakeLiveClient()
    session = _ai_session(client, provider, data=AI_DATA)  # 有 research_direction，没有 degree
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["field_label"] == "研究方向"
        assert panel["value"] == "分布式系统"
        assert panel["alternatives"] == [], "填不了的那条不该留在候选里"
    finally:
        session.stop()


def test_a_recognized_field_with_no_data_says_so_instead_of_offering_a_button():
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "advisor"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider, data={"name": "张三"})
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert panel["field_label"] == "导师"
        assert "资料里还没填" in panel["note"]
    finally:
        session.stop()


def test_a_value_the_page_cannot_take_says_that_instead():
    """资料里有值、但这个框装不下（下拉没有对应选项）——说法要与"资料里没有"分开。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "degree"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider, data={**AI_DATA, "degree": "本科"})
    session.start()
    try:
        control = _ai_control(
            type="select", options=[{"v": "1", "t": "一号实验室"}, {"v": "2", "t": "二号实验室"}]
        )
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert panel["field_label"] == "学历"
        assert "选项" in panel["note"]
        assert "资料里还没填" not in panel["note"]
    finally:
        session.stop()


def test_a_stale_answer_is_discarded():
    """答案回来时用户已经点到别的框了——**丢掉的这一份不能推**，
    否则面板上会显示上一个框的答案，看起来就像程序答错了。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        stale_seq = session._seq
        panels_before = len(client.panels)

        # 用户点到了别处
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        session._run_ai(stale_seq, control)

        assert len(client.panels) == panels_before + 1, "过期的那份也被推上面板了"
    finally:
        session.stop()


def test_a_failed_call_degrades_to_a_usable_panel():
    """模型挂了不该让这个框变成死路——面板要照常给出「换个资料…」这条路。"""
    provider = ScriptedProvider(error=LLMError("模型响应超时，请稍后重试"))
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        control = _ai_control()
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        session._run_ai(session._seq, control)

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert "换个资料" in panel["note"]
        assert session.is_running is True
    finally:
        session.stop()


def test_blocked_controls_never_reach_the_model():
    """密码与验证码是终局判定，**模型没有投票权**——顺序不能反。"""
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label="短信验证码", autocomplete="one-time-code"))
        session._tick()

        assert provider.calls == 0
        assert client.panels[-1]["status"] == "blocked"
    finally:
        session.stop()


def test_other_peoples_fields_never_reach_the_model():
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label="紧急联系人姓名"))
        session._tick()

        assert provider.calls == 0
        assert client.panels[-1]["status"] == "blocked"
    finally:
        session.stop()


def test_no_provider_means_the_ai_path_does_not_exist():
    """没配模型时**零调用**，行为与加这个功能之前一模一样。"""
    client = FakeLiveClient()
    session = LiveSession(client, AI_DATA, provider=None, ai_enabled=True)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()

        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert panel["source"] == ""
    finally:
        session.stop()


def test_the_switch_off_means_no_call_even_with_a_provider():
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = LiveSession(client, AI_DATA, provider=provider, ai_enabled=False)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()

        assert provider.calls == 0
        assert client.panels[-1]["status"] == "unmatched"
    finally:
        session.stop()


def test_the_call_budget_is_capped(monkeypatch):
    """**这是钱**。这是那道闸本身。"""
    monkeypatch.setattr(live_module, "MAX_AI_CALLS", 2)
    session = _ai_session(FakeLiveClient(), ScriptedProvider())

    assert session._begin_ai_call() is True
    assert session._begin_ai_call() is True
    assert session._begin_ai_call() is False, "超出上限还在放行"
    assert session._ai_calls == 2, "被拒绝的那次不该也扣掉"


def test_an_exhausted_budget_says_so_and_asks_nothing(monkeypatch):
    """到顶之后**一次都不该再问**，而且说法要和"没开 AI"分得开。"""
    monkeypatch.setattr(live_module, "MAX_AI_CALLS", 0)
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()

        assert provider.calls == 0
        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert "次数已用完" in panel["note"]
        assert "换个资料" in panel["note"]
    finally:
        session.stop()


def test_an_unrecognized_field_still_points_at_the_picker():
    """没开 AI 时，认不出的框也要指向「换个资料…」——不会是死路。

    （"AI 在看"与"AI 没帮上忙"两种终态的措辞分别由 ``test_a_failed_call_degrades_to_a_usable_panel``
    与 ``test_an_exhausted_budget_says_so_and_asks_nothing`` 覆盖。面板上那个按钮本身是
    无条件渲染的，由 ``test_webform_js_canary`` 守。）
    """
    client = FakeLiveClient()
    session = LiveSession(client, AI_DATA, provider=None, ai_enabled=False)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()

        assert "没认出来" in client.panels[-1]["note"]
        assert "换个资料" in client.panels[-1]["note"]
    finally:
        session.stop()


def test_the_poll_loop_is_not_blocked_by_the_model():
    """**用户点到下一个框时面板必须立刻响应**。

    模型调用要 1~3 秒；若在 ``_on_focus`` 里同步等它，350ms 一轮的轮询会整个卡住，
    表现出来就是"点了没反应"。这条用例把「调用挪到工作线程」这件事钉住。
    """
    provider = ScriptedProvider(
        {"matches": [{"index": 0, "field": "research_direction"}]}, delay=1.5
    )
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        started = time.monotonic()
        session._tick()
        elapsed = time.monotonic() - started

        assert elapsed < 0.5, f"聚焦那次 tick 被模型调用卡住了（{elapsed:.2f}s）"
        assert client.panels[-1]["status"] == "ai_thinking", "没有先把面板切到「AI 在看」"
    finally:
        session.stop()


def test_the_answer_arrives_on_the_panel_after_the_delay():
    """异步那条路的另一端：等一会儿，答案真的会出现在面板上。"""
    provider = ScriptedProvider(
        {"matches": [{"index": 0, "field": "research_direction"}]}, delay=0.05
    )
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()

        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and session.state.get("status") != "matched":
            time.sleep(0.02)

        assert session.state["status"] == "matched", "结果没回到面板上"
        assert session.state["value"] == "分布式系统"
    finally:
        session.stop()


def test_a_pending_answer_is_not_pushed_after_stopping():
    """停用之后不该再往页面上推东西——用户已经看不到那个面板了。"""
    provider = ScriptedProvider(
        {"matches": [{"index": 0, "field": "research_direction"}]}, delay=0.3
    )
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    client.focus_on(raw_control(label=UNKNOWN_LABEL))
    session._tick()
    panels_before = len(client.panels)

    session.stop()
    time.sleep(0.5)

    assert len(client.panels) == panels_before


def test_repeated_focus_on_the_same_field_costs_one_call():
    """来回点同一个框不该反复付钱——语义缓存挡在前面。"""
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    client = FakeLiveClient()
    session = _ai_session(client, provider)
    session.start()
    try:
        # 直接调 `_run_ai` 而不走 `_tick`：走 `_tick` 会把同一个控件再排给工作线程，
        # 那条路与这里并发，缓存就变成"两边同时未命中"了——那是测试自己造出来的竞态，
        # 生产里这个函数只有工作线程一个调用者。
        control = _ai_control()
        for _ in range(3):
            session._run_ai(session._seq, control)

        assert provider.calls == 1
    finally:
        session.stop()


def test_live_module_exposes_a_single_lock_for_the_session():
    """两个会话会往同一个页面里各显示各的面板——所以单例的互斥必须存在。"""
    assert hasattr(live_module, "_session_lock")


# ===== 「记住这条」（2026-09-27）=====
#
# 用户在「点哪个填哪个」里按「记住这条」：把这个框的值记进「网申资料」，下次遇到同类的框
# 就能自动填。**包括资料里没值的框**（认得出、但 profile 里是空的）——那正是这个按钮最
# 有用的地方：用户现场看到一个自己从没录过的栏目，顺手就能补进本地资料。
#
# 这里只测 Python 侧（``_on_remember``）。JS 那半在 test_webform_js_canary.py 里真机跑。


def _remember_session(client, data=None, **kwargs) -> tuple[LiveSession, list[dict]]:
    """起一个带落库回调的会话，回调把每次写入记进列表并回报成功。"""
    saved: list[dict] = []

    def store(entry: dict[str, str]) -> bool:
        saved.append(entry)
        return True

    session = LiveSession(client, data if data is not None else AI_DATA, store=store, **kwargs)
    return session, saved


def test_remembering_a_recognized_field_uses_its_catalog_key():
    """**认得出的字段按目录 key 记**——这是它下次还能自动填的前提。

    走 ``CUSTOM_`` 的话下次只有标签一个信号，匹配不上；只有落在目录 key 上，背后那
    五到十个同义词才用得上。
    """
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert saved == [{"key": "height", "label": "身高(cm)", "value": "178"}]
        assert "已记住" in client.panels[-1]["note"]
    finally:
        session.stop()


def test_remembering_an_unrecognized_field_uses_a_custom_key():
    """**认不出的**用控件自己的话规范成 ``CUSTOM_*``：存得下、看得见、能手填。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label=UNKNOWN_LABEL)
        client.focus_on(control)
        client.remember_on(control, "同意")
        session._tick()

        assert len(saved) == 1
        assert saved[0]["key"].startswith("CUSTOM_")
        assert UNKNOWN_LABEL in saved[0]["key"]
        assert saved[0]["label"] == UNKNOWN_LABEL
        assert saved[0]["value"] == "同意"
    finally:
        session.stop()


def test_remembering_a_recognized_field_with_no_data_still_works():
    """**这是用户明确要的那一档**：认得出、但资料里没值（``missing_data``）也要能记。

    那个框在面板上说的是"去我的资料补一下"，用户就地按「记住这条」把它补进网申资料——
    比跳去另一屏录一遍顺手得多。
    """
    # AI_DATA 里有 advisor，这里换一个目录里有、但这份资料里没有的字段。
    client = FakeLiveClient()
    session, saved = _remember_session(client, data={"name": "张三"})
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        # 先确认它确实是"认得出但没值"
        suggest = suggest_for(
            LiveSession._build_control(control), {"name": "张三"}, engine=session._engine
        )
        assert suggest.status == "unmatched", "前提不成立：这个字段有值"

        client.remember_on(control, "178")
        session._tick()

        assert saved == [{"key": "height", "label": "身高(cm)", "value": "178"}]
    finally:
        session.stop()


def test_remembering_clears_the_intent_so_it_is_not_stored_twice():
    """记完要清掉标记，否则下一轮会把同一条**重复记一遍**。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()
        assert client.remember is None, "回执没有清掉标记"
        assert len(saved) == 1

        session._tick()  # 下一轮：标记已经清了，不该再记一次

        assert len(saved) == 1
    finally:
        session.stop()


def test_remembering_an_empty_value_is_ignored():
    """空值没什么可记的——库里"没有这一项"与"这一项是空的"是同一件事。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "   ")
        session._tick()

        assert saved == []
    finally:
        session.stop()


def test_remembering_without_a_store_says_so_instead_of_pretending():
    """没接上落库回调时**如实说记不了**，不静默假成功。

    假装成功比不显示更糟：用户以为记下了，下次填表却什么都没有，而且无从知道为什么。
    """
    client = FakeLiveClient()
    session = LiveSession(client, AI_DATA)  # 没有 store
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert "记不了" in client.panels[-1]["note"]
    finally:
        session.stop()


def test_a_store_failure_does_not_kill_the_poll_loop():
    """落库抛异常不能弄死轮询线程——那会让整个模式停止响应，而用户只按了个「记住」。"""
    client = FakeLiveClient()

    def broken_store(entry: dict[str, str]) -> bool:
        raise RuntimeError("库锁住了")

    session = LiveSession(client, AI_DATA, store=broken_store)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        client.remember_on(control, "178")
        session._tick()

        assert "没能记住" in client.panels[-1]["note"]
        # 轮询还活着：再走一轮不会抛。
        session._tick()
    finally:
        session.stop()


def test_remembering_keeps_the_suggestion_on_the_panel():
    """回执只改 ``note``，**不动 ``status``/``value``**。

    否则用户按一下「记住」，面板上那条建议就没了——他本来可能接着要按「填入」。
    """
    client = FakeLiveClient()
    session, _ = _remember_session(client)
    session.start()
    try:
        client.focus_on(raw_control(label="姓名"))
        session._tick()
        assert session.state["status"] == "matched"

        control = raw_control(label="姓名")
        client.remember_on(control, "张三")
        session._tick()

        assert session.state["status"] == "matched", "记住之后建议被清掉了"
        assert session.state["value"] == "张三"
    finally:
        session.stop()


def test_api_sessions_pause_for_an_explicit_memory_target_choice():
    """新的 API 会话不能默认覆盖资料，必须先把 pending 交给用户选择。"""
    client = FakeLiveClient()
    session, saved = _remember_session(client, require_memory_choice=True)
    session.start()
    try:
        control = raw_control(label="身高(cm)")
        client.focus_on(control)
        session._tick()
        client.remember_on(control, "178")
        session._tick()

        assert saved == []
        assert session.state["remember_pending"] == {
            "field_key": "height",
            "field_label": "身高(cm)",
            "value": "178",
            "control_label": "身高(cm)",
            "source": "rule",
        }

        assert (
            session.remember_choice(
                target_id="extra:height",
                value="178",
                label="身高(cm)",
                reuse="general",
            )
            is True
        )
        assert saved == [
            {
                "target_id": "extra:height",
                "key": "height",
                "value": "178",
                "label": "身高(cm)",
                "reuse": "general",
            }
        ]
        assert session.state["remember_pending"] is None
    finally:
        session.stop()


def test_live_session_refreshes_profile_data_before_the_next_focus():
    """另一个界面补资料后，下一次点框不能继续使用启动时的旧快照。"""
    client = FakeLiveClient()
    current = {"name": "张三"}

    def load_data():
        return dict(current), [{"group": "身份信息", "label": "姓名", "value": current["name"]}]

    session = LiveSession(client, current, data_loader=load_data)
    session.start()
    try:
        first = raw_control(label="姓名")
        client.focus_on(first)
        session._tick()
        assert client.panels[-1]["value"] == "张三"

        current["name"] = "李四"
        client.focus_on(raw_control(label="姓名"))
        session._tick()

        assert client.panels[-1]["value"] == "李四"
    finally:
        session.stop()
