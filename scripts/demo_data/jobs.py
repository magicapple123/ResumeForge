# SPDX-License-Identifier: Apache-2.0
"""岗位域：``JOBS`` 模板 → job 表，以及备选岗位（candidate_job）。

搬迁自 ``scripts/seed_demo_data.py`` 第 249–570 行（原文的 ``# ── 岗位 ──`` 与
``# ── 备选岗位 ──`` 两段）。``JOBS`` 留在模块顶层：简历/进度/投递域都要引用它
（``JOBS[3]["title"]`` 这类写法依赖它是个列表）。
"""

from __future__ import annotations

from datetime import timedelta

from demo_data.base import NOW, ins, keywords_of, recognition_source_of, row

JOBS = [
    dict(
        title="市场运营专员",
        company="示例科技（上海）有限公司",
        location="上海·徐汇区",
        salary="15-25K·13薪",
        job_type="社招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0001.html",
        posted_at="2026-10-03",
        favorite=True,
        keywords=["活动策划", "用户增长", "数据分析", "跨部门协作"],
        description=(
            "1. 负责品牌营销活动的策划与执行，对活动参与人数与转化率负责；\n"
            "2. 搭建活动复盘机制，把有效做法沉淀为可复用 SOP；\n"
            "3. 对接外部渠道并维护渠道效果台账。"
        ),
        requirements=(
            "1. 本科及以上，市场营销、新闻传播等相关专业优先；\n"
            "2. 2 年以上市场活动或用户运营经验；\n"
            "3. 熟练使用 Excel，能做基础数据复盘；\n"
            "4. 有跨部门协作与供应商管理经验。"
        ),
        additional_info="五险一金、补充医疗、年度调薪、弹性上班",
        note="猎头推荐，先聊了岗位方向",
    ),
    dict(
        title="新媒体运营",
        company="示例文化传媒有限公司",
        location="杭州·西湖区",
        salary="12-18K",
        job_type="社招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0002.html",
        posted_at="2026-10-02",
        favorite=False,
        keywords=["内容运营", "短视频", "社群运营"],
        description="负责官方新媒体账号的内容排期与日常运营，跟踪内容数据并优化选题。",
        requirements="1. 1 年以上新媒体运营经验；\n2. 有短视频脚本与剪辑经验优先；\n3. 对数据敏感，能用数据解释选题结果。",
        additional_info="双休",
        note="",
    ),
    dict(
        title="品牌营销专员",
        company="示例日化有限公司",
        location="广州·天河区",
        salary="14-20K",
        job_type="社招",
        source="招聘网站",
        source_url="",
        posted_at="2026-09-30",
        favorite=False,
        keywords=["品牌传播", "媒介投放", "预算管理"],
        description="参与年度品牌传播计划，负责媒介投放的排期、执行与效果复盘。",
        requirements="1. 本科及以上；\n2. 熟悉主流社交平台投放逻辑；\n3. 有预算管理经验。",
        additional_info="",
        note="来源是朋友转发的招聘信息",
    ),
    dict(
        title="用户增长运营",
        company="示例网络科技有限公司",
        location="北京·海淀区",
        salary="20-30K",
        job_type="社招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0004.html",
        posted_at="2026-10-04",
        favorite=True,
        keywords=["用户增长", "A/B 测试", "数据分析", "会员体系"],
        description="负责会员体系的拉新与留存，设计并落地增长实验。",
        requirements="1. 3 年以上用户运营或增长经验；\n2. 能独立设计并复盘 A/B 实验；\n3. 熟悉 SQL 优先。",
        additional_info="股票期权",
        note="",
    ),
    dict(
        title="内容运营（校招）",
        company="示例在线教育有限公司",
        location="上海·浦东新区",
        salary="10-15K",
        job_type="校招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0005.html",
        posted_at="2026-09-27",
        favorite=False,
        keywords=["内容运营", "文案", "用户调研"],
        description="参与课程内容的选题与生产，配合活动做内容排期。",
        requirements="1. 2027 届本科及以上；\n2. 有校园媒体或自媒体运营经历；\n3. 文字表达清晰。",
        additional_info="",
        note="",
    ),
    dict(
        title="活动策划专员",
        company="示例文创发展有限公司",
        location="成都·武侯区",
        salary="10-16K",
        job_type="社招",
        source="手动录入",
        source_url="",
        posted_at="2026-09-25",
        favorite=False,
        keywords=["线下活动", "供应商管理", "预算管理"],
        description="负责线下文创活动的策划、执行与现场统筹。",
        requirements="1. 2 年以上线下活动执行经验；\n2. 能接受项目期出差。",
        additional_info="",
        note="",
    ),
    dict(
        title="社群运营专员",
        company="示例教育科技有限公司",
        location="深圳·南山区",
        salary="13-19K",
        job_type="社招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0007.html",
        posted_at="2026-10-05",
        favorite=True,
        keywords=["社群运营", "用户留存", "活动策划"],
        description=(
            "1. 负责付费学员社群的日常运营与活跃度提升；\n"
            "2. 设计并落地社群转化活动，对续费率负责；\n"
            "3. 沉淀社群 SOP 并迭代话术库。"
        ),
        requirements=(
            "1. 2 年以上社群或用户运营经验；\n"
            "2. 有教育行业经验优先；\n"
            "3. 能独立完成活动方案与复盘。"
        ),
        additional_info="六险一金、免费课程",
        note="职责与我的活动策划经历比较对口",
    ),
    dict(
        title="市场推广专员",
        company="示例智能硬件有限公司",
        location="苏州·工业园区",
        salary="12-18K",
        job_type="社招",
        source="智联招聘",
        source_url="https://www.zhipin.com/job_detail/demo0008.html",
        posted_at="2026-10-04",
        favorite=False,
        keywords=["市场推广", "渠道拓展", "预算管理"],
        description="负责线上线下的市场推广执行，维护投放渠道并跟踪转化。",
        requirements=(
            "1. 2 年以上市场推广经验；\n2. 有硬件或消费电子行业经验优先；\n3. 熟悉投放数据口径。"
        ),
        additional_info="",
        note="",
    ),
    dict(
        title="运营助理（实习）",
        company="示例数据服务有限公司",
        location="上海·静安区",
        salary="180-220 元/天",
        job_type="实习",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0009.html",
        posted_at="2026-10-03",
        favorite=False,
        keywords=["数据整理", "运营支持", "Excel"],
        description="协助整理运营数据报表，跟进日常运营事项。",
        requirements="1. 在校生，每周可到岗 3 天以上；\n2. 熟练使用 Excel；\n3. 细心、有条理。",
        additional_info="",
        note="",
    ),
    dict(
        title="品牌内容运营",
        company="示例食品有限公司",
        location="武汉·江汉区",
        salary="11-17K",
        job_type="社招",
        source="招聘网站",
        source_url="",
        posted_at="2026-10-01",
        favorite=False,
        keywords=["内容运营", "品牌传播", "文案"],
        description="负责品牌账号的内容规划与产出，配合新品上市做传播。",
        requirements="1. 1 年以上内容运营经验；\n2. 文字功底扎实；\n3. 有快消行业经验优先。",
        additional_info="",
        note="来源是群里转发的招聘信息",
    ),
    dict(
        title="用户运营专员",
        company="示例出行科技有限公司",
        location="北京·朝阳区",
        salary="16-24K",
        job_type="社招",
        source="BOSS直聘",
        source_url="https://www.zhipin.com/job_detail/demo0011.html",
        posted_at="2026-10-06",
        favorite=False,
        keywords=["用户运营", "数据分析", "会员体系"],
        description="负责会员权益的设计与迭代，跟踪核心运营指标。",
        requirements=(
            "1. 2 年以上用户运营经验；\n2. 能独立完成数据分析并提出方案；\n3. 有会员体系经验优先。"
        ),
        additional_info="13 薪、餐补",
        note="",
    ),
    dict(
        title="活动执行专员",
        company="示例会展服务有限公司",
        location="南京·建邺区",
        salary="9-14K",
        job_type="社招",
        source="手动录入",
        source_url="",
        posted_at="2026-09-29",
        favorite=False,
        keywords=["线下活动", "现场执行", "供应商管理"],
        description="负责展会与线下活动的现场执行与供应商对接。",
        requirements="1. 1 年以上活动执行经验；\n2. 能接受项目期出差与加班；\n3. 沟通协调能力强。",
        additional_info="",
        note="",
    ),
]


def seed() -> None:
    """写入 12 条演示岗位与 2 条备选岗位。"""
    # 原文件里这两行就是死代码（`job_ids` 之后再没被引用过）。纯搬迁保留原样，
    # 只是从模块级挪进了函数体，于是 ruff 的 F841 才看得见它。
    job_ids: list[int] = []
    ins(
        "job",
        [
            row(
                id=i + 1,
                title=j["title"],
                company=j["company"],
                location=j["location"],
                salary=j["salary"],
                job_type=j["job_type"],
                description=j["description"],
                requirements=j["requirements"],
                additional_info=j["additional_info"],
                keywords=keywords_of(j),
                source=j["source"],
                source_url=j["source_url"],
                posted_at=j["posted_at"],
                status="active",
                note=j["note"],
                note_images=[],
                favorite=j["favorite"],
                recognition_source=recognition_source_of(j),
                # 列表按 Job.created_at 倒序，所以用 `days=i` 让 JOBS[0]（市场运营专员）排在第一条。
                # 这里**不能写 `days=常数 - i`**：岗位数一旦超过那个常数，i 大的条目会落到未来时间，
                # 于是最后新增的岗位反而排在最前（2026-10-07 把岗位从 6 个加到 12 个时踩过）。
                created_at=NOW - timedelta(days=i),
                updated_at=NOW - timedelta(days=i),
            )
            for i, j in enumerate(JOBS)
        ],
    )
    job_ids = [i + 1 for i in range(len(JOBS))]  # noqa: F841 - 见上：原文件的死代码

    # ── 备选岗位 ────────────────────────────────────────────────────────────────
    ins(
        "candidate_job",
        [
            row(
                id=1,
                title="市场专员",
                company="示例供应链有限公司",
                raw_text="市场专员 / 示例供应链有限公司 / 上海 / 13-18K",
                images=[],
                note="从招聘信息里复制的，还没核对",
                source="manual",
                job_type="社招",
                location="上海",
                salary="13-18K",
                source_url="",
                description="",
                requirements="",
                additional_info="",
                collect_task_id=None,
                status="pending",
                imported_job_id=None,
                created_at=NOW - timedelta(days=2),
                updated_at=NOW - timedelta(days=2),
            ),
            row(
                id=2,
                title="运营助理",
                company="示例贸易有限公司",
                raw_text="运营助理 / 示例贸易有限公司 / 苏州 / 8-12K",
                images=[],
                note="招聘会现场拍的展板，待整理",
                source="manual",
                job_type="社招",
                location="苏州",
                salary="8-12K",
                source_url="",
                description="",
                requirements="",
                additional_info="",
                collect_task_id=None,
                status="pending",
                imported_job_id=None,
                created_at=NOW - timedelta(days=5),
                updated_at=NOW - timedelta(days=5),
            ),
        ],
    )
