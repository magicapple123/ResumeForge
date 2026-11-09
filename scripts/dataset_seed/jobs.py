# SPDX-License-Identifier: Apache-2.0
"""岗位域：14 条正式岗位（含已截止/已投递/回收站）+ 4 条备选岗位。

岗位都是 2027 届计算机本科应届生会投的技术岗：后端、AI Agent、全栈、测试开发、数据开发、
客户端。正文按真实 JD 的写法给：职责 3–5 条、要求 3–5 条、补充信息一句。技能标签不手写，
交给 ``base.keywords_of`` 用应用自己的解析器生成——手写一份必然和词表漂移。

``source_url`` 一律用真实招聘平台的 URL 形态（BOSS 直聘 / 智联 / 猎聘 / 公司校招站），
每条的数字都不同；``source`` 只能取 ``base.recognition_source_of`` 认得的取值
（招聘平台 → 岗位采集、公司官网 → 官网采集、其余 → 手动填写）。
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

# source 是用户可见的「来源」，status 用 models.job 的白名单（开放中/已截止/已投递）。
JOBS = [
    {
        "title": "后端开发工程师（校招）",
        "company": "杭州枢云信息科技有限公司",
        "location": "杭州·余杭区",
        "salary": "18-28K·14薪",
        "job_type": "校招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/78234190.html",
        "posted_at": "2026-10-26",
        "favorite": True,
        "status": "开放中",
        "note": "内推人：张工（交易中台），走的是部门直招；一面手写 LRU，二面问慢查询排查。",
        "description": (
            "1. 负责交易与订单域的服务端开发，承接日常需求并保证接口的稳定性与性能；\n"
            "2. 参与缓存、消息队列、异步任务的方案设计与落地；\n"
            "3. 治理慢查询与热点接口，参与容量评估与压测；\n"
            "4. 补单测、写文档，参与组内 code review。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机、软件工程等相关专业；\n"
            "2. 熟悉 Python 或 Java 至少一门，理解常见数据结构与算法；\n"
            "3. 熟悉 MySQL 索引与事务，了解 Redis 常用结构与使用场景；\n"
            "4. 有完整的课程项目或个人项目，能讲清自己负责的那部分；\n"
            "5. 有互联网公司实习经历者优先。"
        ),
        "additional_info": "六险一金、免费三餐、租房补贴、弹性上班；校招统一 14 薪。",
    },
    {
        "title": "AI Agent 开发工程师（校招）",
        "company": "杭州灵枢智能科技有限公司",
        "location": "杭州·滨江区",
        "salary": "22-35K·14薪",
        "job_type": "校招",
        "source": "猎聘",
        "source_url": "https://www.liepin.com/job/19873402.shtml",
        "posted_at": "2026-10-25",
        "favorite": False,
        "status": "已投递",
        "note": "10/27 投递；简历第一屏放的就是评测集那条，HR 说组里正缺做评测的人。",
        "description": (
            "1. 负责企业知识库 Agent 的工具层与编排层开发，覆盖检索、表格查询、工单等场景；\n"
            "2. 设计工具调用的参数结构与失败重试策略，提升端到端任务成功率；\n"
            "3. 维护评测集与离线评测流程，每次发版前给出回归结论；\n"
            "4. 与产品、算法一起做 prompt 迭代与效果归因。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机相关专业，有 LLM 应用项目经验；\n"
            "2. 熟悉 Python，能读懂并改造开源框架的调用链；\n"
            "3. 理解 function calling / RAG 的基本原理，知道常见失败模式；\n"
            "4. 有评测集构建或数据分析经验者优先；\n"
            "5. 有开源贡献或技术博客者优先。"
        ),
        "additional_info": "13 薪 + 项目奖金，GPU 资源充足，入职配 32 寸显示器。",
    },
    {
        "title": "全栈开发工程师（校招）",
        "company": "南京云枢软件有限公司",
        "location": "南京·雨花台区",
        "salary": "16-26K·14薪",
        "job_type": "校招",
        "source": "智联招聘",
        "source_url": "https://jobs.zhaopin.com/93102745.htm",
        "posted_at": "2026-10-24",
        "favorite": False,
        "status": "开放中",
        "note": "",
        "description": (
            "1. 参与企业协同办公产品的前后端开发，从需求评审到上线全流程参与；\n"
            "2. 前端使用 React + TypeScript，后端使用 Python 或 Node.js；\n"
            "3. 参与组件库与接口规范的建设，减少重复实现；\n"
            "4. 配合质量同学完成联调与问题定位。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机相关专业；\n"
            "2. 熟悉 JavaScript/TypeScript，了解 React 或 Vue 之一；\n"
            "3. 了解一种后端语言与关系型数据库，能独立写 CRUD 与联调；\n"
            "4. 有从 0 到 1 上线过的项目，能说明技术选型理由。"
        ),
        "additional_info": "双休、五险一金按全额缴纳、每年两次调薪窗口。",
    },
    {
        "title": "Python 后端开发工程师",
        "company": "上海澜川网络科技有限公司",
        "location": "上海·徐汇区",
        "salary": "20-32K·14薪",
        "job_type": "社招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/82067315.html",
        "posted_at": "2026-10-23",
        "favorite": True,
        "status": "开放中",
        "note": "团队 8 人，直属 leader 是从支付转过来的，聊下来方向比较对口。",
        "description": (
            "1. 负责 SaaS 产品的服务端设计与开发，主力框架 FastAPI；\n"
            "2. 承担接口性能优化、慢查询治理与缓存设计；\n"
            "3. 参与数据一致性方案的评审，处理对账、幂等与重试；\n"
            "4. 参与线上问题排查，沉淀值班手册与告警规则。"
        ),
        "requirements": (
            "1. 本科及以上，2 年以上 Python 服务端开发经验；\n"
            "2. 熟悉 FastAPI/Django 之一，理解异步编程模型；\n"
            "3. 熟悉 PostgreSQL/MySQL，能用 EXPLAIN 定位问题；\n"
            "4. 熟悉 Redis、消息队列，做过异步任务拆分；\n"
            "5. 有高并发或计费类系统经验者优先。"
        ),
        "additional_info": "14 薪 + 季度绩效，补充商业医疗保险，可申请人才公寓。",
    },
    {
        "title": "算法工程师（LLM 应用）",
        "company": "北京启元智能科技有限公司",
        "location": "北京·海淀区",
        "salary": "28-45K·15薪",
        "job_type": "社招",
        "source": "猎聘",
        "source_url": "https://www.liepin.com/job/20135886.shtml",
        "posted_at": "2026-10-22",
        "favorite": False,
        "status": "开放中",
        "note": "更偏模型微调与研究，工程占比低；先投着看，面试再判断。",
        "description": (
            "1. 负责行业大模型的微调与对齐实验，输出可复现的实验结论；\n"
            "2. 建设领域评测集，设计自动评测与人工抽检流程；\n"
            "3. 与工程团队配合把模型能力落到产品链路里；\n"
            "4. 跟踪前沿论文并做内部分享。"
        ),
        "requirements": (
            "1. 硕士及以上，计算机、人工智能相关专业；\n"
            "2. 熟悉 PyTorch，做过 SFT/LoRA 等微调实验；\n"
            "3. 熟悉 RAG、向量检索与重排，能读懂英文论文；\n"
            "4. 有评测体系搭建经验者优先。"
        ),
        "additional_info": "15 薪 + 论文奖励，GPU 集群共享，弹性工作。",
    },
    {
        "title": "测试开发工程师（校招）",
        "company": "深圳恒芯云科技有限公司",
        "location": "深圳·南山区",
        "salary": "17-26K·14薪",
        "job_type": "校招",
        "source": "智联招聘",
        "source_url": "https://jobs.zhaopin.com/95531028.htm",
        "posted_at": "2026-10-20",
        "favorite": False,
        "status": "已截止",
        "note": "10/21 投的，10/24 官网就挂出「停止接收简历」，状态改成已截止。",
        "description": (
            "1. 负责服务端接口的自动化用例设计与实现，维护回归集；\n"
            "2. 建设质量工具与 CI 流水线，提升发版效率；\n"
            "3. 参与性能压测与稳定性演练，输出质量报告；\n"
            "4. 参与线上问题复盘，补充可测性设计建议。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机相关专业；\n"
            "2. 熟悉 Python，能独立写接口自动化脚本；\n"
            "3. 了解 HTTP 协议、数据库基础与 Linux 常用命令；\n"
            "4. 有 pytest、Jenkins 或压测工具使用经验者优先。"
        ),
        "additional_info": "14 薪、免费班车、体检与健身房。",
    },
    {
        "title": "数据开发工程师",
        "company": "上海数野信息技术有限公司",
        "location": "上海·浦东新区",
        "salary": "19-30K·14薪",
        "job_type": "社招",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/79412668.html",
        "posted_at": "2026-10-19",
        "favorite": False,
        "status": "开放中",
        "note": "",
        "description": (
            "1. 负责业务数仓的分层建模与 ETL 任务开发，保障数据时效与口径一致；\n"
            "2. 优化离线任务的执行效率，治理长尾任务与数据倾斜；\n"
            "3. 支撑业务方的取数需求，沉淀常用指标与宽表；\n"
            "4. 参与数据质量监控规则的制定。"
        ),
        "requirements": (
            "1. 本科及以上，1 年以上数据开发经验；\n"
            "2. 熟练 SQL，了解 Hive/Spark 的任务调度与优化；\n"
            "3. 熟悉 Python，能写数据校验与清洗脚本；\n"
            "4. 有指标体系或数仓分层实践经验者优先。"
        ),
        "additional_info": "14 薪、每年一次技术大会参会名额、内部转岗开放。",
    },
    {
        "title": "客户端开发工程师（校招，iOS/Android）",
        "company": "广州启岸科技有限公司",
        "location": "广州·天河区",
        "salary": "16-24K·13薪",
        "job_type": "校招",
        "source": "公司官网",
        "source_url": "https://job.qi-an-tech.com/campus/2027/client",
        "posted_at": "2026-10-18",
        "favorite": False,
        "status": "开放中",
        "note": "官网投递要填一份项目经历表，已经把二手交易平台那段整理好了。",
        "description": (
            "1. 参与移动端业务功能的开发与迭代，方向为 iOS 或 Android；\n"
            "2. 参与性能与稳定性治理，处理崩溃、卡顿与内存问题；\n"
            "3. 与后端联调接口，参与组件化与基础库建设；\n"
            "4. 参与灰度发布与线上问题跟踪。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机相关专业；\n"
            "2. 熟悉 Java/Kotlin 或 Swift/Objective-C 之一，了解一门脚本语言；\n"
            "3. 理解网络协议与多线程基础，能读懂崩溃堆栈；\n"
            "4. 有 App 上架或个人作品者优先。"
        ),
        "additional_info": "13 薪 + 季度奖金、免费午晚餐、入职配 MacBook。",
    },
    {
        "title": "后端开发实习生",
        "company": "苏州云栖智算科技有限公司",
        "location": "苏州·工业园区",
        "salary": "240/天",
        "job_type": "实习",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job_detail/83740291.html",
        "posted_at": "2026-10-18",
        "favorite": False,
        "status": "开放中",
        "note": "每周到岗 4 天就行，学校坐 2 号线直达，通勤 40 分钟。",
        "description": (
            "1. 参与算力调度平台的后端接口开发与联调；\n"
            "2. 协助做接口压测与日志埋点，整理压测结论；\n"
            "3. 参与文档维护与用例补充。"
        ),
        "requirements": (
            "1. 计算机相关专业在读，每周到岗 4 天、连续 3 个月以上；\n"
            "2. 会 Python，了解 FastAPI 或 Flask；\n"
            "3. 了解 MySQL 与 Linux 基础操作；\n"
            "4. 有课程项目或开源经历者优先。"
        ),
        "additional_info": "实习补贴 240/天，提供实习证明，表现优秀可转正。",
    },
    {
        "title": "AI 应用开发实习生",
        "company": "上海知源智能科技有限公司",
        "location": "上海·杨浦区",
        "salary": "260/天",
        "job_type": "实习",
        "source": "猎聘",
        "source_url": "https://www.liepin.com/job/20967114.shtml",
        "posted_at": "2026-10-17",
        "favorite": True,
        "status": "开放中",
        "note": "内推人：陈工（Agent 应用组），说实习期主要做评测和工具层，正好对口。",
        "description": (
            "1. 参与 Agent 工具层开发，把内部系统封装成可调用的 function tool；\n"
            "2. 协助维护评测集，跑离线评测并整理失败样本；\n"
            "3. 参与 RAG 链路的切分与检索参数调优。"
        ),
        "requirements": (
            "1. 计算机相关专业在读，每周到岗 3 天以上，连续 4 个月；\n"
            "2. 熟悉 Python，用过大模型 API 或开源框架；\n"
            "3. 能读懂英文文档，会写简单的评测脚本；\n"
            "4. 有 RAG 或 Agent 项目经验者优先。"
        ),
        "additional_info": "260/天，弹性到岗，可远程一天/周。",
    },
    {
        "title": "服务端开发工程师（Go / Python）",
        "company": "成都星河云图科技有限公司",
        "location": "成都·高新区",
        "salary": "21-33K·14薪",
        "job_type": "社招",
        "source": "智联招聘",
        "source_url": "https://jobs.zhaopin.com/97820116.htm",
        "posted_at": "2026-10-16",
        "favorite": False,
        "status": "已投递",
        "note": "10/16 投的，跨城市，先看一面反馈再决定要不要飞过去。",
        "description": (
            "1. 负责游戏平台服务端的模块开发，语言以 Go 为主、Python 为辅；\n"
            "2. 参与长连接网关与消息推送的稳定性建设；\n"
            "3. 参与容量评估与压测，定位性能瓶颈；\n"
            "4. 参与线上值班与故障复盘。"
        ),
        "requirements": (
            "1. 本科及以上，2 年以上服务端开发经验；\n"
            "2. 熟悉 Go 或 Python，理解并发模型与内存管理；\n"
            "3. 熟悉 Redis、MySQL 与消息队列；\n"
            "4. 有长连接或高并发系统经验者优先。"
        ),
        "additional_info": "14 薪、餐补、住房补贴、每年一次团建。",
    },
    {
        "title": "平台研发工程师（Kubernetes）",
        "company": "武汉锐思云科技有限公司",
        "location": "武汉·洪山区",
        "salary": "24-38K·14薪",
        "job_type": "社招",
        "source": "内推",
        "source_url": "",
        "posted_at": "2026-10-15",
        "favorite": False,
        "status": "开放中",
        "note": "学长内推，JD 是他转发给我的，官网链接还没找到，先留空。",
        "description": (
            "1. 负责内部 PaaS 平台的研发，方向是容器编排与发布流水线；\n"
            "2. 开发运维工具与 Operator，降低业务接入成本；\n"
            "3. 参与集群容量规划与故障演练；\n"
            "4. 参与监控告警体系的建设。"
        ),
        "requirements": (
            "1. 本科及以上，2 年以上平台或运维开发经验；\n"
            "2. 熟悉 Kubernetes 核心概念，写过 Operator 或 Controller；\n"
            "3. 熟练 Go 或 Python，能独立开发工具；\n"
            "4. 熟悉 Linux、Docker 与常见监控组件。"
        ),
        "additional_info": "14 薪 + 项目奖金，内部技术分享氛围较好。",
    },
    {
        "title": "大模型应用开发工程师（校招）",
        "company": "上海曦和智能科技有限公司",
        "location": "上海·张江",
        "salary": "24-38K·15薪",
        "job_type": "校招",
        "source": "公司官网",
        "source_url": "https://careers.xihe-ai.com/campus/2027/llm-app",
        "posted_at": "2026-10-27",
        "favorite": True,
        "status": "开放中",
        "note": "岗位描述和我的 Agent 工作台几乎一一对应，优先跟进这家。",
        "description": (
            "1. 参与垂直行业 Agent 产品的应用层开发，覆盖工具调用、多轮编排与结构化输出；\n"
            "2. 参与评测集建设与线上效果监控，定位效果回退的原因；\n"
            "3. 参与 RAG 链路优化，包括切分、混合检索与重排；\n"
            "4. 与产品一起把不确定的模型能力包装成可交付的功能。"
        ),
        "requirements": (
            "1. 2027 届本科及以上，计算机相关专业；\n"
            "2. 熟练 Python，有 FastAPI 等服务端框架使用经验；\n"
            "3. 做过 LLM 应用项目，能说清工具调用与 RAG 的实现细节；\n"
            "4. 有评测集设计经验者优先；\n"
            "5. 有软著、开源或个人作品集者优先。"
        ),
        "additional_info": "15 薪、股权激励、免费三餐与健身房、落户协助。",
    },
    {
        "title": "后端开发实习生（可转正）",
        "company": "南京枢云信息技术有限公司",
        "location": "南京·建邺区",
        "salary": "200/天",
        "job_type": "实习",
        "source": "内推",
        "source_url": "",
        "posted_at": "2026-10-10",
        "favorite": False,
        "status": "已截止",
        "note": "内推名额已经招满了，先留在回收站里，明年春招还想去看看。",
        "description": (
            "1. 参与内部管理系统的接口开发与维护；\n"
            "2. 协助排查线上问题并整理排查记录；\n"
            "3. 参与用例补充与文档整理。"
        ),
        "requirements": (
            "1. 计算机相关专业在读，每周到岗 3 天以上；\n"
            "2. 会 Python，了解一种 Web 框架；\n"
            "3. 熟悉 SQL 基础语法。"
        ),
        "additional_info": "有转正名额，提供实习证明。",
    },
]

CANDIDATES = [
    {
        "title": "后端开发工程师（支付方向）",
        "company": "深圳云鉴科技有限公司",
        "raw_text": "",
        "note": "招聘会上扫码加的，JD 还没细看，先存着。",
        "source": "岗位采集",
        "job_type": "社招",
        "location": "深圳·福田区",
        "salary": "22-34K·14薪",
        "source_url": "https://www.zhipin.com/job_detail/84629103.html",
        "description": (
            "1. 负责支付清结算系统的服务端开发；\n"
            "2. 保障资金链路的幂等、对账与一致性；\n"
            "3. 参与接口性能优化与容量评估。"
        ),
        "requirements": (
            "1. 本科及以上，2 年以上服务端开发经验；\n"
            "2. 熟悉 Python 或 Java，熟悉 MySQL 与 Redis；\n"
            "3. 有支付、计费或对账系统经验者优先。"
        ),
        "additional_info": "14 薪，年度体检，补充商业保险。",
        "status": "pending",
    },
    {
        "title": "AI 工程师（Agent 方向）",
        "company": "杭州数翼科技有限公司",
        "raw_text": (
            "【数翼科技】AI 工程师（Agent 方向）\n地点：杭州·西湖区\n薪资：25-40K\n"
            "职责：负责 Agent 工具层与编排层开发，维护评测集。\n"
            "要求：熟悉 Python，做过 RAG 或 Agent 项目，能独立做评测。"
        ),
        "note": "招聘群里发的岗位截图，识别出来的文本还没核对公司信息。",
        "source": "手动添加",
        "job_type": "社招",
        "location": "杭州·西湖区",
        "salary": "25-40K",
        "source_url": "",
        "description": "负责 Agent 工具层与编排层开发，维护评测集。",
        "requirements": "熟悉 Python，做过 RAG 或 Agent 项目，能独立做评测。",
        "additional_info": "",
        "status": "pending",
    },
    {
        "title": "全栈开发工程师（远程）",
        "company": "厦门栖点网络科技有限公司",
        "raw_text": "",
        "note": "截图识别出来的岗位，薪资和「远程」的具体要求待确认。",
        "source": "图片识别",
        "job_type": "社招",
        "location": "远程（厦门）",
        "salary": "20-32K",
        "source_url": "",
        "description": (
            "1. 负责小团队内部工具的前后端开发；\n"
            "2. 独立完成从需求到上线的全流程。"
        ),
        "requirements": "2 年以上全栈经验，React + Python 技术栈，能远程协作。",
        "additional_info": "全远程，季度线下聚会。",
        "status": "pending",
    },
    {
        "title": "客户端开发实习生",
        "company": "南京云枢软件有限公司",
        "raw_text": (
            "【云枢软件】客户端开发实习生\n150-200/天\n参与 React Native 业务页面开发与联调。"
        ),
        "note": "",
        "source": "手动添加",
        "job_type": "实习",
        "location": "南京·雨花台区",
        "salary": "150-200/天",
        "source_url": "",
        "description": "参与 React Native 业务页面开发与联调。",
        "requirements": "每周 3 天以上，能连续实习 4 个月。",
        "additional_info": "",
        "status": "pending",
    },
]


def _chart_png() -> str:
    """岗位备注里那张「订单接口缓存命中率」截图（与后端实习的 43%→91% 对得上）。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        font, has_cjk = cjk_font(18)
        small, _ = cjk_font(14)
        canvas.rectangle([0, 0, 639, 359], outline=(226, 232, 240))
        title = "订单详情接口缓存命中率（上线 5 周）" if has_cjk else "Cache hit rate (5 weeks)"
        canvas.text((24, 18), title, fill=(15, 23, 42), font=font)
        bars = [
            ("第 1 周", 0.43),
            ("第 2 周", 0.62),
            ("第 3 周", 0.78),
            ("第 4 周", 0.86),
            ("第 5 周", 0.91),
        ]
        base_y, height = 300, 190
        for index, (label, value) in enumerate(bars):
            x = 60 + index * 112
            bar_height = int(height * value)
            canvas.rectangle(
                [x, base_y - bar_height, x + 64, base_y],
                fill=(22, 54, 92) if index == len(bars) - 1 else (148, 163, 184),
            )
            canvas.text((x + 6, base_y + 8), label, fill=(51, 65, 85), font=small)
            canvas.text(
                (x + 6, base_y - bar_height - 20),
                f"{value * 100:.0f}%",
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
        is_deleted = job["title"] == "后端开发实习生（可转正）"
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
