# SPDX-License-Identifier: Apache-2.0
"""求职进度、内推、提醒、投递队列、助手会话与技能。

进度记录的 ``applied_at`` 从 7 月铺到 10 月，是为了让「分析看板」的六个月趋势、
漏斗转化率都有东西可画——全部塞在同一个月里，图会变成一个尖峰。

时间线按 2027 届技术秋招的真实节奏排：8 月起投、9–10 月笔试与面试、10 月底出结果，
状态覆盖 applied / screening / assessment / interview / offer / rejected 六种。
"""

from __future__ import annotations

from datetime import timedelta

from dataset_seed.base import NOW, ins, row
from dataset_seed.jobs import JOBS

# (岗位序号, 状态, 投递日, 状态变更日, 下一步, 下一步日期, 阶段说明, 渠道, 证据)
TRACKS = [
    (
        0,
        "interview",
        "2026-09-08",
        "2026-10-24",
        "准备二面：手写 LRU + 慢查询排查",
        "2026-10-30",
        "一面已过，等二面",
        "job_platform",
        "10/24 收到一面反馈邮件",
    ),
    (
        1,
        "screening",
        "2026-10-25",
        "2026-10-27",
        "等 HR 约面",
        "2026-10-31",
        "简历已过初筛",
        "job_platform",
        "10/27 收到测评邀请",
    ),
    (
        12,
        "applied",
        "2026-10-27",
        "2026-10-27",
        "跟进内推进度",
        "2026-11-02",
        "已投递",
        "referral",
        "内推人已确认收件",
    ),
    (
        10,
        "interview",
        "2026-10-15",
        "2026-10-26",
        "准备系统设计题",
        "2026-11-01",
        "二面安排在 11/1",
        "headhunter",
        "猎头发来面试邀请",
    ),
    (
        3,
        "rejected",
        "2026-10-12",
        "2026-10-18",
        "",
        "",
        "HC 冻结，岗位下线",
        "job_platform",
        "10/18 收到婉拒邮件",
    ),
    (
        2,
        "assessment",
        "2026-10-18",
        "2026-10-22",
        "10/29 前完成在线测评",
        "2026-10-29",
        "测评已发",
        "job_platform",
        "邮件里有测评链接",
    ),
    (
        4,
        "applied",
        "2026-10-23",
        "2026-10-23",
        "等简历筛选",
        "2026-10-30",
        "已投递",
        "job_platform",
        "猎聘投递成功截图",
    ),
    (
        8,
        "rejected",
        "2026-09-28",
        "2026-10-09",
        "",
        "",
        "岗位改成长期实习，学期内时间对不上",
        "job_platform",
        "10/9 收到感谢信",
    ),
    (
        7,
        "offer",
        "2026-09-20",
        "2026-10-20",
        "10/31 前答复 offer",
        "2026-10-31",
        "口头 offer 已发，等书面",
        "referral",
        "HR 电话沟通薪资",
    ),
    (9, "applied", "2026-08-19", "2026-08-19", "", "", "实习岗，先投了试试", "other", ""),
    (
        5,
        "rejected",
        "2026-07-15",
        "2026-07-22",
        "",
        "",
        "笔试三道算法题卡在第二道",
        "official_website",
        "7/22 收到笔试结果通知",
    ),
    (
        6,
        "rejected",
        "2026-05-20",
        "2026-05-28",
        "",
        "",
        "社招岗要求 1 年以上经验",
        "job_platform",
        "",
    ),
]

REFERRALS = [
    {
        "job_index": 7,
        "referrer_name": "陈立",
        "referrer_contact": "微信 chenli_dev",
        "relation": "学长（同实验室）",
        "channel": "熟人直接递",
        "status": "submitted",
        "converted": True,
        "submitted_at": "2026-09-21",
        "note": "他把简历直接转给了客户端组 leader，一周内约面。",
        "referral_code": "",
    },
    {
        "job_index": 12,
        "referrer_name": "吴穹",
        "referrer_contact": "wu.qiong@qq.com",
        "relation": "同队队友（二手平台项目）",
        "channel": "官网内推码",
        "status": "submitted",
        "converted": False,
        "submitted_at": "2026-10-27",
        "note": "内推码 XH2027-1146，投递时填在备注里。",
        "referral_code": "XH2027-1146",
    },
    {
        "job_index": 0,
        "referrer_name": "周敏华",
        "referrer_contact": "微信 zhoumh_cs",
        "relation": "国创项目指导老师",
        "channel": "邮箱推荐",
        "status": "active",
        "converted": False,
        "submitted_at": "",
        "note": "老师说她和枢云有合作项目，可以先聊聊再走正式流程。",
        "referral_code": "",
    },
]

# (标题, 相对 NOW 的小时数, 类型, 状态, 关联进度序号, 备注)
REMINDERS = [
    (
        "二面：枢云科技 后端开发工程师",
        -30,
        "interview",
        "pending",
        0,
        "线上会议，提前 10 分钟进会议室",
    ),
    ("提交云枢在线测评", 6, "assessment_deadline", "pending", 5, "测评链接 10/29 23:59 失效"),
    ("回复启岸 offer", 72, "hr_reply", "pending", 8, "先确认薪资结构与签约时间再答复"),
    ("跟进曦和 HR 约面", 26, "hr_reply", "pending", 2, ""),
    ("准备星河云图系统设计题", 96, "interview", "pending", 3, "大概率考限流与缓存一致性"),
    ("整理 9 月投递复盘", -120, "other", "done", None, "已写完，结论进了知识库"),
    ("取消的宣讲会提醒", -200, "other", "dismissed", None, "岗位已下架"),
]

QUEUE = [
    (
        0,
        "您好，我是沈亦舟，计算机本科 2027 届。在枢云做过交易中台接口：订单详情 P95 从 380 ms 降到 95 ms，"
        "慢查询日均从 2.3 万条降到 900 条。看到贵司在招后端，想聊聊交易域的容量与缓存设计。",
        "pending",
    ),
    (
        1,
        "您好，我在灵枢做过 Agent 工具层，9 个 function tool 的调用成功率从 79% 提到 94%，"
        "也搭过 160 条评测集。想了解贵司 Agent 产品的工具边界是怎么划分的。",
        "pending",
    ),
    (
        12,
        "您好，我是吴穹推荐的内推候选人，做过 Agent 工作台与 RAG 召回优化（Recall@5 61%→84%），"
        "对大模型应用的评测链路很感兴趣。",
        "done",
    ),
    (
        10,
        "您好，我有 Redis + Lua 限流与短链发号的项目经验，想了解这个岗位更偏长连接网关还是业务服务端。",
        "pending",
    ),
    (
        2,
        "您好，我做过 React + FastAPI 的全栈项目（500 并发下 P95 210 ms），"
        "想了解贵司协同办公产品的前后端分工方式。",
        "skipped",
    ),
    (
        4,
        "您好，我做过混合检索与重排的对比实验（Recall@5 62%→79%，MRR 0.62→0.79），"
        "想了解算法岗这边工程与研究的比例。",
        "pending",
    ),
]


def seed() -> None:
    """写进度、内推、提醒、投递队列、历史任务、助手会话与技能。"""
    tracks = []
    for index, (
        job_index,
        status,
        applied,
        status_date,
        action,
        action_date,
        stage,
        channel,
        evidence,
    ) in enumerate(TRACKS):
        job = JOBS[job_index]
        tracks.append(
            row(
                company=job["company"],
                title=job["title"],
                company_key=job["company"],
                title_key=job["title"],
                status=status,
                stage_note=stage,
                applied_at=applied,
                status_date=status_date,
                next_action=action,
                next_action_date=action_date,
                note="",
                evidence=evidence,
                job_id=job_index + 1,
                resume_id=1 if index == 0 else None,
                resume_title="后端开发工程师 - 杭州枢云信息科技有限公司" if index == 0 else "",
                channel=channel,
                source="manual",
                created_at=NOW - timedelta(days=60 - index * 4),
                updated_at=NOW - timedelta(days=20 - index),
                deleted_at=None,
            )
        )
    ins("application_track", tracks)

    ins(
        "referral",
        [
            row(
                job_id=item["job_index"] + 1,
                job_title=JOBS[item["job_index"]]["title"],
                company=JOBS[item["job_index"]]["company"],
                referrer_name=item["referrer_name"],
                referrer_contact=item["referrer_contact"],
                relation=item["relation"],
                position=JOBS[item["job_index"]]["title"],
                channel=item["channel"],
                status=item["status"],
                # job 7 的进度记录是 TRACKS 里的第 9 行（列表序号 8），主键从 1 开始。
                track_id=9 if item["job_index"] == 7 else None,
                converted=item["converted"],
                submitted_at=item["submitted_at"],
                note=item["note"],
                referral_code=item["referral_code"],
                note_images=[],
                created_at=NOW - timedelta(days=30 - index * 5),
                updated_at=NOW - timedelta(days=10 - index * 2),
                deleted_at=None,
            )
            for index, item in enumerate(REFERRALS)
        ],
    )

    ins(
        "reminder",
        [
            row(
                title=title,
                remind_at=NOW + timedelta(hours=hours),
                kind=kind,
                status=status,
                track_id=(track_index + 1) if track_index is not None else None,
                job_id=None,
                resume_id=None,
                note=note,
                created_at=NOW - timedelta(days=5),
                updated_at=NOW - timedelta(days=1),
                deleted_at=None,
            )
            for title, hours, kind, status, track_index, note in REMINDERS
        ],
    )

    ins(
        "apply_queue_item",
        [
            row(
                job_id=job_index + 1,
                job_title=JOBS[job_index]["title"],
                company=JOBS[job_index]["company"],
                resume_id=1,
                greeting=greeting,
                sort_order=index,
                status=status,
                created_at=NOW - timedelta(days=10 - index),
                updated_at=NOW - timedelta(days=10 - index),
            )
            for index, (job_index, greeting, status) in enumerate(QUEUE)
        ],
    )

    ins(
        "apply_task",
        [
            row(
                id=1,
                kind="apply",
                status="completed",
                total=3,
                processed=3,
                succeeded=2,
                failed=0,
                skipped=1,
                current_step="done",
                stop_reason="",
                config={"site": "zhipin", "delay_seconds": 20},
                message="已处理 3 个岗位：成功 2、跳过 1。",
                started_at=NOW - timedelta(days=2, hours=1),
                finished_at=NOW - timedelta(days=2),
                created_at=NOW - timedelta(days=2, hours=2),
            ),
            row(
                id=2,
                kind="collect",
                status="completed",
                total=12,
                processed=12,
                succeeded=12,
                failed=0,
                skipped=0,
                current_step="done",
                stop_reason="",
                config={"keyword": "后端开发 校招", "city": "上海"},
                message="采集 12 条，全部进入备选岗位。",
                started_at=NOW - timedelta(days=6, minutes=40),
                finished_at=NOW - timedelta(days=6),
                created_at=NOW - timedelta(days=6, hours=1),
            ),
        ],
    )

    ins(
        "apply_task_item",
        [
            row(
                task_id=1,
                job_id=1,
                job_title=JOBS[0]["title"],
                company=JOBS[0]["company"],
                resume_id=1,
                resume_title="后端开发工程师 - 杭州枢云信息科技有限公司",
                greeting=QUEUE[0][1],
                status="success",
                failure_category="",
                failure_detail="",
                attempt=1,
                sort_order=0,
                started_at=NOW - timedelta(days=2, hours=1),
                finished_at=NOW - timedelta(days=2, minutes=52),
                created_at=NOW - timedelta(days=2, hours=2),
                deleted_at=None,
            ),
            row(
                task_id=1,
                job_id=2,
                job_title=JOBS[1]["title"],
                company=JOBS[1]["company"],
                resume_id=1,
                resume_title="后端开发工程师 - 杭州枢云信息科技有限公司",
                greeting=QUEUE[1][1],
                status="success",
                failure_category="",
                failure_detail="",
                attempt=1,
                sort_order=1,
                started_at=NOW - timedelta(days=2, minutes=50),
                finished_at=NOW - timedelta(days=2, minutes=30),
                created_at=NOW - timedelta(days=2, hours=2),
                deleted_at=None,
            ),
            row(
                task_id=1,
                job_id=13,
                job_title=JOBS[12]["title"],
                company=JOBS[12]["company"],
                resume_id=2,
                resume_title="大模型应用开发工程师 - 上海曦和智能科技有限公司",
                greeting=QUEUE[2][1],
                status="skipped",
                failure_category="",
                failure_detail="检测到 30 天内已投递过该岗位",
                attempt=1,
                sort_order=2,
                started_at=NOW - timedelta(days=2, minutes=28),
                finished_at=NOW - timedelta(days=2, minutes=28),
                created_at=NOW - timedelta(days=2, hours=2),
                deleted_at=None,
            ),
        ],
    )

    ins(
        "assistant_skill",
        [
            row(
                name="面试复盘教练",
                description="把一场面试的记录整理成结构化复盘：问了什么、答得如何、下次怎么答。",
                prompt=(
                    "你是面试复盘教练。用户会贴一场面试的记录或回忆。请按以下结构输出：\n"
                    "1. 被问到的核心问题（按能力维度归类）；\n"
                    "2. 每个问题的回答要点与可改进之处；\n"
                    "3. 三个下次可以问面试官的问题；\n"
                    "4. 需要补的知识清单。\n"
                    "不要编造用户没说过的细节。"
                ),
                enabled=True,
                source_name="manual",
                created_at=NOW - timedelta(days=30),
                updated_at=NOW - timedelta(days=30),
            ),
            row(
                name="JD 拆解助手",
                description="把岗位描述拆成能力项、关键词与匹配度打分，指出简历该补什么。",
                prompt=(
                    "你是岗位 JD 拆解助手。用户会给你一段 JD 和一份简历。请输出：\n"
                    "1. 岗位的三个核心能力项，各附一句 JD 原文依据；\n"
                    "2. 关键词清单（技能、行业、工具）；\n"
                    "3. 简历与 JD 的匹配点与缺口；\n"
                    "4. 三条具体修改建议（改哪一句、怎么改）。\n"
                    "只依据用户给的材料，不要补充外部信息。"
                ),
                enabled=True,
                source_name="manual",
                created_at=NOW - timedelta(days=25),
                updated_at=NOW - timedelta(days=25),
            ),
        ],
    )

    ins(
        "chat_conversation",
        [
            row(
                title="订单接口缓存与慢查询排查",
                surface="page",
                pinned=True,
                favorite=True,
                archived=False,
                group_name="后端",
                created_at=NOW - timedelta(days=4, hours=3),
                updated_at=NOW - timedelta(days=4),
                deleted_at=None,
            ),
            row(
                title="Agent 评测集怎么设计",
                surface="page",
                pinned=False,
                favorite=False,
                archived=True,
                group_name="Agent",
                created_at=NOW - timedelta(days=15),
                updated_at=NOW - timedelta(days=14),
                deleted_at=None,
            ),
        ],
    )

    ins(
        "chat_message",
        [
            row(
                conversation_id=1,
                role="user",
                content="订单详情接口 P95 还在 200 ms 左右，除了继续加缓存还有什么办法？",
                quoted_message_id=None,
                attachments=[],
                context={},
                status="complete",
                error="",
                model="",
                created_at=NOW - timedelta(days=4, hours=3),
            ),
            row(
                conversation_id=1,
                role="assistant",
                content=(
                    "三个方向，按投入从低到高：\n"
                    "1. 先确认命中率还有没有提升空间：现在是 91%，剩余 9% 多是空值和高基数 key，"
                    "可以给空结果也加短 TTL；\n"
                    "2. 再看回源本身：慢查询日志里还有 900 条，若订单详情走了多表 JOIN，"
                    "把只读字段拆成宽表能省一次 JOIN；\n"
                    "3. 最后才是并发手段：把详情接口改成异步并行取子资源，注意别把连接池打满。"
                ),
                quoted_message_id=None,
                attachments=[],
                context={},
                status="complete",
                error="",
                model="deepseek-v4-flash",
                created_at=NOW - timedelta(days=4, hours=3) + timedelta(minutes=1),
            ),
            row(
                conversation_id=2,
                role="user",
                content="Agent 评测集的失败样本，要不要按工具类型分层？",
                quoted_message_id=None,
                attachments=[],
                context={},
                status="complete",
                error="",
                model="",
                created_at=NOW - timedelta(days=15),
            ),
            row(
                conversation_id=2,
                role="assistant",
                content=(
                    "要分层，但别只按工具分。建议两层：第一层按失败类型（工具选错、参数幻觉、循环调用），"
                    "第二层按工具或场景抽样，保证长尾工具也有样本。"
                    "另外留 10% 给「开放提问」，否则评测集会只考你改过的那几种失败。"
                ),
                quoted_message_id=None,
                attachments=[],
                context={},
                status="complete",
                error="",
                model="deepseek-v4-flash",
                created_at=NOW - timedelta(days=15) + timedelta(minutes=1),
            ),
        ],
    )
