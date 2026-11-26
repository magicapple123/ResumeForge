# SPDX-License-Identifier: Apache-2.0
"""R23（P0，**发错不可撤回**）：会话匹配必须是「公司名 + 岗位名」双键，不唯一就明确失败。

## 病根（三步全只认公司名）

1. ``_user_list_script(company)``（现随选会话逻辑抽到 ``boss_conversation_match.py``）：
   条目文本含公司名就命中，**命中第一条立即 ``break``**；
2. ``boss_chat_guard.verify_conversation(company)``：右栏标题含公司名即通过；
3. ``confirm_conversation_after_send(company, fallback)``：发送后再看一次公司名。

同一家公司有两个 HR 时，第 1 步取 DOM 靠前那条，2、3 步照样绿灯——**图发给了另一个人**，
而聊天消息**不可撤回**。本文件钉住三件事：

- 双键筛完恰好剩 1 条 → 点那一条（坐标来自那一条，不是"第一条含公司名的"）；
- 多条命中 / 零命中 → ``FAILURE_FILE_UPLOAD_FAILED`` + 诊断列出候选标题，**一次点击、一次
  上传都不做**（文本招呼语由另一条链路发，这里不拦）；
- 归属核对（发图前 / 发图后）同样要求两个键。

**为什么只能桩测**：真站上要复现"同公司两个 HR"必须真的投一次递、真的发一张图，而发出去的
聊天消息不可撤回。所以这里全部是适配器级假件（``chat_image_support.ChatCdp``），一个真实站点
都不碰。**真站未能验证，需用户自己发一次**——结论见 ``T14-evidence.md``。
"""

from __future__ import annotations

import pytest
from app.models.apply import FAILURE_FILE_UPLOAD_FAILED
from app.services.sites.base import SiteFailure
from app.services.sites.boss_chat_guard import confirm_conversation_after_send, verify_conversation
from app.services.sites.boss_conversation_match import _user_list_script
from app.services.sites.boss_page import SELECTOR_CHAT_IMAGE_INPUT
from chat_image_support import (
    CHAT_URL,
    COMPANY,
    FAST_WAIT,
    FILE_INPUT_METHOD,
    FILES,
    OTHER_ITEM,
    ChatCdp,
    upload,
)

# ===== 桩数据：同一家公司「中科曙光」下有两个 HR，各自在招不同岗位 =====

TARGET_JOB = "PC服务工具开发工程师"
OTHER_JOB = "Java开发工程师"

# 左侧会话条目文本（真站形状：招聘方 + 公司名 + 岗位 + 最后一句话）。第一条岗位**不匹配**，
# 且在 DOM 里更靠前——旧实现正是在它上面 break 的。
ITEM_FIRST_OTHER_JOB = f"王先生{COMPANY}HRBP {OTHER_JOB} 您好，看一下简历"
ITEM_SECOND_TARGET_JOB = f"罗先生{COMPANY}HRBP {TARGET_JOB} 您好，我对该岗位很感兴趣"
ITEM_THIRD_ALSO_TARGET = f"李女士{COMPANY}HRBP {TARGET_JOB} 双休 您好"

# 两条会话的点击坐标刻意不同：这样"点的是哪一条"是可断言的（而不是两条共用一个坐标）。
FIRST_RECT = (120, 260)
SECOND_RECT = (120, 360)
THIRD_RECT = (120, 460)

# 右栏标题（真站形状：招聘方 + 公司名 + 岗位 + 一串福利）。
TITLE_FIRST = f"王先生 {COMPANY} 招聘人事 更多 {OTHER_JOB} 双休"
TITLE_SECOND = f"罗先生 {COMPANY} 招聘人事 更多 {TARGET_JOB} 双休 六险一金"
TITLE_THIRD = f"李女士 {COMPANY} 招聘人事 更多 {TARGET_JOB} 双休"


def _point(rect: tuple[int, int]) -> str:
    """可信点击在假件里被记成 ``click:x,y``。"""
    return f"click:{rect[0]},{rect[1]}"


# ===== 1. 恰好一条命中：点它（而且必须是被岗位名筛出来的那一条）=====


def test_the_conversation_is_picked_by_the_job_title_not_by_dom_order() -> None:
    """同公司两个 HR、只有一个岗位匹配 → 必须点**第二条**（DOM 靠前的第一条不匹配）。"""
    client = ChatCdp(
        conversations=[ITEM_FIRST_OTHER_JOB, ITEM_SECOND_TARGET_JOB],
        item_rects=[FIRST_RECT, SECOND_RECT],
        item_titles=[TITLE_FIRST, TITLE_SECOND],
    )

    strategy = upload(client, job_title=TARGET_JOB)

    assert strategy == "dom_input"
    assert client.clicks() == [_point(SECOND_RECT)], "坐标必须来自岗位名命中的那一条"
    assert client.item_clicks == 1
    assert client.file_inputs == [(SELECTOR_CHAT_IMAGE_INPUT, FILES)]


def test_a_single_hit_records_which_conversation_the_image_went_to() -> None:
    """结果里的"发给了谁"必须是那条会话的标题（事后可核对）。"""
    client = ChatCdp(
        conversations=[ITEM_FIRST_OTHER_JOB, ITEM_SECOND_TARGET_JOB],
        item_rects=[FIRST_RECT, SECOND_RECT],
        item_titles=[TITLE_FIRST, TITLE_SECOND],
    )
    from app.services.sites.boss import BossAdapter

    adapter = BossAdapter(ready_wait=FAST_WAIT)
    adapter.upload_greeting_images(client, FILES, company=COMPANY, job_title=TARGET_JOB)

    assert adapter.greeting_image_target.startswith("罗先生"), (
        "写进结果的必须是本次投递的那个招聘方，不是同公司的另一个人"
    )


# ===== 2. 多条命中：明确失败，一次点击/上传都不做 =====


def test_two_matching_conversations_fail_loudly_and_touch_nothing() -> None:
    """两条都匹配 = 无法确定是哪一个 HR → 失败；诊断里要能看到两个候选标题。"""
    client = ChatCdp(
        conversations=[ITEM_SECOND_TARGET_JOB, ITEM_THIRD_ALSO_TARGET],
        item_rects=[SECOND_RECT, THIRD_RECT],
        item_titles=[TITLE_SECOND, TITLE_THIRD],
    )

    with pytest.raises(SiteFailure) as excinfo:
        upload(client, job_title=TARGET_JOB)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "同公司下匹配到 2 个会话" in detail
    # 两个候选标题都要写进诊断，否则用户无从判断该把岗位名写多细。
    assert "罗先生" in detail and "李女士" in detail
    assert "请在建批次 / 编辑队列时把岗位名写清楚" in detail
    # 红线：一次点击、一次上传都不许发生。
    assert client.clicks() == []
    assert client.item_clicks == 0
    assert client.file_inputs == []
    assert FILE_INPUT_METHOD not in client.methods


# ===== 3. 零命中：明确失败 =====


def test_no_matching_conversation_fails_and_lists_the_samples() -> None:
    """公司名对、岗位名不对 = 零命中；不能退化成"取第一条含公司名的"。"""
    client = ChatCdp(
        conversations=[OTHER_ITEM, ITEM_FIRST_OTHER_JOB],
        item_rects=[FIRST_RECT, SECOND_RECT],
    )

    with pytest.raises(SiteFailure) as excinfo:
        upload(client, job_title=TARGET_JOB)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "会话列表里没有找到" in detail
    assert COMPANY in detail and TARGET_JOB in detail, "诊断要写清期望的两个键"
    assert "王先生" in detail, "要列出列表样本，否则无从核对"
    assert client.clicks() == []
    assert client.file_inputs == []


# ===== 4. 发图前核对：标题必须同时含公司名与岗位名 =====


def test_verify_conversation_rejects_a_same_company_conversation_with_another_job() -> None:
    """同公司、岗位不同 → 核对不过（旧实现只看公司名，这里会放行别人的会话）。"""
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_FIRST)

    with pytest.raises(SiteFailure) as excinfo:
        verify_conversation(client, company=COMPANY, job_title=TARGET_JOB, ready_wait=FAST_WAIT)

    detail = excinfo.value.detail
    assert excinfo.value.category == FAILURE_FILE_UPLOAD_FAILED
    assert "当前打开的会话不是目标会话" in detail
    assert COMPANY in detail and TARGET_JOB in detail
    assert client.file_inputs == []


def test_verify_conversation_passes_when_both_keys_are_in_the_title() -> None:
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_SECOND)

    title = verify_conversation(client, company=COMPANY, job_title=TARGET_JOB, ready_wait=FAST_WAIT)

    assert title.startswith("罗先生")
    assert TARGET_JOB in title


def test_verify_conversation_still_accepts_a_company_only_rule_when_the_job_is_blank() -> None:
    """唯一允许放宽的情形：队列条目没有岗位名时只校验公司名。"""
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_FIRST)

    title = verify_conversation(client, company=COMPANY, job_title="", ready_wait=FAST_WAIT)

    assert title.startswith("王先生")


# ===== 5. 发图后核对：同上，含 fallback 分支 =====


def test_confirm_after_send_rejects_a_conversation_with_another_job() -> None:
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_FIRST)

    with pytest.raises(SiteFailure) as excinfo:
        confirm_conversation_after_send(
            client, company=COMPANY, job_title=TARGET_JOB, fallback="（上传前核对通过的标题）"
        )

    detail = excinfo.value.detail
    assert "图片已交给页面" in detail
    assert TARGET_JOB in detail, "要写清期望的岗位名，用户才知道该核对哪个会话"
    assert "请到浏览器里核对并手动撤回" in detail


def test_confirm_after_send_passes_when_both_keys_are_in_the_title() -> None:
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_SECOND)

    title = confirm_conversation_after_send(
        client, company=COMPANY, job_title=TARGET_JOB, fallback="（不该用到）"
    )

    assert title.startswith("罗先生")


def test_confirm_after_send_falls_back_to_the_verified_title_when_unreadable() -> None:
    """读不到标题（容器消失）→ 退回上传前已核对通过的标题，不凭猜测推翻它。"""
    client = ChatCdp(start_url=CHAT_URL, open_conversation=TITLE_SECOND, title_visible=False)

    title = confirm_conversation_after_send(
        client, company=COMPANY, job_title=TARGET_JOB, fallback=TITLE_SECOND
    )

    assert title == TITLE_SECOND


# ===== 6. 脚本结构：收集全部命中，绝不"命中第一条就 break" =====


def test_the_user_list_script_collects_every_hit_instead_of_breaking_on_the_first() -> None:
    """结构钉子：脚本里只允许 1 个 ``break``（找列表容器那个），命中循环里不许有第二个。

    这正是 R23 的病根所在：一旦有人在命中后写回 ``break``，同公司两个 HR 又会退化成"取
    DOM 靠前那条"，而页面上看不出来（另外两步当时也只看公司名）。
    """
    script = _user_list_script(COMPANY, TARGET_JOB)

    assert "match_count" in script, "必须把命中条数交回 Python 侧判定"
    assert "hits.push" in script, "必须收集全部命中项"
    assert script.count("break;") == 1, "命中循环里不许 break（那会退化成'取第一条'）"
    assert "JOB" in script, "岗位名必须真的进到页面脚本里"
