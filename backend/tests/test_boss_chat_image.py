# SPDX-License-Identifier: Apache-2.0
"""招呼语配图（三）：**真站实测复现**——发图前必须先回聊天页并选中本次投递的会话。

队列 #18 的真实投递里，文本招呼语送达成功、图片那一步 ``upload_failed``，诊断原文是
「页面里没有 input[type=file]……当前地址：https://www.zhipin.com/job_detail/….html」。
根因不是选择器写错：招呼语发完弹层就关了，页面停在**岗位详情页**，那里从来没有上传控件。
所以这里钉住三件事：

1. 不在聊天页时**先导航**到 ``/web/geek/chat``，再选中会话，最后才塞文件（顺序断言）；
2. 会话列表里找不到公司名 → **可诊断的失败**，且**绝不盲点第一条**（点错会把图片发给另一位
   招聘方，不可撤回）；
3. 已经在聊天页时**不**多发一次导航。

"点完会话条目不等于切换成功"这一支（2026-11-24 队列 #17 事故）在
``test_boss_chat_image_guard.py``；假件与常量在 ``chat_image_support.py``。

全程不碰网络、不碰真站：``ChatCdp`` 只按 cookie 化的页面状态回答探针，并按顺序记录动作。
真站仍未实测的两项（是否需要预览态二次确认、图片气泡的真实 class）见
``services/sites/boss_apply_image.py`` 开头，**本文件证明不了它们**。
"""

from __future__ import annotations

import re

import pytest
from app.models.apply import FAILURE_FILE_UPLOAD_FAILED
from app.services.sites.base import SiteFailure
from app.services.sites.boss_apply_image import _bubble_script, _image_probe_script
from app.services.sites.boss_chat_image import _chat_shell_script
from app.services.sites.boss_conversation_match import _user_list_script
from app.services.sites.boss_page import (
    CHAT_PAGE_URL,
    SELECTOR_CHAT_IMAGE_BUTTON,
    SELECTOR_CHAT_IMAGE_INPUT,
)
from chat_image_support import (
    CHAT_URL,
    COMPANY,
    FILES,
    ITEM_TEXT,
    JOB_URL,
    OTHER_ITEM,
    ChatCdp,
    upload,
)

# ===== 0. 页面脚本的语法前提：同一作用域不能重复声明 const =====

# 页面脚本只在浏览器里跑，本地测试正常也发现不了语法错误——真站上的表现会是"探测不到控件"，
# 而诊断里完全看不出原因。所以在这里逐脚本钉住那条最容易踩的规则。
_PAGE_SCRIPTS = {
    "chat_shell": _chat_shell_script,
    # R23：选会话的脚本要吃两个键（公司名 + 岗位名），这里也按双键构造，语法前提才盖得住。
    "chat_user_list": lambda: _user_list_script(COMPANY, "PC 服务工具开发工程师"),
    "image_probe": _image_probe_script,
    "image_bubble": _bubble_script,
}


@pytest.mark.parametrize("name", sorted(_PAGE_SCRIPTS))
def test_every_page_script_declares_each_const_only_once(name: str) -> None:
    """同一作用域重复 ``const`` 是 SyntaxError：脚本整体抛错，页面探针全废。

    真实踩过：``_image_probe_script`` 里加了一个和 ``_blocker_js`` 同名的 ``const shown``，
    整个脚本直接 SyntaxError（本地全绿，真站上"什么都找不到"）。
    """
    script = _PAGE_SCRIPTS[name]()
    # 只看脚本**顶层**的声明（恰好两格缩进）：嵌套块里的同名短变量（如循环里的 ``const r``）
    # 各自独立作用域，重复是合法的，不该被这条守卫误伤。
    declared = re.findall(r"^  const ([A-Za-z_$][\w$]*) =", script, re.MULTILINE)
    duplicates = sorted({word for word in declared if declared.count(word) > 1})
    assert duplicates == [], f"{name} 脚本里重复声明了 {duplicates}（页面上会直接 SyntaxError）"


# ===== 1. 顺序：导航到聊天页 → 点会话条目 → 塞文件 =====


def test_image_upload_navigates_then_picks_the_conversation_then_sets_the_file() -> None:
    """真站实测的核心修复：三步的顺序本身就是这次要钉住的行为。"""
    client = ChatCdp()

    strategy = upload(client)

    assert strategy == "dom_input"
    assert client.log[0] == f"navigate:{CHAT_PAGE_URL}"
    assert client.clicks() == ["click:120,260"]
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]
    order = [
        entry for entry in client.log if entry.startswith(("navigate", "click", "set_file_input"))
    ]
    assert order == [
        f"navigate:{CHAT_PAGE_URL}",
        "click:120,260",
        f"set_file_input:{SELECTOR_CHAT_IMAGE_INPUT}",
    ]


def test_the_upload_uses_the_precise_send_image_input_not_the_broad_one() -> None:
    """真站的 ``input[type=file]`` 里还有简历附件上传，宽口径会误命中它。"""
    client = ChatCdp()

    upload(client)

    selectors = [selector for selector, _files in client.file_inputs]
    assert selectors == [".btn-sendimg input[type=file]"]
    assert "input[type=file]" not in selectors


# ===== 2. 找不到会话：可诊断地失败，且绝不盲点第一条 =====


def test_missing_conversation_fails_with_the_listing_and_never_clicks_anything() -> None:
    client = ChatCdp(conversations=[OTHER_ITEM, "王先生另一家公司 您好"])

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "会话列表里没有找到包含" in detail
    assert COMPANY in detail
    # 列表文本要写进诊断：否则"找不到"无从核对是公司名不对还是会话列表不对。
    assert "李女士某某科技" in detail
    assert client.clicks() == [], "匹配不到时一次都不许点（点错会把图片发给别的招聘方）"
    assert client.file_inputs == []


def test_an_empty_conversation_list_is_reported_as_such_not_as_a_name_mismatch() -> None:
    # 聊天页打开了（编辑框在），但列表里一条会话都没有：不能报成"公司名看不到"。
    client = ChatCdp(conversations=[], chat_input_present=True)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    assert "会话列表没有加载出来" in excinfo.value.detail
    assert client.clicks() == []
    assert client.file_inputs == []


def test_without_a_company_name_it_refuses_to_guess_a_conversation() -> None:
    """没有公司名时连"按列表第一条"都不行：猜错会把图片发给另一位招聘方，不可撤回。"""
    client = ChatCdp(start_url=JOB_URL, chat_input_present=False)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client, company="")

    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "条目缺少公司名，无法定位会话" in excinfo.value.detail
    assert client.clicks() == []
    assert client.file_inputs == []


def test_without_a_company_name_it_does_not_reuse_the_open_conversation_either() -> None:
    """空公司名时"当前打开着的会话"同样不可信：那一页可能停在别人的会话上。"""
    client = ChatCdp(start_url=CHAT_URL)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client, company="")

    assert "条目缺少公司名，无法定位会话" in excinfo.value.detail
    assert client.clicks() == []
    assert client.file_inputs == []


def test_a_blank_company_name_is_treated_exactly_like_a_missing_one() -> None:
    """只有空白的公司名等于没有（``"  "`` 不能当成"匹配一切"）。"""
    client = ChatCdp(start_url=CHAT_URL)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client, company="   ")

    assert "条目缺少公司名，无法定位会话" in excinfo.value.detail
    assert client.file_inputs == []


# ===== 3. 已经在聊天页：不再导航 =====


def test_being_already_on_the_chat_page_does_not_navigate_again() -> None:
    client = ChatCdp(start_url=CHAT_URL)

    upload(client)

    assert [entry for entry in client.log if entry.startswith("navigate")] == []
    assert client.clicks() == ["click:120,260"], "在聊天页也要选中本次投递的会话"
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]


# ===== 4. 控件形态再变时的兜底与失败语义 =====


def test_a_missing_input_is_recovered_by_clicking_the_send_image_button_once() -> None:
    client = ChatCdp(image_input_present=False)

    strategy = upload(client)

    assert strategy == "dom_input"
    # 先点会话条目（选会话），再点「发送图片」把控件带出来。
    assert client.clicks() == ["click:120,260", "click:700,720"]
    assert f"set_file_input:{SELECTOR_CHAT_IMAGE_INPUT}" in client.log
    assert client.log.index(client.clicks()[0]) < client.log.index(
        f"set_file_input:{SELECTOR_CHAT_IMAGE_INPUT}"
    )


def test_a_missing_input_without_the_button_fails_with_the_selector_in_the_detail() -> None:
    client = ChatCdp(image_input_present=False, send_button_present=False)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "找不到图片上传控件" in detail
    assert SELECTOR_CHAT_IMAGE_INPUT in detail
    assert SELECTOR_CHAT_IMAGE_BUTTON in detail
    assert "简历附件上传" in detail, "诊断要说清宽口径为什么不能用"
    assert client.file_inputs == []


def test_a_sent_file_without_a_new_image_bubble_is_reported_as_not_visible() -> None:
    """塞进去了不等于发出去了：判据是会话里出现新的图片。"""
    client = ChatCdp(bubbles_after_upload=0)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    assert "没有看到图片消息出现在会话里" in excinfo.value.detail
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]


def test_the_item_text_is_used_to_find_the_conversation_not_the_first_entry() -> None:
    """列表里排在**第一个**的是别人：按公司名命中的必须是第 2 条，而不是第一条。"""
    client = ChatCdp(conversations=[OTHER_ITEM, ITEM_TEXT])

    upload(client)

    assert client.item_clicks == 1
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]
