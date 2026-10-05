"""实时链路的 AI 兜底（从 test_webform_live.py 拆出）。

FakeLiveClient/raw_control 留在 test_webform_live.py；语义缓存的 autouse 清理
fixture 在本文件内重声明（import 不会传播 autouse 语义）。
"""
import asyncio
import json
import time

import pytest

from app.services.llm.base import LLMError
from app.services.webform import ai as ai_module
from app.services.webform import live as live_module
from app.services.webform.engine import Control
from app.services.webform.live import LiveSession

from test_webform_live import FakeLiveClient, raw_control

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


def test_ambiguous_name_context_is_not_presented_as_a_name_value():
    """多个字段候选时宁可让用户挑，也不能把本人姓名静默填进别的栏目。"""
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = _ai_session(client, provider, data={"name": "张三"})
    session.start()
    try:
        client.focus_on(raw_control(label="导师姓名"))
        session._tick()

        assert provider.calls == 0
        assert client.panels[-1]["status"] == "unmatched"
        assert client.panels[-1]["value"] == ""
        assert "未自动猜测" in client.panels[-1]["note"]
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
