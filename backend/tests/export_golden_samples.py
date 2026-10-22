# SPDX-License-Identifier: Apache-2.0
"""黄金导出矩阵的**样本构造器**（纯虚构内容，对抗性长度）。

从 ``test_export_golden.py`` 拆出来的原因只有一个：仓库 500 行测试文件预算
（``tests/test_file_size_budget.py``）。拆的是**样本**，不是矩阵机制——``CASES``
定义、两阶段基线写入与指纹比对仍留在 ``test_export_golden.py`` 里，一处都不动。

样本刻意对抗：长公司名、长链接、极长 bullet、中英双语、3 页内容量。
"""

from __future__ import annotations

from app.schemas.resume import ResumeContent

# ===== 黄金样本（纯虚构；对抗性内容：长公司名 / 长链接 / 极长 bullet / 中文） =====

ZH_URL = "https://linzhiyuan-dev.example.com/works/system-design-portfolio"
EN_URL = "https://alex-johnson-dev.example.com/projects/open-source/contributions/2024"


def short_zh() -> ResumeContent:
    """1 页中文样本：长公司名、长链接、一条跨行折行的极长 bullet。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验，长期负责高并发交易系统的架构设计与稳定性治理。",
        experience=[
            {
                "company": "云梯智联科技有限公司",
                "role": "高级后端工程师",
                "start_date": "2018-01",
                "end_date": "2024-12",
                "description": [
                    "负责核心交易链路的设计与落地，覆盖网关鉴权、订单状态机与幂等补偿，"
                    "推动跨团队接口契约评审，上线后该链路全年可用性达到四个九，"
                    "兜底策略上线后资损为零，相关方案沉淀为团队标准接入文档。",
                ],
            }
        ],
        projects=[
            {
                "name": "统一网关平台",
                "role": "负责人",
                "tech_stack": ["Python", "FastAPI", "MySQL"],
                "description": ["面向全公司的统一接入网关与配额管理，设计文档见 " + ZH_URL + "。"],
                "highlights": ["灰度放量与回滚预案演练覆盖全部核心服务。"],
            }
        ],
        skills=[{"name": "Python", "level": "精通"}, {"name": "MySQL", "level": "精通"}],
        education=[{"school": "星辰理工大学", "major": "计算机科学与技术", "degree": "本科"}],
        personal_website=ZH_URL,
    )


def short_en() -> ResumeContent:
    """1 页英文样本：长公司名、长链接、长 bullet（ASCII 无中文字体路径）。

    **必须带 `github`**：页头的 `GitHub：…` 是 `_resume_sections.j2` 与 PDF `_draw_resume`
    都单独拼的一段，此前黄金矩阵里没有任何 case 填 github（只有 `personal_website`），于是
    `GitHub：` 这个前缀在 PDF 里断掉也不会有人发现。探针与指纹都锁住它。
    """
    return ResumeContent(
        name="Alex Johnson",
        phone="13900005678",
        email="alex.johnson@example.com",
        city="Hangzhou",
        github="https://github.com/alex-johnson-dev",
        job_intent="Senior Backend Engineer",
        summary="Ten years of backend engineering across high-throughput commerce systems.",
        experience=[
            {
                "company": "International Cloud Commerce Systems Division",
                "role": "Senior Backend Engineer",
                "start_date": "2018-01",
                "end_date": "2024-12",
                "description": [
                    "Owned the design and delivery of the order-state pipeline covering "
                    "gateway authentication, idempotency guarantees and compensation flows; "
                    "drove cross-team contract reviews and kept the ledger path at four nines "
                    "of availability for three consecutive years. Full portfolio: " + EN_URL,
                ],
            }
        ],
        skills=[{"name": "Python", "level": "Expert"}, {"name": "MySQL", "level": "Expert"}],
        education=[
            {
                "school": "Stellar Polytechnic University",
                "major": "Computer Science",
                "degree": "BSc",
            }
        ],
        personal_website=EN_URL,
    )


def _long_experiences(lang: str) -> list[dict]:
    """8 段经历 × 3 条长 bullet：让内容在字号缩放后仍稳定超出 2 页。"""
    items = []
    for i in range(8):
        if lang == "zh":
            company = f"云梯智联科技有限公司第{i}事业部"
            bullets = [
                f"负责核心交易链路第{i}模块的设计与落地，覆盖网关鉴权、订单状态机与幂等补偿，"
                "推动跨团队接口契约评审，上线后该链路全年可用性达到四个九，兜底策略上线后资损为零，"
                "相关方案沉淀为团队标准接入文档并被三个兄弟部门复用。",
                f"主导第{i}代索引重构与慢查询治理，将 P99 延迟从 800ms 压到 60ms，"
                "期间完成双写切换、灰度放量与回滚预案演练，并输出压测报告与容量规划模型。",
                f"搭建第{i}套自动化回归与告警体系，接入全链路追踪，"
                "故障平均定位时间从半小时缩短到三分钟，次年该体系推广到全部核心服务。",
            ]
        else:
            company = f"International Cloud Commerce Systems Division {i}"
            bullets = [
                f"Owned the design and delivery of the order-state pipeline for business unit {i}, "
                "covering gateway authentication, idempotency guarantees and compensation flows; "
                "drove cross-team contract reviews and kept the ledger path at four nines of "
                "availability for three consecutive years.",
                f"Led the generation-{i} index overhaul and slow-query remediation programme, "
                "reducing P99 latency from 800ms to 60ms; executed dual-write migration, "
                "progressive rollout and rollback drills, and published the capacity planning model.",
                f"Built the automated regression and alerting platform for unit {i}, integrating "
                "distributed tracing end to end; cut mean time to diagnosis from thirty minutes to "
                "three minutes and later rolled the platform out to every core service.",
            ]
        items.append(
            {"company": company, "role": f"Senior Backend Engineer {i}", "description": bullets}
        )
    return items


def long_zh() -> ResumeContent:
    """3 页中文样本：内容量确保 page_limit=3 下真实渲染 3 页。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验，长期负责高并发交易系统的架构设计与稳定性治理，作品集：" + ZH_URL,
        experience=_long_experiences("zh"),
        skills=[
            {"name": "Python", "level": "精通"},
            {"name": "MySQL", "level": "精通"},
            {"name": "Redis", "level": "熟练"},
            {"name": "Kafka", "level": "熟练"},
            {"name": "Kubernetes", "level": "掌握"},
        ],
        personal_website=ZH_URL,
    )


def long_en() -> ResumeContent:
    """3 页英文样本。"""
    return ResumeContent(
        name="Alex Johnson",
        phone="13900005678",
        email="alex.johnson@example.com",
        city="Hangzhou",
        job_intent="Senior Backend Engineer",
        summary="Ten years of backend engineering across high-throughput commerce systems. "
        "Portfolio: " + EN_URL,
        experience=_long_experiences("en"),
        skills=[
            {"name": "Python", "level": "Expert"},
            {"name": "MySQL", "level": "Expert"},
            {"name": "Redis", "level": "Advanced"},
            {"name": "Kafka", "level": "Advanced"},
            {"name": "Kubernetes", "level": "Competent"},
        ],
        personal_website=EN_URL,
    )


SAMPLES = {"short_zh": short_zh, "short_en": short_en, "long_zh": long_zh, "long_en": long_en}
