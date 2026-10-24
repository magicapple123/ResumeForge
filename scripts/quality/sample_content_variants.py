# SPDX-License-Identifier: Apache-2.0
"""边界样例的**内容构造器**：每个函数返回一份可直接喂给 ResumeContent 的 dict。

只负责"内容长什么样"，不含模板/字号/页数等渲染参数（那些在 sample_corpus_boundaries
里按样例声明）。所有内容仍然全虚构：EN 侧统一 Sample/Example 命名，链接只用
example.com / example.org。

为什么按"类别"而不是按"样例"拆函数：同一类边界（例如长链接）要覆盖 8 种参数组合，
正文构造逻辑只该有一份；样例表里只写"第几条"。
"""

from __future__ import annotations

import copy
from typing import Any

from .sample_specs import (
    EMAIL,
    EMAIL_ALT,
    PHONE,
    award,
    base_content,
    education,
    experience,
    project,
    skill,
)

# 长链接用字符块拼出来而不是手抄一长串：长度按 idx 变化，内容固定。
_LONG_PATH = "abcdefghijklmnopqrstuvwxyz0123456789" * 12


def mixed_language(idx: int) -> dict[str, Any]:
    """中英混排：术语、公司名、日期格式、全/半角标点各走一种组合。"""
    content = base_content()
    content["name"] = "示例甲 Sample A"
    content["job_intent"] = "后端开发工程师 / Backend Engineer"
    content["summary"] = (
        "3 年 Python 后端经验，主导过 2 个 microservice（微服务）拆分；"
        "熟悉 FastAPI、SQLAlchemy 与 PostgreSQL。"
    )
    content["experience"] = [
        experience(
            company="示例科技 Example Tech",
            role="Backend Engineer 后端工程师",
            start_date="Jul 2023",
            end_date="至今",
            description=[
                "用 FastAPI 重构 legacy API，P95 latency 从 800ms 降到 120ms。",
                "负责 CI/CD 流水线（GitHub Actions + pytest），覆盖率从 62% 提到 85%。",
                "与 PM、QA 协作交付 3 个 sprint，0 线上 P0 事故。",
            ],
        ),
        experience(
            company="示例文化传播有限公司",
            role="实习运营 Intern",
            start_date="2022.06",
            end_date="2022.12",
            description=["独立完成 WeChat 社群选题与发布，月均 20 posts。"],
        ),
    ]
    if idx % 2 == 0:
        content["education"] = [
            education(
                school="示例大学 Example University",
                major="Computer Science 计算机科学与技术",
                gpa="3.8/4.0 (Top 5%)",
            )
        ]
    if idx % 3 == 0:
        content["skills"] = [
            skill("Python"),
            skill("FastAPI"),
            skill("PostgreSQL / MySQL"),
            skill("Docker & K8s"),
            skill("English (CET-6)"),
        ]
    if idx % 4 == 1:
        content["awards"] = [award("ACM-ICPC 区域赛银奖 / Silver Medal", "2022.11")]
    return content


def sparse(idx: int) -> dict[str, Any]:
    """少内容：只剩 1–2 个字段，其余为空列表 / 空串（模板必须整段跳过而不是留空标题）。"""
    variants: list[dict[str, Any]] = [
        {"name": "示例乙"},
        {"name": "示例乙", "phone": PHONE},
        {"name": "示例乙", "phone": PHONE, "email": EMAIL},
        {"name": "示例乙", "job_intent": "示例岗位"},
        {"name": "示例乙", "summary": "一句话概述。"},
        {"name": "示例乙", "skills": [skill("示例技能")]},
        {"name": "示例乙", "education": [education(gpa="", courses=[], achievements=[])]},
        {"name": "示例乙", "awards": [award()]},
    ]
    return copy.deepcopy(variants[idx % len(variants)])


def dense(idx: int, *, experiences: int | None = None) -> dict[str, Any]:
    """多内容：条目 / 要点数量随 idx 增长，用来把内容顶到 2–3 页并触发溢出截断。"""
    content = base_content()
    count = experiences if experiences is not None else 4 + idx
    content["experience"] = [
        experience(
            company=f"示例科技有限公司（第 {index + 1} 家）",
            role="示例岗位",
            start_date=f"20{16 + index % 8}.0{1 + index % 9}",
            end_date="至今" if index == 0 else f"20{17 + index % 8}.12",
            description=[
                f"第 {index + 1} 段经历要点 A：负责示例模块，示例指标提升 {10 + index}%。",
                f"第 {index + 1} 段经历要点 B：主导示例流程改造，交付周期缩短 {20 + index}%。",
                f"第 {index + 1} 段经历要点 C：维护示例台账，覆盖 {index + 3} 个示例渠道。",
                f"第 {index + 1} 段经历要点 D：与 {index + 4} 人团队协作，按期交付。",
            ],
        )
        for index in range(count)
    ]
    content["projects"] = [
        project(name=f"示例长项目 {index + 1}", description=["示例项目描述一条。"], highlights=[])
        for index in range(2 + idx % 2)
    ]
    content["campus_experience"] = [
        {
            "organization": "示例大学学生会",
            "role": "副部长",
            "start_date": "2021.09",
            "end_date": "2022.06",
            "description": ["统筹 6 场示例活动，累计触达 3000 余人次。"],
        }
    ]
    content["summary"] = "示例概述：这段文字在超页样例里用来把首页页头之后的空间占满。"
    return content


def long_url(idx: int) -> dict[str, Any]:
    """长链接：无空格、可换行点很少的 URL，放进页眉与正文列表各一处。"""
    # personal_website 的 schema 上限是 256 字符：最长一档 230，接近上限但不越界。
    length = 90 + idx * 20
    long_link = "https://example.com/" + _LONG_PATH[:length]
    content = base_content()
    content["personal_website"] = long_link
    if idx % 2 == 0:
        content["github"] = "https://github.example.com/" + _LONG_PATH[: 60 + idx * 17]
    bullet_url = "https://example.org/docs/" + _LONG_PATH[: 70 + idx * 11]
    content["summary"] = (
        "示例概述：交付文档见 " + bullet_url + " ，接口说明与示例都在这一份文档里。"
    )
    content["projects"] = [
        project(
            name="示例长链接项目",
            tech_stack=["示例工具"],
            description=["项目主页：" + long_link],
            highlights=[],
        )
    ]
    return content


def special_chars(idx: int) -> dict[str, Any]:
    """特殊符号：HTML 元字符、引号、破折号、竖线、百分号、反斜杠与全角标点。"""
    variants: list[tuple[str, str]] = [
        ("示例 <script>alert(1)</script> 名称", "含未转义 HTML 标签的文本"),
        ("示例 & 符号 &amp; 与 <b>粗体标签</b>", "HTML 实体与标签字样"),
        ("示例引号 “双引号” ‘单引号’ 'apostrophe' \"quote\"", "中英文引号"),
        ("示例破折号 — em dash – en dash … 省略号", "破折号与省略号"),
        ("示例竖线 | 反斜杠 \\ 百分号 100% 井号 #1 星号 *", "转义敏感字符"),
        ("示例百分号 %s 与 {占位符} 与 ${变量} 与 {{jinja}}", "模板语法字样"),
        ("示例全角标点：，。；：！？（）、〈〉《》「」『』", "CJK 全角标点"),
        ("示例组合字符 e\u0301 与零宽字符\u200b与软连字符\u00ad", "组合字符 / 零宽字符"),
    ]
    name, summary = variants[idx % len(variants)]
    content = base_content()
    content["name"] = "示例丙"
    content["job_intent"] = "示例岗位（特殊符号）"
    content["summary"] = f"{summary}；{name}。"
    content["experience"] = [
        experience(
            description=[
                f"{name} —— 第一行要点。",
                "示例要点：A & B < C > D，开销降低 15%–20%。",
            ]
        )
    ]
    content["skills"] = [skill("C++ / C#"), skill("Node.js & npm"), skill("<T> 模板")]
    return content


def emphasis(idx: int) -> tuple[dict[str, Any], bool]:
    """局部强调：返回 (内容, 是否含**成对**加粗标记)。

    idx 0/1/2/3/5/6/7 是成对标记（渲染层必须去标记并加粗）；idx 4 是**落单**的
    ** 标记（按项目约定按普通文字原样保留，不许吞字符）。
    """
    content = base_content()
    paired = idx != 4
    if paired:
        content["summary"] = "示例概述：**这段是加粗的**，后面是正常文字。"
        content["experience"] = [
            experience(
                description=[
                    "带 **关键指标** 的要点：转化率提升 18%。",
                    "**整条要点都加粗**。",
                    "普通要点，尾部的 **局部强调** 结束。",
                ]
            )
        ]
        content["projects"] = [project(description=["**项目描述加粗** 与正常文字混排。"])]
    else:
        # **恰好一个**标记：成对解析器不会消费它，必须原样出现在文本产物里。
        content["summary"] = "示例概述：这里只有**一个星号标记，应当原样保留。"
        content["experience"] = [
            experience(description=["这条要点没有标记。", "另一条也没有标记。"])
        ]
    if idx in (0, 6):
        content["education"] = [education(achievements=["**获奖经历**：示例竞赛二等奖。"])]
    return content, paired


def legacy_raw(idx: int) -> dict[str, Any]:
    """旧记录：没有 id / point_ids、字段残缺、带旧版本/其它客户端留下的未知键。

    三条性质要成立（见 check）：Pydantic 读入时忽略未知键、序列化时不凭空生成
    id/point_ids、导出各格式正常。idx 变化只改"残到哪一档"。
    """
    raw: dict[str, Any] = {
        "name": f"示例旧记录 {idx + 1}",
        "phone": PHONE,
        "email": EMAIL if idx % 2 == 0 else EMAIL_ALT,
        "summary": "旧记录概述：这条内容模拟历史版本保存的 JSON。",
        "education": [
            {
                "school": "示例大学",
                "major": "示例专业",
                "degree": "本科",
                "start_date": "2018.09",
                "end_date": "2022.06",
                "gpa": "",
                "courses": [],
                "achievements": [],
            }
        ],
        "experience": [
            {
                "company": "示例科技有限公司",
                "role": "示例岗位",
                "start_date": "2022.07",
                "end_date": "至今",
                "description": ["旧记录只有一条要点。"],
            }
        ],
        "campus_experience": [],
        "projects": [],
        "skills": [{"name": "示例技能", "level": ""}],
        "awards": [],
        # 旧/新版本客户端可能留下的未知键：读入必须忽略，序列化不得写回。
        "parent_revision_id": None,
        "legacy_extra": {"nested": [1, 2, 3]},
    }
    if idx % 3 == 0:
        raw.pop("summary")
    if idx % 4 == 1:
        raw.pop("skills")
    if idx % 4 == 2:
        # 空数组：旧记录里"有这个分区但一条都没有"是常见形态。
        raw["projects"] = []
        raw["awards"] = []
    if idx == 7:
        raw["name"] = ""
        raw["email"] = ""
    return raw


def scholar_long_cv(idx: int, *, long_cv: bool = False) -> dict[str, Any]:
    """学术长 CV：多段研究经历、论文列表、方法技能，scholar 模板排 2–3 页。

    long_cv=True 时再加两段助教/评审经历与更多论文（样例库用它证明"2–3 页"，
    否则 standard 字号下内容只排得下 1 页，无法支撑跨页结论）。
    """
    content = base_content()
    content["name"] = "示例丁"
    content["job_intent"] = "研究助理 / Research Assistant"
    content["birth_year"] = ""
    content["summary"] = (
        "研究兴趣：示例方向的示例问题（Example Problem）。"
        "已发表 3 篇示例会议论文，擅长示例方法与示例数据。"
    )
    content["education"] = [
        education(
            school="示例大学",
            major="示例专业（博士在读）",
            degree="博士",
            start_date="2022.09",
            end_date="至今",
            gpa="",
            courses=["示例课程：高级示例方法"],
            achievements=["示例学业奖学金（博士）"],
        ),
        education(
            school="示例大学",
            major="示例专业",
            degree="本科",
            start_date="2018.09",
            end_date="2022.06",
            gpa="3.9/4.0",
            courses=["示例课程一", "示例课程二", "示例课程三"],
            achievements=["示例优秀毕业生"],
        ),
    ]
    content["experience"] = [
        experience(
            company="示例大学 示例实验室",
            role="研究助理",
            start_date="2022.09",
            end_date="至今",
            description=[
                "参与示例项目（编号示例），负责示例实验设计与示例数据分析。",
                "复现并改进示例基线方法，示例指标相对提升 7.5%。",
                "维护示例数据集与示例评测脚本，服务 3 个示例课题。",
            ],
        ),
        experience(
            company="示例研究院",
            role="暑期研究实习生",
            start_date="2021.06",
            end_date="2021.09",
            description=["整理示例文献 120 篇，产出示例综述初稿。"],
        ),
    ]
    paper_count = (8 + idx * 2) if long_cv else (4 + idx)
    content["projects"] = [
        project(
            name=f"示例论文 {index + 1}：面向示例任务的方法研究",
            role="第一作者" if index % 2 == 0 else "共同作者",
            start_date=f"202{index % 4}.0{index % 9 + 1}",
            end_date="",
            tech_stack=["示例方法", "Python", "LaTeX"],
            description=[f"示例会议（ExampleConf 202{index}）录用，示例评审 3 项。"],
            highlights=[],
        )
        for index in range(paper_count)
    ]
    if long_cv:
        content["experience"].extend(
            [
                experience(
                    company="示例大学 示例课程组",
                    role="助教（示例课程）",
                    start_date="2023.02",
                    end_date="2023.06",
                    description=[
                        "负责 30 人小班的习题课与作业批改，组织 2 次示例项目辅导。",
                        "维护课程示例代码仓库，更新 5 个示例实验。",
                    ],
                ),
                experience(
                    company="示例会议程序委员会",
                    role="外部评审",
                    start_date="2023.09",
                    end_date="2024.06",
                    description=["评审 12 篇投稿，输出示例评审意见。"],
                ),
            ]
        )
    content["skills"] = [
        skill("Python"),
        skill("PyTorch"),
        skill("示例统计方法"),
        skill("LaTeX"),
        skill("英文论文写作"),
        skill("示例实验设计"),
        skill("数据可视化"),
        skill("R"),
    ]
    content["awards"] = [
        award("示例会议最佳论文提名", "2024.06"),
        award("示例学业奖学金（一等）", "2023.10"),
        award("示例学术新人奖", "2022.09"),
    ]
    return content


def page_boundary(idx: int) -> dict[str, Any]:
    """分页边界：内容量贴着"刚好一页 / 刚好两页"的档位逐级变化。

    这里**不声明精确页数**（不同平台字体度量会让精确页数漂移），样例守的是
    "页数不超过上限 + 溢出标记与页数自洽 + 不出现空白页"。具体档位：经历条数
    1→4、每条要点 2→4、字号三档，覆盖"差一行就换页"的几种组合。
    """
    count = 1 + idx % 4
    bullets = 2 + idx % 3
    content = base_content()
    content["experience"] = [
        experience(
            company=f"示例科技有限公司{index + 1}",
            role="示例岗位",
            start_date=f"20{18 + index}.0{1 + index % 9}",
            end_date=f"20{19 + index}.12",
            description=[
                f"第 {index + 1} 条经历要点 {bullet + 1}：示例内容用于逼近分页边界。"
                for bullet in range(bullets)
            ],
        )
        for index in range(count)
    ]
    content["projects"] = [
        project(name=f"示例项目{index + 1}", description=["示例项目描述。"], highlights=[])
        for index in range(1 + idx % 2)
    ]
    return content


__all__ = [
    "dense",
    "emphasis",
    "legacy_raw",
    "long_url",
    "mixed_language",
    "page_boundary",
    "scholar_long_cv",
    "sparse",
    "special_chars",
]
