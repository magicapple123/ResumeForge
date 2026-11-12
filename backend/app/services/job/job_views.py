# SPDX-License-Identifier: Apache-2.0
"""岗位的响应视图：详情（带 JD 全文）与列表行（不带 JD 全文）。

原先长在 ``api/jobs.py``：``services/actions`` 的岗位动作需要同一份视图，只能反向
import 路由模块。视图是"一条岗位对外长什么样"的唯一实现，跟着服务走。
"""

from __future__ import annotations

from ...models.job import Job
from ...schemas.job import JobListOut, JobOut


def job_out(job: Job) -> JobOut:
    return JobOut.model_validate(job)


def job_list_out(job: Job) -> JobListOut:
    # 列表响应不带 JD 全文（体积审计 PR-17）；详情仍走 job_out，JD 全文可达。
    return JobListOut.model_validate(job)


__all__ = ["job_list_out", "job_out"]
