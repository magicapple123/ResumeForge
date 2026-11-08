# SPDX-License-Identifier: Apache-2.0
"""简历生成的后台输入重建（F3 §1/RF-03）：`resume_generate_runner` 的纯搬家产物。

**为什么单独成模块**：runner 已 499/500 行，而本批要在 `consume()` 里接入 RAG
（算 scope + 包住首次事件）。把"从任务行重建冻结输入"这段搬运出去，runner 只保留
薄委托，既腾出行数预算，也保持"有冻结快照时只消费快照、绝不重读当前组"的契约不变。

**行为逐字不变**：函数体从 runner 原样搬出（含全部注释与失败分支），原模块
`resume_generate_runner._snapshot` 委托到这里并 re-export `prepare_generate_inputs`，
旧 import 路径仍可用（有测试钉住）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ...models.job import Job
from ...models.resume import ResumeGenerateTask
from ...schemas.job import JobOut
from ...schemas.profile_projection import ConsumedProfile
from ...services import trash
from ...services.claims import build_baseline
from ...services.llm import create_provider
from ...services.profile.profile_service import get_profile_detail, to_profile_out
from ...services.resume.generate_snapshot import (
    GenerationSnapshot,
    consumed_has_content,
    snapshot_entry_ids,
)
from ...services.settings_service import get_llm_config

#: 返回顺序：job_out / profile_out / baseline / provider / fact_sections / consumed。
GenerateInputs = tuple[JobOut | None, Any, Any, Any, dict[str, Any] | None, ConsumedProfile | None]


class ResumeGenerateInputError(Exception):
    """输入重建的可预期失败（岗位已删、未配置模型、资料为空等），message 可直接展示。"""


def prepare_generate_inputs(
    session: Any,
    task: ResumeGenerateTask,
    *,
    generation_snapshot: GenerationSnapshot | None,
    provider_factory: Callable[[Any], Any] = create_provider,
    baseline_builder: Callable[..., Any] = build_baseline,
) -> GenerateInputs:
    """重建生成输入；有冻结快照时只消费它（F3 §1：worker 不再解析当前组）。

    `provider_factory` / `baseline_builder` 由调用方注入：runner 传它**模块命名空间**里
    的 `create_provider` / `build_baseline`，既有测试
    `monkeypatch.setattr("…resume_generate_runner.create_provider|build_baseline")`
    因此继续生效——搬移不得静默失效 monkeypatch 锚点（AGENTS.md 纪律）。

    失败抛 :class:`ResumeGenerateInputError`（`str(exc)` 作为任务 error 文案）。
    """
    job = session.get(Job, task.job_id) if task.job_id is not None else None
    if task.job_id is not None and (job is None or trash.is_deleted(job)):
        raise ResumeGenerateInputError("岗位不存在或已被删除")
    job_out = JobOut.model_validate(job) if job is not None else None
    config = get_llm_config(session)
    if not config.base_url or not config.model:
        raise ResumeGenerateInputError("尚未配置大模型 API")
    provider = provider_factory(config)
    frozen = generation_snapshot
    if frozen is not None:
        if not consumed_has_content(frozen.consumed):
            raise ResumeGenerateInputError("个人资料为空，无法生成简历")
        # F3 契约 §4：台账基线只带入能关联本次快照条目的正向事实。
        baseline = baseline_builder(session, source_entry_ids=snapshot_entry_ids(frozen.consumed))
        return job_out, None, baseline, provider, None, frozen.consumed
    # 旧 ProfileOut 路径（legacy 兼容；生产链路始终有冻结快照）。
    # 补充事实已在 2.0 删除，fact_sections 恒为 None。
    baseline = baseline_builder(session)
    profile_out = to_profile_out(get_profile_detail(session))
    return job_out, profile_out, baseline, provider, None, None


__all__ = ["GenerateInputs", "ResumeGenerateInputError", "prepare_generate_inputs"]
