# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本·任务归类与"调用发生"上报（兼容壳 + 落库入口）。

拆分历史：本模块原本同时承载"任务名常量 + 路径映射 + ContextVar"与"provider 旁路落账"。
前一半（上下文与纯映射）在 RF-08b 下沉到 :mod:`app.runtime.usage_context`——HTTP 中间件
要在每个 ``/api/`` 请求入口写这两个 ContextVar，而它不该为了打一个标签反向依赖整个账本
（SQLAlchemy 模型、单价、汇总）。落库留在这里：账本是 ``services`` 的事，``runtime`` 里
不允许出现一行 IO。

对外符号一个都没少：``from app.services.llm.usage_tasks import task_for_path`` 一类既有
导入路径继续可用，且拿到的是 ``runtime.usage_context`` 里的同一份对象（同一张映射表、
同一个 ContextVar），不是副本——中间件写的值 provider 一定读得到。
"""

from __future__ import annotations

import logging
from typing import Any

from ...runtime.usage_context import (
    DEFAULT_AUDIT_BUDGET as DEFAULT_AUDIT_BUDGET,
)
from ...runtime.usage_context import (
    DEFAULT_AUDIT_LANGUAGE as DEFAULT_AUDIT_LANGUAGE,
)
from ...runtime.usage_context import (
    JOB_ANALYSIS_TOKEN_BUDGET as JOB_ANALYSIS_TOKEN_BUDGET,
)
from ...runtime.usage_context import (
    SETTINGS_PROBE_TOKEN_BUDGET as SETTINGS_PROBE_TOKEN_BUDGET,
)
from ...runtime.usage_context import (
    TASK_APPLY as TASK_APPLY,
)
from ...runtime.usage_context import (
    TASK_ASSISTANT as TASK_ASSISTANT,
)
from ...runtime.usage_context import (
    TASK_CLAIMS as TASK_CLAIMS,
)
from ...runtime.usage_context import (
    TASK_DRILL as TASK_DRILL,
)
from ...runtime.usage_context import (
    TASK_INTERVIEW as TASK_INTERVIEW,
)
from ...runtime.usage_context import (
    TASK_JOB_ANALYSIS as TASK_JOB_ANALYSIS,
)
from ...runtime.usage_context import (
    TASK_JOB_MATCH as TASK_JOB_MATCH,
)
from ...runtime.usage_context import (
    TASK_JOB_PARSE as TASK_JOB_PARSE,
)
from ...runtime.usage_context import (
    TASK_PROFILE_PARSE as TASK_PROFILE_PARSE,
)
from ...runtime.usage_context import (
    TASK_RESUME_GENERATE as TASK_RESUME_GENERATE,
)
from ...runtime.usage_context import (
    TASK_RESUME_OPTIMIZE as TASK_RESUME_OPTIMIZE,
)
from ...runtime.usage_context import (
    TASK_RESUME_REVISE as TASK_RESUME_REVISE,
)
from ...runtime.usage_context import (
    TASK_RESUME_RISK as TASK_RESUME_RISK,
)
from ...runtime.usage_context import (
    TASK_RESUME_SCENARIO as TASK_RESUME_SCENARIO,
)
from ...runtime.usage_context import (
    TASK_RESUME_SUGGESTIONS as TASK_RESUME_SUGGESTIONS,
)
from ...runtime.usage_context import (
    TASK_RESUME_TRANSLATE as TASK_RESUME_TRANSLATE,
)
from ...runtime.usage_context import (
    TASK_RESUME_WRITING as TASK_RESUME_WRITING,
)
from ...runtime.usage_context import (
    TASK_SETTINGS_PROBE as TASK_SETTINGS_PROBE,
)
from ...runtime.usage_context import (
    TASK_TEMPLATE as TASK_TEMPLATE,
)
from ...runtime.usage_context import (
    TASK_TRACKER as TASK_TRACKER,
)
from ...runtime.usage_context import (
    TASK_UNKNOWN as TASK_UNKNOWN,
)
from ...runtime.usage_context import (
    TASK_WEBFORM as TASK_WEBFORM,
)
from ...runtime.usage_context import (
    ambient_scope as ambient_scope,
)
from ...runtime.usage_context import (
    ambient_task as ambient_task,
)
from ...runtime.usage_context import (
    budget_for_ai_kind as budget_for_ai_kind,
)
from ...runtime.usage_context import (
    scope_for_path as scope_for_path,
)
from ...runtime.usage_context import (
    set_ambient_scope as set_ambient_scope,
)
from ...runtime.usage_context import (
    set_ambient_task as set_ambient_task,
)
from ...runtime.usage_context import (
    task_for_ai_kind as task_for_ai_kind,
)
from ...runtime.usage_context import (
    task_for_path as task_for_path,
)

logger = logging.getLogger(__name__)


def record_ambient_usage(provider: Any) -> None:
    """provider 每完成一次模型调用就落一条账；失败只记日志，绝不影响业务结果。"""
    task = ambient_task()
    if not task:
        return
    # #35：把 ContextVar 里的数据边界四字段一并落库，否则它们只活在日志里，
    # 「模型用量」界面与接口事后无法自证这次调用喂了什么。缺项保持"未声明"语义
    # （空串 / None），绝不填一个看起来合理的默认值。
    scope = ambient_scope()
    masked = scope.get("masked")
    budget = scope.get("budget")
    try:
        # 延迟导入：usage_ledger 是 services.llm 的叶子模块，database 会反向 import 模型层，
        # 放在函数内避免导入环（provider 层 -> usage_ledger -> database -> ...）。
        from ...database import SessionLocal
        from .usage_ledger import record_provider_usage

        with SessionLocal() as db:
            record_provider_usage(
                db,
                task=task,
                provider=provider,
                input_scope=str(scope.get("input_scope") or ""),
                masked=masked if isinstance(masked, bool) else None,
                language=str(scope.get("language") or ""),
                budget=budget if isinstance(budget, int) else None,
            )
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
    "TASK_SETTINGS_PROBE",
    "TASK_TEMPLATE",
    "TASK_TRACKER",
    "TASK_UNKNOWN",
    "TASK_WEBFORM",
    "DEFAULT_AUDIT_BUDGET",
    "DEFAULT_AUDIT_LANGUAGE",
    "JOB_ANALYSIS_TOKEN_BUDGET",
    "SETTINGS_PROBE_TOKEN_BUDGET",
    "ambient_scope",
    "ambient_task",
    "budget_for_ai_kind",
    "record_ambient_usage",
    "set_ambient_scope",
    "set_ambient_task",
    "scope_for_path",
    "task_for_ai_kind",
    "task_for_path",
]
