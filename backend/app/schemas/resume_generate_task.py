# SPDX-License-Identifier: Apache-2.0
"""简历生成后台任务的对外状态模型。

从 `schemas/resume.py` 拆出（该文件贴着 500 行硬预算）：#30 给任务回执加了一个
`rag` 字段后越线，按既有先例（resume_analysis / resume_creation 等）单列一个模块并在
原文件 re-export，既有 `from app.schemas.resume import GenerateTaskOut` 导入路径不变。
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class GenerateTaskOut(BaseModel):
    """简历生成后台任务的对外状态（前端按 1.5s 轮询）。

    ``status`` 与 ``models.resume`` 的常量一致；``message`` 映射阶段条；``received_chars``
    只计数不做百分比（总长未知）；``rag`` 是 #30 的本次检索回执。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    resume_id: int | None = None
    error: str = ""
    message: str = ""
    received_chars: int = 0
    job_id: int | None = None
    title: str = ""
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    rag: dict | None = None  # #30 本次检索回执（零迁移；见 services/rag/rag_receipt.py）
