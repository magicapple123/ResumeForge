# SPDX-License-Identifier: Apache-2.0
"""注入到专用浏览器的脚本文案：中文原样、英文不漏中文。

覆盖三个注入面（悬浮球菜单 / 焦点面板 / 「记住这条」编辑器）与 Python 侧回写到面板的
状态文案。判据只有两条，都是用户能直接看到的：

1. ``zh-CN`` 渲染结果与改造前**逐字一致**（源语言不能被"翻译"改坏）；
2. ``en-US`` 渲染结果里不再出现下面这些界面文案（用户截图里露出来的就是它们）。

注释里的中文不参与判定：注入脚本带大量实现说明，翻不翻都不影响界面。
"""

from __future__ import annotations

import pytest
from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live_control import install_live_control_script
from app.services.webform.live_memory_panel import REMEMBER_EDITOR_SCRIPT, remember_editor_script
from app.services.webform.panel_copy import localize_panel
from app.services.webform.webform_copy import locale_key, ui_text

# 用户截图里出现的界面文案（英文界面下必须消失）。
_ZH_UI_COPY = (
    "当前页面助手",
    "仅填写，不替你提交",
    "自动填写当前页面",
    "问历历",
    "收起问答",
    "发送",
    "历历思考中",
    "分组快速定位",
    "搜索资料（如",
    "可拖动标题栏调整位置",
    "换个资料",
    "记住这条",
    "已填入",
    "使用上方字段名",
    "尚未填写",
    "保存这条",
)


def test_chinese_rendering_is_byte_identical() -> None:
    """源语言不许被"翻译"动过：三条脚本都要与模块级常量逐字相同。"""
    assert localize_panel(FOCUS_LISTENER_SCRIPT, "zh-CN") == FOCUS_LISTENER_SCRIPT
    assert install_live_control_script(True, "zh-CN") == install_live_control_script(True)
    assert remember_editor_script("zh-CN") == REMEMBER_EDITOR_SCRIPT


def _without_comments(script: str) -> str:
    """去掉纯注释行：注入脚本带大量实现说明，中文注释不影响用户看到的界面。"""
    return "\n".join(
        line for line in script.splitlines() if not line.lstrip().startswith(("//", "/*", "*"))
    )


@pytest.mark.parametrize(
    "render",
    [
        lambda: localize_panel(FOCUS_LISTENER_SCRIPT, "en-US"),
        lambda: install_live_control_script(True, "en-US"),
        lambda: remember_editor_script("en-US"),
    ],
    ids=["panel", "ball", "memory"],
)
def test_english_rendering_has_no_chinese_ui_copy(render) -> None:
    script = render()
    visible = _without_comments(script)
    leaked = [phrase for phrase in _ZH_UI_COPY if phrase in visible]
    assert leaked == []
    # 占位符必须被渲染掉：漏一个用户就会看到 `%%copy:xxx%%`。
    assert "%%copy:" not in script


def test_english_rendering_keeps_the_expected_labels() -> None:
    panel = localize_panel(FOCUS_LISTENER_SCRIPT, "en-US")
    assert "Fill" in panel
    assert "Remember this" in panel
    assert "Jump to a group" in panel
    ball = install_live_control_script(True, "en-US")
    assert "Page assistant" in ball
    assert "Fill this page" in ball
    memory = remember_editor_script("en-US")
    assert "Where to save" not in memory  # 键名不是文案，别把断言写成实现的镜像
    assert "Save" in memory


def test_unknown_locale_falls_back_to_source_language() -> None:
    assert locale_key("fr-FR") == "zh-CN"
    assert locale_key(None) == "zh-CN"
    assert locale_key("en-GB") == "en-US"
    assert ui_text("fr-FR", "panel.fill") == "填入"


def test_python_side_notes_follow_the_locale() -> None:
    assert ui_text("en-US", "note.filled") == "Filled in — please check"
    assert ui_text("zh-CN", "note.filled") == "已填入，请核对"
    # 带参数的那几条不能把 {placeholders} 留在界面上
    assert "{note}" not in ui_text("en-US", "note.pickFromList", note="No match")
    assert "{percent}" not in ui_text("en-US", "autofill.rate", percent=42)


def test_session_prefers_the_locale_captured_at_start() -> None:
    """开启会话时记下的语言优先：后台线程读同一个键时没有数据集身份，可能读到另一份设置。"""
    from app.services.webform.live import LiveSession

    class _Client:
        def evaluate(self, expression, timeout=None):  # pragma: no cover - 本用例不触发
            return "1"

    session = LiveSession(
        _Client(),
        {"name": "张三"},
        ui_locale="en-US",
        ui_locale_loader=lambda: "zh-CN",
    )
    assert session._locale() == "en-US"

    fallback = LiveSession(_Client(), {"name": "张三"}, ui_locale_loader=lambda: "en-US")
    assert fallback._locale() == "en-US"

    source = LiveSession(_Client(), {"name": "张三"})
    assert source._locale() == "zh-CN"


def test_both_session_types_accept_the_locale_keywords() -> None:
    """工厂把 ``ui_locale*`` 透传给两种会话：任一实现不接就会 500，面板直接起不来。

    2026-10-29 就这么挂过一次：``MultiLiveSession.__init__`` 漏了 ``ui_locale``，
    ``/api/webform/live/start`` 抛 TypeError，用户看到的是"提示卡片消失"。
    """
    import inspect

    from app.services.webform.live import LiveSession, MultiLiveSession, start_live

    forwarded = {"ui_locale", "ui_locale_loader"} & set(inspect.signature(start_live).parameters)
    assert forwarded == {"ui_locale", "ui_locale_loader"}
    for session_type in (LiveSession, MultiLiveSession):
        accepted = set(inspect.signature(session_type.__init__).parameters)
        assert forwarded <= accepted, session_type.__name__
