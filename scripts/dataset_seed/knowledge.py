# SPDX-License-Identifier: Apache-2.0
"""资料箱、知识库、面经：三类"还没进正式流程的原始材料"。

资料箱里有一条带图片附件的记录——它会在导出前被 ``user_files.ensure_copies`` 回填成
真正的磁盘副本，因此「我的文件」页面与备份包的资产清单都能读到东西（不是空壳）。
"""

from __future__ import annotations

from datetime import timedelta

from PIL import ImageDraw

from dataset_seed.base import NOW, ins, png_data_url, row

MATERIALS = [
    {
        "title": "季度会员召回结案报告",
        "category": "作品",
        "url": "",
        "note": "结案报告里的数字与事实台账第 1 条一致。",
        "content": (
            "2024 Q3 会员召回项目结案：\n"
            "- 触达 186 万人，召回 23.1 万人，召回率 12.4%（上一季度 8.1%）。\n"
            "- 增量 GMV 约 210 万元，券成本 38 万元，ROI 5.5。\n"
            "- 高层级人群不发券，改为内容与权益提醒，券成本下降 23%。\n"
            "- 遗留问题：召回后 60 天的二次流失率仍偏高（约 41%），下一季度跟进。"
        ),
        "files": [
            {
                "name": "召回结案报告.md",
                "mime_type": "text/markdown",
                "size_bytes": 1024,
                "text": "# 会员召回结案\n\n召回率 12.4%，增量 GMV 210 万，ROI 5.5。\n",
            }
        ],
    },
    {
        "title": "归因看板截图（2025-04）",
        "category": "作品",
        "url": "https://zhiyao.example.com/attribution",
        "note": "市场与增长两侧共用的那一版。",
        "content": "末次点击与线性归因并列展示，7 个渠道的 ROI 排序差异一目了然。",
        "files": [],
        "image": True,
    },
    {
        "title": "上海财经大学硕士学位证",
        "category": "证书",
        "url": "",
        "note": "扫描件在个人网盘，这里只记编号。",
        "content": "应用统计专业，专业学位，2023 年 6 月授予。证书编号：1027 2023 0618 0042。",
        "files": [],
    },
    {
        "title": "阿里云数据分析师 ACP 证书",
        "category": "证书",
        "url": "https://example.com/verify/acp",
        "note": "2026 年 11 月到期，记得续期。",
        "content": "认证编号 ACP-2023-77120，2023 年 11 月签发。",
        "files": [],
    },
    {
        "title": "SQL 窗口函数速查",
        "category": "笔记",
        "url": "",
        "note": "面试前会翻一遍。",
        "content": (
            "ROW_NUMBER / RANK / DENSE_RANK 的差异；\n"
            "LAG / LEAD 做同环比；\n"
            "SUM() OVER (PARTITION BY ... ORDER BY ...) 做累计；\n"
            "注意：窗口函数不能直接写在 WHERE 里，需要子查询或 QUALIFY。"
        ),
        "files": [],
    },
    {
        "title": "增长周报模板（公开版）",
        "category": "链接",
        "url": "https://zhiyao.example.com/notes/growth-weekly",
        "note": "",
        "content": "一页纸：核心指标、异常拆解、下周假设。团队连续用了 11 个月。",
        "files": [],
    },
    {
        "title": "云梯网络实习小结",
        "category": "实习材料",
        "url": "",
        "note": "离职时提交的实习总结，含带教老师评语。",
        "content": (
            "实习期 6 个月，独立交付 9 份分析，其中 3 份结论进入当季运营排期。\n"
            "带教评语：取数规范、结论谨慎，能主动追问口径。"
        ),
        "files": [
            {
                "name": "实习小结.txt",
                "mime_type": "text/plain",
                "size_bytes": 512,
                "text": "实习期 6 个月，独立交付 9 份分析。\n",
            }
        ],
    },
    {
        "title": "数学建模竞赛论文（2020）",
        "category": "校园材料",
        "url": "",
        "note": "上海赛区三等奖。",
        "content": "题目为城市共享单车调度，负责排队论建模与论文写作。",
        "files": [],
        # 留在回收站里：给「回收站」页签一个可恢复的样本（恢复后资料箱仍有 8 条）。
        "deleted": True,
    },
]

KNOWLEDGE = [
    {
        "title": "会员分层的 5 个常用维度",
        "category": "方法论",
        "tags": ["会员", "分层", "RFM"],
        "source": "工作沉淀",
        "content": (
            "1. 最近一次消费（R）：判断是否沉默，比频次更敏感；\n"
            "2. 消费频次（F）：区分习惯性购买与一次性促销；\n"
            "3. 客单价（M）：决定召回时的权益力度；\n"
            "4. 内容/互动行为：内容型产品的早期信号；\n"
            "5. 服务触点（客服、退款）：负向信号，单独一层。\n"
            "经验：分层规则不要超过 5 层，否则运营配置不过来。"
        ),
    },
    {
        "title": "A/B 实验的 9 个检查点",
        "category": "方法论",
        "tags": ["实验", "AB", "统计"],
        "source": "团队 SOP",
        "content": (
            "假设可证伪、样本量估算、分流校验、指标口径、显著性、效应量、"
            "护栏指标、上线决策、后续跟踪。\n"
            "最常被跳过的是「分流校验」和「护栏指标」——前者会让结论完全失效，"
            "后者会让一次「成功」的实验在两周后反噬。"
        ),
    },
    {
        "title": "渠道质量评分卡（CAC / 次留 / LTV30）",
        "category": "工作方法",
        "tags": ["投放", "CAC", "LTV"],
        "source": "工作沉淀",
        "content": (
            "评分 = 0.4 × 次留标准化 + 0.4 × LTV30/CAC + 0.2 × 量级稳定性。\n"
            "用途：周会排序，连续两周低于阈值的渠道进入观察名单。\n"
            "注意：LTV30 有 30 天滞后，新渠道前两周只看次留。"
        ),
    },
    {
        "title": "消费零售行业的会员体系观察",
        "category": "行业知识",
        "tags": ["零售", "会员", "行业"],
        "source": "面试准备",
        "content": (
            "三种主流形态：付费会员（山姆式）、积分等级（航空/酒店式）、"
            "权益包（电商式）。\n"
            "付费会员的核心是「让用户觉得一年能省回来」，因此高频品类更适合；"
            "积分等级的核心是「沉没成本」，需要足够的兑换场景。"
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
        "title": "弦月网络二面复盘",
        "category": "面试复盘",
        "tags": ["面试", "商业分析"],
        "source": "本人记录",
        "content": (
            "问了三个问题：如何定义「经营健康度」、渠道 ROI 排序变化怎么解释、"
            "如果预算砍一半先砍哪里。\n"
            "第三个问题答得不好：我只说了「砍低 ROI」，没有给出验证路径。"
            "下次应该补一句「先做小流量停投实验，确认量级缺口能否被自然流量补上」。"
        ),
    },
    {
        "title": "为什么简历上不写「精通 Excel」",
        "category": "求职策略",
        "tags": ["简历", "表达"],
        "source": "个人经验",
        "content": (
            "精通是最容易被追问的词。写成「Excel（透视表 / Power Query，做过 12 万行"
            "渠道台账）」反而更容易被记住，也给了面试官一个具体问题。"
        ),
    },
    {
        "title": "归因模型：末次点击 vs 线性",
        "category": "方法论",
        "tags": ["归因", "投放"],
        "source": "工作沉淀",
        "content": (
            "末次点击适合评估「临门一脚」的渠道，线性归因适合看品牌类投放的贡献。\n"
            "实践做法：两套都算，差额作为「渠道争议」的量化指标；"
            "如果差额超过 30%，说明口径本身有问题，先对数再谈优化。"
        ),
    },
]

INTERVIEWS = [
    {
        "title": "澄川科技 用户增长分析师 一面",
        "company": "澄川科技（上海）有限公司",
        "position": "用户增长分析师",
        "job_index": 0,
        "content": (
            "整体 45 分钟，两位面试官（增长负责人 + 分析师）。前半段深挖会员召回项目，"
            "后半段是一道开放题：如果新客 7 日留存只有 20%，你会怎么定位问题。\n"
            "感受：他们非常在意口径，几乎每个数字都会追问分母。"
        ),
        "questions": [
            "你们的分层规则是怎么定的？为什么是 5 层？",
            "召回率的分母包含哪些人？",
            "12 组实验里有没有互相干扰？",
            "如果留存只有 20%，你怎么定位问题？",
            "你平时怎么做指标口径对齐？",
        ],
        "tags": ["增长", "会员", "一面"],
        "source": "self",
        "difficulty": "中等",
        "round_type": "一面",
        "interview_date": "2026-10-24",
    },
    {
        "title": "弦月网络 商业分析师 二面",
        "company": "弦月网络科技（上海）有限公司",
        "position": "商业分析师（用户方向）",
        "job_index": 1,
        "content": (
            "直面业务负责人，几乎没有八股，全程围绕一个虚拟业务场景："
            "会员续费率连续三个月下滑，给你一周时间给结论。\n"
            "我按「拆指标—找异常—提假设—设计验证」的顺序讲，对方中途打断两次追问数据来源。"
        ),
        "questions": [
            "续费率下滑，你先看哪三个指标？",
            "怎么区分季节性因素和真实下滑？",
            "如果数据只能拿到月度，你怎么办？",
            "你如何说服业务接受一个不够好看的结论？",
        ],
        "tags": ["商业分析", "案例", "二面"],
        "source": "self",
        "difficulty": "困难",
        "round_type": "二面",
        "interview_date": "2026-10-21",
    },
    {
        "title": "星桥教育 增长分析师 笔试",
        "company": "星桥教育科技有限公司",
        "position": "增长分析师",
        "job_index": 12,
        "content": (
            "线上笔试 90 分钟：3 道 SQL、2 道指标计算、1 道开放题（设计一个转介绍实验）。\n"
            "SQL 考了窗口函数做留存、自连接做漏斗；开放题重点看有没有写护栏指标。"
        ),
        "questions": [
            "用 SQL 算次日留存（给两张表：注册、登录）",
            "设计一个转介绍实验，说明分流与护栏指标",
            "试听课转化率下降 15%，列出排查顺序",
        ],
        "tags": ["笔试", "SQL", "教育"],
        "source": "peer",
        "difficulty": "中等",
        "round_type": "笔试",
        "interview_date": "2026-10-18",
    },
    {
        "title": "火花实验室 增长黑客 HR 面",
        "company": "火花实验室（北京）科技有限公司",
        "position": "增长黑客（Growth Hacker）",
        "job_index": 7,
        "content": (
            "HR 面主要确认三件事：能否接受 996 节奏、期望薪资、以及为什么从上海考虑北京。\n"
            "公开渠道上的面经提到这家会问「最近一次失败的增长实验」，我提前准备了。"
        ),
        "questions": [
            "最近一次失败的增长实验是什么？",
            "能接受什么样的加班节奏？",
            "为什么考虑来北京？",
        ],
        "tags": ["HR面", "北京", "创业公司"],
        "source": "public",
        "difficulty": "简单",
        "round_type": "HR面",
        "interview_date": "2026-10-16",
    },
]


def _dashboard_png() -> str:
    """资料箱里那张「归因看板截图」：两条归因曲线的简单示意。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        canvas.text((24, 18), "渠道 ROI：末次点击 vs 线性归因", fill=(15, 23, 42))
        canvas.line([48, 300, 620, 300], fill=(148, 163, 184))
        canvas.line([48, 60, 48, 300], fill=(148, 163, 184))
        points_last = [
            (70, 250),
            (150, 190),
            (230, 210),
            (310, 150),
            (390, 175),
            (470, 120),
            (550, 140),
        ]
        points_linear = [
            (70, 230),
            (150, 215),
            (230, 180),
            (310, 185),
            (390, 140),
            (470, 150),
            (550, 110),
        ]
        canvas.line(points_last, fill=(22, 54, 92), width=3)
        canvas.line(points_linear, fill=(220, 120, 60), width=3)
        canvas.text((430, 66), "— 末次点击", fill=(22, 54, 92))
        canvas.text((430, 86), "— 线性归因", fill=(220, 120, 60))

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
                    "name": "归因看板.png",
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
