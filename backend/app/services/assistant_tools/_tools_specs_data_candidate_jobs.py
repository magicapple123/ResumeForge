# SPDX-License-Identifier: Apache-2.0
"""备选岗位（candidate jobs）工具声明：列出 / 读取 / 新建 / 修改 / 导入成正式岗位。

T28 收尾批：5 对全部迁入 action 契约层（``actions/domains/candidate_jobs.py``）。
参数/权限/preview/service_entry 的唯一真源是那边的 ``ActionSpec``；本文件只按原顺序
把 ``as_tool(...)`` 的结果拼回注册表。
"""

from __future__ import annotations

from ..actions.domains.candidate_jobs import candidate_job_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

# 一次构建（幂等、可重入），再按原声明顺序取工具——顺序是提示词契约，不得重排。
_ACTIONS = candidate_job_actions()

CANDIDATE_JOB_TOOLS: tuple[Tool, ...] = (
    as_tool(_ACTIONS["list_candidate_jobs"]),
    as_tool(_ACTIONS["get_candidate_job"]),
    as_tool(_ACTIONS["create_candidate_job"]),
    as_tool(_ACTIONS["update_candidate_job"]),
    as_tool(_ACTIONS["import_candidate_job"]),
)

__all__ = ["CANDIDATE_JOB_TOOLS"]

