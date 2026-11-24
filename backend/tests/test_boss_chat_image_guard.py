# SPDX-License-Identifier: Apache-2.0
"""招呼语配图（四）：**会话归属校验**与**气泡扫描根**——2026-11-24 真站事故的回归钉子。

事故现场（队列 #17 万事云）：回报 ``image_status=sent``（"已随招呼语发出 1 张图片"），但

- 万事云的会话里**没有**图；
- 图出现在**另一个人（张岩）**的会话里，被用户手动撤回。

根因：点会话条目的点击在自动化下没生效（真站条目没有 active/selected 类名，实测为空），
而页面上早开着别人的会话——``.chat-input`` / ``.btn-sendimg`` 都在，旧实现只检查"输入框在"。
本文件钉住四件事（每条都对应一个真实可能发生的误发/误报）：

1. 右栏标题里没有目标公司 → ``upload_failed``，detail 说明「当前打开的会话不是目标公司」，
   而且**一次 ``DOM.setFileInputFiles`` 都不许发**；
2. 第一次点不中、第二次点中了 → 成功（点两次即可，不无限重试）；
3. 气泡只数右栏：左栏头像 img 变多、右栏没图 → 判失败（本次"误报已发出"的回归钉子）；
4. 成功路径把"发给了谁"写进结果（``greeting_image_target``），且标题截到 40 字以内。

不碰网络、不碰真站：假件见 ``chat_image_support.py``（它按脚本的扫描根决定计数口径，
所以第 3 条在脚本退回 ``document`` 时会真的失败）。
"""

from __future__ import annotations

import re

import pytest
from app.models.apply import FAILURE_FILE_UPLOAD_FAILED
from app.services.sites.base import SiteFailure
from app.services.sites.boss_apply_image import _bubble_script, _image_probe_script
from app.services.sites.boss_chat_guard import conversation_script
from app.services.sites.boss_page import SELECTOR_CHAT_IMAGE_INPUT
from chat_image_support import (
    COMPANY,
    FILE_INPUT_METHOD,
    FILES,
    OTHER_TITLE,
    ChatCdp,
    upload,
    upload_with_adapter,
)

# ===== 1. 会话归属不匹配：一次都不上传 =====


def test_a_wrong_conversation_fails_with_the_actual_title_and_never_uploads() -> None:
    """事故原形：点条目没生效，右栏还是别人的会话——绝不能在别人的会话里发图。"""
    client = ChatCdp(open_conversation=OTHER_TITLE, company_switch_after=None)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "当前打开的会话不是目标公司" in detail
    assert COMPANY in detail, "诊断要写清期望包含什么"
    assert "张岩科技" in detail, "诊断要写清实际标题（用户据此核对）"
    assert "图片没有发送" in detail and "消息不可撤回" in detail
    # 零上传：这是这次修复的核心红线。
    assert client.file_inputs == []
    assert FILE_INPUT_METHOD not in client.methods
    assert client.item_clicks == 2, "核对不过要再点一次会话条目，最多两次"
    assert [entry for entry in client.log if entry.startswith("set_file_input")] == []


def test_a_conversation_switch_on_the_second_click_succeeds() -> None:
    """第一次点不中（真站常态）、第二次点中 → 成功；断言点击恰好发生两次。"""
    client = ChatCdp(open_conversation=OTHER_TITLE, company_switch_after=2)

    strategy = upload(client)

    assert strategy == "dom_input"
    assert client.item_clicks == 2
    assert client.clicks() == ["click:120,260", "click:120,260"]
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]


def test_an_unreadable_conversation_title_also_refuses_to_upload() -> None:
    """读不到标题（右栏没渲染出来）同样不能猜：``.chat-input`` 在也证明不了归属。"""
    client = ChatCdp(title_visible=False)

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    assert "读不到当前会话的标题" in excinfo.value.detail
    assert client.file_inputs == []
    assert FILE_INPUT_METHOD not in client.methods


# ===== 2. 气泡只数右栏：左栏头像不许被算成"图片气泡" =====


def test_bubbles_are_counted_only_inside_the_right_pane() -> None:
    """本次"误报已发出"的回归钉子：左栏头像变多、右栏没有图 → 必须判失败。

    假件按脚本的扫描根计数：脚本限定右栏才只数右栏，退回 ``document`` 就会把左栏
    ``.user-list-content`` 里新懒加载出来的头像一起数进来 → 计数凭空变大 → 误报成功。
    """
    client = ChatCdp(
        left_list_images=0,
        left_list_images_after_upload=4,
        bubbles_after_upload=0,
    )

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    assert "没有看到图片消息出现在会话里" in excinfo.value.detail
    # 结构钉子：两个脚本的扫描根都不是 document。
    for script in (_bubble_script(), _image_probe_script()):
        assert "chatScope()" in script
        assert "document.querySelectorAll(BUBBLE)" not in script
        assert "document.body" not in script


def test_the_scope_helpers_exclude_the_left_column_explicitly() -> None:
    """扫描根之外还要显式排除左栏：``.user-list-content`` 里的 img 一律不算气泡。"""
    for script in (_bubble_script(), _image_probe_script()):
        assert ".user-list-content" in script
        assert "outsideChatList" in script


# ===== 3. 成功路径：把"发给了谁"写进结果 =====


def test_a_successful_upload_records_and_returns_the_conversation_title() -> None:
    client = ChatCdp()

    adapter, strategy = upload_with_adapter(client)

    assert strategy == "dom_input"
    target = adapter.greeting_image_target
    assert COMPANY in target, "结果里必须写清发给了谁"
    assert target.startswith("杨女士")
    assert len(target) <= 40, "标题要截到 40 字以内（整段会话摘要不能进记录）"


class _EscapingChatCdp(ChatCdp):
    """发图瞬间把右栏切走：还原真站上"点击逃逸"（图落到别人会话里）的形状。"""

    def set_file_input(self, selector: str, files: list[str], *, timeout: float | None = None):
        super().set_file_input(selector, files, timeout=timeout)
        self.open_conversation = OTHER_TITLE


def test_a_conversation_that_moves_after_the_upload_is_reported_not_hidden() -> None:
    """发完再核对：会话在发图途中被切走 → 报"可能发错人"，绝不记成"已发出"。"""
    client = _EscapingChatCdp()

    with pytest.raises(SiteFailure) as excinfo:
        upload(client)

    detail = excinfo.value.detail
    assert "图片已交给页面" in detail
    assert "请到浏览器里核对并手动撤回" in detail
    # 此时图**已经**发出去了，如实记录这条风险，但不能把它当成"发了 1 张给目标公司"。
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]


# ===== 4. 会话探针脚本本身的语法前提 =====

_CONVERSATION_CONST_RE = r"^  const ([A-Za-z_$][\w$]*) ="


def test_the_conversation_script_declares_each_const_only_once() -> None:
    """同一作用域重复 ``const`` 是 SyntaxError（真站上表现为"读不到标题"）。"""
    script = conversation_script()
    declared = re.findall(_CONVERSATION_CONST_RE, script, re.MULTILINE)
    duplicates = sorted({word for word in declared if declared.count(word) > 1})
    assert duplicates == []
