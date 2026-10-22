# SPDX-License-Identifier: Apache-2.0
"""投递队列、模型配置、助手会话与技能域。

搬迁自 ``scripts/seed_demo_data.py`` 第 1309–1528 行（原文的
``# ── 投递队列 + 批次历史 ──``、``# ── 模型配置 ──``、``# ── 求职助手会话 ──``、
``# ── 助手技能 ──`` 四段）。
"""

from __future__ import annotations

from datetime import timedelta

from demo_data.base import NOW, ins, row
from demo_data.jobs import JOBS
from demo_data.resumes_ledger import RESUMES


def seed() -> None:
    """写入投递队列/批次历史、模型配置、助手会话与助手技能。"""
    # ── 投递队列 + 批次历史 ─────────────────────────────────────────────────────
    queue_rows = []
    for i, jid in enumerate([1, 4, 5, 7]):
        job = JOBS[jid - 1]
        queue_rows.append(
            row(
                id=i + 1,
                job_id=jid,
                job_title=job["title"],
                company=job["company"],
                resume_id=1 if jid != 4 else 2,
                greeting=f"您好，我在{job['title']}方向有 3 年经验，方便聊聊这个岗位吗？",
                sort_order=i,
                status="pending",
                created_at=NOW - timedelta(hours=6),
                updated_at=NOW - timedelta(hours=6),
            )
        )
    ins("apply_queue_item", queue_rows)

    ins(
        "apply_task",
        [
            row(
                id=1,
                kind="apply",
                status="completed",
                total=2,
                processed=2,
                succeeded=1,
                failed=0,
                skipped=1,
                current_step="idle",
                stop_reason="done",
                config={"limit_per_task": 5, "interval_seconds": 45},
                message="已完成",
                started_at=NOW - timedelta(days=2, hours=1),
                finished_at=NOW - timedelta(days=2),
                created_at=NOW - timedelta(days=2, hours=1),
            ),
            row(
                id=2,
                kind="collect",
                status="completed",
                total=1,
                processed=1,
                succeeded=1,
                failed=0,
                skipped=0,
                current_step="idle",
                stop_reason="done",
                config={"query": "市场运营", "city": "上海", "pages": 3},
                message="已完成",
                started_at=NOW - timedelta(days=4),
                finished_at=NOW - timedelta(days=4),
                created_at=NOW - timedelta(days=4),
            ),
        ],
    )

    ins(
        "apply_task_item",
        [
            row(
                id=1,
                task_id=1,
                job_id=1,
                job_title=JOBS[0]["title"],
                company=JOBS[0]["company"],
                resume_id=1,
                resume_title=RESUMES[0]["title"],
                greeting="您好，我在市场运营方向有 3 年经验，方便聊聊这个岗位吗？",
                status="success",
                failure_category="",
                failure_detail="",
                attempt=1,
                sort_order=0,
                started_at=NOW - timedelta(days=2, minutes=50),
                finished_at=NOW - timedelta(days=2, minutes=48),
                created_at=NOW - timedelta(days=2, hours=1),
            ),
            row(
                id=2,
                task_id=1,
                job_id=4,
                job_title=JOBS[3]["title"],
                company=JOBS[3]["company"],
                resume_id=2,
                resume_title=RESUMES[1]["title"],
                greeting="",
                status="skipped",
                failure_category="",
                failure_detail="按「同公司只投一个岗位」跳过：本批次已经投过「示例网络科技有限公司」的岗位。",
                attempt=0,
                sort_order=1,
                started_at=NOW - timedelta(days=2, minutes=47),
                finished_at=NOW - timedelta(days=2, minutes=47),
                created_at=NOW - timedelta(days=2, hours=1),
            ),
        ],
    )

    # ── 模型配置（演示用占位，密钥是假的） ──────────────────────────────────────
    import json  # noqa: E402

    ins(
        "app_setting",
        [
            row(
                key="llm_config",
                value=json.dumps(
                    {
                        "provider": "deepseek",
                        "base_url": "https://api.deepseek.com/v1",
                        "api_key": "",
                        # 演示库当前配置的模型；旧的 deepseek-chat 已于 2026-07-24 停用。
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

    # ── 求职助手会话 ────────────────────────────────────────────────────────────
    ins(
        "chat_conversation",
        [
            row(
                id=1,
                title="市场运营岗的简历重点怎么放",
                pinned=True,
                favorite=True,
                archived=False,
                group_name="简历",
                created_at=NOW - timedelta(days=2),
                updated_at=NOW - timedelta(days=2),
                deleted_at=None,
            )
        ],
    )
    ins(
        "chat_message",
        [
            row(
                conversation_id=1,
                role="user",
                content="我现在有 3 个市场运营方向的岗位在谈，简历里最该突出什么？",
                quoted_message_id=None,
                attachments=[],
                context={"job_ids": [1]},
                status="complete",
                error="",
                model="",
                created_at=NOW - timedelta(days=2, minutes=10),
            ),
            row(
                conversation_id=1,
                role="assistant",
                content=(
                    "按你的台账，可核对的只有「活动参与人数 1.2 万」和「转化率环比 +18%」，"
                    "这两条应该放在第一段经历的最前面，并写清口径。\n\n"
                    "至于「渠道成本下降 15%」，台账里还是「待确认」，建议先不写——"
                    "面试官一定会问统计口径。"
                ),
                quoted_message_id=None,
                attachments=[],
                context={},
                status="complete",
                error="",
                model="deepseek-v4-flash",
                created_at=NOW - timedelta(days=2, minutes=9),
            ),
        ],
    )

    # ── 助手技能 ────────────────────────────────────────────────────────────────
    ins(
        "assistant_skill",
        [
            row(
                id=1,
                name="面试官视角挑刺",
                description="用面试官视角逐条质疑简历里的说法，指出可能被追问的点",
                prompt=(
                    "你现在是一位严格的面试官。请针对我给出的简历内容逐条提问，"
                    "优先追问数字口径、我的个人贡献与失败经历。不要给我鼓励。"
                ),
                enabled=True,
                source_name="",
                created_at=NOW - timedelta(days=15),
                updated_at=NOW - timedelta(days=15),
            ),
            row(
                id=2,
                name="JD 关键词对齐",
                description="把岗位 JD 的关键词和我的资料逐条对齐，标出缺口",
                prompt="请读取岗位 JD 与我的个人资料，逐条列出：已覆盖、表达缺口、真实缺口。",
                enabled=True,
                source_name="",
                created_at=NOW - timedelta(days=8),
                updated_at=NOW - timedelta(days=8),
            ),
        ],
    )
