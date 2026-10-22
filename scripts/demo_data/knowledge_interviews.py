# SPDX-License-Identifier: Apache-2.0
"""资料箱、知识库、面试经验域：material + knowledge_entry + interview_experience。

搬迁自 ``scripts/seed_demo_data.py`` 第 815–1053 行（原文的 ``# ── 资料箱 ──``、
``# ── 知识库 ──``、``# ── 面试经验 ──`` 三段）。
"""

from __future__ import annotations

from datetime import timedelta

from demo_data.base import NOW, ins, row


def seed() -> None:
    """写入 5 条资料箱条目、6 条知识库条目、3 条面试经验。"""
    # ── 资料箱 ──────────────────────────────────────────────────────────────────
    ins(
        "material",
        [
            row(
                id=1,
                title="新媒体运营结业证书",
                category="证书",
                content="2024 年 3 月取得，课程包含内容选题、数据复盘与投放基础。",
                url="",
                files=[],
                note="扫描件放在本地网盘",
                created_at=NOW - timedelta(days=20),
                updated_at=NOW - timedelta(days=20),
                deleted_at=None,
            ),
            row(
                id=2,
                title="季度活动结案报告（脱敏版）",
                category="作品",
                content="3 场主题活动的目标、执行路径与结果对比，已去掉内部数据。",
                url="https://example.com/portfolio/campaign-review",
                files=[],
                note="面试时可现场讲",
                created_at=NOW - timedelta(days=14),
                updated_at=NOW - timedelta(days=14),
                deleted_at=None,
            ),
            row(
                id=3,
                title="面试常用链接",
                category="链接",
                content="作品集、行业报告与常用数据源，面试前会过一遍。",
                url="https://example.com/links",
                files=[],
                note="",
                created_at=NOW - timedelta(days=6),
                updated_at=NOW - timedelta(days=6),
                deleted_at=None,
            ),
            row(
                id=4,
                title="校园招聘会复盘（一页纸）",
                category="作品",
                content="企业邀约路径、到会率与现场排队时间的复盘，用于回答「你怎么组织一次活动」。",
                url="https://example.com/portfolio/campus-fair",
                files=[],
                note="讲到组织能力时可以直接拿出来",
                created_at=NOW - timedelta(days=5),
                updated_at=NOW - timedelta(days=5),
                deleted_at=None,
            ),
            row(
                id=5,
                title="渠道效果台账模板",
                category="作品",
                content="按渠道记录进量、成交与单条线索成本，每周更新一次，用于判断该停哪些渠道。",
                url="https://example.com/portfolio/channel-tracker",
                files=[],
                note="脱敏后可以带去面试",
                created_at=NOW - timedelta(days=3),
                updated_at=NOW - timedelta(days=3),
                deleted_at=None,
            ),
        ],
    )

    # ── 知识库 ──────────────────────────────────────────────────────────────────
    ins(
        "knowledge_entry",
        [
            row(
                id=1,
                title="运营岗面试常被追问的三件事",
                category="面试问答",
                tags=["面试", "运营"],
                content=(
                    "1. **数据口径**：只要说了数字，一定会被问「这个数怎么统计的」。\n"
                    "2. **你的贡献**：团队做的事情里，哪一部分是你独立完成的。\n"
                    "3. **失败经历**：讲一次效果不好的活动，重点在你后来改了什么。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=10),
                updated_at=NOW - timedelta(days=10),
                deleted_at=None,
            ),
            row(
                id=2,
                title="简历里数字怎么写才站得住",
                category="简历技巧",
                tags=["简历", "量化"],
                content=(
                    "写数字之前先确认三件事：口径、来源、你的角色。\n\n"
                    "口径不清的数字不如不写——面试时第一个被追问的就是它。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=7),
                updated_at=NOW - timedelta(days=7),
                deleted_at=None,
            ),
            row(
                id=3,
                title="求职节奏：每周固定复盘一次",
                category="求职策略",
                tags=["节奏", "复盘"],
                content=(
                    "- 周一：更新岗位池，把上周的备选岗位核对进正式岗位。\n"
                    "- 周三：投递 + 跟进未回复的岗位。\n"
                    "- 周五：复盘本周投递转化，调整下一周的目标公司名单。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=4),
                updated_at=NOW - timedelta(days=4),
                deleted_at=None,
            ),
            row(
                id=4,
                title="匹配度的五类结论怎么读",
                category="求职策略",
                tags=["匹配度", "改简历"],
                content=(
                    "- **已匹配**：能找到证据，简历里也写清楚了，不用动。\n"
                    "- **表达缺口**：做过但简历没写，或者写得看不出结果——这是最该改的一类。\n"
                    "- **证据不足**：这条主张在资料里找不到出处，先去补证据，别急着写。\n"
                    "- **真实缺口**：确实没做过。要么补经历，要么接受这个岗位不合适。\n"
                    "- **待确认**：信息不够判断，先按原文再读一遍 JD。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=6),
                updated_at=NOW - timedelta(days=6),
                deleted_at=None,
            ),
            row(
                id=5,
                title="请人内推时怎么开口",
                category="求职策略",
                tags=["内推", "沟通"],
                content=(
                    "一次说明白三件事，对方才好帮你转：\n\n"
                    "1. 岗位链接与你的匹配点（一两句，不要甩整份简历）；\n"
                    "2. 你希望的推进方式（帮投 / 帮问 / 给建议）；\n"
                    "3. 什么时候需要答复。\n\n"
                    "对方答应后当天把简历发过去，别让对方来催。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=2),
                updated_at=NOW - timedelta(days=2),
                deleted_at=None,
            ),
            row(
                id=6,
                title="面试复盘要记哪三件事",
                category="面试问答",
                tags=["复盘", "面试"],
                content=(
                    "1. **被追问的位置**：哪个数字或哪句话被追问了两轮以上——那就是简历里最虚的地方。\n"
                    "2. **没答上来的题**：按题目类型归类，同类题攒到三道就去补知识而不是背答案。\n"
                    "3. **下一次要改的表述**：当场就能改的那一句，直接回填进事实台账的表述字段。\n"
                ),
                source="",
                created_at=NOW - timedelta(days=1),
                updated_at=NOW - timedelta(days=1),
                deleted_at=None,
            ),
        ],
    )

    # ── 面试经验 ────────────────────────────────────────────────────────────────
    ins(
        "interview_experience",
        [
            row(
                id=1,
                title="示例科技 市场运营专员 一面",
                company="示例科技（上海）有限公司",
                position="市场运营专员",
                job_id=1,
                content="整体偏行为面，重点问活动数据和跨部门协作方式。面试官很关注口径。",
                questions=[
                    "介绍一下你主导过的一次活动，目标是什么？",
                    "1.2 万这个报名数是怎么统计的，含重复报名吗？",
                    "活动里你和设计、研发怎么分工？",
                    "如果预算砍一半，你会怎么安排？",
                ],
                tags=["行为面", "数据"],
                source="self",
                difficulty="中级",
                round_type="一面",
                interview_date="2026-10-01",
                created_at=NOW - timedelta(days=5),
                updated_at=NOW - timedelta(days=5),
                deleted_at=None,
            ),
            row(
                id=2,
                title="示例网络科技 用户增长运营 二面",
                company="示例网络科技有限公司",
                position="用户增长运营",
                job_id=4,
                content="偏案例，现场给了一个留存下跌的场景，要求说出排查顺序。",
                questions=[
                    "留存突然跌了 5 个百分点，你的排查顺序是什么？",
                    "怎么设计一次 A/B 实验验证你的假设？",
                    "过去做过哪次实验是失败的？",
                ],
                tags=["案例面", "增长"],
                source="peer",
                difficulty="高级",
                round_type="二面",
                interview_date="2026-10-04",
                created_at=NOW - timedelta(days=2),
                updated_at=NOW - timedelta(days=2),
                deleted_at=None,
            ),
            row(
                id=3,
                title="示例日化 品牌营销专员 一面",
                company="示例日化有限公司",
                position="品牌营销专员",
                job_id=3,
                content="偏经历核对，问得很细，重点是预算规模和我的具体分工。",
                questions=[
                    "你经手的活动预算大概什么量级？",
                    "媒介投放的效果你是怎么复盘的？",
                    "和供应商谈判时你争取到过什么条件？",
                    "为什么从甲方市场部想换到品牌方？",
                ],
                tags=["经历面", "预算"],
                source="self",
                difficulty="中级",
                round_type="一面",
                interview_date="2026-09-27",
                created_at=NOW - timedelta(days=10),
                updated_at=NOW - timedelta(days=9),
                deleted_at=None,
            ),
        ],
    )
