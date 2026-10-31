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

    # 旧六表写完后，把同一份虚构资料再写进 F1 新模型（组/工作区/条目/自建字段）。
    _seed_new_profile_model()


def _legacy_rows(table: str) -> list[dict]:
    """读回刚写入的旧六表数据：新旧两份数据必须同源，避免两处各写一份会漂移的文案。"""
    from sqlalchemy import select

    from demo_data.base import T, engine

    with engine.connect() as conn:
        return [dict(item) for item in conn.execute(select(T[table])).mappings().all()]


def _allowed(model: type, payload: dict) -> dict:
    """只保留目标 Pydantic 模型认识的字段（旧表列比新模型字段多，例如 project.highlights）。"""
    return {key: value for key, value in payload.items() if key in model.model_fields}


def _seed_new_profile_model() -> None:
    """把演示人物写进 R-46 之后的新资料模型，让资料页/AI 生成能读到同一份虚构资料。

    为什么两套都要写：新资料模型**按产品决定不读旧六表**（R-46），而演示数据是 README
    截图与 AI 功能验收的唯一数据源。旧六表保留用于兼容旧接口/对照；新模型（profile_group /
    profile_group_member / profile_workspace_state / profile_entry / 自建字段定义）保证
    「打开资料页」「直接生成简历」看到的是同一个张示例，而不是空资料。

    为什么走服务层而不是手写 SQL：默认组 bootstrap、单例分区、字段快照、自建字段上限都在
    services/profile 里，seed 再写一份 SQL 必然与线上语义漂移。
    """
    from app.database import SessionLocal
    from app.schemas.profile import (
        AwardIn,
        CampusExperienceIn,
        EducationIn,
        ExperienceIn,
        ProfileUpdate,
        ProjectIn,
        SkillIn,
    )
    from app.services.profile import definition_store, entry_store
    from app.services.profile.profile_service import update_profile

    profile_row = _legacy_rows("user_profile")[0]
    project_rows = _legacy_rows("project")
    projects = []
    for item in project_rows:
        payload = _allowed(ProjectIn, item)
        # 旧表的 highlights 是独立一列，新模型只有 description：合并进描述，避免内容丢失。
        highlights = str(item.get("highlights") or "").strip()
        if highlights:
            payload["description"] = (
                str(payload.get("description") or "").rstrip() + "\n" + highlights
            ).strip()
        projects.append(ProjectIn(**payload))

    payload = ProfileUpdate(
        name=profile_row.get("name") or "",
        gender=profile_row.get("gender") or "",
        birth_year=profile_row.get("birth_year") or "",
        phone=profile_row.get("phone") or "",
        email=profile_row.get("email") or "",
        city=profile_row.get("city") or "",
        target_city=profile_row.get("target_city") or "",
        job_intent=profile_row.get("job_intent") or "",
        personal_website=profile_row.get("personal_website") or "",
        github=profile_row.get("github") or "",
        summary=profile_row.get("summary") or "",
        section_order=list(profile_row.get("section_order") or []),
        educations=[
            EducationIn(**_allowed(EducationIn, item)) for item in _legacy_rows("education")
        ],
        experiences=[
            ExperienceIn(**_allowed(ExperienceIn, item)) for item in _legacy_rows("experience")
        ],
        # 校园经历：v2 演示版要覆盖 campus_experience 板块，也让 AI 生成有素材可用。
        # 事实与简历样例同源（示例大学学生会宣传部 / 副部长）。
        campus_experiences=[
            CampusExperienceIn(
                organization="示例大学学生会宣传部",
                role="副部长",
                start_date="2021-09-01",
                end_date="2022-06-30",
                description="统筹 6 场校园活动的宣传排期，协调 8 人小组分工，累计触达 3000 余人次。",
            )
        ],
        projects=projects,
        skills=[SkillIn(**_allowed(SkillIn, item)) for item in _legacy_rows("skill")],
        awards=[AwardIn(**_allowed(AwardIn, item)) for item in _legacy_rows("award")],
    )

    with SessionLocal() as db:
        update_profile(db, payload)
        # 自建大字段 + 自定义小字段 + 一条条目：覆盖 F1 的 profile_definition 链路，
        # 让「资料页截图」能看到自建分区，也让自检接口真的读到自建定义。
        section = definition_store.create_custom_section(db, "证书与作品")
        field_row = definition_store.create_custom_field(
            db, section.key, "作品链接", "single_line", default_placement="trail"
        )

        # ── v2 字段级文档模型的资料素材（D6）─────────────────────────────────
        # 演示数据必须覆盖三种自定义字段形态，否则 e2e 与截图看不到 v2 的卖点：
        #   1. 自定义短字段（默认落 trail 灰字段）；
        #   2. 自定义长文本字段（默认落 body 正文块）；
        #   3. 仅素材字段（material_only：进 AI/网申素材，永远不上纸面）。
        # 字段挂在系统分区上（教育/实习），与"用户在资料页加字段"是同一链路。
        education_field = definition_store.create_custom_field(
            db, "educations", "课题组", "single_line", default_placement="trail"
        )
        _merge_first_entry_values(
            db, "educations", {education_field.field_id: "消费者行为研究组（示例）"}
        )
        report_field = definition_store.create_custom_field(
            db, "experiences", "汇报对象", "single_line", default_placement="trail"
        )
        collaboration_field = definition_store.create_custom_field(
            db, "experiences", "团队协作说明", "multi_line", default_placement="body"
        )
        background_field = definition_store.create_custom_field(
            db,
            "experiences",
            "背调联系人",
            "single_line",
            default_placement="hidden",
            material_only=True,
        )
        _merge_first_entry_values(
            db,
            "experiences",
            {
                report_field.field_id: "示例市场总监",
                collaboration_field.field_id: (
                    "活动期与内容、设计、销售三个小组按周对齐目标与排期，"
                    "把跨部门确认时间从 3 天压到 1 天。"
                ),
                background_field.field_id: "示例背调人（虚构）",
            },
        )

        # 自建板块补齐"标题 + 链接 + 说明"三种字段与两条条目：演示 v2 自建板块与系统
        # 板块同构（可编排、可导出），也是 §17.2「自定义字段 + 自建板块」的素材来源。
        work_name = definition_store.create_custom_field(
            db, section.key, "作品名称", "single_line", default_placement="title"
        )
        work_note = definition_store.create_custom_field(
            db, section.key, "作品说明", "multi_line", default_placement="body"
        )
        entry_store.upsert_entry(
            db,
            section.key,
            values={
                work_name.field_id: "校园招聘会一页纸招募说明",
                field_row.field_id: "https://example.com/zhang-portfolio",
                work_note.field_id: (
                    "按企业侧决策路径重写招募说明，把宣讲信息压缩到一页纸，"
                    "3 天内完成 40 家企业邀约确认。"
                ),
            },
        )
        entry_store.upsert_entry(
            db,
            section.key,
            values={
                work_name.field_id: "季度活动复盘 SOP",
                field_row.field_id: "https://example.com/zhang-portfolio/sop",
                work_note.field_id: (
                    "把单次活动复盘沉淀成 9 个检查点的模板，团队复用后单场筹备时间"
                    "从 10 天压缩到 4 天。"
                ),
            },
        )


def _merge_first_entry_values(db, section_key: str, extra: dict[str, str]) -> None:
    """把自定义字段值并进该分区第一条条目的 values（演示种子只往第一条挂）。"""
    from app.services.profile import entry_store

    rows = entry_store.list_entries(db, section_key=section_key)
    if not rows:
        return
    first = rows[0]
    values = dict(first.values or {})
    values.update(extra)
    entry_store.upsert_entry(db, section_key, entry_id=first.entry_id, values=values)
