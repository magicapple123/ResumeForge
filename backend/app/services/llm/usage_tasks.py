# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本·任务分类与环境任务（从 usage_ledger 拆分，控制单文件 ≤500 行）。

拆分理由：``usage_ledger.py`` 的写入/查询/汇总已接近行数预算
（``tests/test_file_size_budget.py`` 上限 500 行），而"这一跳属于哪个 AI 任务"是独立
职责：任务名常量、HTTP 路径映射、ContextVar 与 provider 旁路上报可以单独放。拆开
之后 ``usage_ledger`` 仍是唯一写入实现，本模块只负责任务归类与"调用发生"这一事实。
"""

from __future__ import annotations

import contextvars
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


# 任务类别（前端按这些值做分组；未知任务原样保留，不丢数据）。
TASK_RESUME_GENERATE = "resume_generate"
TASK_RESUME_REVISE = "resume_revise"
TASK_RESUME_SUGGESTIONS = "resume_suggestions"
TASK_RESUME_TRANSLATE = "resume_translate"
TASK_RESUME_OPTIMIZE = "resume_optimize"
TASK_ASSISTANT = "assistant"
TASK_UNKNOWN = "unknown"
TASK_RESUME_WRITING = "resume_writing"
TASK_RESUME_RISK = "resume_risk"
TASK_RESUME_SCENARIO = "resume_scenario"
TASK_JOB_PARSE = "job_parse"
TASK_JOB_ANALYSIS = "job_analysis"
TASK_JOB_MATCH = "job_match"
TASK_INTERVIEW = "interview"
TASK_WEBFORM = "webform"
TASK_CLAIMS = "claims"
TASK_TRACKER = "tracker"
TASK_PROFILE_PARSE = "profile_parse"
TASK_DRILL = "drill"
TASK_APPLY = "apply"
TASK_TEMPLATE = "resume_template"


# ===== 环境任务（R04-补全）：按请求路径确定任务名，provider 每次调用自动落账 =====
#
# 为什么需要在 provider 层兜底：AI 端点分散在生成（SSE/后台任务）、写作增强、岗位解析/
# 匹配、面试、网申、台账、解析等二十余条路径上，逐端点手写记录既容易漏（本轮实测 27 次
# 真实调用只落了 1 条修订记录），也无法覆盖服务层内部的二次调用。这里把"调用发生"的
# 事实收敛成 provider._record_usage() 的一次统一上报：任务名由 HTTP 中间件按路径写入
# 环境变量（ContextVar），后台线程（生成任务/批量匹配）启动时复制启动方 contextvars，
# 因此同样能取到任务名。没有环境任务的调用（例如 llm 层单测直接构造 provider）不落账，
# 避免测试污染与"测试连接"之外的意外写入。
_AMBIENT_TASK: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "rf_llm_usage_task", default=None
)


def set_ambient_task(task: str | None) -> None:
    """由 HTTP 中间件/后台运行器在调用链开始处写入本次 AI 任务名。"""
    _AMBIENT_TASK.set(task)


def ambient_task() -> str | None:
    return _AMBIENT_TASK.get()


# 路径 → 任务名（只做前缀/正则匹配；未列出的 /api 路径记 unknown，非 API 不落账）。
# 顺序即优先级：更具体的写在前面。
_TASK_ROUTES: tuple[tuple[str, str | None], ...] = (
    (
        r"^/api/resumes/\d+/writing/(star|phrases|polish|rewrite-field|translate)$",
        TASK_RESUME_WRITING,
    ),
    (r"^/api/writing/polish-selection$", TASK_RESUME_WRITING),
    (r"^/api/resumes/\d+/suggestions$", TASK_RESUME_SUGGESTIONS),
    # /revise 由端点手工记账（需要 resume_id 关联），这里返回 None 让自动记账让路。
    (r"^/api/resumes/\d+/revise$", None),
    (r"^/api/resumes/\d+/risk-scan$", TASK_RESUME_RISK),
    (r"^/api/resumes/\d+/scenario-variants", TASK_RESUME_SCENARIO),
    (r"^/api/resumes/generate($|/)", TASK_RESUME_GENERATE),
    (r"^/api/interview", TASK_INTERVIEW),
    (r"^/api/jobs/parse-(text|multiple)$", TASK_JOB_PARSE),
    (r"^/api/jobs/\d+/analysis$", TASK_JOB_ANALYSIS),
    (r"^/api/jobs/\d+/match-analysis$", TASK_JOB_MATCH),
    (r"^/api/jobs/match-batch", TASK_JOB_MATCH),
    (r"^/api/job-match", TASK_JOB_MATCH),
    (r"^/api/webform", TASK_WEBFORM),
    (r"^/api/claims/draft$", TASK_CLAIMS),
    (r"^/api/tracker/parse$", TASK_TRACKER),
    (r"^/api/profile/parse-text$", TASK_PROFILE_PARSE),
    (r"^/api/drill", TASK_DRILL),
    (r"^/api/apply/greeting", TASK_APPLY),
    (r"^/api/resume-templates", TASK_TEMPLATE),
    (r"^/api/assistant", TASK_ASSISTANT),
)


def task_for_path(path: str) -> str | None:
    """HTTP 路径 → 任务名；非 /api 路径返回 None（不落账）。"""
    if not path.startswith("/api/"):
        return None
    # 设置页的「测试连接 / 思考能力检测」是配置自检，不是用户对 AI 功能的消耗，
    # 不进入用量统计（否则每点一次测试就会多一条记录）。
    if path.startswith("/api/settings/"):
        return None
    for pattern, task in _TASK_ROUTES:
        if re.search(pattern, path):
            return task
    return TASK_UNKNOWN


def record_ambient_usage(provider: Any) -> None:
    """provider 每完成一次模型调用就落一条账；失败只记日志，绝不影响业务结果。"""
    task = _AMBIENT_TASK.get()
    if not task:
        return
    try:
        # 延迟导入：usage_ledger 是 services.llm 的叶子模块，database 会反向 import 模型层，
        # 放在函数内避免导入环（provider 层 -> usage_ledger -> database -> ...）。
        from ...database import SessionLocal
        from .usage_ledger import record_provider_usage

        with SessionLocal() as db:
            record_provider_usage(db, task=task, provider=provider)
    except Exception:  # noqa: BLE001 - 账本是旁路，绝不反向破坏模型调用
        logger.warning("模型用量自动记录失败 task=%s", task, exc_info=True)


__all__ = [
    "TASK_APPLY",
    "TASK_ASSISTANT",
    "TASK_CLAIMS",
    "TASK_DRILL",
    "TASK_INTERVIEW",
    "TASK_JOB_ANALYSIS",
    "TASK_JOB_MATCH",
    "TASK_JOB_PARSE",
    "TASK_PROFILE_PARSE",
    "TASK_RESUME_GENERATE",
    "TASK_RESUME_OPTIMIZE",
    "TASK_RESUME_REVISE",
    "TASK_RESUME_RISK",
    "TASK_RESUME_SCENARIO",
    "TASK_RESUME_SUGGESTIONS",
    "TASK_RESUME_TRANSLATE",
    "TASK_RESUME_WRITING",
    "TASK_TEMPLATE",
    "TASK_TRACKER",
    "TASK_UNKNOWN",
    "TASK_WEBFORM",
    "ambient_task",
    "record_ambient_usage",
    "set_ambient_task",
    "task_for_path",
]
