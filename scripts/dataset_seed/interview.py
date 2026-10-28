# SPDX-License-Identifier: Apache-2.0
"""模拟面试：两场已结束 + 一场进行中，外加一份题库历史与一份复盘历史。

模拟面试不是聊天记录，而是「一条主张 → 一道契约 → 若干轮追问 → 一个判定」。所以
每场都要写齐 ``drill_contract``（问题与必要证据）、``drill_turn``（问答与下一问）和
``drill_session.review``（复盘），只写 session 的话界面会显示"0 道题、没有复盘"。
"""

from __future__ import annotations

from datetime import timedelta

from dataset_seed.base import NOW, ins, row
from dataset_seed.jobs import JOBS

SESSIONS = [
    {
        "id": 1,
        "title": "澄川科技 · 用户增长分析师（模拟一面）",
        "job_index": 0,
        "status": "finished",
        "feedback_policy": "deferred",
        "max_questions": 6,
        "claim_ids": [1, 2, 4],
        "days_ago": 1,
        "review": {
            "covered": "会员召回、新客留存实验、归因看板三条主张。",
            "verified_summary": "召回率与留存两条讲清了口径、分母和实验设计，追问两次仍站得住。",
            "gaps_summary": "归因看板那条没讲清「为什么两套归因都保留」，被追问后答成了工具实现。",
            "actions": [
                {
                    "claim_title": "季度会员召回率从 8.1% 提升到 12.4%",
                    "kind": "补事实",
                    "detail": "补一句「12.4% 不含自然复购」，并准备分渠道的拆分表。",
                },
                {
                    "claim_title": "活动归因看板每月节省 12 小时人工对数",
                    "kind": "改弱表述",
                    "detail": "把「节省 12 小时」限定为月度汇总环节，不含渠道侧核对。",
                },
                {
                    "claim_title": "新客 7 日留存从 31% 提升到 38%",
                    "kind": "补事实",
                    "detail": "准备分流偏差那次的排查过程：新客标识延迟 6 小时。",
                },
            ],
            "rehearsal": [
                {
                    "claim_title": "活动归因看板每月节省 12 小时人工对数",
                    "kind": "variant",
                    "why": "换个问法：「如果只保留一套归因，你留哪套？为什么？」",
                },
                {
                    "claim_title": "季度会员召回率从 8.1% 提升到 12.4%",
                    "kind": "deeper",
                    "why": "往下一层问：召回后 60 天二次流失 41%，你准备怎么接？",
                },
            ],
        },
        "contracts": [
            {
                "id": 1,
                "claim_id": 1,
                "claim_title": "季度会员召回率从 8.1% 提升到 12.4%",
                "question": "你说召回率从 8.1% 提到 12.4%，这个分母到底是谁？",
                "intent": "确认指标口径，排除「把分母做小」的假提升。",
                "required_evidence": ["分母定义", "统计周期", "是否含自然复购"],
                "followup_triggers": ["只报结果不报口径", "把触达人数当分母"],
                "stop_condition": "说清分母是触达的沉默会员，且不含自然复购。",
                "status": "verified",
                "evidence_found": ["分母 = 本期触达的沉默会员", "统计窗口 30 天", "不含自然复购"],
                "missing": [],
                "contradictions": [],
                "followup_depth": 1,
                "next_followup_kind": "metric",
            },
            {
                "id": 2,
                "claim_id": 2,
                "claim_title": "新客 7 日留存从 31% 提升到 38%",
                "question": "12 组实验里，你怎么确认不是分流偏差带来的？",
                "intent": "验证实验设计，而不是背结论。",
                "required_evidence": ["分流校验方法", "样本量", "是否做过 AA 测试"],
                "followup_triggers": ["只说「显著」", "没有分流校验"],
                "stop_condition": "给出分流校验的具体做法与异常处理。",
                "status": "partial",
                "evidence_found": ["上线前做过 AA 测试", "样本量按 5% 提升估算"],
                "missing": ["分流偏差的排查过程"],
                "contradictions": [],
                "followup_depth": 1,
                "next_followup_kind": "failure",
            },
            {
                "id": 3,
                "claim_id": 4,
                "claim_title": "活动归因看板每月节省 12 小时人工对数",
                "question": "末次点击和线性归因差了 32%，为什么还同时保留两套？",
                "intent": "确认对归因模型的理解，而不是只会上线工具。",
                "required_evidence": ["两套归因的适用场景", "差异来源", "如何使用"],
                "followup_triggers": ["把差异归因于「数据不准」"],
                "stop_condition": "说清差异来自渠道协作，以及两套结果分别用于什么决策。",
                "status": "unverified",
                "evidence_found": ["提到品牌渠道的曝光贡献"],
                "missing": ["差异来源的具体拆解", "两套归因的使用场景"],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "",
            },
        ],
        "turns": [
            {
                "contract_id": 1,
                "question": "你说召回率从 8.1% 提到 12.4%，这个分母到底是谁？",
                "answer": "分母是本期触达的沉默会员，窗口 30 天，不含自然复购。",
                "status": "partial",
                "feedback": "",
                "next_question": "那 12.4% 里有多少是券带来的增量，而不是本来就要回来的人？",
            },
            {
                "contract_id": 1,
                "question": "那 12.4% 里有多少是券带来的增量，而不是本来就要回来的人？",
                "answer": "我们留了 5% 的对照组不发券，对照组自然回访率 6.2%，所以增量大约是 6.2 个百分点。",
                "status": "verified",
                "feedback": "",
                "next_question": "",
            },
            {
                "contract_id": 2,
                "question": "12 组实验里，你怎么确认不是分流偏差带来的？",
                "answer": "上线前做了 AA 测试，分流按设备号哈希，样本量按 5% 提升估算。",
                "status": "partial",
                "feedback": "",
                "next_question": "如果分流真出问题了，你从哪张表能看出来？",
            },
            {
                "contract_id": 2,
                "question": "如果分流真出问题了，你从哪张表能看出来？",
                "answer": "看两组的新客结构，尤其是注册渠道和首日行为分布……具体那次是新客标识延迟，后来加了校验任务。",
                "status": "partial",
                "feedback": "",
                "next_question": "",
            },
            {
                "contract_id": 3,
                "question": "末次点击和线性归因差了 32%，为什么还同时保留两套？",
                "answer": "主要是想让市场看到品牌渠道的贡献，工具上两套都算一遍成本也不高。",
                "status": "unverified",
                "feedback": "",
                "next_question": "",
            },
        ],
    },
    {
        "id": 2,
        "title": "弦月网络 · 商业分析师（模拟二面）",
        "job_index": 1,
        "status": "active",
        "feedback_policy": "immediate",
        "max_questions": 6,
        "claim_ids": [4, 6],
        "days_ago": 0,
        "review": {},
        "contracts": [
            {
                "id": 4,
                "claim_id": 6,
                "claim_title": "招聘周期从 42 天降到 29 天",
                "question": "招聘周期从 42 天降到 29 天，这个「周期」是从哪一步算到哪一步？",
                "intent": "确认口径，以及结论是否被口径变化放大。",
                "required_evidence": ["起点定义", "终点定义", "口径是否改过"],
                "followup_triggers": ["口径中途变过但没说"],
                "stop_condition": "说清起止点，并承认口径前后的可比性边界。",
                "status": "partial",
                "evidence_found": ["起点 = JD 发布", "终点 = 入职"],
                "missing": ["编制审批时间是否计入"],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "metric",
            }
        ],
        "turns": [
            {
                "contract_id": 4,
                "question": "招聘周期从 42 天降到 29 天，这个「周期」是从哪一步算到哪一步？",
                "answer": "从 JD 发布到入职，不含编制审批。口径前后一致，都是 HR 系统同一个字段。",
                "status": "partial",
                "feedback": "口径讲清了，但「不含编制审批」这句要提前说，否则听感像在缩小分母。",
                "next_question": "如果预算砍一半，你先砍哪一块？",
            }
        ],
    },
    {
        "id": 3,
        "title": "星桥教育 · 增长分析师（快问快答）",
        "job_index": 12,
        "status": "finished",
        "feedback_policy": "deferred",
        "max_questions": 3,
        "claim_ids": [1],
        "days_ago": 4,
        "review": {
            "covered": "只覆盖了会员召回一条。",
            "verified_summary": "口径与对照组讲得清楚，可以照这个版本说。",
            "gaps_summary": "没有时间覆盖其他主张。",
            "actions": [],
            "rehearsal": [],
        },
        "contracts": [
            {
                "id": 5,
                "claim_id": 1,
                "claim_title": "季度会员召回率从 8.1% 提升到 12.4%",
                "question": "用一分钟讲清楚这个召回项目。",
                "intent": "看能不能把项目压缩成一分钟版本。",
                "required_evidence": ["问题", "做法", "结果"],
                "followup_triggers": [],
                "stop_condition": "一分钟内讲完三段，且结果带数字。",
                "status": "verified",
                "evidence_found": ["问题", "分层做法", "12.4% 与 210 万 GMV"],
                "missing": [],
                "contradictions": [],
                "followup_depth": 0,
                "next_followup_kind": "",
            }
        ],
        "turns": [
            {
                "contract_id": 5,
                "question": "用一分钟讲清楚这个召回项目。",
                "answer": "186 万会员里有大量沉默用户，原先全量发券；我按四组信号分 5 层，分层配置召回手段，季度召回率从 8.1% 到 12.4%，增量 GMV 约 210 万。",
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
    "resume_title": "用户增长分析师 - 澄川科技（上海）有限公司",
    "model": "deepseek-v4-flash",
    "days_ago": 2,
    "groups": [
        {
            "type": "基础题",
            "questions": [
                {
                    "question": "召回率、留存率、复购率这三个指标，你怎么定义？",
                    "purpose": "确认指标口径的基本功。",
                    "answer_hint": "先给分母，再给时间窗，最后说清不含什么。",
                },
                {
                    "question": "做增长分析时，你怎么判断一个指标值得拆？",
                    "purpose": "看有没有指标体系的概念。",
                    "answer_hint": "从业务动作出发，拆到能指导动作的那一层为止。",
                },
            ],
        },
        {
            "type": "项目深挖题",
            "questions": [
                {
                    "question": "会员分层为什么是 5 层？层数多了会怎样？",
                    "purpose": "验证分层方法是拍脑袋还是试出来的。",
                    "answer_hint": "说清运营可执行性：层数太多，配置和预算跟不上。",
                },
                {
                    "question": "召回后 60 天二次流失 41%，你准备怎么接？",
                    "purpose": "看有没有把项目做完整，而不是停在指标提升。",
                    "answer_hint": "承接动作 + 观测窗口 + 如何判断有效。",
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
    "resume_title": "用户增长分析师 - 澄川科技（上海）有限公司",
    "model": "deepseek-v4-flash",
    "days_ago": 5,
    "questions": [
        "如何定义经营健康度？",
        "渠道 ROI 排序为什么会变？",
        "预算砍一半先砍哪里？",
        "如果数据只有月度，你怎么做归因？",
    ],
    "analysis": {
        "framework": (
            "四道题分别对应指标定义、口径解释、资源取舍与数据受限下的推断。前两题答得稳，"
            "第三题只说了「砍低 ROI」，缺一步小流量验证；第四题可以用「月度差分 + 同期群」补。"
        )
    },
    "suggestions": [
        {
            "priority": "high",
            "section": "项目经历",
            "issue": "归因看板只写了「统一口径」，没写清差异来源。",
            "suggestion": "补一句：两套归因差额 32% 主要来自品牌渠道的曝光贡献，并说明如何使用。",
            "evidence": ["面试官连续追问两次口径差异"],
        },
        {
            "priority": "medium",
            "section": "实习/工作经历",
            "issue": "渠道成本下降 17% 的边界没写。",
            "suggestion": "明确「仅统计付费投放，不含自然流量与裂变」。",
            "evidence": ["简历原文只有结论，没有口径"],
        },
        {
            "priority": "low",
            "section": "专业技能",
            "issue": "技能栏没有体现实验设计能力。",
            "suggestion": "把「A/B 实验设计」从技能列表提到项目描述里，用一次实验说明。",
            "evidence": ["岗位 JD 明确要求 AB 实验经验"],
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
