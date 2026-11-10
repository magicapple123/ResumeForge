# SPDX-License-Identifier: Apache-2.0
"""体验示例数据集：一键载入纯虚构的小份数据，让新用户立刻"有的可看"。

新装用户的首页是空的：没有岗位、没有简历，所有功能都停在空态。这份示例数据只做
一件事——让引导结束的那一瞬间，**每个页面都有内容可看**（岗位、简历、资料箱、
知识库、面经/题库与网申资料都有内容）。

边界：纯虚构（不含真实个人数据、播种不发网络或模型调用）；独立数据集（主数据一个
字节都不碰，可整份删除）；幂等复用（同 seed_version 直接切回，reused=True，不重复新建）。
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..dataset_registry import MAIN_DATASET_ID, DatasetError, read_metadata, write_metadata
from ..models import (
    ApplicationTrack,
    InterviewExperience,
    Job,
    KnowledgeEntry,
    Material,
    QuestionBankRecord,
    ResumeRecord,
    WebFormProfileEntry,
)
from ..models.job import (
    JOB_STATUS_APPLIED,
    JOB_STATUS_CLOSED,
    JOB_STATUS_OPEN,
)
from ..models.tracker import (
    SOURCE_RECOGNIZED,
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    normalize_key,
)
from .data_backup import restore_directory
from .datasets import activate_dataset, create_dataset, import_dataset, list_datasets
from .resume.resume_sample import sample_resume_content

logger = logging.getLogger(__name__)

SAMPLE_DATASET_NAME = "体验示例"

# 播种内容的版本号：丰富化示例数据后递增。载入时按它判断「已存在的示例数据集
# 是否还是当前版本」——同版本直接复用（reused=True），旧版本走新建流程（旧数据集
# 原样保留，不就地升级：用户可能已经在那份示例上改过内容）。
#
# 3 = 示例简历补齐全部资料字段（性别 / 出生年 / 个人主页 / GitHub / 照片）。
# 只服务"没有内置包"的开发/测试环境；发布环境用包内容 hash 做版本（sample_seed_version）。
SAMPLE_SEED_VERSION = "3"

# 内置示例包（问题清单 §6.7：随包发布，不再保留降级到"代码播种"的发布路径）。
# 它是 scripts/seed_test_dataset.py 的生成物，**禁止手改**；改
# scripts/dataset_seed/** 后必须重新生成（见包目录 README 与测试里的计数守卫）。
_SAMPLE_PACK_RELATIVE = Path("assets") / "sample" / "sample_dataset.zip"


def _sample_pack_path() -> Path | None:
    """内置示例包路径；没有这个文件（开发/测试环境）时返回 None。

    测试用 monkeypatch.setattr 替换它来驱动两条路径（代码播种 / 包导入）。
    """
    path = Path(__file__).resolve().parents[1] / _SAMPLE_PACK_RELATIVE
    return path if path.is_file() else None


def _sample_pack_digest() -> str | None:
    """内置包的 sha256 前 12 位；包不存在时返回 None。

    用**内容 hash** 而不是 exported_at 做版本：重新生成时时间戳会变，内容没变就不该
    算新版本（否则每重新生成一次就多一份「体验示例」，清单 §6.4）。
    """
    path = _sample_pack_path()
    if path is None:
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def sample_seed_version() -> str:
    """当前示例数据的版本号：有内置包用 pack:<sha256 前 12>，否则代码播种版本。"""
    digest = _sample_pack_digest()
    return f"pack:{digest}" if digest is not None else SAMPLE_SEED_VERSION

# 与示例简历同方向的一小段 JD：岗位详情有结构可读即可，不追求覆盖全部字段。
_SAMPLE_JD = """岗位职责：
1. 策划并执行季度主题营销活动，负责选题、预算与落地；
2. 维护渠道台账，按周追踪进量与转化；
3. 把活动经验沉淀成可复用的复盘流程。

任职要求：
1. 本科及以上学历，市场营销相关专业优先；
2. 一年以上市场/运营经验，能独立带小项目；
3. 熟悉 Excel 与基础数据复盘，沟通协作顺畅。"""

_SAMPLE_KEYWORDS = [
    {"name": "活动策划", "category": "职业技能"},
    {"name": "数据复盘", "category": "职业技能"},
    {"name": "Excel", "category": "办公技能"},
    {"name": "沟通协作", "category": "通用能力"},
]

_BACKEND_JD = """岗位职责：
1. 参与校招业务中台的接口设计与开发，与前端协作交付；
2. 编写单元测试与接口文档，参与代码评审；
3. 协助排查线上问题，沉淀排查手册。

任职要求：
1. 本科及以上学历，计算机相关专业；
2. 熟悉至少一门后端语言（Python/Java/Go）与常用数据库；
3. 了解基本的 Web 开发流程，有实习或课程项目经验者优先。"""

_BACKEND_KEYWORDS = [
    {"name": "Python", "category": "编程语言"},
    {"name": "FastAPI", "category": "框架"},
    {"name": "MySQL", "category": "数据库"},
    {"name": "沟通协作", "category": "通用能力"},
]

_PRODUCT_JD = """岗位职责：
1. 协助产品经理完成需求调研与竞品分析；
2. 撰写 PRD 与原型，跟进功能上线后的数据反馈；
3. 整理用户反馈，输出周度汇总。

任职要求：
1. 本科及以上学历，专业不限；
2. 逻辑清晰，文档能力强；
3. 对数据工具（SQL/Excel）有基础了解者优先。"""


def _seed_jobs(db) -> list[Job]:
    """播种 4 个不同状态/来源的岗位（状态取值都在 JOB_STATUSES 白名单内）。"""
    jobs = [
        Job(
            title="市场运营专员",
            company="示例科技有限公司",
            location="上海",
            salary="8k-12k",
            job_type="校招",
            description=_SAMPLE_JD,
            keywords=_SAMPLE_KEYWORDS,
            recognition_source="手动填写",
            status=JOB_STATUS_OPEN,
        ),
        Job(
            title="后端开发工程师",
            company="示例网络科技股份有限公司",
            location="杭州",
            salary="15k-20k",
            job_type="校招",
            description=_BACKEND_JD,
            keywords=_BACKEND_KEYWORDS,
            recognition_source="粘贴文本识别",
            status=JOB_STATUS_APPLIED,
        ),
        Job(
            title="产品实习生",
            company="示例数据服务有限公司",
            location="北京",
            salary="200元/天",
            job_type="实习",
            description=_PRODUCT_JD,
            recognition_source="手动填写",
            status=JOB_STATUS_OPEN,
        ),
        Job(
            title="数据分析师",
            company="示例信息科技有限公司",
            location="深圳",
            salary="10k-15k",
            job_type="社招",
            description="负责业务数据的日常报表与专题分析，输出可执行的运营建议。",
            recognition_source="粘贴文本识别",
            status=JOB_STATUS_CLOSED,
        ),
    ]
    db.add_all(jobs)
    db.flush()
    return jobs


def _seed_resumes(db, job: Job) -> list[ResumeRecord]:
    """播种 2 份简历：一份挂在岗位上，一份通用（job_id 为空）。"""
    content = sample_resume_content().model_dump()
    attached = ResumeRecord(
        title="示例简历 · 市场运营",
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        content=content,
        # 示例内容用户可以直接改：按"手动"归档，不冒充 AI 生成。
        source="manual",
    )
    general = ResumeRecord(
        title="示例通用简历",
        content=content,
        source="manual",
    )
    db.add_all([attached, general])
    db.flush()
    return [attached, general]


def _seed_tracks(db, jobs: list[Job], resume: ResumeRecord) -> None:
    """播种 3 条求职进度，覆盖不同阶段状态（状态都在 tracker STATUSES 白名单内）。"""
    backend_job = next(job for job in jobs if job.title == "后端开发工程师")
    product_job = next(job for job in jobs if job.title == "产品实习生")
    analyst_job = next(job for job in jobs if job.title == "数据分析师")
    db.add_all(
        [
            ApplicationTrack(
                company=backend_job.company,
                title=backend_job.title,
                company_key=normalize_key(backend_job.company),
                title_key=normalize_key(backend_job.title),
                status=STATUS_INTERVIEW,
                stage_note="技术一面",
                applied_at="2026-03-02",
                status_date="2026-03-18",
                next_action="准备二面，复习项目细节",
                next_action_date="2026-03-25",
                note="示例进度：面试官主要围绕课程项目提问。",
                evidence="示例通知：恭喜您进入技术面试环节。",
                job_id=backend_job.id,
                resume_id=resume.id,
                resume_title=resume.title,
                source=SOURCE_RECOGNIZED,
            ),
            ApplicationTrack(
                company=product_job.company,
                title=product_job.title,
                company_key=normalize_key(product_job.company),
                title_key=normalize_key(product_job.title),
                status=STATUS_APPLIED,
                applied_at="2026-03-10",
                next_action="等待笔试通知",
                note="示例进度：官网渠道投递，暂无回音。",
                evidence="示例通知：已收到您的申请。",
                job_id=product_job.id,
                resume_id=resume.id,
                resume_title=resume.title,
            ),
            ApplicationTrack(
                company=analyst_job.company,
                title=analyst_job.title,
                company_key=normalize_key(analyst_job.company),
                title_key=normalize_key(analyst_job.title),
                status=STATUS_OFFER,
                applied_at="2026-02-20",
                status_date="2026-03-12",
                note="示例进度：已收到录用意向，等待三方协议。",
                evidence="示例通知：我们非常期待您的加入。",
                job_id=analyst_job.id,
                resume_id=resume.id,
                resume_title=resume.title,
            ),
        ]
    )


def _seed_materials(db) -> None:
    """播种 3 条文本型素材（不塞附件，files 保持为空列表）。"""
    db.add_all(
        [
            Material(
                title="示例素材 · 六级成绩单信息",
                category="证书",
                content="示例内容：CET-6 成绩 580 分（虚构），证书编号 EXAMPLE-2025-0001。",
                note="示例备注：网申常填，随手备一份文字版。",
            ),
            Material(
                title="示例素材 · 个人作品集链接",
                category="链接",
                url="https://portfolio.example.com/demo",
                content="示例内容：课程项目与设计作品合集（虚构链接，仅作占位）。",
            ),
            Material(
                title="示例素材 · 求职周记",
                category="笔记",
                content="示例内容：本周完成了 3 份网申，复盘了 1 场模拟面试（虚构）。",
            ),
        ]
    )


def _seed_knowledge(db) -> None:
    """播种 3 条知识库条目（分类与标签都是自由文本）。"""
    db.add_all(
        [
            KnowledgeEntry(
                title="示例知识 · 网申开放题答题框架",
                category="求职方法",
                tags=["示例", "网申"],
                content="示例内容：开放题按「情境-任务-行动-结果」四段组织，先结论后细节。",
                source="手动录入",
            ),
            KnowledgeEntry(
                title="示例知识 · 常见面试问题清单",
                category="面试准备",
                tags=["示例", "面试"],
                content="示例内容：自我介绍、项目深挖、职业规划三类问题各准备一版 1 分钟回答。",
                source="手动录入",
            ),
            KnowledgeEntry(
                title="示例知识 · 目标行业速览",
                category="行业认知",
                tags=["示例"],
                content="示例内容：记录目标行业的头部公司、典型岗位与能力要求（虚构）。",
                source="手动录入",
            ),
        ]
    )


def _seed_interview_experience(db, job: Job) -> None:
    """播种 1 条面经（问题清单随条目一起保存）。"""
    db.add(
        InterviewExperience(
            title="示例面经 · 后端开发工程师一面",
            company=job.company,
            position=job.title,
            job_id=job.id,
            content=(
                "示例内容：面试官先让我做了自我介绍，随后围绕课程项目追问了数据库设计与"
                "接口实现，最后出了一道基础算法题（虚构）。"
            ),
            questions=[
                "示例问题：介绍一个你最有成就感的项目？",
                "示例问题：数据库索引在什么情况下会失效？",
                "示例问题：手写一个去重并排序的函数。",
            ],
            tags=["示例", "一面"],
            source="self",
            difficulty="中等",
            round_type="一面",
            interview_date="2026-03-18",
        )
    )


def _seed_question_bank(db, job: Job, resume: ResumeRecord) -> None:
    """播种 1 条历史题库记录（模拟一次「保存题库」的落库结果）。"""
    db.add(
        QuestionBankRecord(
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            resume_id=resume.id,
            resume_title=resume.title,
            groups=[
                {
                    "type": "基础题",
                    "questions": [
                        {
                            "question": "示例问题：请做一个一分钟的自我介绍。",
                            "purpose": "示例说明：开场暖场并核对简历要点。",
                            "answer_hint": "示例提示：按教育、项目、技能三条线展开。",
                        }
                    ],
                },
                {
                    "type": "项目题",
                    "questions": [
                        {
                            "question": "示例问题：项目中你负责的部分最大的难点是什么？",
                            "purpose": "示例说明：验证真实参与度。",
                            "answer_hint": "示例提示：讲清楚约束、方案与结果。",
                        }
                    ],
                },
            ],
            model="",
        )
    )


def _seed_web_form_profile(db) -> None:
    """播种少量「网申资料」值（key 都是补充资料目录里的字段，纯虚构）。"""
    db.add_all(
        [
            WebFormProfileEntry(field_key="student_id", value="202301001"),
            WebFormProfileEntry(field_key="height", value="175"),
            WebFormProfileEntry(field_key="specialty", value="示例特长：视频拍摄与剪辑（虚构）"),
        ]
    )


def _find_reusable_sample_dataset() -> str | None:
    """已存在的「当前播种版本」示例数据集 id；旧版本/主数据不算。"""
    version = sample_seed_version()
    for dataset in list_datasets():
        dataset_id = dataset.get("id", "")
        if dataset_id == MAIN_DATASET_ID or dataset.get("source") != "sample":
            continue
        metadata = read_metadata(dataset_id)
        if metadata.get("seed_version") == version:
            return dataset_id
    return None


def load_sample_dataset(bind: Engine) -> dict[str, Any]:
    """载入「体验示例」数据集并切换过去；已存在同版本示例时直接复用。

    返回切换后的数据集描述（带 sample: True 标记）；reused 表示这次是**回到已有**的
    示例数据集而不是新建（前端据此把提示从"已创建"改成分流措辞，旧后端没有这个字段，
    前端按可选处理）。调用方是本机 API。

    有内置包（backend/app/assets/sample/sample_dataset.zip，随包发布）时优先走导入
    管线（包是完整演示数据的唯一真源）；没有包（开发/测试环境）才回退代码播种。
    """
    reusable_id = _find_reusable_sample_dataset()
    if reusable_id is not None:
        activated = activate_dataset(reusable_id, bind)
        logger.info("复用已有体验示例数据集 id=%s", reusable_id)
        return {**activated, "sample": True, "reused": True}

    pack_path = _sample_pack_path()
    if pack_path is not None:
        return _load_sample_from_pack(pack_path, bind)
    return _load_sample_from_code(bind)


def _load_sample_from_pack(pack_path: Path, bind: Engine) -> dict[str, Any]:
    """从内置包导入一份新的「体验示例」并切换过去（清单 §6.3 的随包发布路径）。

    复用备份导入管线（先验后写、失败回滚、候选库迁移到 head、附件恢复），格式校验/
    epoch 闸门/附件 sha256 复核都不必重写。导入写死的 source="导入" 在这里覆写为
    "sample"；restore_directory 与上传导入接口用同一个暂存目录（同盘才能原子改名）。
    """
    version = sample_seed_version()
    try:
        info = import_dataset(
            pack_path, SAMPLE_DATASET_NAME, bind, restore_directory(bind)
        )
    except Exception as exc:  # noqa: BLE001 - 包存在却导不进来必须明确失败
        # §6.3：**不得静默回退代码播种**——否则用户以为载入成功，内容却不是完整示例。
        raise DatasetError(f"体验示例数据包导入失败：{exc}") from exc
    metadata = read_metadata(info["id"])
    metadata["source"] = "sample"
    metadata["seed_version"] = version
    write_metadata(info["id"], metadata)
    activated = activate_dataset(info["id"], bind)
    logger.info("已从内置包载入体验示例 dataset=%s version=%s", info["id"], version)
    return {**activated, "sample": True, "reused": False}


def _load_sample_from_code(bind: Engine) -> dict[str, Any]:
    """代码播种（没有内置包时）：4 岗位 / 2 简历的旧示例，保持原行为不变。"""
    info = create_dataset(SAMPLE_DATASET_NAME, bind)
    # 数据集注册表是 JSON 元数据（不是数据库迁移）：source 覆写为 "sample"、
    # seed_version 记录播种版本；页头与数据集列表据此显示「示例」标识并判断复用。
    metadata = read_metadata(info["id"])
    metadata["source"] = "sample"
    metadata["seed_version"] = SAMPLE_SEED_VERSION
    write_metadata(info["id"], metadata)
    activated = activate_dataset(info["id"], bind)

    with database.SessionLocal() as db:
        # SessionLocal 是原地改绑的（见 database.rebind）：这里拿到的已经是新库。
        jobs = _seed_jobs(db)
        resumes = _seed_resumes(db, jobs[0])
        _seed_tracks(db, jobs, resumes[0])
        _seed_materials(db)
        _seed_knowledge(db)
        _seed_interview_experience(db, jobs[1])
        _seed_question_bank(db, jobs[1], resumes[0])
        _seed_web_form_profile(db)
        db.commit()
        logger.info(
            "体验示例数据已写入 dataset=%s jobs=%d resumes=%d",
            info["id"],
            len(jobs),
            len(resumes),
        )
    return {**activated, "sample": True, "reused": False}


__all__ = [
    "SAMPLE_DATASET_NAME",
    "SAMPLE_SEED_VERSION",
    "load_sample_dataset",
    "sample_seed_version",
]
