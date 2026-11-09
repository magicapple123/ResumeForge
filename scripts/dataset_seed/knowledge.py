# SPDX-License-Identifier: Apache-2.0
"""资料箱、知识库、面经：三类"还没进正式流程的原始材料"。

资料箱里有一条带图片附件的记录——它会在导出前被 ``user_files.ensure_copies`` 回填成
真正的磁盘副本，因此「我的文件」页面与备份包的资产清单都能读到东西（不是空壳）。

内容与 ``claims.py`` 的数字逐条对齐：资料箱里的结案材料就是台账第 2、3 条的证据。
"""

from __future__ import annotations

from datetime import timedelta

from PIL import ImageDraw

from dataset_seed.base import NOW, ins, png_data_url, row

MATERIALS = [
    {
        "title": "订单接口缓存与慢查询治理结案",
        "category": "作品",
        "url": "",
        "note": "结案材料里的数字与事实台账第 1、2 条一致。",
        "content": (
            "2026 Q3 交易中台接口治理结案：\n"
            "- 订单详情加两级缓存（Redis + 进程内 LRU），命中率 43% → 91%，回源 QPS 1800 → 160，P95 380 ms → 95 ms。\n"
            "- 用 EXPLAIN 定位 17 条全表扫描语句，补 4 个联合索引、改写 3 个深分页查询，"
            "慢查询日均 2.3 万条 → 900 条。\n"
            "- 对账导出 42 s → 6 s；同步改异步后超时错误率 8.4% → 0.2%。\n"
            "- 遗留问题：报表类长事务仍占慢查询的七成，需要单独拆到离线链路。"
        ),
        "files": [
            {
                "name": "接口治理结案.md",
                "mime_type": "text/markdown",
                "size_bytes": 1024,
                "text": "# 接口治理结案\n\n命中率 43%→91%，P95 380→95 ms，慢查询 2.3 万→900 条。\n",
            }
        ],
    },
    {
        "title": "接口耗时对比图（2026-09）",
        "category": "作品",
        "url": "https://github.com/yizhou-shen/perf-notes",
        "note": "缓存上线前后各取 7 天的监控导出。",
        "content": "订单详情 P95：上线前 380 ms 上下波动，上线后稳定在 95 ms 附近。",
        "files": [],
        "image": True,
    },
    {
        "title": "南京理工大学 在读证明",
        "category": "证书",
        "url": "",
        "note": "秋招网申要求上传，扫描件在个人网盘。",
        "content": "计算机科学与技术专业，2023 年 9 月入学，预计 2027 年 6 月毕业。学号 2023210467。",
        "files": [],
    },
    {
        "title": "软件设计师（软考中级）证书",
        "category": "证书",
        "url": "",
        "note": "上机与论文两科一次通过。",
        "content": "证书编号 RK-2026-054271，2026 年 5 月签发，长期有效。",
        "files": [],
    },
    {
        "title": "SQL 执行计划速查",
        "category": "笔记",
        "url": "",
        "note": "面试前会翻一遍。",
        "content": (
            "先看 type 是否 ALL（全表扫描）；再看 rows 估算与实际行数的差距；\n"
            "然后看 Extra 里有没有 Using filesort / Using temporary；\n"
            "联合索引注意最左前缀，范围查询后面的列用不上索引；\n"
            "深分页改成「游标 + 上一页最后一条主键」而不是大 offset。"
        ),
        "files": [],
    },
    {
        "title": "FastAPI 异步踩坑清单（博客）",
        "category": "链接",
        "url": "https://shenyizhou.github.io/posts/fastapi-async-pitfalls",
        "note": "",
        "content": "阻塞调用混进事件循环、连接池被长任务占满、BackgroundTasks 丢异常；三个复现脚本可直接跑。",
        "files": [],
    },
    {
        "title": "灵枢智能实习小结",
        "category": "实习材料",
        "url": "",
        "note": "离职时提交的实习总结，含带教老师评语。",
        "content": (
            "实习期 5 个月，负责 Agent 工具层 9 个 function tool，调用成功率 79% → 94%；\n"
            "搭 160 条评测集并在发版前跑回归，三个月拦下 21 个问题。\n"
            "带教评语：动手快、愿意把评测写下来，遇到线上问题会先看埋点再看代码。"
        ),
        "files": [
            {
                "name": "实习小结.txt",
                "mime_type": "text/plain",
                "size_bytes": 512,
                "text": "实习期 5 个月，负责 Agent 工具层，调用成功率 79% → 94%。\n",
            }
        ],
    },
    {
        "title": "数学建模竞赛论文（2024）",
        "category": "校园材料",
        "url": "",
        "note": "江苏赛区二等奖。",
        "content": "题目为景区客流预测与调度，负责排队论建模与代码实现。",
        "files": [],
        # 留在回收站里：给「回收站」页签一个可恢复的样本（恢复后资料箱仍有 8 条）。
        "deleted": True,
    },
]

KNOWLEDGE = [
    {
        "title": "联合索引与最左前缀：三个高频误用",
        "category": "方法论",
        "tags": ["MySQL", "索引", "性能"],
        "source": "工作沉淀",
        "content": (
            "1. 把区分度最高的列放最左，但前提是查询条件里一定会带上它；\n"
            "2. 范围查询（>、between、like 前缀）之后的列用不上索引，"
            "所以 (status, created_at) 这种组合要给范围列留最后；\n"
            "3. 索引不是越多越好：每个索引都要在写入时维护，"
            "我治理时先删了 3 个从没被命中的索引再加新的。\n"
            "验证方式只有一个：EXPLAIN 看 key 与 rows，不看直觉。"
        ),
    },
    {
        "title": "缓存击穿、穿透、雪崩怎么区分",
        "category": "方法论",
        "tags": ["Redis", "缓存", "性能"],
        "source": "工作沉淀",
        "content": (
            "击穿：单个热点 key 过期，瞬间回源；解法是互斥重建或逻辑过期。\n"
            "穿透：查不存在的数据，缓存永远不命中；解法是空值短 TTL 或布隆过滤器。\n"
            "雪崩：大批 key 同时过期或缓存实例挂掉；解法是 TTL 加随机抖动 + 降级。\n"
            "我第一版只做了击穿，没做空值缓存，被刷了一次回源把连接池打满。"
        ),
    },
    {
        "title": "Agent 工具调用的四类失败",
        "category": "工作方法",
        "tags": ["Agent", "评测", "LLM"],
        "source": "实习沉淀",
        "content": (
            "1. 选错工具：描述写得像、边界没划清；\n"
            "2. 参数幻觉：字段名对、值编的；用 JSON Schema 校验能拦掉大部分；\n"
            "3. 循环调用：同一工具同参数连续调用，要设次数上限；\n"
            "4. 该放弃时硬答：知识库没有答案时应该转向人工，而不是编一个。\n"
            "这四类分别对应不同的埋点字段，混在一起看成功率是没有信息量的。"
        ),
    },
    {
        "title": "RAG 切分策略的对比结论",
        "category": "方法论",
        "tags": ["RAG", "检索", "切分"],
        "source": "个人项目",
        "content": (
            "同一份 1.2 万段文档、300 条问答集上比过四种：固定长度、按标题、按语义、滑窗重叠。\n"
            "结论：按标题层级切 + 512 token 滑窗最好（Recall@5 86%）；纯固定长度最差（62%）。\n"
            "滑窗重叠要控制在 15% 以内，否则同一段会重复召回，重排再准也救不回来。"
        ),
    },
    {
        "title": "SQL 执行计划怎么看",
        "category": "工具",
        "tags": ["SQL", "性能"],
        "source": "工作沉淀",
        "content": (
            "先看有没有全表扫描（type=ALL），再看 rows 估算与实际行数的差距，"
            "最后看是否用到覆盖索引。\n"
            "分区表要注意分区裁剪有没有生效——WHERE 里对分区字段做函数运算会失效。"
        ),
    },
    {
        "title": "灵枢二面复盘",
        "category": "面试复盘",
        "tags": ["面试", "Agent"],
        "source": "本人记录",
        "content": (
            "问了三个问题：工具调用失败怎么归因、Recall@5 是怎么判对的、评测集怎么防过拟合。\n"
            "第三个问题答得不好：我只说了「定期换样本」，没给出如何判断评测集饱和的方法。"
            "下次应该补一句「看新增样本的通过率是否已经贴着上限」。"
        ),
    },
    {
        "title": "为什么简历上不写「精通」",
        "category": "求职策略",
        "tags": ["简历", "表达"],
        "source": "个人经验",
        "content": (
            "精通是最容易被追问的词。写成「Python（FastAPI，做过日均 210 万请求的交易接口）」"
            "反而更容易被记住，也给了面试官一个具体问题。"
        ),
    },
    {
        "title": "结构化输出：JSON Schema + 一次重试",
        "category": "方法论",
        "tags": ["LLM", "结构化输出"],
        "source": "实习沉淀",
        "content": (
            "做法：先用 JSON Schema 约束输出结构，校验失败时把「哪里不符合」回填给模型重试一次，"
            "仍失败则走兜底不影响主流程。\n"
            "效果：工具参数格式错误率 12% → 1.8%。\n"
            "注意：重试要带错误信息，否则模型会原样再犯一次。"
        ),
    },
]

INTERVIEWS = [
    {
        "title": "枢云科技 后端开发工程师 一面",
        "company": "杭州枢云信息科技有限公司",
        "position": "后端开发工程师（校招）",
        "job_index": 0,
        "content": (
            "整体 45 分钟，两位面试官（交易中台 leader + 一位资深开发）。前半段深挖缓存与慢查询治理，"
            "后半段手写 LRU，最后问了一个开放题：如果 QPS 涨十倍先动哪里。\n"
            "感受：他们很在意「你为什么这么选」，每个方案都会追问替代方案。"
        ),
        "questions": [
            "两级缓存里 L1 为什么选进程内 LRU？多实例下怎么保持一致？",
            "缓存命中率的分母是什么？空值缓存算不算命中？",
            "你说慢查询降到 900 条，剩下的为什么不继续优化？",
            "手写一个 LRU，要求 get/put 都是 O(1)",
            "QPS 涨十倍，你的优化顺序是什么？",
        ],
        "tags": ["后端", "缓存", "一面"],
        "source": "self",
        "difficulty": "中等",
        "round_type": "一面",
        "interview_date": "2026-10-24",
    },
    {
        "title": "灵枢智能 AI Agent 开发工程师 二面",
        "company": "杭州灵枢智能科技有限公司",
        "position": "AI Agent 开发工程师（校招）",
        "job_index": 1,
        "content": (
            "直面 Agent 应用组负责人，几乎没有八股，全程围绕一个场景：企业知识库 Agent 答错了，"
            "你怎么定位是检索的问题还是工具的问题。\n"
            "我按「先看埋点分层—再看召回明细—最后看工具参数」的顺序讲，对方中途追问两次评测集怎么建。"
        ),
        "questions": [
            "Agent 答错了，你怎么判断是检索还是工具的问题？",
            "Recall@5 的 84% 是怎么判对的？标注规范写了什么？",
            "评测集怎么防止过拟合到你改过的那几种失败？",
            "如果模型坚持调用一个不存在的工具，你怎么兜？",
        ],
        "tags": ["Agent", "评测", "二面"],
        "source": "self",
        "difficulty": "困难",
        "round_type": "二面",
        "interview_date": "2026-10-25",
    },
    {
        "title": "曦和智能 大模型应用开发工程师 笔试",
        "company": "上海曦和智能科技有限公司",
        "position": "大模型应用开发工程师（校招）",
        "job_index": 12,
        "content": (
            "线上笔试 90 分钟：2 道算法（滑动窗口、二叉树层序）、1 道 SQL（窗口函数做留存）、"
            "1 道开放题（设计一个带工具调用的问答链路，说明失败处理）。\n"
            "开放题重点看有没有写重试上限与降级路径。"
        ),
        "questions": [
            "给定数组，求最长无重复字符子串",
            "用 SQL 算次日留存（给两张表：注册、登录）",
            "设计一个带工具调用的问答链路，说明失败处理与重试上限",
        ],
        "tags": ["笔试", "算法", "SQL"],
        "source": "peer",
        "difficulty": "中等",
        "round_type": "笔试",
        "interview_date": "2026-10-27",
    },
    {
        "title": "启岸科技 客户端开发工程师 HR 面",
        "company": "广州启岸科技有限公司",
        "position": "客户端开发工程师（校招，iOS/Android）",
        "job_index": 7,
        "content": (
            "HR 面主要确认三件事：能否接受广州、期望薪资、以及为什么从南京考虑广州。\n"
            "公开渠道上的面经提到这家会问「最近一次和同学意见不一致怎么处理」，我按二手平台项目的分工准备了。"
        ),
        "questions": [
            "为什么选择广州？家里有没有意见？",
            "期望薪资是多少？怎么得出这个数的？",
            "团队里意见不一致时你怎么处理？",
        ],
        "tags": ["HR面", "广州", "校招"],
        "source": "public",
        "difficulty": "简单",
        "round_type": "HR面",
        "interview_date": "2026-10-18",
    },
]


def _dashboard_png() -> str:
    """资料箱里那张「接口耗时对比图」：优化前后两条 P95 曲线的示意。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        canvas.text((24, 18), "订单详情接口 P95（缓存上线前后）", fill=(15, 23, 42))
        canvas.line([48, 300, 620, 300], fill=(148, 163, 184))
        canvas.line([48, 60, 48, 300], fill=(148, 163, 184))
        points_before = [
            (70, 150),
            (150, 132),
            (230, 158),
            (310, 140),
            (390, 136),
            (470, 152),
            (550, 144),
        ]
        points_after = [
            (70, 262),
            (150, 268),
            (230, 258),
            (310, 264),
            (390, 270),
            (470, 260),
            (550, 266),
        ]
        canvas.line(points_before, fill=(220, 120, 60), width=3)
        canvas.line(points_after, fill=(22, 54, 92), width=3)
        canvas.text((430, 66), "— 上线前 380 ms", fill=(220, 120, 60))
        canvas.text((430, 86), "— 上线后 95 ms", fill=(22, 54, 92))

    return png_data_url(640, 340, draw)


def seed() -> None:
    """写 8 条资料、8 条知识库、4 条面经。"""
    dashboard = _dashboard_png()
    material_rows = []
    for index, item in enumerate(MATERIALS):
        files = list(item.get("files") or [])
        if item.get("image"):
            files = [
                {
                    "name": "接口耗时对比.png",
                    "mime_type": "image/png",
                    "size_bytes": len(dashboard),
                    "text": "",
                    "data_url": dashboard,
                }
            ]
        material_rows.append(
            row(
                title=item["title"],
                category=item["category"],
                content=item["content"],
                url=item["url"],
                files=files,
                note=item["note"],
                created_at=NOW - timedelta(days=30 - index * 2),
                updated_at=NOW - timedelta(days=30 - index * 2),
                deleted_at=NOW - timedelta(days=3) if item.get("deleted") else None,
            )
        )
    ins("material", material_rows)

    ins(
        "knowledge_entry",
        [
            row(
                title=item["title"],
                category=item["category"],
                tags=item["tags"],
                content=item["content"],
                source=item["source"],
                created_at=NOW - timedelta(days=40 - index * 3),
                updated_at=NOW - timedelta(days=40 - index * 3),
                deleted_at=None,
            )
            for index, item in enumerate(KNOWLEDGE)
        ],
    )

    ins(
        "interview_experience",
        [
            row(
                title=item["title"],
                company=item["company"],
                position=item["position"],
                job_id=item["job_index"] + 1,
                content=item["content"],
                questions=item["questions"],
                tags=item["tags"],
                source=item["source"],
                difficulty=item["difficulty"],
                round_type=item["round_type"],
                interview_date=item["interview_date"],
                created_at=NOW - timedelta(days=14 - index * 2),
                updated_at=NOW - timedelta(days=14 - index * 2),
                deleted_at=None,
            )
            for index, item in enumerate(INTERVIEWS)
        ],
    )
