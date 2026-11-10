# SPDX-License-Identifier: Apache-2.0
"""生成成本与耗时（清单 §17.3-C7，2026-11-10 第 17 条）。

数据源是 llm_usage_record（本地用量账本）。**只报 token 与耗时，不报金额**：本库没有
价格表，凭记忆写一个单价就是编的；账本里真实存在的是 token 数与 duration_ms。

口径：

- generate_calls / generate_completion_tokens / generate_avg_duration_ms 只统计
  task = resume_generate（"生成一份简历"的主路径，含格式修复/篇幅压缩等同一任务下的多跳）；
- total_calls / total_tokens 是全账本口径，用来说明"生成在全部 AI 消耗里占多大"；
- by_model 只按 resume_generate 分组：换了模型之后"平均一份简历多少 token/多少秒"
  应该分模型看，混在一起会被旧账拉偏。
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.llm_usage import LLMUsageRecord
from .llm.usage_tasks import TASK_RESUME_GENERATE


def generation_cost(db: Session) -> dict:
    """生成一份简历的平均 token / 耗时 + 全账本口径。

    空账本时全部是明确的 0 / 空列表（不是 None）——前端据此渲染空态。
    """
    generate_filter = LLMUsageRecord.task == TASK_RESUME_GENERATE
    generate_calls, generate_completion, generate_duration = (
        db.query(
            func.count(LLMUsageRecord.id),
            func.coalesce(func.sum(LLMUsageRecord.completion_tokens), 0),
            func.coalesce(func.avg(LLMUsageRecord.duration_ms), 0),
        )
        .filter(generate_filter)
        .one()
    )
    total_calls, total_tokens = db.query(
        func.count(LLMUsageRecord.id),
        func.coalesce(func.sum(LLMUsageRecord.total_tokens), 0),
    ).one()
    model_rows = (
        db.query(
            LLMUsageRecord.model,
            func.count(LLMUsageRecord.id),
            func.coalesce(func.sum(LLMUsageRecord.completion_tokens), 0),
            func.coalesce(func.avg(LLMUsageRecord.duration_ms), 0),
        )
        .filter(generate_filter)
        .group_by(LLMUsageRecord.model)
        .order_by(func.count(LLMUsageRecord.id).desc())
        .all()
    )
    generate_calls = int(generate_calls or 0)
    return {
        "generate_calls": generate_calls,
        "generate_completion_tokens": int(generate_completion or 0),
        "generate_avg_duration_ms": int(generate_duration or 0),
        "total_calls": int(total_calls or 0),
        "total_tokens": int(total_tokens or 0),
        "by_model": [
            {
                "model": str(model or ""),
                "calls": int(calls or 0),
                "completion_tokens": int(completion or 0),
                "avg_duration_ms": int(avg_duration or 0),
            }
            for model, calls, completion, avg_duration in model_rows
        ],
    }


__all__ = ["generation_cost"]
