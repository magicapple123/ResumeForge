# SPDX-License-Identifier: Apache-2.0
"""Apply/tracker-domain generator: tasks, items, queue, claims, tracks,
track events, reminders, referrals and fact-drilling sessions."""

from __future__ import annotations

from datetime import timedelta

from .context import SeedContext, date_str, row
from .vocab import COMPANIES, TITLES, fake_name

TASK_STATUSES_ALL = (
    "pending",
    "running",
    "paused",
    "breaker_paused",
    "completed",
    "stopped",
    "failed",
)
ITEM_STATUSES_ALL = ("pending", "running", "success", "failed", "skipped")
FAILURE_POOL = (
    "selector_invalid",
    "login_required",
    "captcha_required",
    "greeting_missing",
    "network_timeout",
    "file_upload_failed",
    "site_unsupported",
    "profile_insufficient",
    "unconfirmed",
    "unknown",
)

CLAIM_CATEGORIES_ALL = (
    "教育经历",
    "实习/工作",
    "项目经历",
    "校园经历",
    "专业技能",
    "荣誉奖项",
    "其他",
)
RESPONSIBILITY_ALL = ("参与", "负责模块", "主导方案或交付", "项目负责人")
VERIFICATION_ALL = ("已确认", "待确认", "已过期", "不采用")

TRACK_STATUSES_ALL = (
    "applied",
    "screening",
    "assessment",
    "interview",
    "offer",
    "rejected",
    "unknown",
)
CHANNELS_ALL = ("unknown", "referral", "official_website", "job_platform", "headhunter", "other")
TRACK_SOURCE_ALL = ("apply", "manual", "recognized")

# Ladder of canonical status progressions; events beyond it repeat earlier
# transitions so from/to covers all states (including an empty origin).
STAGE_LADDER = [
    ("", "applied"),
    ("applied", "screening"),
    ("screening", "assessment"),
    ("assessment", "interview"),
    ("interview", "offer"),
]

REMINDER_KINDS_ALL = ("interview", "assessment_deadline", "hr_reply", "other")
REMINDER_STATUSES_ALL = ("pending", "done", "dismissed")
REFERRAL_STATUSES_ALL = ("active", "submitted", "closed", "invalid")
EVIDENCE_ALL = ("verified", "partial", "unverified", "contradictory", "not_covered")


def seed_apply_tasks(ctx: SeedContext) -> None:
    now = ctx.now
    count = ctx.counts.apply_task
    ctx.insert(
        "apply_task",
        [
            row(
                id=i + 1,
                kind="apply" if i % 3 else "collect",
                status=TASK_STATUSES_ALL[i % len(TASK_STATUSES_ALL)],
                total=8,
                processed=8 if i % 7 != 0 else 3,
                succeeded=5,
                failed=2,
                skipped=1,
                current_step="idle" if i % 7 != 0 else "submitting",
                stop_reason={0: "done", 1: "user", 2: "breaker", 3: "error"}.get(i % 4, ""),
                config={"limit_per_task": 5, "interval_seconds": 45},
                message="已完成" if i % 4 == 0 else "",
                started_at=now - timedelta(hours=i * 6),
                finished_at=now - timedelta(hours=i * 6) + timedelta(minutes=20),
                created_at=now - timedelta(hours=i * 6),
            )
            for i in range(count)
        ],
    )


def seed_apply_items(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> None:
    now = ctx.now
    count = ctx.counts.apply_task_item
    ctx.insert(
        "apply_task_item",
        [
            row(
                id=i + 1,
                task_id=(i % ctx.counts.apply_task) + 1,
                job_id=(i * 13 % len(job_rows)) + 1,
                job_title=job_rows[(i * 13) % len(job_rows)]["title"],
                company=job_rows[(i * 13) % len(job_rows)]["company"],
                resume_id=(i % len(resume_rows)) + 1,
                resume_title=resume_rows[i % len(resume_rows)]["title"],
                greeting="您好，我对这个岗位很感兴趣，方便聊聊吗？" if i % 4 else "",
                status=ITEM_STATUSES_ALL[i % len(ITEM_STATUSES_ALL)],
                failure_category=FAILURE_POOL[i % len(FAILURE_POOL)] if i % 5 == 3 else "",
                failure_detail="页面结构变化，控件未找到" if i % 5 == 3 else "",
                attempt=1 if i % 5 == 3 else 0,
                sort_order=i % 8,
                started_at=now - timedelta(hours=i * 2),
                finished_at=now - timedelta(hours=i * 2) + timedelta(minutes=2),
                created_at=now - timedelta(hours=i * 2),
                deleted_at=now - timedelta(days=i % 31) if i % 64 == 7 else None,
            )
            for i in range(count)
        ],
    )


def seed_apply_queue(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> None:
    """Queue rows have a unique job_id, so at most one per job."""
    now = ctx.now
    total = min(40, len(job_rows))
    start = len(job_rows) - total
    ctx.insert(
        "apply_queue_item",
        [
            row(
                id=i + 1,
                job_id=start + i,
                job_title=job_rows[start + i]["title"],
                company=job_rows[start + i]["company"],
                resume_id=(i % len(resume_rows)) + 1,
                greeting="您好，我在相关方向有实习经验，方便聊聊这个岗位吗？",
                sort_order=i,
                status=("pending", "skipped", "done")[i % 3],
                created_at=now - timedelta(hours=6 + i),
                updated_at=now - timedelta(hours=6 + i),
            )
            for i in range(total)
        ],
    )


def seed_claims(ctx: SeedContext) -> None:
    now = ctx.now
    ctx.insert(
        "claim_record",
        [
            row(
                id=i + 1,
                title=f"虚构主张 #{i + 1}：{CLAIM_CATEGORIES_ALL[i % len(CLAIM_CATEGORIES_ALL)]}",
                category=CLAIM_CATEGORIES_ALL[i % len(CLAIM_CATEGORIES_ALL)],
                subject=COMPANIES[i % len(COMPANIES)],
                source_fact="压力测试虚构事实：来自某次虚构项目的内部数据。",
                candidate_wording="把该虚构事实写成一句可放进简历的表述。",
                sources=[
                    {
                        "type": "pull_request",
                        "location": "example/repo#1",
                        "public": True,
                        "note": "",
                    }
                ],
                responsibility_level=RESPONSIBILITY_ALL[i % len(RESPONSIBILITY_ALL)],
                verification_status=VERIFICATION_ALL[i % len(VERIFICATION_ALL)],
                allowed_uses=["resume"] if i % 2 else ["resume", "interview"],
                interview_details={
                    "decisions": ["口径怎么定"],
                    "difficulties": [],
                    "verification": [],
                    "result": None,
                },
                boundary="只覆盖本人负责的部分。",
                risk_notes=[],
                last_verified=date_str(now - timedelta(days=i % 30)) if i % 4 == 0 else "",
                created_at=now - timedelta(days=i),
                updated_at=now - timedelta(days=i),
                deleted_at=now - timedelta(days=i % 17) if i % 17 == 5 else None,
            )
            for i in range(40)
        ],
    )


def seed_tracks(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> int:
    """Insert application tracks; return the count (later domains reference ids).

    ``count`` stays a multiple of 12: company = COMPANIES[i // 12] and
    title = TITLES[i % 12], with (company_key, title_key) unique.
    """
    now = ctx.now
    count = ctx.counts.application_track
    track_rows: list[dict] = []
    for i in range(count):
        company = COMPANIES[i // 12]
        title = TITLES[i % 12]
        status = TRACK_STATUSES_ALL[i % len(TRACK_STATUSES_ALL)]
        applied = ctx.rand_dt(ctx.event_range_start, now)
        track_rows.append(
            row(
                id=i + 1,
                company=company,
                title=title,
                company_key=company.casefold(),
                title_key=title.casefold(),
                status=status,
                stage_note={"interview": "二面", "assessment": "笔试", "offer": "意向已发"}.get(
                    status, ""
                ),
                applied_at=date_str(applied),
                status_date=date_str(applied + timedelta(days=ctx.rng.randint(1, 20))),
                next_action="等通知" if status in ("applied", "screening") else "",
                next_action_date="",
                note="压力测试虚构进度" if i % 13 == 0 else "",
                evidence="收到通知邮件（虚构）" if i % 2 else "",
                job_id=(i % len(job_rows)) + 1,
                resume_id=(i % len(resume_rows)) + 1,
                resume_title=resume_rows[i % len(resume_rows)]["title"],
                channel=CHANNELS_ALL[i % len(CHANNELS_ALL)],
                source=TRACK_SOURCE_ALL[i % len(TRACK_SOURCE_ALL)],
                created_at=applied,
                updated_at=applied + timedelta(days=ctx.rng.randint(1, 30)),
                deleted_at=now - timedelta(days=i % 23) if i % 73 == 9 else None,
            )
        )
    ctx.insert("application_track", track_rows, chunk=250)
    return count


def seed_track_events(ctx: SeedContext, track_count: int) -> None:
    """>= 7 progression events per track; the first 320 tracks get one extra."""
    now = ctx.now
    event_rows: list[dict] = []
    event_id = 0
    for i in range(track_count):
        n_events = 8 if i < min(320, track_count) else 7
        base_time = ctx.rand_dt(ctx.event_range_start, now)
        for k in range(n_events):
            event_id += 1
            if k < len(STAGE_LADDER):
                from_status, to_status = STAGE_LADDER[k]
            elif k == len(STAGE_LADDER):
                from_status, to_status = "interview", "rejected"
            else:
                from_status, to_status = (
                    ("screening", "screening") if k % 2 else ("applied", "applied")
                )
            event_at = base_time + timedelta(days=k * ctx.rng.randint(3, 15))
            if event_at > now:
                event_at = now - timedelta(hours=event_id % 72)
            event_rows.append(
                row(
                    track_id=i + 1,
                    event_at=event_at,
                    status_date=date_str(event_at),
                    source=("user", "system")[k % 2],
                    user_confirmed=bool(k % 2),
                    from_status=from_status,
                    to_status=to_status,
                )
            )
    ctx.insert("application_track_event", event_rows, chunk=500)


def seed_reminders(ctx: SeedContext, job_rows: list[dict], resume_rows: list[dict]) -> None:
    now = ctx.now
    ctx.insert(
        "reminder",
        [
            row(
                title=f"虚构提醒（{i + 1}）：{REMINDER_KINDS_ALL[i % len(REMINDER_KINDS_ALL)]}",
                remind_at=now + timedelta(days=ctx.rng.randint(-20, 30)),
                kind=REMINDER_KINDS_ALL[i % len(REMINDER_KINDS_ALL)],
                status=REMINDER_STATUSES_ALL[i % len(REMINDER_STATUSES_ALL)],
                track_id=(i % ctx.counts.application_track) + 1,
                job_id=(i % len(job_rows)) + 1,
                resume_id=(i % len(resume_rows)) + 1,
                note="压力测试虚构提醒",
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
                deleted_at=now - timedelta(days=i % 11) if i % 40 == 8 else None,
            )
            for i in range(120)
        ],
    )


def seed_referrals(ctx: SeedContext, job_rows: list[dict]) -> None:
    now = ctx.now
    ctx.insert(
        "referral",
        [
            row(
                job_id=(i % len(job_rows)) + 1,
                job_title=job_rows[i % len(job_rows)]["title"],
                company=job_rows[i % len(job_rows)]["company"],
                referrer_name=fake_name(i),
                referrer_contact=f"referral{i + 1}@example.com",
                relation=("前同事", "校友", "朋友", "网友")[i % 4],
                position=TITLES[i % len(TITLES)],
                channel=("同事", "校友", "官网内推码", "牛客")[i % 4],
                status=REFERRAL_STATUSES_ALL[i % len(REFERRAL_STATUSES_ALL)],
                track_id=(i % ctx.counts.application_track) + 1,
                converted=False,
                submitted_at=date_str(now - timedelta(days=i)) if i % 2 else "",
                note="压力测试虚构内推",
                referral_code=f"REF-STRESS-{i + 1:04d}" if i % 2 else "",
                note_images=[],
                created_at=now - timedelta(days=i),
                updated_at=now - timedelta(days=i),
                deleted_at=now - timedelta(days=i % 15) if i % 30 == 3 else None,
            )
            for i in range(60)
        ],
    )


def seed_drills(ctx: SeedContext) -> None:
    """Fact-drilling sessions/contracts/turns referencing the 40 fixed claims."""
    now = ctx.now
    ctx.insert(
        "drill_session",
        [
            row(
                id=i + 1,
                title=f"虚构深挖会话（{i + 1}）",
                job_id=(i % ctx.counts.job) + 1,
                job_title=TITLES[i % len(TITLES)],
                company=COMPANIES[i % len(COMPANIES)],
                status=("active", "finished")[i % 2],
                feedback_policy=("deferred", "immediate")[i % 2],
                claim_ids=[(i % 40) + 1],
                max_questions=6,
                current_index=3,
                review={"summary": "虚构复盘"} if i % 2 else {},
                created_at=now - timedelta(days=i * 2),
                updated_at=now - timedelta(days=i * 2),
            )
            for i in range(20)
        ],
    )
    ctx.insert(
        "drill_contract",
        [
            row(
                id=i + 1,
                session_id=(i % 20) + 1,
                claim_id=(i % 40) + 1,
                claim_title=f"虚构主张 #{(i % 40) + 1}",
                question="这道题要验证的虚构主张是什么？",
                intent="验证口径与本人贡献",
                required_evidence=["数据来源", "本人分工"],
                followup_triggers=["口径含糊"],
                stop_condition="证据齐备或确认讲不清",
                status=EVIDENCE_ALL[i % len(EVIDENCE_ALL)],
                evidence_found=["内部台账"],
                missing=["外部佐证"],
                contradictions=[],
                followup_depth=i % 3,
                next_followup_kind=("metric", "decision")[i % 2],
                created_at=now - timedelta(days=i),
                updated_at=now - timedelta(days=i),
            )
            for i in range(60)
        ],
    )
    ctx.insert(
        "drill_turn",
        [
            row(
                session_id=(i % 20) + 1,
                contract_id=(i % 60) + 1,
                question="虚构追问：这个数字是怎么统计的？",
                answer="虚构回答：按周汇总去重后的报名数。",
                status=EVIDENCE_ALL[i % len(EVIDENCE_ALL)],
                feedback="继续追问口径" if i % 2 else "",
                next_question="" if i % 3 == 0 else "虚构追问：你的分工是？",
                created_at=now - timedelta(days=i % 20),
            )
            for i in range(120)
        ],
    )
