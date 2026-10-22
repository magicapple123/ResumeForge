# SPDX-License-Identifier: Apache-2.0
"""个人资料域：user_profile + education / experience / project / skill / award。

搬迁自 ``scripts/seed_demo_data.py`` 第 90–247 行（原文的 ``# ── 个人资料 ──`` 段）。
"""

from __future__ import annotations

from demo_data.base import NOW, ins, row


def seed() -> None:
    """写入演示人物及其教育、工作经历、项目、技能、奖项。"""
    # ── 个人资料 ────────────────────────────────────────────────────────────────
    ins(
        "user_profile",
        [
            row(
                id=1,
                name="张示例",
                gender="女",
                birth_year="2001",
                phone="138-0000-0000",
                email="zhang.example@example.com",
                city="上海",
                target_city="上海",
                job_intent="市场运营专员",
                personal_website="https://example.com/zhang",
                github="",
                photo="",
                summary=(
                    "3 年市场与运营经验，主导过从 0 到 1 的会员增长项目与季度主题营销活动，"
                    "单场活动最高触达 1.2 万人、转化率环比提升 18%；"
                    "擅长把一次性的活动经验沉淀成可复用的流程与台账，"
                    "习惯用数据解释结论而不是凭感觉拍板。"
                ),
                # 与前端 DEFAULT_SECTION_ORDER / 后端 PROFILE_SECTION_KEYS 同一套键名。
                # 这里曾经写成 ["education", "experience", "projects", "campus", "skills", "awards"]
                # ——education / experience / campus 都是**不存在的键**，规范化时会被整条丢掉，
                # 于是 6 条里只剩 3 条生效，演示库的分区顺序看起来像"用户自己拖乱了"，
                # 而且它会一直盖住默认顺序（存的顺序优先于默认顺序）。
                section_order=[
                    "experiences",
                    "projects",
                    "skills",
                    "educations",
                    "awards",
                    "campus_experiences",
                ],
                updated_at=NOW,
            )
        ],
    )

    ins(
        "education",
        [
            row(
                profile_id=1,
                school="示例大学",
                major="市场营销",
                degree="本科",
                start_date="2019.09",
                end_date="2023.06",
                gpa="3.7/4.0",
                courses="市场调研；消费者行为；应用统计",
                achievements="连续两年获得校级奖学金",
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ins(
        "experience",
        [
            row(
                profile_id=1,
                company="示例科技有限公司",
                role="市场运营专员",
                start_date="2023.07",
                end_date="至今",
                description=(
                    "- 主导季度主题营销活动，全程负责选题、预算分配与落地执行，"
                    "参与人数 1.2 万、活动转化率环比提升 18%，超出季度目标 6 个百分点。\n"
                    "- 把活动复盘模板沉淀成 SOP，覆盖从立项到复盘的 9 个检查点，"
                    "团队复用后单场筹备时间从 10 天压缩到 4 天。\n"
                    "- 对接 12 家外部渠道并建立效果台账，按周追踪各渠道的进量与成交转化，"
                    "停投 3 家低效渠道后年度渠道成本下降 15%。\n"
                    "- 牵头搭建活动数据看板，把参与人数、转化率与单客成本并入同一张表，"
                    "让季度复盘从「讲感受」变成「看数据」。"
                ),
                reference_file_name="市场运营工作小结.md",
                reference_content="# 季度活动复盘\n\n- 参与人数：12,400\n- 转化率：7.2%（环比 +18%）\n",
            ),
            row(
                profile_id=1,
                company="示例文化传播有限公司",
                role="市场部实习生",
                start_date="2022.06",
                end_date="2022.12",
                description=(
                    "- 负责社群日常维护与内容排期，独立完成选题、撰写与发布，"
                    "月均产出 20 篇内容，半年内粉丝净增 3000。\n"
                    "- 建立内容选题库并按打开率与转发率排序，把高互动选题占比从 25% 提到 48%。\n"
                    "- 配合线下活动做预热与收尾，单场活动报名转化率较此前提升约 12%。"
                ),
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ins(
        "project",
        [
            row(
                profile_id=1,
                name="校园招聘会策划",
                role="项目负责人",
                start_date="2024.03",
                end_date="2024.06",
                tech_stack="活动策划,渠道对接,预算管理",
                description="- 从 0 到 1 策划校园招聘会，主导场地、企业邀约与现场执行，到会企业 40 家、学生 1200 人。",
                highlights=(
                    "- 用分时段报名数据调度入场节奏，把现场排队时间控制在 10 分钟以内。\n"
                    "- 设计企业侧的一页纸招募说明并在 3 天内完成 40 家邀约确认，"
                    "到会率 92%，高于往届平均水平。"
                ),
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                name="会员拉新与留存实验",
                role="项目成员",
                start_date="2024.07",
                end_date="2024.10",
                tech_stack="用户增长,AB测试,数据分析",
                description=(
                    "- 参与会员拉新实验的设计与执行，把新客权益拆成 3 组做 AB 测试，"
                    "最终选定的一组把首月留存率提升 9 个百分点。"
                ),
                highlights=(
                    "- 用 Excel 搭建实验数据表，自动汇总各组的进量、留存与单客成本，"
                    "把每次实验的分析时间从半天压到 1 小时。"
                ),
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ins(
        "skill",
        [
            row(profile_id=1, name="活动策划", level="熟练"),
            row(profile_id=1, name="Excel", level="熟练"),
            row(profile_id=1, name="数据复盘", level="掌握"),
            row(profile_id=1, name="沟通协作", level="熟练"),
            row(profile_id=1, name="商务英语", level="了解"),
        ],
    )

    ins(
        "award",
        [
            row(profile_id=1, name="示例大学一等奖学金", date="2021.10", description=""),
            row(profile_id=1, name="校级优秀学生干部", date="2021.05", description=""),
        ],
    )
