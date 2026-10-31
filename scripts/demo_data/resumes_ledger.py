# SPDX-License-Identifier: Apache-2.0
"""简历与事实台账域：resume_record + claim_record。

搬迁自 ``scripts/seed_demo_data.py`` 第 571–814 行（原文的 ``# ── 简历 ──`` 与
``# ── 事实台账 ──`` 两段）。``RESUMES`` 留在模块顶层：投递队列域要按
``RESUMES[n]["title"]`` 引用它们，所以改内容不要改顺序。

v2 之后演示库同时有两种内容：
- 索引 0/1 是 **v1 旧格式**（v1_resume_sample.json 冻结的夹具）——用来验证"打开旧简历 →
  读时一次性转换"（计划 D11/§17.3），所以它们必须原样保存 v1 JSON，不能预转成 v2；
- 索引 2/3 是 **v2 文档**（document_v2.build_document 构造，含自定义字段/自建板块/三种条目头
  布局），用来验证新模型、四出口与截图。
"""

from __future__ import annotations

from datetime import timedelta

from demo_data.base import NOW, ins, row
from demo_data.document_v2 import build_document, load_v1_sample
from demo_data.jobs import JOBS

# v1 旧简历夹具（纯虚构）：来自 v1 代码冻结的 sample_resume_content。演示库里保留两份
# 旧格式内容，用来验证读时转换；它们不能被预转成 v2，否则测不到转换路径。
V1_BASE = load_v1_sample()
V2_PHOTO = str(V1_BASE.get("photo") or "")


def v1_content(intent: str, summary: str) -> dict:
    """v1 内容 = 基础夹具 + 一份简历的岗位意向/总结覆盖（与 v1 时代生成结果同形）。"""
    data = dict(V1_BASE)
    data["job_intent"] = intent
    data["summary"] = summary
    return data


RESUMES = [
    dict(
        id=1,
        title="市场运营专员 - 示例科技（上海）有限公司",
        job_id=1,
        job_title=JOBS[0]["title"],
        company=JOBS[0]["company"],
        content=v1_content(
            "市场运营专员",
            "3 年市场与运营经验，主导季度主题营销活动，参与人数 1.2 万、转化率环比提升 18%；"
            "擅长把活动经验沉淀为可复用 SOP。",
        ),
        source="ai",
        favorite=False,
        tone="",
        enhancement_enabled=True,
        enhancement_level="strong",
        # 旧格式：打开时触发读时转换（计划 D11），所以模板/版式仍按 v1 时代的值给。
        template="classic",
        format_name="standard",
        format_config={"accent": "#16365c"},
        page_limit=1,
        font_scale="standard",
        custom_instruction="突出活动转化率与流程沉淀",
        note="旧版内容：打开会触发「旧简历转换」，用于验收读时转换",
        created_at=NOW - timedelta(days=21),
    ),
    dict(
        id=2,
        title="用户增长运营 - 示例网络科技有限公司",
        job_id=4,
        job_title=JOBS[3]["title"],
        company=JOBS[3]["company"],
        content=v1_content(
            "用户增长运营",
            "3 年运营经验，做过会员拉新与留存实验，习惯用数据解释结论。",
        ),
        source="manual",
        favorite=False,
        tone="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        template="classic",
        format_name="standard",
        format_config={},
        page_limit=2,
        font_scale="standard",
        custom_instruction="",
        note="旧版内容：第二份转换样本",
        created_at=NOW - timedelta(days=15),
    ),
    dict(
        id=3,
        title="通用简历（市场 / 运营方向）",
        job_id=None,
        job_title="",
        company="",
        # content 要等 init_db() 之后才能构造（build_document 会读资料库自定义字段定义），
        # 所以这里给的是延迟构造器，由 seed() 统一 materialize。
        content_builder=lambda: build_document(variant="general", photo=V2_PHOTO),
        source="manual",
        favorite=True,
        tone="",
        enhancement_enabled=False,
        enhancement_level="balanced",
        template="elegant",
        format_name="spacious",
        format_config={},
        page_limit=1,
        font_scale="standard",
        custom_instruction="",
        note="通用版，先投不明确方向的岗位",
        created_at=NOW - timedelta(days=8),
    ),
    dict(
        id=4,
        # 首屏展示用的那份：technical 的实心色块标题层次最分明，强调色换成应用的
        # colorPrimary（#16365c），让截图与界面本身是同一个调子。
        title="市场运营专员（字段版） - 示例科技（上海）有限公司",
        job_id=1,
        job_title=JOBS[0]["title"],
        company=JOBS[0]["company"],
        content_builder=lambda: build_document(variant="job", photo=V2_PHOTO),
        source="ai",
        favorite=True,
        tone="",
        enhancement_enabled=True,
        enhancement_level="strong",
        template="technical",
        format_name="standard",
        format_config={"accent": "#16365c"},
        page_limit=1,
        font_scale="standard",
        custom_instruction="突出活动转化率与流程沉淀",
        note="v2 字段版：教育/实习的自定义字段与自建板块都落进纸面",
        created_at=NOW - timedelta(days=3),
    ),
]


def seed() -> None:
    """写入 4 份简历（2 份 v1 旧格式 + 2 份 v2 文档）与 6 条事实台账。"""
    records = []
    for spec in RESUMES:
        data = dict(spec)
        builder = data.pop("content_builder", None)
        if builder is not None:
            # v2 文档必须等资料库写完之后再构造（自定义字段 id / 默认位置都从库里读）。
            data["content"] = builder()
        records.append(
            row(
                **data,
                warnings=[],
                model="" if data["source"] == "manual" else "deepseek-v4-flash",
                parse_error="",
                deleted_at=None,
            )
        )
    ins("resume_record", records)

    # ── 事实台账 ────────────────────────────────────────────────────────────────
    ins(
        "claim_record",
        [
            row(
                id=1,
                title="季度主题营销活动参与人数 1.2 万",
                category="实习/工作",
                subject="示例科技有限公司 / 市场运营专员",
                source_fact="活动后台报名数据：12,400 人，活动结案报告里有截图。",
                candidate_wording="主导季度主题营销活动，参与人数 1.2 万。",
                sources=[],
                responsibility_level="主导方案或交付",
                verification_status="已确认",
                allowed_uses=["resume", "interview"],
                interview_details={
                    "decisions": ["报名口径包含重复报名吗", "1.2 万是报名数还是到场数"],
                    "difficulties": ["增长主要来自哪一波渠道"],
                    "verification": ["活动后台导出数据", "结案报告截图"],
                    "result": None,
                },
                boundary="不含线下到场人数，到场约 6,000。",
                risk_notes=[],
                last_verified="2026-10-03",
                created_at=NOW - timedelta(days=12),
                updated_at=NOW - timedelta(days=3),
            ),
            row(
                id=2,
                title="活动转化率环比提升 18%",
                category="实习/工作",
                subject="示例科技有限公司 / 市场运营专员",
                source_fact="结案报告对比上一季度：7.2% vs 6.1%。",
                candidate_wording="活动转化率环比提升 18%。",
                sources=[],
                responsibility_level="负责模块",
                verification_status="已确认",
                allowed_uses=["resume", "interview"],
                interview_details={
                    "decisions": ["环比基数为什么低", "增长来自哪一步"],
                    "difficulties": [],
                    "verification": ["结案报告对比数据"],
                    "result": None,
                },
                boundary="单一渠道口径，不含付费投放。",
                risk_notes=[],
                last_verified="2026-10-03",
                created_at=NOW - timedelta(days=12),
                updated_at=NOW - timedelta(days=3),
            ),
            row(
                id=3,
                title="渠道成本下降 15%",
                category="实习/工作",
                subject="示例科技有限公司 / 市场运营专员",
                source_fact="渠道台账里单条线索成本从 42 元降到 35 元。",
                candidate_wording="对接 12 家外部渠道，年度渠道成本下降 15%。",
                sources=[],
                responsibility_level="参与",
                verification_status="待确认",
                allowed_uses=["resume"],
                interview_details={
                    "decisions": ["降本靠砍量还是压价"],
                    "difficulties": ["口径还没和财务对齐"],
                    "verification": [],
                    "result": None,
                },
                boundary="尚未与财务口径对齐，先不写进简历。",
                risk_notes=["口径未对齐"],
                last_verified="",
                created_at=NOW - timedelta(days=9),
                updated_at=NOW - timedelta(days=9),
            ),
            row(
                id=4,
                title="单场活动筹备时间从 10 天压缩到 4 天",
                category="实习/工作",
                subject="示例科技有限公司 / 市场运营专员",
                source_fact="SOP 上线前后各 3 场活动的筹备排期表对比。",
                candidate_wording="把活动复盘模板沉淀成 SOP，团队复用后单场筹备时间从 10 天压缩到 4 天。",
                sources=[],
                responsibility_level="负责模块",
                verification_status="已确认",
                allowed_uses=["resume", "interview"],
                interview_details={
                    "decisions": ["9 个检查点是怎么定下来的", "砍掉的 6 天具体来自哪几步"],
                    "difficulties": ["第一版 SOP 太细，执行的人不愿意填"],
                    "verification": ["活动排期表前后对比"],
                    "result": "连续 3 场活动都稳定在 4 到 5 天",
                },
                boundary="压缩的是内部筹备排期，不含外部供应商的交付周期。",
                risk_notes=[],
                last_verified="2026-10-03",
                created_at=NOW - timedelta(days=11),
                updated_at=NOW - timedelta(days=4),
            ),
            row(
                id=5,
                title="内容选题库把高互动选题占比提到 48%",
                category="实习/工作",
                subject="示例文化传播有限公司 / 市场部实习生",
                source_fact="内容后台按打开率与转发率排序的月度统计。",
                candidate_wording="建立内容选题库并按打开率与转发率排序，把高互动选题占比从 25% 提到 48%。",
                sources=[],
                responsibility_level="参与",
                verification_status="已确认",
                allowed_uses=["resume"],
                interview_details={
                    "decisions": ["高互动的判定阈值怎么定"],
                    "difficulties": [],
                    "verification": ["内容后台月度统计截图"],
                    "result": None,
                },
                boundary="实习期主导的是选题库整理，选题决策由带教老师拍板。",
                risk_notes=[],
                last_verified="2026-10-03",
                created_at=NOW - timedelta(days=11),
                updated_at=NOW - timedelta(days=4),
            ),
            row(
                id=6,
                title="校园招聘会到会企业 40 家",
                category="校园经历",
                subject="示例大学学生会宣传部 / 副部长",
                source_fact="招聘会签到表与现场照片，企业到会 40 家、学生 1200 人。",
                candidate_wording="主导校园招聘会的场地与企业邀约，到会企业 40 家、学生 1200 人。",
                sources=[],
                responsibility_level="项目负责人",
                verification_status="已确认",
                allowed_uses=["resume", "interview"],
                interview_details={
                    "decisions": ["40 家邀约名单是怎么筛的", "到会率 92% 靠什么保证"],
                    "difficulties": ["前两周只有 12 家确认，后面靠校友渠道补上"],
                    "verification": ["签到表", "现场照片"],
                    "result": "到会率 92%，高于往届平均水平",
                },
                boundary="场地与经费由学院提供，我负责的是企业邀约与现场调度。",
                risk_notes=[],
                last_verified="2026-09-30",
                created_at=NOW - timedelta(days=8),
                updated_at=NOW - timedelta(days=5),
            ),
        ],
    )
