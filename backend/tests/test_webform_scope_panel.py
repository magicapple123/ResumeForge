# SPDX-License-Identifier: Apache-2.0
"""需求 3 / 问题 8：注入面板的取数范围开关与空态分句的**结构契约**。

为什么用脚本字符串断言而不是 canary：canary 家族在 CI 与并行跑下按契约恒 skip，
不是门禁。这里钉住的是"四段链路缺一不可"的骨架——页面开关注入、请求全局、
页面消费 `__rfSetScope`、空态按 `__rfFilteredSections` 分句。纯字符串比对不需要浏览器，
却能在任何一处被改回去时立刻变红。
"""

import pytest
from app.services.webform import ai as ai_module
from app.services.webform import live_scripts
from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live import LiveSession
from app.services.webform.live_scripts import _scope_script
from app.services.webform.panel_copy import localize_panel
from app.services.webform.webform_copy import ui_text
from test_webform_live import FakeLiveClient, raw_control
from test_webform_live_ai import ScriptedProvider

SECTIONS = [{"key": "education", "display": "教育经历"}]


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
