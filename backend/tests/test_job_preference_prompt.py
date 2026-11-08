# SPDX-License-Identifier: Apache-2.0
"""求职偏好注入块（期二 T13）：格式 / 预算 / 两段降级 / parts 顺序 / 权限四档全注入。

计划 §6.3.4 的验收点都在这里：标题与结束标记、逐条目录标签 + 来源/日期、0 条空串、
24 条上限、单值 120 字符、列表 8 项、整块 900 字符、先省后缀再按优先级裁尾、
session_note 不进块、块的位置在写操作状态之后、技能与本地时间之前、四档权限都注入。
"""

from __future__ import annotations

import inspect

from app.models.job_preference import PREF_SOURCE_USER_EDITED
from app.services import job_preference_prompt as prompt_module
from app.services import job_preference_service as service
from app.services.assistant import assistant_system_prompt as system_prompt_module


def _seed(db, kind: str, value, *, source: str = PREF_SOURCE_USER_EDITED):
    return service.upsert_preference(db, kind, value, source=source)


def _line(
    label: str,
    display: str = "值",
    *,
    source: str = "用户陈述",
    updated: str = "11-09",
    priority: int = 1,
) -> prompt_module.PreferenceLine:
    return prompt_module.PreferenceLine(
        label=label, display=display, source_label=source, updated_label=updated, priority=priority
    )


def test_zero_preferences_render_empty_string(db_session):
    assert prompt_module.render_preference_block(db_session) == ""


def test_block_format_follows_the_plan(db_session):
    _seed(db_session, "target_city", ["杭州", "上海"])
    block = prompt_module.render_preference_block(db_session)
    assert block.startswith(prompt_module.TITLE)
    assert prompt_module.INTRO in block
    assert block.endswith(prompt_module.FOOTER)
    # 逐条：目录中文标签 + 值 + 来源/更新时间后缀。
    assert "- 城市：杭州、上海（用户修改，" in block
    assert "更新）" in block


def test_lines_are_ordered_by_inject_priority(db_session):
    _seed(db_session, "redline_tone", "plain")  # priority 11
    _seed(db_session, "target_city", ["杭州"])  # priority 2
    _seed(db_session, "salary_floor", "月薪15k")  # priority 3
    block = prompt_module.render_preference_block(db_session)
    assert (
        block.index("- 城市：") < block.index("- 薪资底线：") < block.index("- 写作红线（语气）：")
    )


def test_session_note_is_never_injected(db_session):
    _seed(db_session, "target_city", ["杭州"])
    _seed(db_session, "session_note", "这次只投后端")
    block = prompt_module.render_preference_block(db_session)
    assert "这次只投后端" not in block
    assert "仅本次对话" not in block
    assert "杭州" in block


def test_all_injectable_kinds_fit_the_900_char_budget(db_session):
    _seed(db_session, "target_role_family", ["产品运营", "用户增长", "商业化运营"])
    _seed(db_session, "target_city", ["杭州", "上海", "北京"])
    _seed(db_session, "salary_floor", "月薪15k")
    _seed(db_session, "work_mode", "远程")
    _seed(db_session, "exclude_company", ["某外包公司", "某连锁机构"])
    _seed(db_session, "exclude_industry", ["外包", "传统制造"])
    _seed(db_session, "overtime", "尽量少")
    _seed(db_session, "available_from", "2026-12")
    _seed(db_session, "redline_banned_word", ["赋能", "抓手", "闭环"])
    _seed(db_session, "redline_length", "一页")
    _seed(db_session, "redline_tone", "平实")
    block = prompt_module.render_preference_block(db_session)
    assert block
    assert len(block) <= prompt_module.MAX_BLOCK_CHARS
    # 11 类都出现了（不是靠丢条目压进预算的）。
    for label in (
        "期望岗位方向",
        "城市",
        "薪资底线",
        "工作方式",
        "排除公司",
        "排除行业",
        "加班接受度",
        "到岗时间",
        "写作红线（禁用词）",
        "写作红线（篇幅）",
        "写作红线（语气）",
    ):
        assert label in block, label


def test_single_value_is_truncated_to_120_chars(db_session):
    words = [f"禁用词{i:02d}" + "长" * 14 for i in range(20)]  # 每项 20 字符，合计远超 120
    _seed(db_session, "redline_banned_word", words)
    block = prompt_module.render_preference_block(db_session)
    display = block.split("禁用词）：", 1)[1].split("（", 1)[0]
    assert len(display) <= prompt_module.MAX_VALUE_CHARS
    assert display.endswith("…")


def test_list_is_capped_at_eight_items(db_session):
    families = ["运营", "产品", "市场", "增长", "品牌", "策划", "内容", "商务", "渠道", "策略"]
    _seed(db_session, "target_role_family", families)
    block = prompt_module.render_preference_block(db_session)
    assert "等 10 项" in block
    # 前 8 项被列出，第 9 项只以"等 N 项"体现（截断值预算也守 120）。
    display = block.split("期望岗位方向：", 1)[1].split("（", 1)[0]
    assert "渠道" not in display


def test_compose_caps_lines_at_twenty_four_and_says_how_many_hidden():
    lines = [_line(f"类别{index}", priority=index) for index in range(30)]
    block = prompt_module.compose_preference_block(lines)
    assert block.count("\n- ") == prompt_module.MAX_LINES
    assert "（另有 6 条未列出）" in block


def test_degradation_drops_suffix_before_entries(monkeypatch):
    """第一段降级：先省来源/更新时间后缀，**不丢条目**。"""
    lines = [_line("城市", "杭州、上海"), _line("薪资底线", "月薪 ≥15,000 元")]
    with_suffix = prompt_module.compose_preference_block(lines, with_suffix=True)
    without_suffix = prompt_module.compose_preference_block(lines, with_suffix=False)
    assert len(with_suffix) > len(without_suffix)
    monkeypatch.setattr(prompt_module, "MAX_BLOCK_CHARS", len(without_suffix))
    text = prompt_module.fit_preference_budget(lines)
    assert text == without_suffix
    assert "用户陈述" not in text
    assert "杭州、上海" in text and "薪资底线" in text


def test_priority_trim_happens_only_after_suffix_removal(monkeypatch):
    """第二段降级：仍超预算时按 inject_priority 裁尾（低优先级先走）。"""
    lines = [
        _line("城市", "杭州", priority=2),
        _line("薪资底线", "月薪 ≥15,000 元", priority=3),
        _line("工作方式", "远程", priority=4),
        _line("加班接受度", "尽量少", priority=7),
        _line("写作红线（语气）", "平实", priority=11),
    ]
    keep_three = prompt_module.compose_preference_block(lines[:3], with_suffix=False)
    monkeypatch.setattr(prompt_module, "MAX_BLOCK_CHARS", len(keep_three))
    text = prompt_module.fit_preference_budget(lines)
    assert "城市" in text and "薪资底线" in text and "工作方式" in text
    assert "加班接受度" not in text
    assert "写作红线（语气）" not in text


def test_block_sits_between_status_block_and_local_time_and_skills(db_session, monkeypatch):
    """parts 顺序契约：写操作状态 → 求职偏好 → 本地时间 → 技能。"""
    _seed(db_session, "target_city", ["杭州"])
    monkeypatch.setattr(
        system_prompt_module,
        "_proposal_status_block",
        lambda _db, _conversation_id: "【本会话写操作状态（权威）】\n无",
    )
    monkeypatch.setattr(
        system_prompt_module, "build_skill_prompt", lambda _db, _conversation_id: "[已导入的技能]"
    )
    prompt = system_prompt_module._system_prompt(db_session, conversation_id=1)
    status_index = prompt.index("【本会话写操作状态（权威）】")
    preference_index = prompt.index(prompt_module.TITLE)
    time_index = prompt.index("【当前时间】")
    skill_index = prompt.index("[已导入的技能]")
    assert status_index < preference_index < time_index < skill_index


def test_no_preferences_means_no_empty_block_in_system_prompt(db_session):
    prompt = system_prompt_module._system_prompt(db_session)
    assert prompt_module.TITLE not in prompt


def test_permission_tiers_all_keep_the_block(client, db_session):
    """权限四档全注入（含 read_only）：注入函数不看权限开关。"""
    _seed(db_session, "target_city", ["杭州"])
    # 结构断言：渲染函数没有权限/开关类参数——它从设计上就不可能按档位过滤。
    parameters = set(inspect.signature(prompt_module.render_preference_block).parameters)
    assert parameters == {"db"}
    for permission in ("read_only", "read_full", "write_confirm", "write_full"):
        response = client.put("/api/assistant/permission", json={"permission": permission})
        assert response.status_code == 200, response.text
        prompt = system_prompt_module._system_prompt(db_session)
        assert prompt_module.TITLE in prompt, permission
        assert "- 城市：杭州" in prompt


def test_user_stated_source_appears_in_suffix(db_session):
    from datetime import timedelta

    from app.models.assistant import AssistantWriteProposal
    from app.models.profile import utcnow

    proposal = AssistantWriteProposal(
        proposal_id="prefprompt0001",
        dataset_key=service.current_dataset_key(),
        dataset_generation=0,
        tool_name="create_job_preference",
        arguments={},
        arguments_digest="",
        preview={},
        target_fingerprint="",
        status="approved",
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=30),
    )
    db_session.add(proposal)
    db_session.commit()
    service.upsert_preference(
        db_session,
        "target_city",
        ["杭州"],
        source="user_stated",
        source_proposal_id=proposal.proposal_id,
    )
    block = prompt_module.render_preference_block(db_session)
    assert "（用户陈述，" in block
