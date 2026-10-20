# SPDX-License-Identifier: Apache-2.0
"""Profile-domain generator: profile, education, experiences, skills, photo."""

from __future__ import annotations

from .blobs import tiny_png_data_url
from .context import SeedContext, row


def seed_profile(ctx: SeedContext) -> None:
    """Insert the single fictional profile plus its sections."""
    now = ctx.now
    ctx.insert(
        "user_profile",
        [
            row(
                id=1,
                name="张虚构",
                gender="女",
                birth_year="2001",
                birth_date="2001-05-12",
                phone="139-0000-0000",
                email="stress.example@example.com",
                city="上海",
                target_city="上海",
                job_intent="数据分析 / 数据产品",
                personal_website="https://example.com/stress",
                github="",
                photo="",
                summary="压力测试数据集的个人资料，全部为虚构内容。",
                section_order=[
                    "experiences",
                    "projects",
                    "skills",
                    "educations",
                    "awards",
                    "campus_experiences",
                ],
                wechat="stress_example",
                id_type="居民身份证",
                id_number="000000190001010000",
                country_region="中国",
                native_place="江苏",
                political_status="群众",
                phone_country_code="+86",
                family_info="父亲：张虚构（虚构）\n母亲：李示例（虚构）",
                expected_salary="18-25K",
                qq="1000000000",
                advisor="王虚构",
                research_direction="数据治理",
                preferred_industry="互联网 / 数据服务",
                updated_at=now,
            )
        ],
    )

    ctx.insert(
        "education",
        [
            row(
                profile_id=1,
                school="示例大学",
                department="数据科学学院",
                major="统计学",
                degree="本科",
                study_mode="全日制",
                degree_type="学士",
                start_date="2019.09",
                end_date="2023.06",
                gpa="3.6/4.0",
                cet4_score="568",
                cet6_score="532",
                courses="概率论；回归分析；数据挖掘；数据库系统",
                achievements="校三等奖学金一次",
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                school="示例财经大学",
                department="统计学院",
                major="应用统计",
                degree="硕士",
                study_mode="全日制",
                degree_type="硕士",
                start_date="2023.09",
                end_date="2026.06",
                gpa="3.7/4.0",
                cet4_score="",
                cet6_score="558",
                courses="多元统计；机器学习；贝叶斯方法",
                achievements="全国大学生统计建模大赛省二等奖",
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ctx.insert(
        "experience",
        [
            row(
                profile_id=1,
                company="云帆科技有限公司",
                role="数据分析实习生",
                start_date="2025.07",
                end_date="2025.12",
                description=(
                    "- 维护增长团队的日/周报看板，把口径从 3 份散表收拢成 1 套。\n"
                    "- 参与一次拉新活动的复盘分析，给出渠道停投建议并被采纳。\n"
                    "- 协助搭建活动数据核对清单，把口径问题从上线后发现提前到上线前。"
                ),
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                company="白泽信息技术有限公司",
                role="数据产品实习生",
                start_date="2024.07",
                end_date="2024.12",
                description=(
                    "- 跟进指标字典项目，整理 60+ 指标的口径与负责人。\n"
                    "- 参与需求评审，学习把分析结论翻译成功能需求。"
                ),
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                company="观澜游戏有限公司",
                role="运营助理（兼职）",
                start_date="2023.10",
                end_date="2024.05",
                description="- 负责社群日常维护与活动数据的手工汇总。",
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ctx.insert(
        "campus_experience",
        [
            row(
                profile_id=1,
                organization="示例大学数据协会",
                role="副会长",
                start_date="2021.09",
                end_date="2022.06",
                description="- 组织数据技能工作坊 8 期，累计参与 400 余人次。",
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                organization="院学生会宣传部",
                role="干事",
                start_date="2020.09",
                end_date="2021.06",
                description="- 负责公众号推文排版与数据周报整理。",
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ctx.insert(
        "project",
        [
            row(
                profile_id=1,
                name="校内二手书流转平台数据分析",
                role="数据分析",
                start_date="2024.03",
                end_date="2024.06",
                tech_stack="SQL,Excel,Python",
                description="- 对平台半年的成交数据做描述性分析与供需匹配建议。",
                highlights="- 给出的定价建议使滞销书目占比下降约 12%。",
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                name="统计建模竞赛：城市通勤流量预测",
                role="队长",
                start_date="2025.03",
                end_date="2025.06",
                tech_stack="Python,sklearn",
                description="- 用公开交通数据做短时流量预测，省赛二等奖。",
                highlights="- 完成特征工程与三个基线模型的对比报告。",
                reference_file_name="",
                reference_content="",
            ),
            row(
                profile_id=1,
                name="课程大作业：问卷数据的信效度检验",
                role="成员",
                start_date="2023.11",
                end_date="2024.01",
                tech_stack="SPSS",
                description="- 对 300 份问卷做信效度检验与因子分析。",
                highlights="",
                reference_file_name="",
                reference_content="",
            ),
        ],
    )

    ctx.insert(
        "skill",
        [
            row(profile_id=1, name="SQL", level="熟练"),
            row(profile_id=1, name="Excel", level="熟练"),
            row(profile_id=1, name="Python", level="掌握"),
            row(profile_id=1, name="SPSS", level="掌握"),
            row(profile_id=1, name="数据可视化", level="掌握"),
            row(profile_id=1, name="商务英语", level="了解"),
        ],
    )

    ctx.insert(
        "award",
        [
            row(
                profile_id=1, name="全国大学生统计建模大赛省二等奖", date="2025.06", description=""
            ),
            row(profile_id=1, name="校三等奖学金", date="2022.10", description=""),
            row(profile_id=1, name="校优秀学生干部", date="2022.05", description=""),
        ],
    )

    ctx.insert(
        "profile_photo",
        [
            row(
                profile_id=1,
                name="证件照-虚构.png",
                image=tiny_png_data_url(),
                is_primary=True,
                created_at=now,
            ),
            row(
                profile_id=1,
                name="生活照-虚构.png",
                image=tiny_png_data_url(),
                is_primary=False,
                created_at=now,
            ),
        ],
    )
