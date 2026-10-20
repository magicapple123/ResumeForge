# SPDX-License-Identifier: Apache-2.0
"""Content-domain generator: knowledge, materials, interviews, assistant chat,
settings and web-form records."""

from __future__ import annotations

import json
from datetime import timedelta

from .context import SeedContext, date_str, row
from .vocab import (
    COMPANIES,
    DIFFICULTIES_ALL,
    EXPERIENCE_SOURCE_ALL,
    INTERVIEW_TYPES_ALL,
    JD_MAJORS,
    KNOWLEDGE_CATEGORIES,
    ROUND_TYPES_ALL,
    STYLES_ALL,
    TITLES,
    WEBFORM_GROUPS,
    WEBFORM_KEYS,
    fake_name,
    long_text,
)

KNOWLEDGE_LONG_ENTRY_TARGET_KB = 21.0


def seed_knowledge(ctx: SeedContext) -> None:
    now = ctx.now
    count = ctx.counts.knowledge_entry
    knowledge_rows: list[dict] = []
    for i in range(count):
        category = KNOWLEDGE_CATEGORIES[i % len(KNOWLEDGE_CATEGORIES)]
        if i < min(50, count):
            content = long_text(
                ["知识条目 {n}：关于{area}的虚构方法与注意事项，供压力测试读取。"],
                list(KNOWLEDGE_CATEGORIES),
                target_kb=KNOWLEDGE_LONG_ENTRY_TARGET_KB,
            )
        else:
            content = "\n".join(
                f"{category}要点 {k}：这是压力测试用的虚构要点，编号 {i}-{k}。" for k in range(8)
            )
        knowledge_rows.append(
            row(
                title=f"{category}笔记（{i + 1}）",
                category=category,
                tags=[category, "压力测试"] if i % 3 else [category],
                content=content,
                source="手动录入" if i % 4 else "面经导入",
                created_at=now - timedelta(hours=i * 2),
                updated_at=now - timedelta(hours=i * 2),
                deleted_at=now - timedelta(days=i % 19) if i % 19 == 4 else None,
            )
        )
    ctx.insert("knowledge_entry", knowledge_rows, chunk=200)


def seed_material(ctx: SeedContext) -> None:
    """Material rows carry a category from the app's canonical list."""
    from app.models import MATERIAL_CATEGORIES  # noqa: PLC0415 - lazy app import

    now = ctx.now
    count = ctx.counts.material
    ctx.insert(
        "material",
        [
            row(
                title=(f"虚构资料（{i + 1}）：{MATERIAL_CATEGORIES[i % len(MATERIAL_CATEGORIES)]}"),
                category=MATERIAL_CATEGORIES[i % len(MATERIAL_CATEGORIES)],
                content="压力测试用虚构资料正文，描述某次虚构活动或作品的要点。",
                url=f"https://example.com/stress-material/{i + 1}" if i % 3 == 0 else "",
                files=[
                    {
                        "name": f"附件-{i + 1}.pdf",
                        "mime_type": "application/pdf",
                        "size_bytes": 102400 + i * 7,
                        "text": "附件提取文字（虚构）",
                    }
                ]
                if i % 4 == 0
                else [],
                note="压力测试虚构资料" if i % 7 == 0 else "",
                created_at=now - timedelta(hours=i * 2),
                updated_at=now - timedelta(hours=i * 2),
                deleted_at=now - timedelta(days=i % 13) if i % 13 == 6 else None,
            )
            for i in range(count)
        ],
    )


def seed_interview_sessions(ctx: SeedContext, job_rows: list[dict]) -> int:
    now = ctx.now
    count = ctx.counts.interview_session
    ctx.insert(
        "interview_session",
        [
            row(
                id=i + 1,
                title=f"虚构模拟面试（{i + 1}）：{TITLES[i % len(TITLES)]}",
                job_id=(i % len(job_rows)) + 1,
                job_title=TITLES[i % len(TITLES)],
                company=COMPANIES[i % len(COMPANIES)],
                interview_type=INTERVIEW_TYPES_ALL[i % len(INTERVIEW_TYPES_ALL)],
                difficulty=DIFFICULTIES_ALL[i % len(DIFFICULTIES_ALL)],
                interviewer_style=STYLES_ALL[i % len(STYLES_ALL)],
                rounds=6,
                rounds_min=None,
                persona="严格但讲道理的虚构面试官",
                focus="量化结果与口径",
                status=("active", "finished")[i % 2],
                report=(
                    {
                        "score": 70 + i % 20,
                        "dimensions": [],
                        "strengths": [],
                        "improvements": [],
                        "summary": "虚构报告",
                    }
                    if i % 2
                    else {}
                ),
                model="deepseek-v4-flash",
                created_at=now - timedelta(hours=i * 5),
                updated_at=now - timedelta(hours=i * 5),
            )
            for i in range(count)
        ],
    )
    return count


def seed_interview_messages(ctx: SeedContext, session_count: int) -> None:
    msg_time = ctx.now - timedelta(days=3)
    interview_message_rows: list[dict] = []
    for i in range(session_count):
        for k in range(6):
            msg_time += timedelta(minutes=2)
            interview_message_rows.append(
                row(
                    session_id=i + 1,
                    role=("interviewer", "user", "note")[k % 3],
                    content=f"模拟面试第 {k + 1} 轮的虚构问答内容（会话 {i + 1}）。",
                    context={},
                    status="complete",
                    error="",
                    created_at=msg_time,
                )
            )
    ctx.insert("interview_message", interview_message_rows)


def seed_interview_extras(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> None:
    """Experience notes, review history and personalized question banks."""
    now = ctx.now
    ctx.insert(
        "interview_experience",
        [
            row(
                title=(
                    f"虚构面经（{i + 1}）：{COMPANIES[i % len(COMPANIES)]} "
                    f"{TITLES[i % len(TITLES)]}"
                ),
                company=COMPANIES[i % len(COMPANIES)],
                position=TITLES[i % len(TITLES)],
                job_id=(i % len(job_rows)) + 1,
                content="这是一条压力测试用的虚构面经正文，描述流程与被追问的要点。",
                questions=[
                    "介绍一下你主导过的虚构项目？",
                    "这个数字的口径是什么？",
                    "如果预算减半你会怎么调整？",
                ],
                tags=["行为面", "压力测试"],
                source=EXPERIENCE_SOURCE_ALL[i % len(EXPERIENCE_SOURCE_ALL)],
                difficulty=DIFFICULTIES_ALL[i % len(DIFFICULTIES_ALL)],
                round_type=ROUND_TYPES_ALL[i % len(ROUND_TYPES_ALL)],
                interview_date=date_str(now - timedelta(days=i * 3)),
                created_at=now - timedelta(days=i * 3),
                updated_at=now - timedelta(days=i * 3),
                deleted_at=now - timedelta(days=i % 13) if i % 26 == 5 else None,
            )
            for i in range(40)
        ],
    )
    ctx.insert(
        "interview_review_record",
        [
            row(
                job_id=(i % len(job_rows)) + 1,
                job_title=TITLES[i % len(TITLES)],
                company=COMPANIES[i % len(COMPANIES)],
                resume_id=(i % len(resume_rows)) + 1,
                resume_title=resume_rows[i % len(resume_rows)]["title"],
                questions=["被追问的虚构问题一", "被追问的虚构问题二"],
                analysis={
                    "framework": "STAR",
                    "key_points": ["口径", "贡献"],
                    "follow_up": [],
                    "pitfalls": [],
                },
                suggestions=[
                    {
                        "priority": "高",
                        "section": "经历",
                        "issue": "缺量化",
                        "suggestion": "补数字",
                        "evidence": "",
                    }
                ],
                model="deepseek-v4-flash",
                created_at=now - timedelta(days=i * 2),
                updated_at=now - timedelta(days=i * 2),
                deleted_at=now - timedelta(days=i % 9) if i % 15 == 4 else None,
            )
            for i in range(30)
        ],
    )
    ctx.insert(
        "question_bank_record",
        [
            row(
                job_id=(i % len(job_rows)) + 1,
                job_title=TITLES[i % len(TITLES)],
                company=COMPANIES[i % len(COMPANIES)],
                resume_id=(i % len(resume_rows)) + 1,
                resume_title=resume_rows[i % len(resume_rows)]["title"],
                groups=[
                    {
                        "type": "基础题",
                        "questions": [
                            {"question": "虚构基础题", "purpose": "热身", "answer_hint": ""}
                        ],
                    },
                    {
                        "type": "深挖题",
                        "questions": [
                            {"question": "虚构深挖题", "purpose": "验证深度", "answer_hint": ""}
                        ],
                    },
                ],
                model="deepseek-v4-flash",
                created_at=now - timedelta(days=i * 2),
                updated_at=now - timedelta(days=i * 2),
                deleted_at=now - timedelta(days=i % 9) if i % 15 == 7 else None,
            )
            for i in range(30)
        ],
    )


CHAT_CONVERSATION_COUNT = 64
CHAT_MESSAGE_COUNT = 2560


def seed_chat(ctx: SeedContext, job_rows: list[dict]) -> None:
    now = ctx.now
    ctx.insert(
        "chat_conversation",
        [
            row(
                id=i + 1,
                title=f"虚构助手对话（{i + 1}）：{TITLES[i % len(TITLES)]}怎么准备",
                # Conversation 1 must be a page one: the detail endpoint filters
                # by surface=page (pinned by the original self-check).
                surface="ball" if i % 8 == 7 else "page",
                pinned=i % 16 == 0,
                favorite=i % 8 == 0,
                archived=i % 20 == 0,
                group_name=("简历", "面试", "")[i % 3],
                created_at=now - timedelta(hours=i * 4),
                updated_at=now - timedelta(hours=i * 4),
                deleted_at=now - timedelta(days=i % 17) if i % 60 == 6 else None,
            )
            for i in range(CHAT_CONVERSATION_COUNT)
        ],
    )

    chat_message_rows: list[dict] = []
    msg_time = now - timedelta(days=10)
    for i in range(CHAT_MESSAGE_COUNT):
        msg_time += timedelta(minutes=1)
        role = "user" if i % 2 == 0 else "assistant"
        content = (
            f"虚构提问 {i}：请帮我看看这条经历怎么改？"
            if role == "user"
            else f"虚构回答 {i}：建议先把口径写清楚，再补一个量化结果，最后说明你的分工。"
        )
        chat_message_rows.append(
            row(
                conversation_id=(i % CHAT_CONVERSATION_COUNT) + 1,
                role=role,
                content=content,
                quoted_message_id=None,
                attachments=[],
                context={"job_ids": [(i % len(job_rows)) + 1]} if i % 10 == 0 else {},
                status="complete",
                error="",
                model="" if role == "user" else "deepseek-v4-flash",
                created_at=msg_time,
            )
        )
    ctx.insert("chat_message", chat_message_rows, chunk=250)


def seed_assistant(ctx: SeedContext) -> None:
    now = ctx.now
    ctx.insert(
        "assistant_skill",
        [
            row(
                id=i + 1,
                name=f"虚构技能（{i + 1}）",
                description="压力测试用的虚构技能描述",
                prompt="请针对我给出的材料逐条提问，优先追问口径与本人贡献。",
                enabled=i % 4 != 0,
                source_name="",
                created_at=now - timedelta(days=i * 3),
                updated_at=now - timedelta(days=i * 3),
            )
            for i in range(8)
        ],
    )
    ctx.insert(
        "assistant_skill_file",
        [
            row(
                skill_id=(i % 8) + 1,
                path=f"docs/虚构资料-{i + 1}.md",
                content="技能包里的虚构知识文件内容。" * 20,
                size_bytes=15 * 20,
            )
            for i in range(16)
        ],
    )


def seed_settings(ctx: SeedContext) -> None:
    now = ctx.now
    ctx.insert(
        "app_setting",
        [
            row(
                key="llm_config",
                value=json.dumps(
                    {
                        "provider": "deepseek",
                        "base_url": "https://api.deepseek.com/v1",
                        "api_key": "",
                        "model": "deepseek-v4-flash",
                        "temperature": 0.1,
                        "timeout_seconds": 120,
                        "max_tokens": 0,
                        "api_style": "openai",
                        "top_p": None,
                        "frequency_penalty": None,
                        "presence_penalty": None,
                        "seed": None,
                        "top_k": None,
                        "repetition_penalty": None,
                        "stop": [],
                        "thinking_budget": None,
                        "extra_body": {},
                    },
                    ensure_ascii=False,
                ),
            ),
            row(key="reminder_popup_on_start", value=json.dumps(False)),
        ],
    )
    ctx.insert(
        "llm_config_record",
        [
            row(
                name="压力测试配置一",
                provider="deepseek",
                base_url="https://api.deepseek.com/v1",
                api_key="",
                model="deepseek-v4-flash",
                temperature=0.1,
                timeout_seconds=120,
                max_tokens=0,
                api_style="openai",
                top_p=None,
                frequency_penalty=None,
                presence_penalty=None,
                seed=None,
                top_k=None,
                repetition_penalty=None,
                stop=[],
                thinking_budget=None,
                thinking_enabled=False,
                thinking_effort="",
                thinking_style="auto",
                extra_body={},
                created_at=now - timedelta(days=5),
                updated_at=now - timedelta(days=5),
            ),
            row(
                name="压力测试配置二",
                provider="custom",
                base_url="https://llm.example.com/v1",
                api_key="",
                model="fictional-model",
                temperature=0.2,
                timeout_seconds=60,
                max_tokens=0,
                api_style="openai",
                top_p=None,
                frequency_penalty=None,
                presence_penalty=None,
                seed=None,
                top_k=None,
                repetition_penalty=None,
                stop=[],
                thinking_budget=None,
                thinking_enabled=False,
                thinking_effort="",
                thinking_style="auto",
                extra_body={},
                created_at=now - timedelta(days=3),
                updated_at=now - timedelta(days=3),
            ),
        ],
    )


def seed_webform(ctx: SeedContext) -> None:
    now = ctx.now
    ctx.insert(
        "web_form_profile_entry",
        [
            row(
                field_key=WEBFORM_KEYS[i % len(WEBFORM_KEYS)],
                value=f"虚构值-{i + 1}",
                label=WEBFORM_KEYS[i % len(WEBFORM_KEYS)].removeprefix("CUSTOM_"),
                source=("manual", "learned")[i % 2],
                reuse=("general", "scenario", "once")[i % 3],
                created_at=now - timedelta(days=i % 40),
                updated_at=now - timedelta(days=i % 40),
            )
            for i in range(60)
        ],
    )
    ctx.insert(
        "web_form_profile_record",
        [
            row(
                group_key=WEBFORM_GROUPS[i % len(WEBFORM_GROUPS)],
                sort_order=i % 40,
                values={
                    "name": fake_name(i),
                    "school": "示例大学" if i % 2 else "示例财经大学",
                    "major": JD_MAJORS[i % len(JD_MAJORS)],
                    "start": "2019.09",
                    "end": "2023.06",
                    "detail": f"压力测试虚构分组记录 {i + 1}",
                },
                created_at=now - timedelta(hours=i * 6),
                updated_at=now - timedelta(hours=i * 6),
            )
            for i in range(240)
        ],
    )
    ctx.insert(
        "web_form_fill_record",
        [
            row(
                url=f"https://careers.example.com/apply/{i + 1}",
                page_title=f"虚构招聘表单（{i + 1}）",
                items=[
                    {
                        "index": k,
                        "field": "full_name" if k == 0 else f"field_{k}",
                        "field_label": "姓名" if k == 0 else f"字段 {k}",
                        "control_label": f"控件 {k}",
                        "value": "张虚构" if k == 0 else f"值{k}",
                        "status": "filled" if k % 4 else ("unverified" if k % 4 == 1 else "failed"),
                        "detail": "",
                        "source": "profile",
                    }
                    for k in range(10)
                ],
                filled=7,
                unverified=2,
                failed=1,
                page_snapshot=[
                    {"index": k, "label": f"字段 {k}", "value": f"值{k}", "filled": k % 4 != 1}
                    for k in range(10)
                ],
                source=("batch", "live")[i % 2],
                created_at=now - timedelta(hours=i * 8),
                updated_at=now - timedelta(hours=i * 8),
                deleted_at=now - timedelta(days=i % 21) if i % 35 == 6 else None,
            )
            for i in range(80)
        ],
    )
    ctx.insert(
        "web_form_url_history",
        [
            row(
                url=f"https://careers.example.com/apply/history/{i + 1}",
                title=f"虚构网申页（{i + 1}）",
                created_at=now - timedelta(days=i),
                last_used_at=now - timedelta(days=i),
            )
            for i in range(40)
        ],
    )
