# SPDX-License-Identifier: Apache-2.0
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
    # 面板顶部的范围开关只置请求全局；**必须**并进这条已有探测，否则 Python 侧
    # ``payload.get("scope_request")`` 恒为 None，点了开关什么都不会发生。
    ", scope_request: window.__rfScopeRequest || null"
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

# ── 取数范围（需求 3：仅当前方案 / 全部资料）────────────────────────────
# 面板顶部那个分段开关只置一个请求全局 `__rfScopeRequest`，由 Python 侧消费并立刻换代
# ——范围参数必须进**快照构造**，不能让面板自己按另一份数据渲染（"清单按全部、预填按
# 当前组"正是要避免的形态）。回执清掉请求，避免 350ms 轮询里重复触发。
_ACK_SCOPE_SCRIPT = (
    "(() => { /* rf:scope-ack */ window.__rfScopeRequest = null; return '1'; })()"
)


def _scope_script(scope: str, sections: list[dict[str, str]]) -> str:
    """把当前范围与「被组过滤的板块」推给页面（面板开关状态 + 空态原因都靠它）。

    **用 JSON 转义**：板块名来自用户自建板块，带引号也不会破坏脚本。
    优先调用页面实现的 ``__rfSetScope``；页面还没装监听时退回写全局，下一轮面板
    重新渲染仍能读到同一份数据（不会出现"开关显示了、数据没换"的错位）。
    """
    payload = json.dumps(
        {"scope": scope, "filtered_sections": list(sections)}, ensure_ascii=False
    )
    return (
        "(() => { /* rf:live-scope */"
        f" const payload = {payload};"
        " window.__rfScope = payload.scope;"
        " window.__rfFilteredSections = payload.filtered_sections;"
        " if (window.__rfSetScope) window.__rfSetScope(payload.scope, payload.filtered_sections);"
        " return '1'; })()"
    )


def _filtered_script(payload: dict[str, Any]) -> str:
    """只推送「被组过滤的板块」清单（范围没变、板块成员变了时用）。

    与 ``_scope_script`` 分开：范围切换要换整份资料，而成员变化只需要让空态换一句
    话——把两者合成一条会让"改了一个板块的开关"触发一次全量重取。
    """
    sections = json.dumps(list(payload.get("filtered_sections") or []), ensure_ascii=False)
    return (
        "(() => { /* rf:live-filtered */"
        f" window.__rfFilteredSections = {sections};"
        " return '1'; })()"
    )

