# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务表：所有"跑起来之后几十秒到几分钟、用户还想干别的事"的入口共用一张登记表。

**为什么需要它（而不是每个入口各建一张表）**：改动前只有简历生成有任务表
（``resume_generate_task``），其余 AI 入口是"请求-响应一体"——连接一断就白跑，
用户既看不到进度、也没有取消入口。若每个入口再各建一张表，前端就得为每种任务写一套
轮询与提醒，取消语义也会各写一遍（这正是本仓当前 4 套前端登记并存的成因）。

所以这里只留**一张**结构统一的表：``kind`` 区分业务，``payload`` 存输入摘要，
``result_ref`` 存"完成后点通知该跳哪"所需的标识（例如 ``{"resume_id": 12}`` /
``{"job_id": 7}``）。业务结果本身仍保存在各自的业务表里（简历、匹配记录、批次快照…），
本表只负责**任务生命周期**——这样清理任务记录永远不需要动业务数据。

**取消是协作式的**：``status=canceled`` 只是结果，不是手段。执行体（见
``services/ai_task_runner.py``）持有一个 ``threading.Event``，任务代码在每个阶段边界与
每次模型输出之间检查它；挂起的模型调用另由 ``RunnerEventLoopHandle`` 跨线程中断。
只改数据库状态而不真的停，会让后端继续把 token 烧完（改动前 job_match 就是这个形态）。

**与 ``resume_generate_task`` 的关系**：那张表承载简历生成的重业务状态（快照、字数、
终态仲裁），本表不复制它。``kind=resume_generate`` 的 handler 以"监管者"身份跟随既有
任务并把它映射成统一状态，避免第二套生成链路。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# ===== 任务类型（新增入口只需在这里加一个常量 + 一个 handler，不改 API 层） =====
AI_TASK_KIND_RESUME_GENERATE = "resume_generate"
AI_TASK_KIND_JOB_MATCH = "job_match"
AI_TASK_KIND_JOB_ANALYSIS = "job_analysis"
#: 简历风险扫描（本地规则 + 可选模型增强，最长 45 秒）。
AI_TASK_KIND_RESUME_RISK = "resume_risk"
#: 简历的「AI 改写/润色」家族里**唯一**任务化的那一支：岗位化修改建议
#: （``POST /resumes/{id}/suggestions``）。逐句润色/翻译不进来，理由见
#: ``services/ai_task_handlers_ai_entries.py`` 的模块 docstring。
AI_TASK_KIND_RESUME_REWRITE = "resume_rewrite"
AI_TASK_KIND_WEBFORM_FILL = "webform_fill"

AI_TASK_KINDS: tuple[str, ...] = (
    AI_TASK_KIND_RESUME_GENERATE,
    AI_TASK_KIND_JOB_MATCH,
    AI_TASK_KIND_JOB_ANALYSIS,
    AI_TASK_KIND_RESUME_RISK,
    AI_TASK_KIND_RESUME_REWRITE,
    AI_TASK_KIND_WEBFORM_FILL,
)

# ===== 状态机 =====
AI_TASK_STATUS_PENDING = "pending"
AI_TASK_STATUS_RUNNING = "running"
AI_TASK_STATUS_SUCCEEDED = "succeeded"
AI_TASK_STATUS_FAILED = "failed"
AI_TASK_STATUS_CANCELED = "canceled"

AI_TASK_STATUSES: tuple[str, ...] = (
    AI_TASK_STATUS_PENDING,
    AI_TASK_STATUS_RUNNING,
    AI_TASK_STATUS_SUCCEEDED,
    AI_TASK_STATUS_FAILED,
    AI_TASK_STATUS_CANCELED,
)

#: 还没到终态的状态：``/active`` 只返回这些，终态迁移只允许从这些状态出发
#: （原子 UPDATE 的 WHERE 条件，见 ``services/ai_task_runner.py``）。
AI_TASK_ACTIVE_STATUSES: tuple[str, ...] = (
    AI_TASK_STATUS_PENDING,
    AI_TASK_STATUS_RUNNING,
)

#: 终态集合（幂等取消与"不覆盖已有终态"的判据）。
AI_TASK_TERMINAL_STATUSES: tuple[str, ...] = (
    AI_TASK_STATUS_SUCCEEDED,
    AI_TASK_STATUS_FAILED,
    AI_TASK_STATUS_CANCELED,
)


class AiTask(Base):
    """一次 AI 任务的登记行。

    字段刻意只有"跨入口通用"的那几个：谁（``kind`` + ``label``）、跑得怎么样
    （``status`` / ``progress`` / ``message`` / ``error``）、怎么重放（``payload``）、
    完成后去哪（``result_ref``）。任何入口私有的东西都进 ``payload`` / ``result_ref``，
    不给这张表加列——加一次列，下一个入口就要跟着迁就一次。
    """

    __tablename__ = "ai_task"

    id: Mapped[int] = mapped_column(primary_key=True)
    # pending/running/succeeded/failed/canceled（取值见模块顶部常量）。
    status: Mapped[str] = mapped_column(String(16), default=AI_TASK_STATUS_PENDING, index=True)
    # resume_generate / job_match / job_analysis / resume_rewrite / webform_fill。
    kind: Mapped[str] = mapped_column(String(32), default="", index=True)
    # 人话说明这是谁的任务（前端页头任务面板直接显示，后端不翻译）。
    label: Mapped[str] = mapped_column(String(256), default="")
    # 0–100 的粗粒度进度：各入口能给出百分比就给，给不出就按阶段递进
    # （准备 10 / 调模型 40 / 落库 90 / 完成 100）。**不是**"还剩几秒"的估算。
    progress: Mapped[int] = mapped_column(Integer, default=0)
    # 当前阶段的一句话（"正在对照岗位要求"），前端显示在进度下面。
    message: Mapped[str] = mapped_column(Text, default="")
    # 输入摘要：只放"重放/展示"必需的标识与选项，**不放**完整 JD 或个人资料正文。
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # 完成后的落点标识：{"resume_id": 12} / {"job_id": 7}；没有落点时为 NULL。
    # 前端据此生成深链（`frontend/src/utils/taskDeepLinks.ts`），任务表本身不认识路由。
    #
    # **没有业务表的那几种入口**（风险扫描 / 岗位化建议 / 网申字段识别）连同结果本身一起
    # 放在这里：它们的结果本来就没有别的落点（扫描报告不入库、建议不入库、预览不入库），
    # 而"用户离开页面回来还能看到结果"要求结果必须有一个进程外的容身处。约定是
    # `{"resume_id": 12, "risk_scan": {…}}`——前缀仍是落点标识，业务负载挂在语义化的键下，
    # **不新开列**（开一列，下一个入口又要跟着迁就一次）。
    result_ref: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 失败/取消原因（**只写原因**，不含"请…"这类引导——那是前端 errorGuidance 的职责）。
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = [
    "AI_TASK_ACTIVE_STATUSES",
    "AI_TASK_KIND_JOB_ANALYSIS",
    "AI_TASK_KIND_JOB_MATCH",
    "AI_TASK_KIND_RESUME_GENERATE",
    "AI_TASK_KIND_RESUME_REWRITE",
    "AI_TASK_KIND_RESUME_RISK",
    "AI_TASK_KIND_WEBFORM_FILL",
    "AI_TASK_KINDS",
    "AI_TASK_STATUSES",
    "AI_TASK_STATUS_CANCELED",
    "AI_TASK_STATUS_FAILED",
    "AI_TASK_STATUS_PENDING",
    "AI_TASK_STATUS_RUNNING",
    "AI_TASK_STATUS_SUCCEEDED",
    "AI_TASK_TERMINAL_STATUSES",
    "AiTask",
]
