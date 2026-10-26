# SPDX-License-Identifier: Apache-2.0
"""求职助手 prompt 预算守卫（issue 4）。

实测助手单轮 prompt 约 5.8 万 token，其中固定成本约 3.2 万（系统提示 2.5 万字符含能力
地图 + 61 个工具声明 3.1 万字符），可变成本（本地上下文 ≤ 4 万字符、历史 20 条不封顶）
才是会随资料/对话量无界增长的部分。这里守的性质：

1. 岗位 + 简历 + 资料一起选时，本地上下文总字符数不超过 MAX_LOCAL_CONTEXT_CHARS；
2. 资料再长（10 万字）也不会让上下文跟着涨；
3. 历史消息总字符数不超过 MAX_HISTORY_CHARS（且最近一条必带）；
4. 最坏情况（长资料 + 长历史 + 全量系统提示与工具声明）的估算 prompt token 有固定上限。

不联网、不调用真实模型，只用 app 里的字符估算（仅遥测口径）。
"""

from __future__ import annotations

import json

from app.api.assistant_context import (
    MAX_JOB_CONTEXT_CHARS,
    MAX_LOCAL_CONTEXT_CHARS,
    MAX_PROFILE_CONTEXT_CHARS,
    MAX_RESUME_CONTEXT_CHARS,
    load_local_context,
)
from app.api.assistant_persistence import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    history_snapshot,
)
from app.models.assistant import ChatConversation, ChatMessage
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.schemas.assistant import AssistantMessageCreate
from app.schemas.profile import ExperienceIn, ProfileUpdate, ProjectIn
from app.services.assistant_tools._registry import tool_definitions
from app.services.llm.token_estimate import estimate_tokens
from app.services.profile.profile_service import update_profile

# 单轮 prompt 的估算上限（含系统提示 + 工具声明 + 本地上下文 + 历史）。
# 修复前最坏情况可到 9 万字符量级（≈6 万 token）；预算化后应稳定在 6 万 token 以内。
MAX_PROMPT_TOKENS_ESTIMATE = 60_000


def _long_text(chars: int) -> str:
    unit = "负责会员增长与活动运营，主导 A/B 实验并复盘转化数据。"
    return (unit * (chars // len(unit) + 1))[:chars]


def _big_profile(extra_entries: int = 0) -> ProfileUpdate:
    """构造"资料量很大"的合法资料：每个多行字段受 2000 字符上限约束，用条数堆出体量。"""
    entry_count = 12 + extra_entries
    return ProfileUpdate(
        name="张示例",
        job_intent="市场运营专员",
        summary=_long_text(1_800),
        experiences=[
            ExperienceIn(
                company=f"示例公司{index}",
                role="市场运营专员",
                start_date="2023.07",
                end_date="2024.07",
                description=_long_text(1_800),
            )
            for index in range(entry_count)
        ],
        projects=[
            ProjectIn(name=f"示例项目{index}", role="负责人", description=_long_text(1_800))
            for index in range(8 + extra_entries)
        ],
    )


def _seed_long_profile(db_session, *, extra_entries: int = 0) -> None:
    update_profile(db_session, _big_profile(extra_entries))


def _seed_job_and_resume(db_session, *, resume_chars: int = 30_000):
    job = Job(
        title="用户增长运营",
        company="示例网络科技有限公司",
        description=_long_text(8_000),
        requirements=_long_text(8_000),
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    resume = ResumeRecord(
        title="长简历",
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        content={
            "name": "张示例",
            "summary": _long_text(4_000),
            "experience": [
                {"company": "示例科技", "role": "运营", "description": [_long_text(resume_chars)]}
            ],
        },
    )
    db_session.add(resume)
    db_session.commit()
    db_session.refresh(resume)
    return job, resume


def test_local_context_is_capped_when_all_selections_are_huge(client, db_session):
    _seed_long_profile(db_session)
    job, resume = _seed_job_and_resume(db_session)
    payload = AssistantMessageCreate(
        content="对比一下这份简历和岗位。", job_id=job.id, resume_id=resume.id
    )

    blocks, _metadata = load_local_context(db_session, payload)
    total_chars = sum(len(block) for block in blocks)

    assert blocks, "三个都选时上下文不应为空"
    assert total_chars <= MAX_LOCAL_CONTEXT_CHARS, (
        f"本地上下文 {total_chars} 字符超过总预算 {MAX_LOCAL_CONTEXT_CHARS}"
    )
    # 三个来源都还在（预算按 岗位→简历→资料 顺序分配，最后一块只保留剩余额度）。
    joined = "".join(blocks)
    assert "[已选岗位开始]" in joined
    assert "[已选简历开始]" in joined
    assert "[已选个人资料" in joined
    # 单块上限仍然生效（不会占用超过自己那一类的额度；+300 是块包装/省略号的空间）。
    assert len(blocks[0]) <= MAX_JOB_CONTEXT_CHARS + 300
    assert len(blocks[1]) <= MAX_RESUME_CONTEXT_CHARS + 300
    assert len(blocks[2]) <= MAX_PROFILE_CONTEXT_CHARS + 300


def test_bigger_profile_does_not_grow_the_context(client, db_session):
    _seed_long_profile(db_session)
    payload = AssistantMessageCreate(content="按我的资料回答。")
    first, _ = load_local_context(db_session, payload)

    # 再写入一份条目更多的资料，上下文仍应被同一预算封住。
    update_profile(db_session, _big_profile(extra_entries=6))
    second, _ = load_local_context(db_session, payload)

    first_total = sum(len(block) for block in first)
    second_total = sum(len(block) for block in second)
    assert second_total <= MAX_LOCAL_CONTEXT_CHARS
    # 只选资料时单块上限（10k）生效：资料再多，块也不会超过该类上限。
    assert second_total <= MAX_PROFILE_CONTEXT_CHARS + 300
    assert first_total <= MAX_PROFILE_CONTEXT_CHARS + 300


def test_history_is_capped_by_total_chars(client, db_session):
    conversation = ChatConversation(title="长历史", surface="page")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    for index in range(MAX_HISTORY_MESSAGES + 10):
        db_session.add(
            ChatMessage(
                conversation_id=conversation.id,
                role="user" if index % 2 == 0 else "assistant",
                content=_long_text(1_000) + f"#{index}",
                status="complete",
            )
        )
    db_session.commit()

    history = history_snapshot(db_session, conversation.id)
    total_chars = sum(len(message["content"]) for message in history)

    assert history, "历史为空说明快照逻辑退化了"
    assert len(history) <= MAX_HISTORY_MESSAGES
    assert total_chars <= MAX_HISTORY_CHARS + 1_100, (
        f"历史 {total_chars} 字符超过预算 {MAX_HISTORY_CHARS}"
    )
    # 最近一条必须保留（当前对话轮次的上下文起点）。
    assert history[-1]["content"].endswith(f"#{MAX_HISTORY_MESSAGES + 9}")


def test_worst_case_prompt_estimate_stays_bounded(client, db_session):
    _seed_long_profile(db_session)
    job, resume = _seed_job_and_resume(db_session)
    payload = AssistantMessageCreate(
        content="按我的资料和这份简历回答。", job_id=job.id, resume_id=resume.id
    )
    blocks, _ = load_local_context(db_session, payload)

    from app.api.assistant import _system_prompt

    system_prompt = _system_prompt(db_session)
    tools = tool_definitions(web_search=False, relaxed=False)
    tools_text = json.dumps(tools, ensure_ascii=False)
    prompt_text = system_prompt + tools_text + "".join(blocks)

    estimate = estimate_tokens(prompt_text)
    assert estimate <= MAX_PROMPT_TOKENS_ESTIMATE, (
        f"最坏情况估算 {estimate} token 超过上限 {MAX_PROMPT_TOKENS_ESTIMATE}"
    )
    # 固定成本本身也别悄悄膨胀（能力地图/工具声明是每轮都发的）。
    # 方案 A（Lead 批准，2026-10-26）：能力地图不再重复工具清单，系统提示从 25,234 字符
    # 降到 23,187 字符（约 -2,047 字符 / 估算 -652 token）；这条阈值守住下降不回退。
    assert len(system_prompt) <= 23_800, (
        f"系统提示固定成本回涨到 {len(system_prompt)} 字符（方案 A 后应 ≤ 23,800）"
    )
    assert len(tools_text) <= 45_000
    # 去重但**不丢功能覆盖**：每个功能域与每个界面功能名都还必须能在系统提示里找到。
    from app.services.feature_catalog import FEATURES, FUNCTIONAL_DOMAINS

    for domain in FUNCTIONAL_DOMAINS:
        assert domain in system_prompt, f"能力地图丢了功能域：{domain}"
    missing_features = [feature.name for feature in FEATURES if feature.name not in system_prompt]
    assert not missing_features, f"能力地图丢了界面功能：{missing_features}"
    # 重复的工具清单/逐条「可配合工具」提示必须真的被删掉（否则省不下固定成本）。
    assert "可配合工具" not in system_prompt
    assert "## 可用工具" not in system_prompt
    assert "写入类工具：" in system_prompt
