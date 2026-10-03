"""「点哪个填哪个」的页面注入脚本构造（状态轮询 / 面板 / 回执 / 清理），纯字符串、零状态。"""
from __future__ import annotations

import json
from typing import Any

# 读取页面状态的脚本：一次往返把需要的都取回来。
# 每一轮都问页面四件事：焦点变了没有、用户点了「填入」没有、用户点了「记住这条」没有、
# **监听还在不在**。
#
# 第四个是必须的：注入的监听与面板活在**当前文档**里，页面一旦跳转或刷新就全没了
# （SPA 的整页跳转、登录回跳、用户自己点了个链接都算）。没有这一项时，会话会一直
# 报告「运行中」而页面上其实什么都没有——用户点哪个框都毫无反应，且得不到任何提示。
# 把它并进这条本来就有的探测里，**不多花一次往返**。
#
# `accept` 与 `remember` 是**两个独立的全局**，不能合成一个"用户点了按钮"的事件：一个是
# "把这个值写进页面"，一个是"记进本地资料"。合成一个的话，Python 只能靠猜来区分。
_STATE_SCRIPT = (
    "(() => { /* rf:live-state */ return JSON.stringify({"
    " seq: window.__rfFocusSeq || 0,"
    " control: window.__rfFocus || null,"
    " accept: window.__rfAccept || null,"
    " remember: window.__rfRemember || null,"
    " live_control: window.__rfLiveControl || null,"
    " installed: window.__rfInstalled === true"
    ", autofill: window.__rfAutoFillRequest || null"
    ", autofill_status: window.__rfAutoFillStatus || null"
    ", assistant_ask: window.__rfAssistantAsk || null"
    " }); })()"
)

_HIDE_SCRIPT = "(() => { /* rf:live-hide */ window.__rfAccept = null; return '1'; })()"

# 「记住这条」的回执：**与「填入」分开一条**，因为清掉的全局不同。用同一条脚本清两个的话，
# 点了「记住」会顺手把还没处理的「填入」也吞掉。
_HIDE_REMEMBER_SCRIPT = (
    "(() => { /* rf:live-hide-remember */ window.__rfRemember = null; return '1'; })()"
)

# 停用：撤掉监听、面板、标记与全局变量，不在别人的页面上留东西。
_UNINSTALL_SCRIPT = (
    "(() => { /* rf:live-uninstall */"
    " return (window.__rfUninstall ? window.__rfUninstall() : '1'); })()"
)


def _show_panel_script(payload: dict[str, Any]) -> str:
    """把面板内容塞进页面。**用 JSON.stringify 转义**，避免用户资料里的引号破坏脚本。"""
    return f"(() => {{ /* rf:live-panel */ window.__rfShowPanel({json.dumps(payload)}); return '1'; }})()"


def _catalog_script(catalog: list[dict[str, str]]) -> str:
    """把"给人挑"的清单推进页面。**用 JSON 转义**，用户资料里的引号破坏不了脚本。"""
    return (
        "(() => { /* rf:live-catalog */"
        f" window.__rfCatalog = {json.dumps(catalog, ensure_ascii=False)};"
        " return '1'; })()"
    )


def _clear_state_script() -> str:
    return (
        "(() => { /* rf:live-clear */"
        " window.__rfAccept = null; window.__rfAutoFillRequest = null;"
        " window.__rfAutoFillStatus = {state:'idle', total:0, completed:0, filled:0, failed:0};"
        " window.__rfSetAutoFillStatus && window.__rfSetAutoFillStatus(window.__rfAutoFillStatus);"
        " window.__rfHidePanel && window.__rfHidePanel(); return '1'; })()"
    )


_ACK_AUTOFILL_SCRIPT = (
    "(() => { /* rf:autofill-ack */ window.__rfAutoFillRequest = null; return '1'; })()"
)

# 「问投投」的回执：先清掉问题全局再交给后台线程处理，否则轮询的 350ms 里问题还在，
# 下一轮会当成新问题再问一遍模型（那可是真金白银）。
_ACK_ASSISTANT_ASK_SCRIPT = (
    "(() => { /* rf:assistant-ack */ window.__rfAssistantAsk = null; return '1'; })()"
)

