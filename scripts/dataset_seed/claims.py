# SPDX-License-Identifier: Apache-2.0
"""事实台账：10 条可核验的事实，覆盖实习、项目、荣誉与教育四类。

台账不是"简历里的句子"，而是"这句话的依据"：``source_fact`` 写证据在哪、
``boundary`` 写这句话的边界（哪些情况不成立）、``verification_status`` 决定它能不能
进正式简历。三个字段缺一个，生成出来的内容就会变成没法回答追问的漂亮话。

⚠️ 这里的 ``title`` 会被 ``interview.py`` 的 ``claim_title`` 逐字引用（模拟面试的
契约与复盘按标题对账），改标题必须同步改面试那一侧。
"""

from __future__ import annotations

from datetime import timedelta

from dataset_seed.base import NOW, ins, row

CLAIMS = [
    {
        "title": "订单详情接口 P95 从 380 ms 降到 95 ms（缓存命中率 43% → 91%）",
        "category": "实习/工作",
        "subject": "杭州枢云信息科技有限公司 / 后端开发实习生",
        "source_fact": (
            "压测报告与线上监控：两级缓存（Redis + 进程内 LRU）上线前后各取 7 天，"
            "接口 P95 380 ms → 95 ms，缓存命中率 43% → 91%，回源 QPS 1800 → 160。"
        ),
        "candidate_wording": "给订单详情接口加两级缓存，P95 从 380 ms 降到 95 ms，回源 QPS 下降 91%。",
        "responsibility_level": "主导方案或交付",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么 L1 选进程内 LRU 而不是再加一层 Redis", "TTL 与主动失效怎么配合"],
            "difficulties": ["第一版没做空值缓存，被击穿后回源打满连接池"],
            "verification": ["压测报告", "监控看板截图"],
            "result": "上线后连续 5 周命中率维持在 88%-91%",
        },
        "boundary": "命中率按「请求命中任一层的比例」统计，不含被限流拒绝的请求。",
        "risk_notes": [],
        "last_verified": "2026-10-20",
    },
    {
        "title": "慢查询日均从 2.3 万条降到 900 条，对账导出从 42 s 降到 6 s",
        "category": "实习/工作",
        "subject": "杭州枢云信息科技有限公司 / 后端开发实习生",
        "source_fact": (
            "慢查询日志统计（阈值 500 ms）：治理前日均 2.3 万条，补 4 个联合索引、"
            "改写 3 个深分页语句后日均 900 条；对账导出耗时 42 s → 6 s。"
        ),
        "candidate_wording": "用 EXPLAIN 定位 17 条全表扫描语句并补索引，慢查询日均下降 96%。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么选联合索引而不是单列索引", "深分页为什么改成游标而不是 offset"],
            "difficulties": ["有一个语句补了索引仍慢，原因是索引选择性太低"],
            "verification": ["慢查询日志前后对比", "执行计划截图"],
            "result": "剩余 900 条主要是报表类长事务，单独归类后不再计入告警",
        },
        "boundary": "统计口径为单实例慢查询日志，不含只读库。",
        "risk_notes": [],
        "last_verified": "2026-10-18",
    },
    {
        "title": "对账导出改异步任务，超时错误率从 8.4% 降到 0.2%",
        "category": "实习/工作",
        "subject": "杭州枢云信息科技有限公司 / 后端开发实习生",
        "source_fact": (
            "网关错误日志：同步接口时期超时（>30 s）占导出请求的 8.4%；改成 Celery 任务 + "
            "前端轮询进度后降到 0.2%，剩余 0.2% 是用户主动取消。"
        ),
        "candidate_wording": "把对账导出从同步接口改成异步任务，超时错误率 8.4% → 0.2%。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么用轮询而不是 WebSocket", "任务结果保留多久"],
            "difficulties": ["重试会把已成功的大文件再导一遍，后来加了幂等键"],
            "verification": ["网关错误日志", "任务表记录"],
            "result": "运营不再手工重试，导出按钮点击量下降 34%",
        },
        "boundary": "错误率按网关 5xx 与超时两类合计，不含参数校验失败。",
        "risk_notes": [],
        "last_verified": "2026-10-18",
    },
    {
        "title": "Agent 工具调用成功率从 79% 提升到 94%（9 个工具）",
        "category": "实习/工作",
        "subject": "杭州灵枢智能科技有限公司 / Agent 开发实习生",
        "source_fact": (
            "工具层埋点：9 个 function tool 的调用结果按「成功 / 参数错误 / 超时 / 选错工具」"
            "四类统计，改造前成功率 79%，补参数校验与重试后 94%。"
        ),
        "candidate_wording": "负责 Agent 工具层 9 个 function tool 的开发，调用成功率 79% → 94%。",
        "responsibility_level": "主导方案或交付",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么把「选错工具」也算失败", "重试上限为什么是 2 次"],
            "difficulties": ["重试会放大延迟，需要在成功率和 P95 之间取舍"],
            "verification": ["工具调用埋点表", "评测集跑分记录"],
            "result": "剩余 6% 主要是知识库没有答案时的主动放弃",
        },
        "boundary": "成功率按单次调用的最终结果统计，不按整轮对话是否完成任务统计。",
        "risk_notes": [],
        "last_verified": "2026-05-20",
    },
    {
        "title": "混合检索把 Recall@5 从 61% 提升到 84%",
        "category": "实习/工作",
        "subject": "杭州灵枢智能科技有限公司 / Agent 开发实习生",
        "source_fact": (
            "160 条问答评测集：纯向量检索 Recall@5 61%，改成按标题层级切分 + 512 token 滑窗、"
            "BM25 与向量 RRF 融合后 84%。"
        ),
        "candidate_wording": "优化 RAG 召回，Recall@5 从 61% 提升到 84%，答非所问的工单下降 37%。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["切分策略为什么按标题层级", "RRF 的 k 取多少"],
            "difficulties": ["滑窗重叠会让同一段文本重复召回，需要去重"],
            "verification": ["评测集跑分脚本", "召回明细抽样"],
            "result": "上线后客服工单里「答非所问」类下降 37%",
        },
        "boundary": "Recall@5 在 160 条人工标注问答集上计算，不代表线上全量分布。",
        "risk_notes": [],
        "last_verified": "2026-05-18",
    },
    {
        "title": "结构化输出把工具参数错误率从 12% 降到 1.8%",
        "category": "实习/工作",
        "subject": "杭州灵枢智能科技有限公司 / Agent 开发实习生",
        "source_fact": (
            "工具层校验日志：JSON Schema 校验 + 一次重试修复后，参数格式错误率 12% → 1.8%。"
        ),
        "candidate_wording": "用 JSON Schema 加一次重试校验，工具参数格式错误率 12% → 1.8%。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么让模型自己修一次而不是直接兜底默认值"],
            "difficulties": ["重试时的上下文要带上错误信息，否则模型会重复犯同一个错"],
            "verification": ["校验日志", "评测集失败样本"],
            "result": "参数类失败从最主要的失败原因降到第三位",
        },
        "boundary": "只统计通过 function calling 通道的调用，不含直接文本解析的老链路。",
        "risk_notes": [],
        "last_verified": "2026-05-15",
    },
    {
        "title": "求职 Agent 工作台编造率从 11% 降到 1.2%（240 条样本）",
        "category": "项目经历",
        "subject": "求职场景 LLM Agent 工作台 / 项目负责人",
        "source_fact": (
            "240 条人工复核样本：加结构化输出与「事实校验」二次校验前后，"
            "生成了事实台账里没有的内容的比例从 11% 降到 1.2%。"
        ),
        "candidate_wording": "给 Agent 加结构化输出与事实校验，编造内容比例从 11% 降到 1.2%。",
        "responsibility_level": "项目负责人",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么校验放在生成之后而不是提示词里约束", "1.2% 剩下的漏检长什么样"],
            "difficulties": ["校验本身也会误杀合理改写，阈值调了三版"],
            "verification": ["240 条复核表", "评测脚本"],
            "result": "自用 5 个月生成 180 份简历，未出现需要人工删掉的编造段落",
        },
        "boundary": "编造率按「句子里出现了台账不支持的具体数字或事实」判定，风格差异不计入。",
        "risk_notes": [],
        "last_verified": "2026-10-12",
    },
    {
        "title": "校园二手交易平台 500 并发 P95 210 ms，超卖投诉归零",
        "category": "项目经历",
        "subject": "校园二手交易全栈平台 / 全栈开发",
        "source_fact": (
            "Locust 压测（500 并发、读多写少）与运营台账：P95 210 ms；"
            "加 Redis 分布式锁前每周 6 起超卖投诉，上线后连续 12 周为 0。"
        ),
        "candidate_wording": "负责二手交易平台后端，500 并发下 P95 210 ms，超卖投诉从每周 6 起降到 0。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么用 Redis 锁而不是数据库行锁", "锁超时与续期怎么处理"],
            "difficulties": ["锁粒度过粗时下单接口 P95 涨到 400 ms，后来按商品维度加锁"],
            "verification": ["压测报告", "运营工单记录"],
            "result": "一学期成交 780 单，无超卖",
        },
        "boundary": "压测环境是单机 4C8G，与真实部署（2 台）不同，指标仅用于横向对比。",
        "risk_notes": [],
        "last_verified": "2026-09-28",
    },
    {
        "title": "国家励志奖学金（专业前 5%）",
        "category": "荣誉奖项",
        "subject": "南京理工大学 / 计算机科学与技术",
        "source_fact": "获奖证书与学校公示名单：2024-2025 学年，专业排名 9/126。",
        "candidate_wording": "国家励志奖学金（专业前 5%）。",
        "responsibility_level": "参与",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": [],
            "difficulties": [],
            "verification": ["获奖证书"],
            "result": None,
        },
        "boundary": "评选口径为学年综合测评 + 家庭经济困难认定，不含竞赛加分。",
        "risk_notes": [],
        "last_verified": "2026-09-01",
    },
    {
        "title": "会议论文第二作者（JSCS 2025 学生论文专场）",
        "category": "教育经历",
        "subject": "南京理工大学 / 计算机科学与技术",
        "source_fact": "论文集 pp. 64-71，作者顺序：周敏华、沈亦舟、陈立。",
        "candidate_wording": "会议论文第二作者（江苏省计算机学会学术年会学生论文专场）。",
        "responsibility_level": "参与",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么用调用轨迹而不是端到端打分做归因"],
            "difficulties": ["240 条样本的失败类型标注一开始两人不一致，后来定了判定规范"],
            "verification": ["论文集", "标注规范文档"],
            "result": "评测集与判定规范被实验室另外两个项目复用",
        },
        "boundary": "我负责评测集构建与实验，方法框架与论文写作由导师主导。",
        "risk_notes": [],
        "last_verified": "2026-09-15",
    },
]


def seed() -> None:
    """写 10 条事实台账。"""
    ins(
        "claim_record",
        [
            row(
                **claim,
                sources=[],
                created_at=NOW - timedelta(days=20 - index),
                updated_at=NOW - timedelta(days=20 - index),
                deleted_at=None,
            )
            for index, claim in enumerate(CLAIMS)
        ],
    )
