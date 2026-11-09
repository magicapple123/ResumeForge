# SPDX-License-Identifier: Apache-2.0
"""模拟面试：两场已结束 + 一场进行中，外加一份题库历史与一份复盘历史。

模拟面试不是聊天记录，而是「一条主张 → 一道契约 → 若干轮追问 → 一个判定」。所以
每场都要写齐 ``drill_contract``（问题与必要证据）、``drill_turn``（问答与下一问）和
``drill_session.review``（复盘），只写 session 的话界面会显示"0 道题、没有复盘"。

⚠️ ``claim_title`` 必须与 ``claims.py`` 里的 ``title`` 逐字一致：契约与复盘的 action
是按标题对账的，差一个字就变成"主张不存在"。
"""

from __future__ import annotations

from datetime import timedelta

from dataset_seed.base import NOW, ins, row
from dataset_seed.jobs import JOBS

SESSIONS = [
    {
        "id": 1,
        "title": "杭州枢云 · 后端开发工程师（一面）",
        "job_index": 0,
        "status": "finished",
        "feedback_policy": "deferred",
        "max_questions": 6,
        "claim_ids": [1, 2, 3],
        "days_ago": 1,
        "review": {
            "covered": "接口缓存、慢查询治理、对账导出改异步三条主张。",
            "verified_summary": "命中率与慢查询两条讲清了口径、分母与前后对比，追问两次仍站得住。",
            "gaps_summary": "异步任务那条没讲清「任务失败用户怎么知道」，被追问后答成了 Celery 重试配置。",
            "actions": [
                {
                    "claim_title": "订单详情接口 P95 从 380 ms 降到 95 ms（缓存命中率 43% → 91%）",
                    "kind": "补事实",
                    "detail": "补一句「命中率按请求命中任一层的比例，不含被限流的请求」，并准备回源曲线。",
                },
                {
                    "claim_title": "对账导出改异步任务，超时错误率从 8.4% 降到 0.2%",
                    "kind": "改弱表述",
                    "detail": "把「错误率降到 0.2%」限定为网关 5xx 与超时两类，不含参数校验失败。",
                },
                {
                    "claim_title": "慢查询日均从 2.3 万条降到 900 条，对账导出从 42 s 降到 6 s",
                    "kind": "补事实",
                    "detail": "准备剩余 900 条的归类：报表类长事务占七成，已单独归类不再计入告警。",
                },
            ],
            "rehearsal": [
                {
                    "claim_title": "订单详情接口 P95 从 380 ms 降到 95 ms（缓存命中率 43% → 91%）",
                    "kind": "variant",
                    "why": "换个问法：「如果 QPS 明天涨十倍，你这套缓存还够吗？」",
                },
                {
                    "claim_title": "慢查询日均从 2.3 万条降到 900 条，对账导出从 42 s 降到 6 s",
                    "kind": "deeper",
                    "why": "往下一层问：深分页为什么改成游标，offset 的代价到底在哪？",
                },
            ],
        },
        "contracts": [
            {
                "id": 1,
                "claim_id": 1,
                "claim_title": "订单详情接口 P95 从 380 ms 降到 95 ms（缓存命中率 43% → 91%）",
                "question": "命中率从 43% 到 91%，这个命中率的分母到底是什么？",
                "intent": "确认指标口径，排除「把分母做小」的假提升。",
                "required_evidence": ["分母定义", "统计窗口", "空值缓存算不算命中"],
                "followup_triggers": ["只报结果不报口径", "把缓存请求数当分母"],
                "stop_condition": "说清分母是「请求命中任一层的比例」，且不含被限流拒绝的请求。",
                "status": "verified",
                "evidence_found": [
                    "分母 = 命中任一层的请求数 / 总请求数",
                    "统计窗口 7 天",
                    "空值缓存单独统计，不算命中",
                ],
                "missing": [],
                "contradictions": [],
                "followup_depth": 1,
                "next_followup_kind": "metric",
            },
            {
                "id": 2,
                "claim_id": 2,
                "claim_title": "慢查询日均从 2.3 万条降到 900 条，对账导出从 42 s 降到 6 s",
                "question": "还剩 900 条慢查询，为什么不继续优化？",
                "intent": "验证是「做到边界」还是「做不动了」。",
                "required_evidence": ["剩余慢查询的归类", "优先级判断", "是否影响线上"],
                "followup_triggers": ["只说「收益不大」"],
                "stop_condition": "给出剩余部分的归类与取舍理由，并说明告警策略怎么调。",
                "status": "partial",
                "evidence_found": ["剩余以报表类长事务为主"],
                "missing": ["剩余慢查询的分类占比", "为什么先不动报表链路"],
                "contradictions": [],
                "followup_depth": 1,
                "next_followup_kind": "priority",
            },
            {
                "id": 3,
                "claim_id": 3,
                "claim_title": "对账导出改异步任务，超时错误率从 8.4% 降到 0.2%",
                "question": "改成异步之后，任务失败了用户怎么知道？",
                "intent": "看是否只做了「不超时」，而没做「可观测」。",
                "required_evidence": ["失败通知方式", "重试与幂等", "任务结果保留策略"],
                "followup_triggers": ["把重试当兜底的全部"],
                "stop_condition": "说清失败通知、幂等键与结果保留时长。",
                "status": "unverified",
                "evidence_found": ["有轮询进度接口"],
                "missing": ["失败通知方式", "幂等键设计"],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "",
            },
        ],
        "turns": [
            {
                "contract_id": 1,
                "question": "命中率从 43% 到 91%，这个命中率的分母到底是什么？",
                "answer": "分母是所有打到这个接口的请求，分子是命中 Redis 或进程内 LRU 的请求，窗口 7 天。",
                "status": "partial",
                "feedback": "",
                "next_question": "那空值缓存算不算命中？被限流的请求算不算？",
            },
            {
                "contract_id": 1,
                "question": "那空值缓存算不算命中？被限流的请求算不算？",
                "answer": "空值缓存单独统计、不算命中；被限流拒绝的请求不进分母，因为它没到业务逻辑。",
                "status": "verified",
                "feedback": "",
                "next_question": "",
            },
            {
                "contract_id": 2,
                "question": "还剩 900 条慢查询，为什么不继续优化？",
                "answer": "剩下的主要是报表类长事务，占比七成左右，跑在只读库上……具体分类我记在结案材料里了。",
                "status": "partial",
                "feedback": "",
                "next_question": "如果让你只挑一条继续优化，你挑哪条？",
            },
            {
                "contract_id": 2,
                "question": "如果让你只挑一条继续优化，你挑哪条？",
                "answer": "对账单明细那条：它同时被三个报表引用，改成物化视图能一次覆盖三个场景……但这条我还没做。",
                "status": "partial",
                "feedback": "",
                "next_question": "",
            },
            {
                "contract_id": 3,
                "question": "改成异步之后，任务失败了用户怎么知道？",
                "answer": "前端轮询进度接口，失败会返回 error，用户可以重试；重试是 Celery 那边配的。",
                "status": "unverified",
                "feedback": "",
                "next_question": "",
            },
        ],
    },
    {
        "id": 2,
        "title": "杭州灵枢 · AI Agent 开发工程师（二面）",
        "job_index": 1,
        "status": "active",
        "feedback_policy": "immediate",
        "max_questions": 6,
        "claim_ids": [4, 5],
        "days_ago": 0,
        "review": {},
        "contracts": [
            {
                "id": 4,
                "claim_id": 4,
                "claim_title": "Agent 工具调用成功率从 79% 提升到 94%（9 个工具）",
                "question": "成功率 79% 到 94%，剩下 6% 失败在哪？",
                "intent": "确认是真的分析过失败分布，而不是只报一个数。",
                "required_evidence": ["失败类型分布", "哪些是主动放弃", "是否可继续降"],
                "followup_triggers": ["把主动放弃算成失败"],
                "stop_condition": "说清剩余失败的类型占比，并指出哪部分是合理的放弃。",
                "status": "partial",
                "evidence_found": ["剩余以知识库无答案时的主动放弃为主"],
                "missing": ["失败类型的具体占比"],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "metric",
            }
        ],
        "turns": [
            {
                "contract_id": 4,
                "question": "成功率 79% 到 94%，剩下 6% 失败在哪？",
                "answer": "主要是模型判断知识库没有答案时主动放弃，还有少量工具超时；超时后来加了 3 秒上限和一次重试。",
                "status": "partial",
                "feedback": "方向对，但要给出占比，否则听感像「大概是这些」。",
                "next_question": "那 Recall@5 从 61% 到 84%，这 84% 是怎么判对的？",
            }
        ],
    },
    {
        "id": 3,
        "title": "上海曦和 · 大模型应用开发工程师（快问快答）",
        "job_index": 12,
        "status": "finished",
        "feedback_policy": "deferred",
        "max_questions": 3,
        "claim_ids": [7],
        "days_ago": 4,
        "review": {
            "covered": "只覆盖了 Agent 工作台一条主张。",
            "verified_summary": "四步链路与事实校验讲得清楚，可以照这个版本说。",
            "gaps_summary": "没有时间覆盖工具层与检索两条。",
            "actions": [],
            "rehearsal": [],
        },
        "contracts": [
            {
                "id": 5,
                "claim_id": 7,
                "claim_title": "求职 Agent 工作台编造率从 11% 降到 1.2%（240 条样本）",
                "question": "用一分钟讲清楚这个 Agent 工作台。",
                "intent": "看能不能把项目压缩成一分钟版本。",
                "required_evidence": ["问题", "做法", "结果"],
                "followup_triggers": [],
                "stop_condition": "一分钟内讲完四步链路，且结果带数字。",
                "status": "verified",
                "evidence_found": ["问题", "四步链路与事实校验", "11% → 1.2%（240 条）"],
                "missing": [],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "",
            }
        ],
        "turns": [
            {
                "contract_id": 5,
                "question": "用一分钟讲清楚这个 Agent 工作台。",
                "answer": (
                    "按 JD 改简历时模型最容易编事实。我把流程拆成意图识别、事实检索、改写、事实校验四步，"
                    "每步输出落库可回溯；校验那步要求每句话都能对上事实台账，编造率从 11% 降到 1.2%。"
                ),
                "status": "verified",
                "feedback": "",
                "next_question": "",
            }
        ],
    },
]

QUESTION_BANK = {
    "job_index": 0,
    "resume_id": 1,
    "resume_title": "后端开发工程师 - 杭州枢云信息科技有限公司",
    "model": "deepseek-v4-flash",
    "days_ago": 2,
    "groups": [
        {
            "type": "基础题",
            "questions": [
                {
                    "question": "联合索引 (a, b, c)，只按 b 查走不走索引？为什么？",
                    "purpose": "确认最左前缀是背下来的还是理解的。",
                    "answer_hint": "不走；从索引结构与 B+ 树的排序方式解释，再补一句覆盖索引的例外。",
                },
                {
                    "question": "缓存和数据库的一致性，你先删缓存还是先更新数据库？",
                    "purpose": "看有没有工程取舍，而不是背结论。",
                    "answer_hint": "说清延迟双删 / 订阅 binlog 各自解决什么问题，以及 TTL 兜底的作用。",
                },
            ],
        },
        {
            "type": "项目深挖题",
            "questions": [
                {
                    "question": "命中率到 91% 之后，剩下的 9% 是什么请求？",
                    "purpose": "验证优化是真的做到边界，而不是停在好看的数字上。",
                    "answer_hint": "空值、高基数 key、刚发布的新商品；各占多少、能不能继续压。",
                },
                {
                    "question": "对账导出改异步，幂等是怎么做的？",
                    "purpose": "看有没有踩过重复导出的坑。",
                    "answer_hint": "幂等键 + 任务去重 + 结果保留期，说清重复提交会怎样。",
                },
            ],
        },
        {
            "type": "反问HR题",
            "questions": [
                {
                    "question": "这个岗位前六个月最重要的交付是什么？",
                    "purpose": "判断岗位预期是否与自己的经验匹配。",
                    "answer_hint": "问具体的交付物，不问「团队氛围怎么样」。",
                }
            ],
        },
    ],
}

REVIEW_RECORD = {
    "job_index": 1,
    "resume_id": 1,
    "resume_title": "后端开发工程师 - 杭州枢云信息科技有限公司",
    "model": "deepseek-v4-flash",
    "days_ago": 5,
    "questions": [
        "Agent 答错了，你怎么判断是检索还是工具的问题？",
        "Recall@5 的 84% 是怎么判对的？",
        "评测集怎么防止过拟合？",
        "如果模型坚持调用不存在的工具，你怎么兜？",
    ],
    "analysis": {
        "framework": (
            "四道题分别对应故障归因、指标口径、评测集设计与边界兜底。前两题答得稳，"
            "第三题只说了「定期换样本」，缺一步判断评测集是否饱和；第四题可以用「工具白名单 + "
            "一次纠正提示 + 兜底文本」三段来答。"
        )
    },
    "suggestions": [
        {
            "priority": "high",
            "section": "项目经历",
            "issue": "Agent 工作台只写了「事实校验」，没写清校验失败后怎么处理。",
            "suggestion": "补一句：校验不通过时回填错误信息让模型重写一次，仍不通过则删掉该句并标黄。",
            "evidence": ["面试官连续追问两次校验流程"],
        },
        {
            "priority": "medium",
            "section": "实习/工作经历",
            "issue": "Recall@5 84% 的边界没写。",
            "suggestion": "明确「在 160 条人工标注问答集上计算，不代表线上全量分布」。",
            "evidence": ["简历原文只有结论，没有口径"],
        },
        {
            "priority": "low",
            "section": "专业技能",
            "issue": "技能栏没有体现评测能力。",
            "suggestion": "把「LLM 应用与工具调用」拆一条「评测集设计与回归」，用 160 条与 240 条两个例子说明。",
            "evidence": ["岗位 JD 明确要求评测集建设经验"],
        },
    ],
}


def seed() -> None:
    """写 3 场模拟面试 + 1 份题库历史 + 1 份复盘历史。"""
    sessions, contracts, turns = [], [], []
    for item in SESSIONS:
        job = JOBS[item["job_index"]]
        created = NOW - timedelta(days=item["days_ago"], hours=2)
        sessions.append(
            row(
                id=item["id"],
                title=item["title"],
                job_id=item["job_index"] + 1,
                job_title=job["title"],
                company=job["company"],
                status=item["status"],
                feedback_policy=item["feedback_policy"],
                claim_ids=item["claim_ids"],
                max_questions=item["max_questions"],
                current_index=len(item["contracts"])
                if item["status"] == "finished"
                else len(item["turns"]),
                review=item["review"],
                created_at=created,
                updated_at=created + timedelta(minutes=40),
            )
        )
        for contract in item["contracts"]:
            contracts.append(
                row(
                    **contract,
                    session_id=item["id"],
                    created_at=created,
                    updated_at=created + timedelta(minutes=30),
                )
            )
        for index, turn in enumerate(item["turns"]):
            turns.append(
                row(
                    **turn,
                    session_id=item["id"],
                    created_at=created + timedelta(minutes=3 * (index + 1)),
                )
            )

    ins("drill_session", sessions)
    ins("drill_contract", contracts)
    ins("drill_turn", turns)

    bank_job = JOBS[QUESTION_BANK["job_index"]]
    bank_at = NOW - timedelta(days=QUESTION_BANK["days_ago"])
    ins(
        "question_bank_record",
        [
            row(
                job_id=QUESTION_BANK["job_index"] + 1,
                job_title=bank_job["title"],
                company=bank_job["company"],
                resume_id=QUESTION_BANK["resume_id"],
                resume_title=QUESTION_BANK["resume_title"],
                groups=QUESTION_BANK["groups"],
                model=QUESTION_BANK["model"],
                created_at=bank_at,
                updated_at=bank_at,
                deleted_at=None,
            )
        ],
    )

    review_job = JOBS[REVIEW_RECORD["job_index"]]
    review_at = NOW - timedelta(days=REVIEW_RECORD["days_ago"])
    ins(
        "interview_review_record",
        [
            row(
                job_id=REVIEW_RECORD["job_index"] + 1,
                job_title=review_job["title"],
                company=review_job["company"],
                resume_id=REVIEW_RECORD["resume_id"],
                resume_title=REVIEW_RECORD["resume_title"],
                questions=REVIEW_RECORD["questions"],
                analysis=REVIEW_RECORD["analysis"],
                suggestions=REVIEW_RECORD["suggestions"],
                model=REVIEW_RECORD["model"],
                created_at=review_at,
                updated_at=review_at,
                deleted_at=None,
            )
        ],
    )
