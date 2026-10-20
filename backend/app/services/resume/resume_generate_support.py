# SPDX-License-Identifier: Apache-2.0
"""简历生成运行器的**横切支持**：用量汇总日志（审计 PR-07-6，RF-14 §2.2-5）。

从 ``resume_generate_runner.py`` 抽出（原 501 行，触及 500 行预算红线）。这里只放
"与任务状态机无关、纯读取 generator 状态并写一条日志"的辅助函数：

- ``log_generation_usage``：把主生成 / 格式修复 / 质量重试 / 失败与取消各轮次的用量
  合并成一条总口径日志。

**不含业务状态语义**：任务终态仲裁仍在 ``resume_task_state.py``，编排与停止信号仍在
``resume_generate_runner.py``。运行器保留 ``_log_generation_usage`` 薄方法委托，调用点与
测试锚点（``ResumeGenerateRunner()._log_generation_usage(...)``）不变。
"""

from __future__ import annotations

import logging
from typing import Any

from ...services.llm.usage import summarize_usages

logger = logging.getLogger(__name__)


def log_generation_usage(
    task_id: int,
    generator: Any,
    *,
    estimated_prompt_tokens: int | None,
) -> None:
    """多段用量汇总日志（审计 PR-07-6，RF-14 §2.2-5）。

    主生成 / 格式修复 / 质量重试 / 失败与取消轮次的用量在
    ``generator.usage_records`` 里逐段收集（假 Provider 缺该属性时容忍），
    这里合并为一条总口径。token 缺失保留 None（「未知」，不伪造 0）；
    estimated_* 遥测只在估算开启时存在。prompt/response 内容与密钥绝不入日志
    （隐私边界）。
    """
    records = list(getattr(generator, "usage_records", None) or [])
    summary = summarize_usages(records)
    if summary is None:
        return
    fields = [
        f"model={summary['model']}",
        f"prompt_tokens={summary['prompt_tokens']}",
        f"completion_tokens={summary['completion_tokens']}",
        f"total_tokens={summary['total_tokens']}",
        f"elapsed_ms={summary['elapsed_ms']}",
        f"finish_reason={summary['finish_reason']}",
        f"retries={summary['retries']}",
    ]
    if estimated_prompt_tokens is not None:
        fields.append(f"estimated_prompt_tokens={estimated_prompt_tokens}")
    logger.info("简历生成任务模型用量 task_id=%s %s", task_id, " ".join(fields))


__all__ = ["log_generation_usage"]
