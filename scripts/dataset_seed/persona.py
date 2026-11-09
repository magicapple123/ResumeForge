# SPDX-License-Identifier: Apache-2.0
"""一份"内容饱满"的数据集：人物设定与全部正文。

人设：2027 届计算机科学与技术本科应届生，求职方向为后端开发 / AI Agent 开发 / 全栈开发。

与 ``scripts/demo_data/`` 的分工：那份是 README/官网截图用的**演示**数据（内容短、
一眼能认出来是演示稿），这份是给用户导入后**逐个功能试用**用的数据——因此要求
13 个内置板块的 106 个小字段几乎都被填上，且内容自洽（经历里的数字与事实台账、
简历正文对得上）。

这里的模块只放**常量**（dict / list），不 import app、不碰数据库：写库逻辑在
``dataset_seed.profile`` 等模块里。所有人物、公司、学校、证书编号均为设定值。

⚠️ 列表长度不是"想写几个写几个"，消费方按下标取：
``resumes.py`` 会取 ``EDUCATIONS[0..1]``、``EXPERIENCES[0..2]``、``PROJECTS[0..4]``、
``PUBLICATIONS[0]``、``RESEARCH_PROJECTS[0]``、``PATENTS[1]`` 以及
``SKILLS[:8]`` / ``AWARDS[:3]`` / ``CREDENTIALS[:3]`` / ``LANGUAGES[:2]``。
所以：学历 ≥2 条（本科 + 微专业辅修）、实习 ≥3 条（含一段实验室暑期实习）、
项目 ≥5 条、软著 ≥2 条、证书 ≥3 条。缩表会直接 IndexError。
"""

from __future__ import annotations

# 数据集里的"现在"：固定值而不是 now()，同一份脚本每次跑出来的库才可比。
NOW_TEXT = "2026-10-28"

BASIC = {
    "name": "沈亦舟",
    "gender": "男",
    "birth_month": "2005-03",
    "phone": "139 0176 4428",
    "email": "shen.yizhou@foxmail.com",
    "city": "南京",
    "target_city": "上海 / 杭州 / 南京",
    "job_intention": "后端开发 / AI Agent 开发 / 全栈开发",
    "homepage": "https://shenyizhou.github.io",
    "github": "https://github.com/yizhou-shen",
    "portfolio_url": "https://shenyizhou.github.io/portfolio",
    "political_status": "共青团员",
    "driver_license": "C1",
    "available_date": "2027-07 毕业到岗，当前可实习",
}

SUMMARY = (
    "计算机科学与技术本科在读（2027 届，GPA 3.7/4.0，专业排名 8%），方向是后端开发与 "
    "AI Agent 应用，两段实习分别做交易中台的业务接口和 Agent 的工具层。后端侧把订单详情"
    "接口 P95 从 380 ms 降到 95 ms（缓存命中率 43%→91%），治理 17 条慢查询让对账导出从 "
    "42 s 降到 6 s；Agent 侧把 9 个工具的调用成功率从 79% 提到 94%，混合检索让 Recall@5 "
    "从 61% 提到 84%。自己写过一套求职场景的 LLM Agent 工作台（工具调用 + 结构化输出 + "
    "240 条评测集），也在校园二手交易平台上跑通了 React + FastAPI + PostgreSQL 的全栈链路。"
    "习惯先写单测和评测集再改代码，交付前会把口径、边界和踩过的坑写进文档。"
)

EDUCATIONS = [
    {
        "school": "南京理工大学",
        "major": "计算机科学与技术",
        "degree": "本科",
        "study_form": "全日制",
        "degree_type": "工学学士",
        "department": "计算机科学与工程学院",
        "start_date": "2023-09",
        "end_date": "2027-06",
        "gpa": "3.7/4.0",
        "rank": "9/126",
        "advisor": "",
        "research_direction": "",
        "core_courses": (
            "数据结构与算法；计算机组成原理；操作系统；计算机网络；数据库系统；"
            "软件工程；编译原理；分布式系统；Python 程序设计"
        ),
        "achievements": (
            "- 三年加权 GPA 3.7/4.0，专业排名 9/126；操作系统、数据库系统、数据结构三门 90 分以上。\n"
            "- 校 ACM 集训队队员，2024 年获中国大学生程序设计竞赛（CCPC）江苏省赛银奖。\n"
            "- 主持一项省级大学生创新创业训练计划（国创）项目，已结题验收为优秀。"
        ),
    },
    {
        "school": "南京理工大学",
        "major": "人工智能（微专业）",
        "degree": "辅修",
        "study_form": "全日制（周末授课）",
        "degree_type": "微专业证书",
        "department": "计算机科学与工程学院",
        "start_date": "2024-09",
        "end_date": "2026-06",
        "gpa": "3.8/4.0",
        "rank": "",
        "advisor": "周敏华",
        "research_direction": "检索增强生成与大模型应用",
        "core_courses": (
            "机器学习；深度学习基础；自然语言处理；大模型应用实践；向量检索与重排；数据可视化"
        ),
        "achievements": (
            "- 微专业课程均分 91，大模型应用实践课程项目被评为班内 3 份示范作业之一。\n"
            "- 课程项目《RAG 检索质量对比实验》后来扩展成了个人项目与国创项目的评测基线。"
        ),
    },
]

EXPERIENCES = [
    {
        "company": "杭州枢云信息科技有限公司",
        "title": "后端开发实习生",
        "start_date": "2026-07",
        "end_date": "2026-10",
        "team_size": "12 人（交易中台组）",
        "work_type": "实习",
        "description": (
            "- 负责交易中台 4 个业务接口（订单查询、退款申请、库存校验、对账单导出）的迭代，"
            "Python + FastAPI 实现，日均请求 210 万，线上 P95 从 640 ms 降到 220 ms。\n"
            "- 给订单详情加两级缓存（Redis + 进程内 LRU），命中率从 43% 提升到 91%，"
            "回源 QPS 从 1800 降到 160，接口 P95 从 380 ms 降到 95 ms。\n"
            "- 治理 MySQL 慢查询：用 EXPLAIN 定位 17 条全表扫描语句，补 4 个联合索引、"
            "改写 3 个深分页语句，慢查询日均从 2.3 万条降到 900 条，对账导出从 42 s 降到 6 s。\n"
            "- 把对账导出从同步接口改成异步任务（Celery + Redis 队列），前端轮询查进度，"
            "超时错误率从 8.4% 降到 0.2%，运营不再手工重试。\n"
            "- 补 26 个 pytest 用例覆盖缓存击穿、并发写与任务失败重试，接口回归从手工 40 分钟"
            "压缩到 CI 里 3 分钟。\n"
            "- 参与每周 code review，累计提交 47 个 PR（合并 41 个），负责把「慢查询上线前必查」"
            "写进组内的 MR 模板。"
        ),
    },
    {
        "company": "杭州灵枢智能科技有限公司",
        "title": "Agent 开发实习生",
        "start_date": "2026-01",
        "end_date": "2026-05",
        "team_size": "6 人（Agent 应用组）",
        "work_type": "实习",
        "description": (
            "- 参与企业知识库 Agent 的工具层开发：把检索、表格查询、工单创建封装成 9 个 "
            "function tool，工具调用成功率从 79% 提升到 94%。\n"
            "- 搭一套 160 条的人工评测集（覆盖工具选择、参数抽取、多轮澄清三类），每次发版前"
            "跑一遍，回归问题从「上线后被用户发现」变成「发版前拦截」，近 3 个月拦下 21 个。\n"
            "- 优化 RAG 召回：把固定长度切分改成按标题层级切分 + 512 token 滑窗，"
            "混合检索（BM25 + 向量）后 Recall@5 从 61% 提升到 84%，答非所问的工单下降 37%。\n"
            "- 用 JSON Schema + 重试校验做结构化输出，工具参数格式错误率从 12% 降到 1.8%。\n"
            "- 把系统提示词从 900 字压缩到 420 字并固化成模板，单次调用 token 成本下降 34%，"
            "首字响应 P95 从 4.2 s 降到 2.6 s。"
        ),
    },
    {
        "company": "南京理工大学 智能软件实验室（产学研项目）",
        "title": "后端开发实习生",
        "start_date": "2025-07",
        "end_date": "2025-09",
        "team_size": "4 人（实验室工程组）",
        "work_type": "实习",
        "description": (
            "- 为实验室的设备数据采集平台写采集与清洗服务（Python + FastAPI + PostgreSQL），"
            "接入 3 类设备协议，日均入库 38 万条。\n"
            "- 用批量写入 + 连接池把入库吞吐从 900 条/秒提到 4200 条/秒，采集端积压告警从"
            "每天 5 次降到每周 1 次以内。\n"
            "- 给 12 张统计报表加预聚合物化视图，日报生成时间从 15 分钟降到 40 秒。\n"
            "- 写 23 条入库校验规则（量程、时序、重复上报），脏数据率从 1.7% 降到 0.3%，"
            "规则以配置化方式交付，后续新增设备只改配置。"
        ),
    },
]

PROJECTS = [
    {
        "name": "求职场景 LLM Agent 工作台",
        "role": "项目负责人",
        "start_date": "2026-03",
        "end_date": "2026-08",
        "tech_stack": "Python, FastAPI, LangGraph, PostgreSQL, React, Docker",
        "project_size": "个人项目，评测集 240 条",
        "outcome_type": "个人项目",
        "public_url": "https://github.com/yizhou-shen/agent-workbench",
        "description": (
            "把「按 JD 改简历」拆成意图识别、事实检索、改写、事实校验四步，用工具调用串成一条"
            "可回溯的链路：每一步的输出都落库，前端能看到模型调了哪个工具、引用了哪条事实。"
        ),
        "highlights": (
            "- 结构化输出 + 二次校验：改写结果必须能对上事实台账里的条目，"
            "编造内容的比率从 11% 降到 1.2%（240 条样本人工复核）。\n"
            "- 工具调用成功率 94%，单次生成 P95 3.1 s；同一份 JD 重复生成的字段一致率 96%。\n"
            "- 61 个 pytest 用例覆盖工具异常、超时、非法 JSON 与重试上限，CI 全绿才发版。\n"
            "- 自己用了 5 个月，累计生成 180 份定制简历，单份从 40 分钟压缩到 6 分钟。"
        ),
    },
    {
        "name": "校园二手交易全栈平台",
        "role": "全栈开发（后端为主）",
        "start_date": "2024-09",
        "end_date": "2025-03",
        "tech_stack": "React, TypeScript, FastAPI, PostgreSQL, Redis, Docker",
        "project_size": "3 人团队，注册用户 2600",
        "outcome_type": "团队项目",
        "public_url": "https://github.com/yizhou-shen/campus-market",
        "description": (
            "校内二手教材与宿舍用品的交易平台，把「发布—搜索—私信—当面交易」四步收拢，"
            "按学院与课程号建索引，教材能被同专业低年级直接搜到。"
        ),
        "highlights": (
            "- 负责后端与部署：23 个 REST 接口、JWT 鉴权、PostgreSQL 读写分离，"
            "500 并发压测下 P95 210 ms。\n"
            "- 用 Redis 做热点商品缓存与分布式锁，同一件商品的超卖投诉从每周 6 起降到 0。\n"
            "- 搜索走课程号 + 关键词双通道，搜索到下单转化率从 12% 提到 29%，"
            "上线一学期成交 780 单。\n"
            "- Docker Compose 一键起环境，新同学本地跑起来从半天缩短到 20 分钟。"
        ),
    },
    {
        "name": "RAG 知识库问答实验台",
        "role": "算法与后端",
        "start_date": "2026-04",
        "end_date": "2026-07",
        "tech_stack": "Python, FastAPI, pgvector, BM25, bge-m3, Ragas",
        "project_size": "个人项目，1.2 万段文档 / 300 条问答集",
        "outcome_type": "个人项目",
        "public_url": "https://github.com/yizhou-shen/rag-lab",
        "description": (
            "不是再做一个聊天框，而是把切分、召回、重排三个环节做成可替换的插件，"
            "用固定问答集量化每一步的收益，避免「感觉答得更好」这种无法复盘的优化。"
        ),
        "highlights": (
            "- 对比 4 种切分策略（固定长度、按标题、按语义、滑窗重叠），最优组合在 300 条"
            "问答集上 Recall@5 86%、答案正确率 78%。\n"
            "- 混合检索（BM25 + 向量 + RRF 融合）比纯向量把 Recall@5 从 62% 提到 79%，"
            "「口头化提问」这一类提升最明显。\n"
            "- 加重排后 MRR 从 0.62 到 0.79，但 P95 多 380 ms，因此按场景做了开关。"
        ),
    },
    {
        "name": "短链与接口限流服务",
        "role": "独立开发",
        "start_date": "2025-10",
        "end_date": "2025-12",
        "tech_stack": "Python, FastAPI, Redis, Lua, Docker, Locust",
        "project_size": "个人项目，压测 3000 QPS",
        "outcome_type": "个人项目",
        "public_url": "https://github.com/yizhou-shen/shortlink-lab",
        "description": (
            "为了把「限流」从背概念变成能压测的东西：三种算法各写一遍，用同一套压测脚本"
            "对比误杀率与时延，顺便练发号器与缓存一致性。"
        ),
        "highlights": (
            "- 固定窗口、滑动窗口、令牌桶三个版本都用 Redis + Lua 实现，"
            "单机 3000 QPS 下限流判断 P99 1.8 ms。\n"
            "- 短链发号改成 Redis 号段 + 本地缓冲，发号吞吐从 1200 提到 9500 QPS，且不再跳号。\n"
            "- Locust 脚本与压测报告一并开源，写清了瓶颈定位过程（连接数、序列化、单线程事件循环）。"
        ),
    },
    {
        "name": "数据库课程设计：B+ 树索引与查询优化",
        "role": "独立完成",
        "start_date": "2024-03",
        "end_date": "2024-06",
        "tech_stack": "C++, CMake, GoogleTest",
        "project_size": "课程项目，1 万行数据",
        "outcome_type": "课程项目",
        "public_url": "",
        "description": (
            "从零实现 B+ 树索引（插入、删除、范围查询）并挂到一个简易存储引擎上，"
            "目标是搞清楚 EXPLAIN 里那些 rows 和 type 到底从哪来。"
        ),
        "highlights": (
            "- 1 万行数据点查平均 3 次页访问，比全表扫描快 41 倍；范围查询结果与 SQLite 对齐。\n"
            "- 38 个单测覆盖节点分裂与合并边界，课程设计评分 96/100。"
        ),
    },
]

# 顺序即简历「技能」栏的展示顺序：``resumes._skills(8)`` 只取前 8 条。
SKILLS = [
    {"name": "Python", "level": "熟练", "category": "编程语言"},
    {"name": "FastAPI", "level": "熟练", "category": "框架与库"},
    {"name": "PostgreSQL", "level": "熟练", "category": "工具与平台"},
    {"name": "Redis", "level": "掌握", "category": "工具与平台"},
    {"name": "TypeScript / React", "level": "掌握", "category": "编程语言"},
    {"name": "LLM 应用与工具调用", "level": "熟练", "category": "其他"},
    {"name": "RAG 与向量检索", "level": "掌握", "category": "其他"},
    {"name": "Prompt 工程与结构化输出", "level": "熟练", "category": "其他"},
    {"name": "MySQL 索引与慢查询优化", "level": "掌握", "category": "工具与平台"},
    {"name": "Docker / Docker Compose", "level": "掌握", "category": "工具与平台"},
    {"name": "Git", "level": "熟练", "category": "工具与平台"},
    {"name": "Linux（Shell / systemd）", "level": "掌握", "category": "工具与平台"},
    {"name": "pytest / GitHub Actions", "level": "掌握", "category": "框架与库"},
    {"name": "数据结构与算法（C++）", "level": "熟练", "category": "其他"},
]

CAMPUS_EXPERIENCES = [
    {
        "organization": "南京理工大学 ACM-ICPC 集训队",
        "role": "队员（图论方向）",
        "start_date": "2023-09",
        "end_date": "2025-06",
        "activity_type": "社团",
        "description": (
            "- 每周 3 场训练赛，两年累计 180 余场；负责队内图论与动态规划两个专题，主讲 8 次。\n"
            "- 与两名队友拿到 2024 年 CCPC 江苏省赛银奖；退役后留下 40 页的专题讲义给下一届。"
        ),
    },
    {
        "organization": "计算机科学与工程学院 学生科协",
        "role": "技术部部长",
        "start_date": "2024-09",
        "end_date": "2025-06",
        "activity_type": "学生会",
        "description": (
            "- 带 5 人小组办 6 场技术分享（FastAPI 入门、Git 协作、Docker 实操），场均 80 余人。\n"
            "- 把分享的讲义与录屏整理成仓库，换届时新部长能直接接着办，不再从零找题目。"
        ),
    },
    {
        "organization": "南京理工大学 图书馆 信息技术志愿服务",
        "role": "志愿者",
        "start_date": "2023-10",
        "end_date": "2024-06",
        "activity_type": "志愿服务",
        "description": (
            "- 每周半天在电子阅览室值班，累计 52 小时，处理 130 余次软件与网络问题。\n"
            "- 把高频问题整理成 12 页的图文手册，之后同类咨询当场就能自助解决。"
        ),
    },
]

AWARDS = [
    {
        "title": "国家励志奖学金",
        "awarded_at": "2025-10",
        "issuer": "教育部",
        "level": "国家级",
        "award_ratio": "前 5%",
        "description": "2024-2025 学年，专业排名 9/126，家庭经济困难认定后获评。",
    },
    {
        "title": "蓝桥杯全国软件和信息技术专业人才大赛 江苏赛区一等奖",
        "awarded_at": "2025-04",
        "issuer": "工业和信息化部人才交流中心",
        "level": "省级",
        "award_ratio": "赛区前 8%",
        "description": "Python 程序设计大学 A 组，省赛一等奖并晋级全国决赛。",
    },
    {
        "title": "中国大学生程序设计竞赛（CCPC）江苏省赛 银奖",
        "awarded_at": "2024-11",
        "issuer": "中国大学生程序设计竞赛组委会",
        "level": "省级",
        "award_ratio": "",
        "description": "三人队，负责图论与 DP 题；赛前两个月的训练赛复盘由我整理。",
    },
    {
        "title": "全国大学生数学建模竞赛 江苏赛区二等奖",
        "awarded_at": "2024-09",
        "issuer": "中国工业与应用数学学会",
        "level": "省级",
        "award_ratio": "",
        "description": "三人队，负责建模与代码实现（排队论 + 仿真）。",
    },
    {
        "title": "南京理工大学 一等奖学金",
        "awarded_at": "2024-12",
        "issuer": "南京理工大学",
        "level": "校级",
        "award_ratio": "前 10%",
        "description": "2023-2024 学年，综合测评班级第 2。",
    },
]

PUBLICATIONS = [
    {
        "title": "基于工具调用轨迹的轻量 Agent 失败归因方法",
        "outcome_type": "会议论文",
        "authorship_rank": "第二作者",
        "authors": "周敏华、沈亦舟、陈立",
        "venue": "江苏省计算机学会学术年会 · 学生论文专场（JSCS 2025）",
        "year": "2025",
        "status": "published",
        "url": "",
        "doi": "",
        "volume_pages": "论文集 pp. 64-71",
        "note": (
            "负责评测集构建与实验（240 条工具调用样本，人工标注失败类型），"
            "方法框架与论文写作由导师主导；国创项目的阶段性成果。"
        ),
    },
]

RESEARCH_PROJECTS = [
    {
        "name": "面向求职场景的 LLM Agent 可靠性评测",
        "role": "项目负责人",
        "institution": "南京理工大学 计算机科学与工程学院",
        "level": "省级",
        "start_date": "2025-04",
        "end_date": "2026-04",
        "funding": "省级大学生创新创业训练计划 1.0 万元",
        "description": (
            "研究「Agent 在长链路任务里为什么会失败」：把失败分成工具选错、参数幻觉、"
            "循环调用三类，给出可自动检测的信号，并把结论落成一套可复用的评测集。"
        ),
        "outcomes": (
            "- 建成 240 条标注评测集与一份失败类型判定规范，被实验室后续两个项目直接复用。\n"
            "- 产出学生论文 1 篇（第二作者），结题验收评为优秀。\n"
            "- 评测集与脚本开源在个人仓库，累计 186 star。"
        ),
    },
    {
        "name": "FastAPI 异步链路的性能瓶颈定位（校 SRTP）",
        "role": "参与（后端与压测）",
        "institution": "南京理工大学 计算机科学与工程学院",
        "level": "校级",
        "start_date": "2024-09",
        "end_date": "2025-06",
        "funding": "校级科研训练 0.3 万元",
        "description": (
            "在同一台机器上把同步阻塞调用、连接池大小、序列化三件事逐个隔离出来，"
            "量化它们对 P95 的影响，形成一份可照着排查的清单。"
        ),
        "outcomes": (
            "- 结论：把阻塞的 ORM 调用挪进线程池后 P95 下降 46%，连接池从 20 调到 50 只再降 8%。\n"
            "- 这份清单后来直接用在了短链限流项目的压测里，也成了实验室新同学的入门材料。"
        ),
    },
]

PATENTS = [
    {
        "title": "求职简历智能体工作台软件 V1.0",
        "outcome_type": "软件著作权",
        "inventors": "沈亦舟",
        "inventor_rank": "第一发明人",
        "patent_number": "2026SR0341882",
        "status": "已登记",
        "application_date": "2026-06",
        "grant_date": "2026-09",
        "url": "",
        "country": "中国",
    },
    {
        "title": "校园二手交易平台服务端软件 V1.0",
        "outcome_type": "软件著作权",
        "inventors": "沈亦舟、吴穹",
        "inventor_rank": "第一发明人",
        "patent_number": "2025SR1126740",
        "status": "已登记",
        "application_date": "2025-05",
        "grant_date": "2025-08",
        "url": "",
        "country": "中国",
    },
]

CREDENTIALS = [
    {
        "title": "软件设计师（软考中级）",
        "credential_type": "职业资格",
        "issuer": "工业和信息化部教育与考试中心",
        "issued_at": "2026-05",
        "expires_at": "",
        "status": "长期有效",
        "credential_number": "RK-2026-054271",
        "verify_url": "",
        "note": "上机与论文两科一次通过，复习时顺手把操作系统与数据库的重点整理成了笔记。",
    },
    {
        "title": "华为认证 AI 工程师（HCIA-AI）",
        "credential_type": "技能认证",
        "issuer": "华为技术有限公司",
        "issued_at": "2025-11",
        "expires_at": "2028-11",
        "status": "有效",
        "credential_number": "HCIA-AI-2025-118473",
        "verify_url": "",
        "note": "",
    },
    {
        "title": "全国计算机等级考试二级（Python）",
        "credential_type": "技能认证",
        "issuer": "教育部教育考试院",
        "issued_at": "2024-03",
        "expires_at": "",
        "status": "长期有效",
        "credential_number": "NCRE-2024-217305",
        "verify_url": "",
        "note": "",
    },
    {
        "title": "普通话水平等级证书 二级甲等",
        "credential_type": "语言证书",
        "issuer": "国家语言文字工作委员会",
        "issued_at": "2025-06",
        "expires_at": "",
        "status": "长期有效",
        "credential_number": "PSC-2025-093417",
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
        "score": "561",
        "obtained_at": "2025-06",
    },
    {
        "language": "英语",
        "level": "熟练",
        "certificate": "IELTS",
        "score": "6.5（听力 7.0 / 阅读 7.0 / 写作 6.0 / 口语 6.0）",
        "obtained_at": "2026-03",
    },
]

# 自建板块：字段顺序即展示顺序，第一个字段自动成为"主文本字段"（纸面标题）。
CUSTOM_SECTIONS = [
    {
        "name": "开源贡献",
        "fields": [
            ("贡献说明", "multi_line"),
            ("仓库链接", "single_line"),
        ],
        "entries": [
            {
                "贡献说明": (
                    "agent-toolkit：把 Agent 工具调用里的重试、超时、结构化输出校验抽成"
                    "可复用的小库，被实验室 3 个项目接入；仓库 186 star，issue 基本一周内回。"
                ),
                "仓库链接": "https://github.com/yizhou-shen/agent-toolkit",
            },
            {
                "贡献说明": (
                    "向两个 Python 生态开源项目提交 5 个 PR（4 个已合并），其中 1 个修掉了"
                    "异步 HTTP 客户端在超时后没有释放连接的问题，复现脚本写进了 PR 描述里。"
                ),
                "仓库链接": "https://github.com/yizhou-shen/oss-pr-index",
            },
            {
                "贡献说明": (
                    "短链与限流服务的 Locust 压测脚本按 Apache-2.0 开源，有人照着它复现了"
                    "自己项目的限流误杀问题，我在 issue 里补了一版更严格的判定。"
                ),
                "仓库链接": "https://github.com/yizhou-shen/shortlink-lab",
            },
        ],
    },
    {
        "name": "技术博客",
        "fields": [
            ("文章摘要", "multi_line"),
            ("文章链接", "single_line"),
        ],
        "entries": [
            {
                "文章摘要": (
                    "《为什么 Agent 的工具调用会失败：240 条样本的归因》：把失败分成参数幻觉、"
                    "选错工具、循环调用三类，每类给出一个可自动检测的信号与排查顺序。"
                ),
                "文章链接": "https://shenyizhou.github.io/posts/agent-failure-analysis",
            },
            {
                "文章摘要": (
                    "《FastAPI 里三个容易踩的异步坑》：阻塞调用混进事件循环、连接池被长任务占满、"
                    "BackgroundTasks 丢异常；文中三个复现脚本可以直接跑。"
                ),
                "文章链接": "https://shenyizhou.github.io/posts/fastapi-async-pitfalls",
            },
            {
                "文章摘要": (
                    "《把慢查询挡在上线前》：我们组内 MR 模板里那三条自查（EXPLAIN、索引覆盖、"
                    "深分页改写）是怎么定下来的，附前后数据。"
                ),
                "文章链接": "https://shenyizhou.github.io/posts/slow-query-gate",
            },
        ],
    },
]

# 网申专用字段（只进旧 user_profile 表，用于「网申填表」页签）。
WEB_FORM = {
    "wechat": "shenyizhou_dev",
    "birth_date": "2005-03-14",
    "id_type": "居民身份证",
    "id_number": "320602200503140010",
    "country_region": "中国",
    "native_place": "江苏南通",
    "political_status": "共青团员",
    "phone_country_code": "+86",
    "family_info": "父母均在江苏南通工作，家庭无负担；可接受上海、杭州异地工作。",
    "expected_salary": "18-25K·14 薪",
    "qq": "1174026853",
    "advisor": "周敏华",
    "research_direction": "检索增强生成与 Agent 可靠性评测",
    "preferred_industry": "互联网 / 企业服务 / AI 应用",
}
