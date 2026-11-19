# SPDX-License-Identifier: Apache-2.0
"""需求 3 / 问题 8：注入面板的取数范围开关与空态分句的**结构契约**。

为什么用脚本字符串断言而不是 canary：canary 家族在 CI 与并行跑下按契约恒 skip，
不是门禁。这里钉住的是"四段链路缺一不可"的骨架——页面开关注入、请求全局、
页面消费 `__rfSetScope`、空态按 `__rfFilteredSections` 分句。纯字符串比对不需要浏览器，
却能在任何一处被改回去时立刻变红。
"""

import time

import pytest
from app.services.webform import ai as ai_module
from app.services.webform import live_scripts
from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live import LiveSession
from app.services.webform.live_scripts import _scope_script
from app.services.webform.panel_copy import localize_panel
from app.services.webform.webform_copy import ui_text
from test_webform_live import FakeLiveClient, raw_control
from test_webform_live_ai import UNKNOWN_LABEL, ScriptedProvider

SECTIONS = [{"key": "education", "display": "教育经历"}]

# 清单里只有一条，但**值放在「全部资料」那一份**：这样"换范围之后建议有没有重算"
# 就能从面板状态上直接读出来，不必去猜内部走了哪条分支。
SCOPE_ROWS = [{"group": "身份信息", "label": "姓名", "value": "张三"}]


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    """焦点链路的语义缓存是模块级的，用例之间会互相串（与 test_webform_live_ai 同）。"""
    ai_module.clear_cache()
    yield
    ai_module.clear_cache()


def test_section_filtered_says_which_section_instead_of_profile_empty():
    """资料里有这块、只是当前方案没包含 → 说板块名，**不能**说成「资料里还没填」。

    与 ``test_webform_live_ai.test_recognized_but_empty_does_not_waste_a_call`` 成对：
    两句话分开正是问题 8 的全部意义。合并成一句时用户会去「我的资料」白找一遍，
    而正确的动作是切到「全部资料」。
    """
    provider = ScriptedProvider()
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"}, provider=provider, ai_enabled=True)
    session.update_data(
        {"name": "张三"},
        scope_info={
            "scope": "group",
            "filtered_sections": [{"key": "education", "name": "教育经历"}],
            "filtered_rows": [{"key": "laboratory", "group_key": "education"}],
        },
    )
    session.start()
    try:
        client.focus_on(raw_control(label="实验室"))
        session._tick()

        assert provider.calls == 0
        panel = client.panels[-1]
        assert panel["status"] == "unmatched"
        assert "当前方案未包含「教育经历」" in panel["note"]
        assert "资料里还没填" not in panel["note"]
    finally:
        session.stop()


def test_panel_carries_the_scope_switch():
    """1) 面板里得有「仅当前方案 / 全部资料」两档开关。"""
    assert 'class="scope"' in FOCUS_LISTENER_SCRIPT
    assert "仅当前方案" in FOCUS_LISTENER_SCRIPT
    assert "全部资料" in FOCUS_LISTENER_SCRIPT
    assert 'data-scope="group"' in FOCUS_LISTENER_SCRIPT
    assert 'data-scope="all"' in FOCUS_LISTENER_SCRIPT


def test_clicking_the_switch_only_sets_a_request_global():
    """2) 面板只置请求全局；范围参数必须进快照构造，不能由面板自己换数据。"""
    assert "window.__rfScopeRequest = button.dataset.scope" in FOCUS_LISTENER_SCRIPT


def test_page_consumes_the_scope_pushed_by_python():
    """3) Python 推下来的范围与新板块清单要能被页面接住。"""
    script = _scope_script("all", SECTIONS)
    assert "window.__rfScope = payload.scope" in script
    assert "window.__rfFilteredSections = payload.filtered_sections" in script
    assert "__rfSetScope" in script
    assert "教育经历" in script
    assert "__rfSetScope" in FOCUS_LISTENER_SCRIPT


def test_state_poll_reports_the_scope_request():
    """开关请求必须并进已有的状态探测里——否则 Python 侧永远读不到它。"""
    assert "scope_request: window.__rfScopeRequest || null" in live_scripts._STATE_SCRIPT


def test_empty_state_speaks_by_reason():
    """4) 空态按原因分句，且两句都在（问题 8 的意义就是把它们分开）。"""
    assert "当前方案未包含「${filteredNames.join('、')}」，切到「全部资料」就能填" in (
        FOCUS_LISTENER_SCRIPT
    )
    assert "资料还是空的，先去「我的资料」填一些" in FOCUS_LISTENER_SCRIPT
    assert "__rfFilteredSections" in FOCUS_LISTENER_SCRIPT


def test_out_of_scope_badge_is_separate_from_the_webform_badge():
    """「方案外」与「网申资料」是两个角标，不能混成一个。"""
    assert "item.out_of_scope === '1'" in FOCUS_LISTENER_SCRIPT
    assert "方案外" in FOCUS_LISTENER_SCRIPT
    # 网申专用项的角标仍然只认 `source === 'extra'`（不受组过滤，不打「方案外」）。
    assert "item.source === 'extra'" in FOCUS_LISTENER_SCRIPT


def test_english_panel_copy_covers_every_new_sentence():
    """英文界面不能留中文开关/角标/空态；中文界面必须逐字不变。"""
    english = localize_panel(FOCUS_LISTENER_SCRIPT, "en-US")
    for text in ("Current plan only", "All data", "Data range", "Outside plan"):
        assert text in english
    assert "current resume plan leaves out" in english
    assert "Current plan only" not in FOCUS_LISTENER_SCRIPT
    assert localize_panel(FOCUS_LISTENER_SCRIPT, "zh-CN") == FOCUS_LISTENER_SCRIPT


def test_note_copy_keeps_the_two_reasons_apart():
    """后端下发的两条 note 各说各的原因，且英文都有译文。"""
    filtered = ui_text("zh-CN", "note.sectionFiltered", section="教育经历")
    empty = ui_text("zh-CN", "note.recognizeNoValue", label="实验室")
    assert "当前方案未包含「教育经历」" in filtered
    assert "资料里还没填" in empty
    assert "资料里还没填" not in filtered
    assert "当前方案未包含" not in empty
    assert "resume plan leaves out" in ui_text("en-US", "note.sectionFiltered", section="Education")
    assert "no value" in ui_text("en-US", "note.recognizeNoValue", label="Laboratory")


# ===== 换范围之后：点下去立刻有反馈 + 当前字段跟着重算 =====


def _scoped_session(client: FakeLiveClient, *, provider=None, ai_enabled: bool = False):
    """按"当前范围"出数的会话：只有「全部资料」那份才带姓名。

    值分档放是为了让断言能直接读面板——换范围到底有没有重算当前字段，看 ``value``
    从空变成"张三"就是答案，不必去猜内部走了哪条分支。
    """
    scopes: list[str] = []

    def loader():
        scope = scopes[-1] if scopes else "group"
        data = {"research_direction": "分布式系统"}
        if scope == "all":
            data["name"] = "张三"
        return (
            data,
            SCOPE_ROWS,
            {"scope": scope, "filtered_sections": [], "filtered_rows": []},
        )

    session = LiveSession(
        client,
        {},
        catalog=SCOPE_ROWS,
        provider=provider,
        ai_enabled=ai_enabled,
        data_loader=loader,
        scope_setter=scopes.append,
    )
    return session, scopes


def test_switching_scope_recomputes_the_focused_field():
    """**"错乱"的根治**：换的只是资料，焦点那个框没变，所以必须拿新资料重算一遍。

    不重算的话面板上仍是旧范围下的结论——开关写着「全部资料」、建议还写着"资料里
    还没填"，两句话互相打脸。
    """
    client = FakeLiveClient()
    session, scopes = _scoped_session(client)
    session._attach()
    client.focus_on(raw_control(label="姓名"))
    session._tick()
    assert client.panels[-1]["status"] == "unmatched"
    assert client.panels[-1]["value"] == ""

    before = len(client.panels)
    session.request_scope("all")

    assert scopes == ["all"]
    assert len(client.panels) > before, "换代后没有重发当前字段的面板"
    panel = client.panels[-1]
    assert panel["field_label"] == "姓名"
    assert panel["status"] == "matched"
    assert panel["value"] == "张三"


def test_switching_scope_never_downgrades_an_ai_verdict():
    """AI 判过的屏**不因换范围降级**：保留模型给的值与来源，只让候选清单跟着新资料走。

    降级的后果是用户看到"换个范围把建议弄丢了"——而规则本来就认不出这个框，重算
    只会得到"没认出来"。同时这条守住"绝不重跑 AI"：一次开关点击不该花一次模型调用。
    """
    provider = ScriptedProvider({"matches": [{"index": 0, "field": "research_direction"}]})
    client = FakeLiveClient()
    session, _scopes = _scoped_session(client, provider=provider, ai_enabled=True)
    session.start()
    try:
        client.focus_on(raw_control(label=UNKNOWN_LABEL))
        session._tick()
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and session.state.get("value") != "分布式系统":
            time.sleep(0.02)
        assert session.state["source"] == "ai"
        assert session.state["value"] == "分布式系统"
        assert provider.calls == 1

        before = len(client.panels)
        session.request_scope("all")

        assert provider.calls == 1, "换范围重跑了一次模型调用"
        assert len(client.panels) > before, "换代后面板没有被重发"
        panel = client.panels[-1]
        assert panel["source"] == "ai", panel
        assert panel["value"] == "分布式系统", panel
    finally:
        session.stop()


def test_the_switch_paints_optimistically_and_rolls_back_without_ack():
    """点下去**当场**变色并挡住连点；2.5s 没等到回推就回滚到上一份已确认范围。

    轮询最快 350ms、慢档 1.5s——在此之前按钮毫无变化，用户看到的就是"点了没反应"。
    """
    assert "paintScope(button.dataset.scope)" in FOCUS_LISTENER_SCRIPT
    assert "setScopePending(true)" in FOCUS_LISTENER_SCRIPT
    assert "elScope.setAttribute('aria-busy', 'true')" in FOCUS_LISTENER_SCRIPT
    assert "elScope.removeAttribute('aria-busy')" in FOCUS_LISTENER_SCRIPT
    assert "button.disabled = !!pending" in FOCUS_LISTENER_SCRIPT
    assert "SCOPE_PENDING_MS = 2500" in FOCUS_LISTENER_SCRIPT
    # 回推到了要**停表**，否则 2.5s 后那次回滚会把刚确认的新档画回旧档。
    assert "clearScopePending();" in FOCUS_LISTENER_SCRIPT
    # 回滚时按 `__rfScope`（上一份已确认值）重画，不是按用户点的那个。
    assert "paintScope();" in FOCUS_LISTENER_SCRIPT


def test_rebuilding_the_list_keeps_the_scroll_position():
    """整块重建（几百行）不能把用户滚到的位置弄丢；搜索词与命中数照常重算。"""
    assert "const keepScroll = elList.scrollTop;" in FOCUS_LISTENER_SCRIPT
    # 两处出口都要回写：空态分支早退，另一处是正常结尾。
    assert FOCUS_LISTENER_SCRIPT.count("elList.scrollTop = keepScroll;") == 2
    assert "renderList(elSearch.value)" in FOCUS_LISTENER_SCRIPT
    assert "elHits.textContent = needle ?" in FOCUS_LISTENER_SCRIPT
