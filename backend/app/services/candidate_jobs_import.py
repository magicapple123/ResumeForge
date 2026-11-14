# SPDX-License-Identifier: Apache-2.0
"""从 ``candidate_jobs`` 拆出：把选中的备选岗位导入岗位广场（逐条如实反馈）。

纯搬迁：实现与拆分前逐字一致；``import_candidates`` 仍在 ``candidate_jobs`` 的模块
命名空间里 re-export（路由与测试已有的导入路径不变）。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.job import JOB_STATUS_OPEN
from ..models.material import CANDIDATE_JOB_IMPORTED, CandidateJob
from ..schemas.job import RECOGNITION_SOURCE_OFFICIAL, JobCreate
from .job.job_service import create_job_record, find_job_by_identity
from .job_parser.metadata import job_type_from_title
from .trash import get_live, is_deleted

logger = logging.getLogger(__name__)

# 导入正式岗位时写进 ``Job.recognition_source`` 的来源：采集来的与手动粘贴的分开标注，
# 用户日后回溯"这条是怎么进来的"才有意义。判据是**有没有采集批次**，而不是猜标题。
RECOGNITION_SOURCE_COLLECT = "岗位采集"
RECOGNITION_SOURCE_MANUAL = "备选岗位导入"


def import_candidates(db: Session, candidate_ids: list[int]) -> dict:
    """把选中的候选导入岗位广场：服务端建岗位并回填关联，**逐条如实反馈结果**。

    为什么由服务端建岗位而不是让前端逐条调保存接口：那样"导入 10 条"会变成 10 次网络往返，
    而且中途失败会留下"导入了一半"的状态；这里一次事务做完，任一条的失败都只影响它自己。

    重复判定复用 ``find_job_by_identity``（与采集去重同一份实现）。命中分两种：库里有的直接
    **指向已有岗位**；**在回收站里的**返回独立结果 ``trashed``——既不新建第二条（那是重复的
    来源），也不自动恢复（用户删它是有理由的），而是让界面告诉他去回收站处理。

    原话：
    而不是再造一条——用户勾错了不该在岗位广场里留下第二个副本。
    """
    imported = duplicate = missing = invalid = trashed = 0
    results: list[dict] = []
    # 去重且保序：同一个 id 传两次不该被导入两次。
    for candidate_id in dict.fromkeys(candidate_ids):
        # 已软删的候选按"不存在"处理：它在待办列表里本来就看不到，能导进来只会让用户
        # 莫名其妙地看到一条自己删过的岗位进了岗位广场。
        candidate = get_live(db, CandidateJob, candidate_id)
        if candidate is None:
            missing += 1
            results.append({"candidate_id": candidate_id, "title": "", "outcome": "missing"})
            continue

        existing = find_job_by_identity(
            db,
            title=candidate.title,
            company=candidate.company,
            source_url=candidate.source_url,
        )
        if existing is not None and is_deleted(existing):
            # 岗位广场的**回收站**里已经有一条同名岗位。
            #
            # 刻意**不**新建第二条（那正是重复的来源），也刻意**不**自动恢复它（用户删它是有
            # 理由的）。如实返回一个独立的结果，让界面告诉他去回收站处理。
            trashed += 1
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "trashed",
                    "job_id": existing.id,
                }
            )
            continue
        if existing is not None:
            duplicate += 1
            # 不用 ``mark_candidate_imported``：它自带 commit，逐条提交会让"导入到一半失败"
            # 留下一半已改、一半未改的库。这里只标字段，最后一次提交。
            candidate.status = CANDIDATE_JOB_IMPORTED
            candidate.imported_job_id = existing.id
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "duplicate",
                    "job_id": existing.id,
                }
            )
            continue

        if not candidate.title.strip():
            # 没有岗位名的候选没法成为一个正式岗位（``JobCreate`` 要求标题非空）。
            # 如实说"这条导不了"，而不是给一个空的标题硬塞进去。
            invalid += 1
            results.append(
                {
                    "candidate_id": candidate.id,
                    "title": candidate.title,
                    "outcome": "invalid",
                }
            )
            continue

        job = create_job_record(
            db,
            JobCreate(
                title=candidate.title,
                company=candidate.company,
                location=candidate.location,
                salary=candidate.salary,
                # 岗位类型：标题推断最优先（采集卡片不带类型字段，「实习生」字样是
                # 最强证据，不能让默认值把实习岗标成校招）；推断不出再信采集任务
                # 的透传标注，最后回落「校招」。
                job_type=(job_type_from_title(candidate.title) or candidate.job_type or "校招"),
                source_url=candidate.source_url,
                # 采集回来的 JD 已经按小标题切成两段，直接各归各位；
                # 手动粘贴的候选没有这两段，退回用原文填描述（与以前的导入行为一致）。
                description=candidate.description or candidate.raw_text,
                requirements=candidate.requirements,
                additional_info=candidate.additional_info,
                note=candidate.note,
                status=JOB_STATUS_OPEN,
                recognition_source=(
                    RECOGNITION_SOURCE_COLLECT
                    if candidate.collect_task_id or candidate.source == RECOGNITION_SOURCE_OFFICIAL
                    else RECOGNITION_SOURCE_MANUAL
                ),
            ),
            # 把候选上的来源透传给岗位：采集导入的候选 source 是站点名（如「BOSS直聘」），
            # 与旧采集器直写 `job.source` 的口径一致；不传的话会落到模型默认值「手动添加」，
            # 让"手动添加 vs 自动采集"这件事基于错误数据。
            source=candidate.source,
        )
        candidate.status = CANDIDATE_JOB_IMPORTED
        candidate.imported_job_id = job.id
        imported += 1
        results.append(
            {
                "candidate_id": candidate.id,
                "title": candidate.title,
                "outcome": "imported",
                "job_id": job.id,
            }
        )

    db.commit()
    logger.info(
        "候选导入完成：新建 %s，重复 %s，在回收站里 %s，无效 %s，缺失 %s",
        imported,
        duplicate,
        trashed,
        invalid,
        missing,
    )
    return {
        "imported": imported,
        "duplicate": duplicate,
        "trashed": trashed,
        "invalid": invalid,
        "missing": missing,
        "results": results,
    }
