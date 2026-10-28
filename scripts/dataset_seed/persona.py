# SPDX-License-Identifier: Apache-2.0
"""一份"内容饱满"的测试数据集：人物设定与全部正文。

与 ``scripts/demo_data/`` 的分工：那份是 README/官网截图用的**演示**数据（内容短、
一眼能认出来是示例），这份是给用户导入后**逐个功能试用**用的测试数据——因此要求
13 个内置板块的 106 个小字段几乎都被填上，且内容自洽（经历里的数字与事实台账、
简历正文对得上）。

这里的模块只放**常量**（dict / list），不 import app、不碰数据库：写库逻辑在
``dataset_seed.profile`` 等模块里。所有人物、公司、学校、证书编号均为虚构。
"""

from __future__ import annotations

# 数据集里的"现在"：固定值而不是 now()，同一份脚本每次跑出来的库才可比。
NOW_TEXT = "2026-10-28"

BASIC = {
    "name": "林知遥",
    "gender": "女",
    "birth_month": "1998-11",
    "phone": "138 0173 8891",
    "email": "lin.zhiyao@example.com",
    "city": "上海",
    "target_city": "上海 / 杭州",
    "job_intention": "用户增长 / 商业分析",
    "homepage": "https://zhiyao.example.com",
    "github": "https://github.com/zhiyao-lin",
    "portfolio_url": "https://zhiyao.example.com/portfolio",
    "political_status": "群众",
    "driver_license": "C1",
    "available_date": "一个月内到岗",
}

SUMMARY = (
    "3 年用户增长与商业分析经验，做过 186 万会员的分层召回、12 组留存增长实验和一套"
    "渠道质量评分体系：季度召回率从 8.1% 提到 12.4%，新客 7 日留存从 31% 提到 38%，"
    "获客成本下降 17%。习惯先把指标口径钉死再谈结论，做过的分析都会落成可复用的看板"
    "或 SOP，而不是停在一次性报告里。硕士读应用统计，能独立完成取数、建模、实验设计与"
    "复盘汇报的全链路，也愿意把方法讲给业务同学听。"
)

EDUCATIONS = [
    {
        "school": "上海财经大学",
        "major": "应用统计",
        "degree": "硕士",
        "study_form": "全日制",
        "degree_type": "专业学位",
        "department": "统计与管理学院",
        "start_date": "2021-09",
        "end_date": "2023-06",
        "gpa": "3.8/4.0",
        "rank": "6/48",
        "advisor": "周敏华",
        "research_direction": "用户行为建模与因果推断",
        "core_courses": (
            "应用回归分析；多元统计分析；因果推断与实验设计；时间序列分析；"
            "数据挖掘；统计计算与 R 语言；消费者行为定量研究"
        ),
        "achievements": (
            "- 学位论文《基于生存分析的会员流失预警研究》获院级优秀论文提名，盲审 88 分。\n"
            "- 与导师合作完成 1 篇会议论文（第二作者），负责眼动实验的数据清洗与中介效应检验。\n"
            "- 连续两年获一等学业奖学金，综合排名 6/48。"
        ),
    },
    {
        "school": "上海大学",
        "major": "市场营销",
        "degree": "本科",
        "study_form": "全日制",
        "degree_type": "管理学学士",
        "department": "管理学院",
        "start_date": "2017-09",
        "end_date": "2021-06",
        "gpa": "3.7/4.0",
        "rank": "5/126",
        "advisor": "",
        "research_direction": "",
        "core_courses": (
            "市场调研；消费者行为学；应用统计学；计量经济学；品牌管理；渠道管理；商务数据分析"
        ),
        "achievements": (
            "- 国家奖学金（2020）、校优秀毕业生（2021）。\n"
            "- 全国大学生数学建模竞赛上海赛区三等奖，负责模型选型与论文写作。\n"
            "- 毕业论文《内容种草对大学生购买决策的影响》获评校级优秀毕业论文。"
        ),
    },
]

EXPERIENCES = [
    {
        "company": "澜石数据科技（上海）有限公司",
        "title": "用户增长分析师",
        "start_date": "2023-07",
        "end_date": "至今",
        "team_size": "8 人（增长组）",
        "work_type": "全职",
        "description": (
            "- 负责会员生命周期增长：把 186 万会员按活跃度与消费频次切成 5 层，"
            "针对沉默层设计三档召回策略（权益、内容、短信），季度召回率从 8.1% 提升到 12.4%，"
            "折算增量 GMV 约 210 万元。\n"
            "- 主导「新客 7 日留存」增长实验：与产品、算法共建 12 组 AB 实验，"
            "统一指标口径与分流校验，最终上线的权益组合把 7 日留存从 31% 提到 38%。\n"
            "- 搭建增长看板（SQL + Tableau），把拉新、激活、留存、变现四段漏斗合成一张日更看板，"
            "替代原先每周手工汇总的 3 份表，指标口径争议从每月 5 次以上降到 0。\n"
            "- 与投放团队共建渠道质量评分（CAC、次留、30 日 LTV），按周复盘后停投 4 个低质渠道，"
            "季度获客成本下降 17%，高价值渠道预算占比从 42% 提到 61%。\n"
            "- 牵头把实验复盘模板沉淀为团队 SOP，覆盖假设、分流、显著性判断、上线决策 9 个检查点，"
            "新同学独立跑完一次实验的时间从 3 周缩短到 1 周。\n"
            "- 带 1 名实习生，负责其 SQL 规范与实验设计的日常 review，实习期内独立交付 2 份专题分析。"
        ),
    },
    {
        "company": "云梯网络科技（杭州）有限公司",
        "title": "数据分析实习生",
        "start_date": "2022-07",
        "end_date": "2023-01",
        "team_size": "5 人（增长分析）",
        "work_type": "实习",
        "description": (
            "- 支持增长与内容两条业务线的日常取数与专题分析，实习期内独立交付 9 份分析，"
            "其中 3 份结论直接进入了当季的运营排期。\n"
            "- 用 Python 把 12 张日报表自动化，原先每天早上 40 分钟的手工汇总压缩到 5 分钟，"
            "并把口径写进脚本注释，交接给下一位同学时不需要再口头讲一遍。\n"
            "- 参与「连续签到」活动效果评估：用倾向得分匹配控制用户活跃度差异，"
            "结论是该活动对次留的提升约 4 个百分点，低于运营侧预期，建议改为分层奖励。\n"
            "- 维护内容选题的阅读完成率看板，按栏目拆出「开头 3 秒流失」指标，"
            "帮助内容组把完读率从 26% 提到 34%。"
        ),
    },
    {
        "company": "星野文化传播（上海）有限公司",
        "title": "市场部实习生",
        "start_date": "2020-07",
        "end_date": "2020-09",
        "team_size": "4 人（品牌组）",
        "work_type": "实习",
        "description": (
            "- 负责公众号内容排期与数据复盘，两个月产出 18 篇推文，"
            "整理出「标题类型 × 打开率」对照表，把平均打开率从 4.2% 提到 5.9%。\n"
            "- 整理竞品活动案例库 60 个，按玩法、预算、传播路径分类，"
            "成为组内做季度方案时的第一份参考材料。\n"
            "- 协助一场线下快闪活动的执行，负责报名表单、现场签到与活动后问卷，"
            "回收有效问卷 312 份。"
        ),
    },
]

PROJECTS = [
    {
        "name": "会员分层与沉默用户召回",
        "role": "项目负责人",
        "start_date": "2024-03",
        "end_date": "2024-09",
        "tech_stack": "SQL, Python, Tableau, RFM",
        "project_size": "覆盖 186 万会员，联动 3 个团队",
        "outcome_type": "团队项目",
        "public_url": "",
        "description": (
            "把原先「全量发券」的粗放召回改成按生命周期分层：以最近购买、频次、"
            "历史客单与内容互动四组信号构造分层规则，为 5 层人群分别配置召回手段与预算。"
        ),
        "highlights": (
            "- 沉默层召回率 8.1% → 12.4%，增量 GMV 约 210 万元/季度。\n"
            "- 用 3 周做小流量验证（每层 5% 抽样），确认权益对高层级用户是负向刺激后，"
            "把高层级人群从发券名单里摘掉，单季度券成本下降 23%。\n"
            "- 分层规则与预算配置沉淀为可调参的配置表，运营同学改参数即可跑下一轮，"
            "不再需要每次找分析师写 SQL。"
        ),
    },
    {
        "name": "多渠道活动归因看板",
        "role": "独立开发",
        "start_date": "2025-01",
        "end_date": "2025-04",
        "tech_stack": "SQL, Metabase, Python",
        "project_size": "7 个渠道 / 每日 40 万条事件",
        "outcome_type": "个人项目",
        "public_url": "https://zhiyao.example.com/attribution",
        "description": (
            "市场部原先按各渠道自报的转化数汇总，加起来比实际成交多 30%。"
            "这套看板把曝光、点击、落地页、下单串成一条事件链，用末次点击与线性归因各算一遍，"
            "差额直接显示在同一个页面上。"
        ),
        "highlights": (
            "- 归因口径统一后，渠道 ROI 排序发生明显变化：两个自报效果最好的渠道实际排在末位。\n"
            "- 每月节省 12 小时的手工对数时间，市场与增长两侧共用同一份数字。\n"
            "- 已登记软件著作权（2025SR0448210），代码与口径文档一并归档。"
        ),
    },
    {
        "name": "会员流失预警模型",
        "role": "模型负责人",
        "start_date": "2022-09",
        "end_date": "2023-01",
        "tech_stack": "Python, LightGBM, SHAP, 生存分析",
        "project_size": "课程项目，样本 12 万",
        "outcome_type": "课程项目",
        "public_url": "",
        "description": (
            "用 Cox 比例风险模型与 LightGBM 两条路线预测会员在未来 30 天内的流失概率，"
            "重点不是把 AUC 堆高，而是让运营能看懂「为什么这个人可能要走」。"
        ),
        "highlights": (
            "- LightGBM 版本 AUC 0.82，比逻辑回归基线高 6 个百分点；Cox 版本可给出时间维度解释。\n"
            "- 用 SHAP 把特征贡献拆到单用户级别，输出「最近 14 天无互动」「客单下降 40%」这类可执行理由。\n"
            "- 按概率分 4 档做 uplift 估算，避免把预算花在本来就不会走的人身上。"
        ),
    },
    {
        "name": "校园二手书交易小程序",
        "role": "产品与前端",
        "start_date": "2019-03",
        "end_date": "2019-09",
        "tech_stack": "微信小程序, 云开发, JavaScript",
        "project_size": "2 人，累计 1200 名用户",
        "outcome_type": "个人项目",
        "public_url": "https://example.com/secondhand-books",
        "description": (
            "毕业季教材流转信息散在十几个群里，做一个小程序把「发布—搜索—当面交易」三步收拢，"
            "按学院与课程号建索引，教材能被同专业低年级直接搜到。"
        ),
        "highlights": (
            "- 上线一个学期累计 1200 名用户、成交约 640 单，教材平均成交价为新书的 3 折。\n"
            "- 用课程号做索引后，搜索到成交的转化率从 11% 提到 27%。\n"
            "- 这段经历是我后来做增长时反复引用的例子：需求不是被「运营」出来的，是被检索效率卡住的。"
        ),
    },
    {
        "name": "招聘漏斗诊断",
        "role": "分析负责人",
        "start_date": "2025-06",
        "end_date": "2025-08",
        "tech_stack": "SQL, 漏斗分析, 同期群分析",
        "project_size": "覆盖 6 个岗位族、14 个月数据",
        "outcome_type": "团队项目",
        "public_url": "",
        "description": (
            "HR 侧反馈「简历不少但招不到人」，把 14 个月的招聘数据按岗位族拆成简历、初筛、"
            "面试、offer、入职五段，定位到底是哪一段在漏。"
        ),
        "highlights": (
            "- 定位到技术岗卡在初筛（通过率 18%），运营岗卡在 offer 接受率（52%）。\n"
            "- 建议技术岗把 JD 里的必备项从 9 条减到 4 条，试运行两个月后初筛通过率升到 29%。\n"
            "- 平均招聘周期从 42 天降到 29 天，报告被 HR 直接用作季度复盘材料。"
        ),
    },
]

SKILLS = [
    {"name": "SQL", "level": "精通", "category": "编程语言"},
    {"name": "Python", "level": "熟练", "category": "编程语言"},
    {"name": "Pandas / NumPy", "level": "熟练", "category": "框架与库"},
    {"name": "LightGBM / scikit-learn", "level": "掌握", "category": "框架与库"},
    {"name": "Tableau", "level": "熟练", "category": "工具与平台"},
    {"name": "Metabase", "level": "熟练", "category": "工具与平台"},
    {"name": "Excel（透视表 / Power Query）", "level": "精通", "category": "工具与平台"},
    {"name": "Hive", "level": "掌握", "category": "工具与平台"},
    {"name": "Git", "level": "掌握", "category": "工具与平台"},
    {"name": "A/B 实验设计", "level": "熟练", "category": "其他"},
    {"name": "用户分层与 RFM", "level": "熟练", "category": "其他"},
    {"name": "指标体系搭建", "level": "熟练", "category": "其他"},
    {"name": "跨部门协作", "level": "熟练", "category": "软技能"},
    {"name": "结构化表达与汇报", "level": "熟练", "category": "软技能"},
]

CAMPUS_EXPERIENCES = [
    {
        "organization": "上海大学学生会宣传部",
        "role": "副部长",
        "start_date": "2018-09",
        "end_date": "2019-06",
        "activity_type": "学生会",
        "description": (
            "- 带 6 人小组负责校级活动的视觉与推文，一学年产出 40 篇推文，平均阅读量 3200。\n"
            "- 把活动宣传流程拆成「物料清单—排期—复盘」三段模板，换届交接时不再靠口口相传。"
        ),
    },
    {
        "organization": "上海大学数据科学社",
        "role": "社长",
        "start_date": "2019-09",
        "end_date": "2020-06",
        "activity_type": "社团",
        "description": (
            "- 组织 8 场校内分享与 2 次数据竞赛训练营，社团活跃成员从 30 人增加到 96 人。\n"
            "- 牵头与统计系老师合作开设 R 语言入门工作坊，两期共 120 人参加。"
        ),
    },
    {
        "organization": "上海科技馆",
        "role": "志愿服务者",
        "start_date": "2018-03",
        "end_date": "2018-06",
        "activity_type": "志愿服务",
        "description": (
            "- 周末在「人与健康」展区做讲解，累计服务 48 小时，负责散客与团队两套讲解词。\n"
            "- 协助整理观众提问，汇总成 30 条高频问题的答复口径交给展区。"
        ),
    },
]

AWARDS = [
    {
        "title": "国家奖学金",
        "awarded_at": "2020-10",
        "issuer": "教育部",
        "level": "国家级",
        "award_ratio": "前 2%",
        "description": "本科期间综合测评专业第一，全校 12 名本科生获评。",
    },
    {
        "title": "上海财经大学一等学业奖学金",
        "awarded_at": "2022-10",
        "issuer": "上海财经大学",
        "level": "校级",
        "award_ratio": "前 10%",
        "description": "研究生二年级，综合排名 6/48。",
    },
    {
        "title": "全国大学生数学建模竞赛 上海赛区三等奖",
        "awarded_at": "2020-09",
        "issuer": "中国工业与应用数学学会",
        "level": "省级",
        "award_ratio": "",
        "description": "三人队，负责模型选型、代码实现与论文写作。",
    },
    {
        "title": "上海大学优秀毕业生",
        "awarded_at": "2021-06",
        "issuer": "上海大学",
        "level": "校级",
        "award_ratio": "前 5%",
        "description": "",
    },
    {
        "title": "上海大学优秀学生干部",
        "awarded_at": "2020-11",
        "issuer": "上海大学",
        "level": "校级",
        "award_ratio": "",
        "description": "任学生会宣传部副部长期间获评。",
    },
]

PUBLICATIONS = [
    {
        "title": "价格框架对复购意愿的影响：基于眼动实验的证据",
        "outcome_type": "会议论文",
        "authorship_rank": "第二作者",
        "authors": "周敏华、林知遥、陈立",
        "venue": "中国营销科学学术年会（JMSAC）",
        "year": "2022",
        "status": "published",
        "url": "https://example.org/jmsac2022/paper-118",
        "doi": "10.0000/jmsac.2022.118",
        "volume_pages": "论文集 pp. 118-126",
        "note": (
            "负责眼动实验的数据清洗（有效样本 96 人）与中介效应检验，"
            "用 Bootstrap 法验证「价格注意时长」的中介作用。"
        ),
    },
    {
        "title": "基于生存分析的会员流失预警研究",
        "outcome_type": "研究报告",
        "authorship_rank": "第一作者",
        "authors": "林知遥",
        "venue": "上海财经大学硕士学位论文",
        "year": "2023",
        "status": "published",
        "url": "",
        "doi": "",
        "volume_pages": "",
        "note": "盲审 88 分，获院级优秀论文提名；对比 Cox 与 LightGBM 两类模型的可解释性取舍。",
    },
]

RESEARCH_PROJECTS = [
    {
        "name": "消费者决策中的价格框架效应研究",
        "role": "研究助理",
        "institution": "上海财经大学 统计与管理学院",
        "level": "校级",
        "start_date": "2021-10",
        "end_date": "2022-06",
        "funding": "校级科研基金 2 万元",
        "description": (
            "课题组用眼动仪与问卷结合，研究「原价—折扣」与「分期—一次性」两种价格呈现方式"
            "对复购意愿的影响路径。"
        ),
        "outcomes": (
            "- 完成 96 名被试的实验执行与数据清洗，形成可复用的实验数据字典。\n"
            "- 产出会议论文 1 篇（第二作者），并在组会做了 2 次方法分享。"
        ),
    },
    {
        "name": "零售企业会员流失预警的横向课题",
        "role": "模型负责人",
        "institution": "上海财经大学 × 某连锁零售企业",
        "level": "企业横向",
        "start_date": "2022-03",
        "end_date": "2023-05",
        "funding": "企业横向经费 8 万元",
        "description": (
            "为企业搭建会员流失预警原型：在不引入外部数据的前提下，"
            "用交易与互动行为预测 30 天流失概率，并给出可分层的运营建议。"
        ),
        "outcomes": (
            "- 交付 AUC 0.82 的预警模型与一份阈值选择说明（兼顾召回率与触达成本）。\n"
            "- 模型思路后来被我带到工作中，改造成会员分层的输入之一。"
        ),
    },
]

PATENTS = [
    {
        "title": "会员分层与召回策略配置系统",
        "outcome_type": "软件著作权",
        "inventors": "林知遥",
        "inventor_rank": "第一发明人",
        "patent_number": "2024SR1234567",
        "status": "已登记",
        "application_date": "2024-08",
        "grant_date": "2024-11",
        "url": "https://example.com/copyright/2024SR1234567",
        "country": "中国",
    },
    {
        "title": "多渠道活动归因分析工具",
        "outcome_type": "软件著作权",
        "inventors": "林知遥、吴穹",
        "inventor_rank": "第一发明人",
        "patent_number": "2025SR0448210",
        "status": "已登记",
        "application_date": "2025-02",
        "grant_date": "2025-05",
        "url": "https://example.com/copyright/2025SR0448210",
        "country": "中国",
    },
]

CREDENTIALS = [
    {
        "title": "Google Analytics 4 认证",
        "credential_type": "技能认证",
        "issuer": "Google",
        "issued_at": "2024-03",
        "expires_at": "2026-03",
        "status": "已过期",
        "credential_number": "GA4-2024-088417",
        "verify_url": "https://skillshop.example.com/verify/GA4-2024-088417",
        "note": "到期后未续期；内容仍适用于看板搭建，已不作为卖点写进简历。",
    },
    {
        "title": "阿里云数据分析师 ACP",
        "credential_type": "职业资格",
        "issuer": "阿里云",
        "issued_at": "2023-11",
        "expires_at": "2026-11",
        "status": "有效",
        "credential_number": "ACP-2023-77120",
        "verify_url": "",
        "note": "",
    },
    {
        "title": "全国计算机等级考试二级（Python）",
        "credential_type": "技能认证",
        "issuer": "教育部教育考试院",
        "issued_at": "2019-09",
        "expires_at": "",
        "status": "长期有效",
        "credential_number": "NCRE-2019-330512",
        "verify_url": "",
        "note": "",
    },
    {
        "title": "普通话水平测试 二级甲等",
        "credential_type": "语言证书",
        "issuer": "国家语言文字工作委员会",
        "issued_at": "2021-05",
        "expires_at": "",
        "status": "长期有效",
        "credential_number": "PSC-2021-014872",
        "verify_url": "",
        "note": "",
    },
]

LANGUAGES = [
    {"language": "中文", "level": "母语", "certificate": "", "score": "", "obtained_at": ""},
    {
        "language": "英语",
        "level": "熟练",
        "certificate": "CET-6",
        "score": "590",
        "obtained_at": "2019-12",
    },
    {
        "language": "英语",
        "level": "熟练",
        "certificate": "IELTS",
        "score": "7.0（听力 7.5 / 阅读 7.5 / 写作 6.5 / 口语 6.5）",
        "obtained_at": "2022-03",
    },
    {
        "language": "日语",
        "level": "日常交流",
        "certificate": "JLPT N2",
        "score": "112/180",
        "obtained_at": "2021-12",
    },
]

# 自建板块：字段顺序即展示顺序，第一个字段自动成为"主文本字段"（纸面标题）。
CUSTOM_SECTIONS = [
    {
        "name": "作品集",
        "fields": [
            ("作品说明", "multi_line"),
            ("作品链接", "single_line"),
        ],
        "entries": [
            {
                "作品说明": (
                    "增长周报模板（Notion 公开版）：把「本周核心指标—异常拆解—下周假设」"
                    "压成一页，团队连续用了 11 个月；模板里保留了旧版本链接，"
                    "能看到三次结构调整的原因。"
                ),
                "作品链接": "https://zhiyao.example.com/notes/growth-weekly",
            },
            {
                "作品说明": (
                    "AB 实验复盘清单：9 个检查点，分别是假设是否可证伪、样本量、分流校验、"
                    "指标口径、显著性、效应量、护栏指标、上线决策、后续跟踪。"
                ),
                "作品链接": "https://zhiyao.example.com/notes/ab-checklist",
            },
            {
                "作品说明": (
                    "SQL 面试题库（60 题）：校招时整理的自用题库，按窗口函数、留存、漏斗"
                    "三类分组，每题附执行计划说明。"
                ),
                "作品链接": "https://github.com/zhiyao-lin/sql-drill",
            },
        ],
    },
    {
        "name": "培训与课程",
        "fields": [
            ("课程收获", "multi_line"),
            ("开设机构", "single_line"),
            ("结课时间", "date_text"),
        ],
        "entries": [
            {
                "课程收获": (
                    "因果推断与 uplift 建模：系统过了一遍潜在结果框架，把组里原先"
                    "「看 AB 显著就上」的习惯改成先算增量再排优先级。"
                ),
                "开设机构": "公司内部数据学院",
                "结课时间": "2025-06",
            },
            {
                "课程收获": (
                    "商业写作与结构化表达：作业被讲师选为范例；此后所有分析报告都先写"
                    "结论页再补过程。"
                ),
                "开设机构": "三节课",
                "结课时间": "2024-04",
            },
        ],
    },
]

# 网申专用字段（只进旧 user_profile 表，用于「网申填表」页签）。
WEB_FORM = {
    "wechat": "zhiyao_lin",
    "birth_date": "1998-11-07",
    "id_type": "居民身份证",
    "country_region": "中国",
    "native_place": "浙江宁波",
    "political_status": "群众",
    "phone_country_code": "+86",
    "family_info": "父母均在职，家庭无负担，可接受异地派驻。",
    "expected_salary": "25-35K·14 薪",
    "qq": "1182047365",
    "advisor": "周敏华",
    "research_direction": "用户行为建模与因果推断",
    "preferred_industry": "互联网 / 消费零售 / 企业服务",
}
