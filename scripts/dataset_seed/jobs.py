# SPDX-License-Identifier: Apache-2.0
"""岗位域：14 条正式岗位（含已截止/已投递/回收站）+ 4 条备选岗位。

岗位正文按真实 JD 的写法给：职责 3–5 条、要求 4 条左右、补充信息一句。技能标签不手写，
交给 ``base.keywords_of`` 用应用自己的解析器生成——手写一份必然和词表漂移。
"""

from __future__ import annotations

from datetime import timedelta

from PIL import ImageDraw

from dataset_seed.base import (
    NOW,
    cjk_font,
    ins,
    keywords_of,
    png_data_url,
    recognition_source_of,
    row,
)

# source 是用户可见的「来源」，status 用 models.job 的白名单。
JOBS = [
    {
        "title": "用户增长分析师",
        "company": "澄川科技（上海）有限公司",
        "location": "上海·杨浦区",
        "salary": "25-40K·14薪",
        "job_type": "社招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/demo-u1.html",
        "posted_at": "2026-10-26",
        "favorite": True,
        "status": "开放中",
        "note": "HR 说团队 6 人，直接汇报给增长负责人。",
        "description": (
            "1. 负责会员生命周期增长，搭建分层与召回策略，对召回率与增量 GMV 负责；\n"
            "2. 设计并复盘 A/B 实验，统一指标口径与分流校验；\n"
            "3. 搭建增长看板，把拉新、激活、留存、变现四段漏斗做成日更视图；\n"
            "4. 与投放团队共建渠道质量评分，持续优化获客成本。"
        ),
        "requirements": (
            "1. 本科及以上，统计、数学、经济、市场营销等相关专业；\n"
            "2. 3 年以上用户增长或商业分析经验，有会员体系经验优先；\n"
            "3. 熟练使用 SQL，能独立完成取数与看板搭建；\n"
            "4. 做过完整的 AB 实验，能解释显著性、效应量与护栏指标。"
        ),
        "additional_info": "六险一金、补充医疗、年度调薪、弹性上班、每周两天远程。",
    },
    {
        "title": "商业分析师（用户方向）",
        "company": "弦月网络科技（上海）有限公司",
        "location": "上海·浦东新区",
        "salary": "28-42K",
        "job_type": "社招",
        "source": "猎聘",
        "source_url": "https://www.liepin.com/job/demo-b2.shtml",
        "posted_at": "2026-10-25",
        "favorite": False,
        "status": "已投递",
        "note": "10/27 投递，附了归因看板那份作品集。",
        "description": (
            "1. 支持业务线的经营分析，输出月度经营复盘与专题诊断；\n"
            "2. 搭建核心指标体系，定义口径并推动跨团队对齐；\n"
            "3. 参与年度预算与目标拆解，跟踪关键假设的验证情况。"
        ),
        "requirements": (
            "1. 3 年以上商业分析/经营分析经验；\n"
            "2. 具备较强的结构化表达与汇报能力，能独立面对业务负责人；\n"
            "3. 熟练 SQL 与至少一种可视化工具；\n"
            "4. 有消费零售或会员业务背景优先。"
        ),
        "additional_info": "13 薪 + 绩效奖金，年度体检，补充商业保险。",
    },
    {
        "title": "数据分析师（增长）",
        "company": "青禾消费金融有限公司",
        "location": "上海·黄浦区",
        "salary": "22-35K",
        "job_type": "社招",
        "source": "智联招聘",
        "source_url": "https://jobs.zhaopin.com/demo-c3.htm",
        "posted_at": "2026-10-24",
        "favorite": False,
        "status": "开放中",
        "note": "",
        "description": (
            "1. 负责信贷产品的增长分析，覆盖获客、激活、授信、首借全链路；\n"
            "2. 搭建风险与增长的联合看板，监控关键 conversion 指标；\n"
            "3. 支持策略实验的设计、监控与复盘。"
        ),
        "requirements": (
            "1. 本科及以上，2 年以上数据分析经验；\n"
            "2. 熟练 SQL、Python，能做基础的统计检验；\n"
            "3. 对金融业务的合规边界有基本认知；\n"
            "4. 有风控或信贷经验优先。"
        ),
        "additional_info": "五险一金按全额缴纳，年终奖 2-4 个月。",
    },
    {
        "title": "增长运营（会员）",
        "company": "拾光文创（杭州）有限公司",
        "location": "杭州·余杭区",
        "salary": "20-30K",
        "job_type": "社招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/demo-d4.html",
        "posted_at": "2026-10-18",
        "favorite": False,
        "status": "已截止",
        "note": "10/20 咨询时 HR 说 HC 冻结了。",
        "description": (
            "1. 负责会员权益体系的设计与迭代，提升会员渗透率与续费率；\n"
            "2. 策划会员专属活动，联动内容与商品团队落地；\n"
            "3. 跟踪会员生命周期数据，输出运营策略建议。"
        ),
        "requirements": (
            "1. 3 年以上会员或用户运营经验；\n"
            "2. 有权益体系从 0 到 1 的搭建经验；\n"
            "3. 能看懂基础数据报表，会写简单的 SQL 更佳。"
        ),
        "additional_info": "双休，节日福利，年度旅游。",
    },
    {
        "title": "数据产品经理",
        "company": "云枢智能科技有限公司",
        "location": "上海·徐汇区",
        "salary": "30-45K",
        "job_type": "社招",
        "source": "公司官网",
        "source_url": "https://careers.example.com/yunshu/data-pm",
        "posted_at": "2026-10-23",
        "favorite": True,
        "status": "开放中",
        "note": "官网投递需要填一份项目经历表，已准备好。",
        "description": (
            "1. 负责数据平台类产品的需求分析与路线规划；\n"
            "2. 与分析师、算法、研发协作，把分析场景抽象成产品能力；\n"
            "3. 定义产品指标，跟踪上线后的使用情况与价值验证。"
        ),
        "requirements": (
            "1. 3 年以上数据产品或分析经验，理解指标体系与埋点；\n"
            "2. 能与研发讨论清楚数据链路与口径；\n"
            "3. 有 BI、归因、实验平台类产品经验优先；\n"
            "4. 具备较强的文档与沟通能力。"
        ),
        "additional_info": "股权激励、弹性工作、年度技术大会参会名额。",
    },
    {
        "title": "策略分析师（校招）",
        "company": "长川零售集团",
        "location": "上海·静安区",
        "salary": "18-24K·13薪",
        "job_type": "校招",
        "source": "公司官网",
        "source_url": "https://campus.example.com/changchuan/strategy",
        "posted_at": "2026-09-20",
        "favorite": False,
        "status": "已截止",
        "note": "只招 2027 届，我的毕业年份不符合。",
        "description": (
            "1. 参与集团层面的经营策略研究，覆盖门店、线上、会员三条线；\n"
            "2. 完成数据收集、建模与结论输出，支持管理层决策；\n"
            "3. 轮岗期 12 个月，结束后定岗到策略或运营部门。"
        ),
        "requirements": (
            "1. 2027 届硕士及以上，统计、经济、管理类专业；\n"
            "2. 具备较强的数据分析能力与商业敏感度；\n"
            "3. 英语可作为工作语言者优先。"
        ),
        "additional_info": "校招统一薪酬包，提供一年住宿补贴。",
    },
    {
        "title": "用户研究实习生",
        "company": "白鹭出行科技有限公司",
        "location": "上海·长宁区",
        "salary": "200-250/天",
        "job_type": "实习",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/demo-e7.html",
        "posted_at": "2026-10-22",
        "favorite": False,
        "status": "开放中",
        "note": "适合练手，但薪资低于预期。",
        "description": (
            "1. 协助完成用户访谈与可用性测试，整理访谈记录；\n"
            "2. 参与问卷设计与数据清洗；\n"
            "3. 输出研究小结，支持产品迭代决策。"
        ),
        "requirements": (
            "1. 每周到岗 4 天，实习期 3 个月以上；\n"
            "2. 心理学、社会学、统计等相关专业优先；\n"
            "3. 有访谈或问卷项目经验。"
        ),
        "additional_info": "提供实习证明，表现优秀可转正。",
    },
    {
        "title": "增长黑客（Growth Hacker）",
        "company": "火花实验室（北京）科技有限公司",
        "location": "北京·朝阳区",
        "salary": "35-50K",
        "job_type": "社招",
        "source": "内推",
        "source_url": "https://example.com/jobs/spark-growth",
        "posted_at": "2026-10-21",
        "favorite": False,
        "status": "开放中",
        "note": "前同事内推，需要先聊一次技术方案。",
        "description": (
            "1. 负责新产品的冷启动与增长实验，从 0 到 1 找到可复制的增长路径；\n"
            "2. 设计并落地裂变、分销、内容投放等多种增长手段；\n"
            "3. 建立增长数据体系，快速验证与迭代。"
        ),
        "requirements": (
            "1. 3 年以上增长经验，有从 0 到 1 的完整案例；\n"
            "2. 能自己写 SQL，会用 Python 做批量分析更佳；\n"
            "3. 对渠道成本与留存的关系有清晰判断；\n"
            "4. 接受高强度、快节奏的工作方式。"
        ),
        "additional_info": "期权 + 项目奖金，扁平组织。",
    },
    {
        "title": "数据分析师",
        "company": "明河医疗科技有限公司",
        "location": "苏州·工业园区",
        "salary": "18-28K",
        "job_type": "社招",
        "source": "智联招聘",
        "source_url": "https://jobs.zhaopin.com/demo-f9.htm",
        "posted_at": "2026-10-19",
        "favorite": False,
        "status": "开放中",
        "note": "医疗行业，需要了解一点合规要求。",
        "description": (
            "1. 负责院内运营数据的统计与建模，输出月度运营分析；\n"
            "2. 支持临床科研的数据清洗与统计分析；\n"
            "3. 维护数据字典与指标口径文档。"
        ),
        "requirements": (
            "1. 本科及以上，统计学、流行病学、公共卫生等相关专业；\n"
            "2. 熟练使用 SQL、Python 或 R；\n"
            "3. 了解临床研究的基本设计方法；\n"
            "4. 有医疗行业经验优先。"
        ),
        "additional_info": "五险一金、补充医疗、提供人才公寓申请。",
    },
    {
        "title": "会员运营专员",
        "company": "南屿酒店管理有限公司",
        "location": "上海·虹口区",
        "salary": "15-22K",
        "job_type": "社招",
        "source": "手动添加",
        "source_url": "",
        "posted_at": "2026-10-15",
        "favorite": False,
        "status": "开放中",
        "note": "朋友转发的招聘信息，规模偏小。",
        "description": (
            "1. 负责酒店会员体系的日常运营，包括积分、等级、权益；\n"
            "2. 策划会员活动并跟踪复购；\n"
            "3. 维护会员数据报表，定期输出运营简报。"
        ),
        "requirements": (
            "1. 2 年以上会员或 CRM 运营经验；\n"
            "2. 熟练使用 Excel，会基础的数据透视；\n"
            "3. 沟通能力强，能对接门店与供应商。"
        ),
        "additional_info": "双休，员工住宿折扣。",
    },
    {
        "title": "商业分析（零售）",
        "company": "恒野商贸有限公司",
        "location": "广州·天河区",
        "salary": "20-32K",
        "job_type": "社招",
        "source": "猎聘",
        "source_url": "https://www.liepin.com/job/demo-g11.shtml",
        "posted_at": "2026-10-17",
        "favorite": False,
        "status": "已投递",
        "note": "跨城市，先看面试反馈再决定。",
        "description": (
            "1. 负责门店与线上渠道的经营分析，定位增长与亏损来源；\n"
            "2. 搭建商品与门店维度的分析模型；\n"
            "3. 支持年度预算编制与月度滚动预测。"
        ),
        "requirements": (
            "1. 3 年以上零售或快消行业分析经验；\n"
            "2. 熟练 SQL 与 Excel，会 Tableau/Power BI 更佳；\n"
            "3. 能接受每月一次出差巡店。"
        ),
        "additional_info": "13 薪，出差补贴，年度调薪。",
    },
    {
        "title": "数据运营（内容）",
        "company": "风荷文化传媒有限公司",
        "location": "杭州·西湖区",
        "salary": "16-24K",
        "job_type": "社招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/demo-h12.html",
        "posted_at": "2026-10-16",
        "favorite": False,
        "status": "开放中",
        "note": "",
        "description": (
            "1. 负责内容数据的日常监控与归因，输出选题建议；\n"
            "2. 维护内容标签体系与选题库；\n"
            "3. 配合投放团队评估内容素材的效果。"
        ),
        "requirements": (
            "1. 2 年以上内容运营或数据运营经验；\n"
            "2. 熟悉主流内容平台的指标体系；\n"
            "3. 会写 SQL 优先。"
        ),
        "additional_info": "双休，内容创作激励。",
    },
    {
        "title": "增长分析师",
        "company": "星桥教育科技有限公司",
        "location": "上海·杨浦区",
        "salary": "24-36K",
        "job_type": "社招",
        "source": "公司官网",
        "source_url": "https://careers.example.com/xingqiao/growth-analyst",
        "posted_at": "2026-10-27",
        "favorite": True,
        "status": "开放中",
        "note": "业务与我的经历最接近，优先跟进。",
        "description": (
            "1. 负责课程产品的增长分析，覆盖试听、转化、续报全链路；\n"
            "2. 设计并复盘转化实验，沉淀可复用的策略库；\n"
            "3. 与销售团队共建线索质量评分。"
        ),
        "requirements": (
            "1. 3 年以上教育或消费行业分析经验；\n"
            "2. 熟练 SQL，能独立搭建看板；\n"
            "3. 有销售线索或 CRM 分析经验优先；\n"
            "4. 具备较强的跨部门推动能力。"
        ),
        "additional_info": "六险一金、子女课程折扣、弹性上班。",
    },
    {
        "title": "分析实习生（可转正）",
        "company": "澜石数据科技有限公司",
        "location": "上海·徐汇区",
        "salary": "220/天",
        "job_type": "实习",
        "source": "内推",
        "source_url": "",
        "posted_at": "2026-10-10",
        "favorite": False,
        "status": "已截止",
        "note": "内部转岗名额，已招满（留在回收站里用于测试恢复）。",
        "description": "1. 协助增长组完成日常取数；\n2. 参与专题分析的资料整理；\n3. 维护看板与指标文档。",
        "requirements": "1. 每周到岗 4 天；\n2. 会 SQL 基础语法；\n3. 统计、数学相关专业优先。",
        "additional_info": "有转正名额。",
    },
]

CANDIDATES = [
    {
        "title": "增长策略经理",
        "company": "木野生活（上海）有限公司",
        "raw_text": "",
        "note": "招聘会上扫的二维码，JD 还没细看。",
        "source": "岗位采集",
        "job_type": "社招",
        "location": "上海·普陀区",
        "salary": "28-40K",
        "source_url": "https://www.zhipin.com/job_detail/demo-k1.html",
        "description": "负责新消费品牌的增长策略，统筹私域与公域投放。",
        "requirements": "5 年以上增长经验，有消费品行业背景。",
        "additional_info": "13 薪，季度奖金。",
        "status": "pending",
    },
    {
        "title": "数据分析师（供应链）",
        "company": "北辰供应链管理有限公司",
        "raw_text": (
            "【北辰供应链】数据分析师\n地点：上海·青浦区\n薪资：18-26K\n"
            "职责：负责仓储与配送的效率分析，搭建成本模型。\n要求：3 年经验，熟练 SQL。"
        ),
        "note": "从招聘群复制过来的文本，还没核对企业信息。",
        "source": "手动添加",
        "job_type": "社招",
        "location": "上海·青浦区",
        "salary": "18-26K",
        "source_url": "",
        "description": "负责仓储与配送的效率分析，搭建成本模型。",
        "requirements": "3 年经验，熟练 SQL。",
        "additional_info": "",
        "status": "pending",
    },
    {
        "title": "用户增长（海外）",
        "company": "远帆数字科技有限公司",
        "raw_text": "",
        "note": "截图识别出来的岗位，薪资和地点待确认。",
        "source": "图片识别",
        "job_type": "社招",
        "location": "深圳·南山区",
        "salary": "30-45K",
        "source_url": "",
        "description": "负责东南亚市场的用户增长，统筹本地化投放与内容。",
        "requirements": "英语可作为工作语言，有海外增长经验。",
        "additional_info": "海外补贴。",
        "status": "pending",
    },
    {
        "title": "商业分析实习生",
        "company": "知微咨询（上海）有限公司",
        "raw_text": "【知微咨询】商业分析实习生\n120-150/天\n协助项目组完成行业研究与数据整理。",
        "note": "",
        "source": "手动添加",
        "job_type": "实习",
        "location": "上海·黄浦区",
        "salary": "120-150/天",
        "source_url": "",
        "description": "协助项目组完成行业研究与数据整理。",
        "requirements": "每周 3 天以上，能连续实习 4 个月。",
        "additional_info": "",
        "status": "pending",
    },
]


def _chart_png() -> str:
    """岗位备注里那张「渠道转化率对比」截图（虚构数据，与正文的 7 个渠道对得上）。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        font, has_cjk = cjk_font(18)
        small, _ = cjk_font(14)
        canvas.rectangle([0, 0, 639, 359], outline=(226, 232, 240))
        title = "渠道转化率对比（近 30 天）" if has_cjk else "Channel conversion (last 30d)"
        canvas.text((24, 18), title, fill=(15, 23, 42), font=font)
        bars = [
            ("私域", 0.124),
            ("搜索", 0.098),
            ("内容", 0.076),
            ("信息流", 0.041),
            ("联盟", 0.028),
        ]
        base_y, height = 300, 190
        for index, (label, value) in enumerate(bars):
            x = 60 + index * 112
            bar_height = int(height * value / 0.14)
            canvas.rectangle(
                [x, base_y - bar_height, x + 64, base_y],
                fill=(22, 54, 92) if index == 0 else (148, 163, 184),
            )
            canvas.text((x + 6, base_y + 8), label, fill=(51, 65, 85), font=small)
            canvas.text(
                (x + 6, base_y - bar_height - 20),
                f"{value * 100:.1f}%",
                fill=(15, 23, 42),
                font=small,
            )
        canvas.line([40, base_y, 620, base_y], fill=(148, 163, 184))

    return png_data_url(640, 360, draw)


def seed() -> None:
    """写 14 条岗位 + 4 条备选岗位；最后一条岗位留在回收站里。"""
    chart = _chart_png()
    rows = []
    for index, job in enumerate(JOBS):
        is_deleted = job["title"] == "分析实习生（可转正）"
        created = NOW - timedelta(days=index)
        rows.append(
            row(
                title=job["title"],
                company=job["company"],
                location=job["location"],
                salary=job["salary"],
                job_type=job["job_type"],
                description=job["description"],
                requirements=job["requirements"],
                additional_info=job["additional_info"],
                keywords=keywords_of(job),
                source=job["source"],
                source_url=job["source_url"],
                posted_at=job["posted_at"],
                status=job["status"],
                note=job["note"],
                note_images=[chart] if index == 0 else [],
                favorite=job["favorite"],
                recognition_source=recognition_source_of(job),
                origin_source=job["source"],
                created_at=created,
                updated_at=created,
                deleted_at=created if is_deleted else None,
            )
        )
    ins("job", rows)

    ins(
        "candidate_job",
        [
            row(
                **candidate,
                images=[],
                collect_task_id=None,
                imported_job_id=None,
                created_at=NOW - timedelta(days=2 + index),
                updated_at=NOW - timedelta(days=2 + index),
                deleted_at=None,
            )
            for index, candidate in enumerate(CANDIDATES)
        ],
    )
