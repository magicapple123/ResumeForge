# SPDX-License-Identifier: Apache-2.0
"""模拟面试用例的共用夹具：关联岗位 + 关联简历（0066 起两项都必填）。

单独成模块（照 ``resume_generate_task_support.py`` 的先例）的两个理由：
1. **500 行预算**：`test_interview.py` 已经到了上限，开场夹具每个用例都要用，放在哪个
   测试文件里都会让另一个文件反向 import 自己；
2. **语义**：这不是"某个用例的私有工具"，而是"开一场面试需要准备什么"这一条契约
   （0066 起面试官只读这两份材料，所以开场前必须备好）。
"""

from __future__ import annotations

from app.models.job import Job
from app.models.resume import ResumeRecord


def targets(db_session) -> dict[str, int]:
    """建一个岗位 + 一份关联该岗位的简历，返回开场所需的 ``job_id`` / ``resume_id``。

    直接写 ORM 而不是走 /api/jobs、/api/resumes：测的是面试链路，不该被岗位/简历的
    录入校验牵连（那些有自己的用例）。
    """
    job = Job(title="后端开发工程师", company="示例公司", description="负责服务端接口与稳定性")
    db_session.add(job)
    db_session.commit()
    record = ResumeRecord(
        title="后端版简历",
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        content={"name": "张三", "summary": "3 年后端经验，做过高并发订单系统"},
    )
    db_session.add(record)
    db_session.commit()
    return {"job_id": job.id, "resume_id": record.id}


def start_interview(client, db_session, **overrides):
    """POST /api/interview 的简写：自动带上必填的关联岗位与关联简历。"""
    return client.post("/api/interview", json={**targets(db_session), **overrides})
