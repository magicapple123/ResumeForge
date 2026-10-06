"""startchat 对话框形态与聊天输入框容器内兜底（从 test_boss_apply.py 拆出）。

``MarkerClient``/常量/state helper 留在主文件（test_boss_apply.py）。
"""
import pytest
from app.services.sites.base import SiteFailure
from app.services.sites.boss import BossAdapter
from app.services.sites.boss_apply import (
    _fill_greeting_script,
    _greeting_state_script,
    classify_submit_state,
)
from test_boss_apply import GREETING, JOB_URL, READY_WAIT, MarkerClient, _entry_rect

# ===== startchat 对话框形态（2026-09-20 真实发现：新会话不跳聊天页，详情页弹出打招呼对话框；
# 发送按钮是 div.send-message，不是 button）=====


def _startchat_dialog_state(**overrides):
    state = {
        "on_chat": False,
        "input_found": True,
        "found": True,
        "kind": "textarea",
        "position": "全栈工程师",
        "name": "中先生",
        "url": JOB_URL,
        "title": "岗位详情",
        "dialog": "打招呼 发送 已开启消息订阅",
    }
    state.update(overrides)
    return state


def test_fill_and_submit_supports_startchat_dialog_form():
    """新会话对话框形态：输入框在 .dialog-container 里、发送按钮是 .send-message、
    成功以"对话框关闭 / 已发送预览 / 预览含全文"之一判定。"""

    class DialogClient(MarkerClient):
        """对话流程全部发生在岗位详情页上（无导航）。"""

        def __init__(self):
            super().__init__(
                {
                    "rf:entry-rect": _entry_rect(),
                    "rf:greeting-state": _startchat_dialog_state(),
                    "rf:fill-greeting": {
                        "ok": True,
                        "matched": 1,
                        "value": GREETING,
                        "url": JOB_URL,
                        "title": "岗位详情",
                    },
                    # 点击发送后：对话框切到「已发送」预览态、草稿清空——真实页面里
                    # 这段判定由 _submit_state_script 的 JS 完成（对话框可见且含
                    # 「已发送」+ 草稿不再等于全文），这里直接给 JS 的**输出**。
                    "rf:submit-state": [
                        {
                            "url": JOB_URL,
                            "title": "岗位详情",
                            "captcha": False,
                            "login_required": False,
                            "sent_message": True,
                            "success": True,
                            "matched": 0,
                        },
                    ],
                }
            )
            # rf:chat-state 由等待循环使用：直接给对话框态（输入框已在）。
            self.responses.setdefault("rf:chat-state", [_startchat_dialog_state()])
            # rf:send-rect：对话框里的 div.send-message（可见、可用）。
            self.responses["rf:send-rect"] = [
                {
                    "found": True,
                    "disabled": False,
                    "matched": 1,
                    "label": "发送",
                    "x": 640.0,
                    "y": 420.0,
                    "width": 68,
                    "height": 28,
                    "url": JOB_URL,
                    "title": "岗位详情",
                }
            ]

    client = DialogClient()
    outcome = BossAdapter(ready_wait=READY_WAIT).fill_and_submit(
        client, {}, GREETING
    )

    assert outcome.success is True
    assert outcome.greeting_sent == GREETING


def test_dialog_draft_still_present_is_not_success():
    """对话框开着、草稿没发出去（state.success=False）——按失败处理并给诊断。"""
    state = {
        "url": JOB_URL,
        "title": "岗位详情",
        "success": False,
        "sent_message": False,
        "matched": 0,
    }
    with pytest.raises(SiteFailure):
        classify_submit_state(state, greeting=GREETING)


# ===== 聊天输入框的容器内兜底（2026-09-21）=====
#
# 站点改版时最先失效的是"靠类名找控件"。沟通入口与发送按钮早有文本兜底，输入框此前**只认
# 类选择器**——类名一改就整条投递流程失败，报的还是"页面结构可能已变化"这种没法自救的话。
# 现在的兜底刻意**只退到容器里**，绝不退成"页面上任意一个 textarea"：站点头部也有搜索框，
# 认错它的后果是把招呼语打进站点的搜索框，比"找不到、如实报错"糟得多。


def test_greeting_state_and_fill_share_one_input_finder():
    """填写与状态检查必须用**同一份**定位实现。各写一份的下场是"检查说找到了、填写却找不到"，
    而两边各自还能单独通过测试。"""
    state_script = _greeting_state_script()
    fill_script = _fill_greeting_script(GREETING)

    assert "const findChatInput" in state_script
    assert "const findChatInput" in fill_script
    # 整段定位逻辑（作用域、判定、兜底）必须逐字相同，而不只是"都叫这个名字"。
    def finder(script: str) -> str:
        return script.split("const CHAT_SCOPES")[1].split("const findChatInput")[0]

    assert finder(state_script) == finder(fill_script)
    # 状态检查要如实报出"是怎么找到的"，否则兜底生效时用户与我们都看不出发生过降级。
    assert "matched_by" in state_script
    assert "matched_by" in fill_script


def test_input_fallback_stays_inside_chat_containers():
    """兜底的作用域必须限定在聊天 / 对话框容器内 —— 这条是防止有人为了"更稳"把它放宽。"""
    script = _fill_greeting_script(GREETING)
    scopes = script.split("const CHAT_SCOPES = [")[1].split("];")[0]
    for scope in (".chat-container", ".dialog-wrap", "[class*=chat-]", "[class*=dialog]"):
        assert scope in scopes
    # 兜底查询走的是容器内的 box.querySelectorAll，而不是再来一次全局 document 查询。
    assert "box.querySelectorAll(" in script
    assert 'document.querySelectorAll("textarea' not in script


def test_container_fallback_refuses_plain_inputs():
    """**容器兜底只认 textarea / contenteditable，绝不接受 `<input>`。**

    这是 2026-09-21 在真实聊天页上撞出来的：聊天页没打开会话时根本没有输入框，而
    `.chat-container` 里躺着一个「搜索30天内的联系人」的 `<input class="boss-search-input">`
    ——可见、未禁用、尺寸正常。放宽到 input 就等于把招呼语打进站点的搜索框。"""
    script = _fill_greeting_script(GREETING)
    container_rule = script.split("const usableByContainer = ")[1].split("const findChatInput")[0]
    assert "isContentEditable" in container_rule
    assert "textarea" in container_rule
    assert "'input'" not in container_rule
    # 兜底查询本身也只列 textarea 与 contenteditable。
    assert 'box.querySelectorAll("textarea, [contenteditable=' in script


def test_selector_path_still_accepts_inputs_it_deliberately_matches():
    """收紧兜底不能顺手把既有能力也砍掉：选择器明确命中的输入框（可能是 `#chat-input`）照旧可用。"""
    script = _fill_greeting_script(GREETING)
    selector_rule = script.split("const usableBySelector = ")[1].split("const usableByContainer")[0]
    assert "tag === 'input'" in selector_rule


def test_search_looking_boxes_are_rejected_on_both_paths():
    """占位文案里写着"搜索/查找/search"的一律不认——两道闸都要有。"""
    script = _fill_greeting_script(GREETING)
    assert "looksLikeSearch" in script
    assert "'搜索'" in script and "'search'" in script
    basic = script.split("const basic = ")[1].split("const usableBySelector")[0]
    assert "looksLikeSearch(node)" in basic
