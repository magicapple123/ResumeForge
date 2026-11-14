# SPDX-License-Identifier: Apache-2.0
"""投递批次的纯辅助动作（从 ``task_apply.py`` 纯搬迁）。

为什么独立成模块：``task_apply.py`` 贴着 500 行预算。批次编排（``run_apply`` /
``execute_item``）留在原模块，因为它要通过 ``runner`` 的生命周期与控制信号、
并调用 ``apply_service``；本模块只承载不依赖编排状态的条目/步骤/诊断/暂停辅助，
由原模块再导出（``task_runner`` 与测试按原路径引用）。
"""

from __future__ import annotations

import time
from typing import Any

from ...models.apply import (
    ITEM_STATUS_FAILED,
    STOP_REASON_BREAKER,
    TASK_STATUS_BREAKER_PAUSED,
    TASK_STATUS_PAUSED,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.job import Job
from ...models.profile import utcnow
from ...schemas.apply import ApplyConfigIn
from .. import diagnostics
from .failure_taxonomy import classify_failure


class ItemSkip(Exception):
    """单个条目的软跳过，不计失败且不触发熔断。

    ``category`` 可选：给出时写入条目的 ``failure_category``（状态仍是 ``skipped``），
    让"为什么跳过"有机器可读的分类（如 ``profile_insufficient``），而不是只有一句中文。
    """

    # #39：step / target 与 category 一样是可选的结构化线索；不给就由诊断文本推断。
    def __init__(
        self, detail: str, *, category: str = "", step: str = "", target: str = ""
    ) -> None:
        super().__init__(detail)
        self.category = category
        self.step = step
        self.target = target


def company_key(company: str) -> str:
    """公司名的归一化键：压掉空白、统一大小写。

    招聘网站上的公司名会带前后空格与不同写法（"字节跳动" / "字节跳动 "），不归一化就会
    把同一家公司当成两家，**「同公司只投一个岗位」于是形同虚设**。空名返回空串——
    没有公司名的条目不计入同公司判断（判断不了就不做判断）。
    """
    return " ".join((company or "").split()).casefold()


def same_company_skip_reason(
    config: ApplyConfigIn, item: ApplyTaskItem, attempted: set[str]
) -> str:
    """这条岗位是否该按「同公司只投一个岗位」跳过；不该跳过时返回空串。

    **记的是"尝试过"而不是"成功过"**：投递失败可能发生在确认环节——招呼语其实已经发出去
    了，只是没读到对方的回执。这时再给同一家公司发第二条，才是用户开这个开关要避免的事。
    所以只要动手了，这家公司就算数；方向始终是"宁可少发一条，不可重发一家"。
    """
    if not config.skip_same_company:
        return ""
    key = company_key(item.company)
    if not key or key not in attempted:
        return ""
    return f"按「同公司只投一个岗位」跳过：本批次已经投过「{' '.join(item.company.split())}」的岗位"


def mark_failed(
    session: Any,
    task: ApplyTask,
    item: ApplyTaskItem,
    category: str,
    detail: str,
    *,
    step: str = "",
    target: str = "",
    reason: str = "",
) -> None:
    """把任务项标记为失败并记录失败分类。"""
    # #39：三段稳定码（step/target/reason）。调用方已知的维度优先，其余从分类 +
    # 诊断文本推断（classify_failure）；界面靠子码筛选与给建议。
    codes = classify_failure(category, detail, step=step, target=target, reason=reason)
    item.status = ITEM_STATUS_FAILED
    item.failure_category = category
    item.failure_detail = detail
    item.failure_step = codes.step
    item.failure_target = codes.target
    item.failure_reason = codes.reason
    item.finished_at = utcnow()
    task.processed += 1
    task.failed += 1
    session.commit()


def record_step(
    task: ApplyTask,
    item: ApplyTaskItem,
    step: str,
    *,
    site_key: str,
    adapter_version: str,
    since: float,
) -> None:
    """记录投递链路的一步（``apply.step`` 诊断事件）。

    后台线程没有 request_id，事件靠 ``task_id`` / ``item_id`` 串联（RF-20 的请求级串联
    在这里以任务级字段缓解）。``elapsed_ms`` 是距上一步锚点的耗时。**绝不携带任何资料
    值 / payload**——招呼语、简历字段都不进诊断事件；``diagnostics`` 的键名脱敏只是
    兜底，这里主动不传。
    """
    diagnostics.record_event(
        "apply.step",
        task_id=task.id,
        item_id=item.id,
        step=step,
        site_key=site_key,
        adapter_version=adapter_version,
        elapsed_ms=int((time.monotonic() - since) * 1000),
    )


def adapter_snapshot(session: Any, items: list[ApplyTaskItem], registry: Any) -> dict[str, str]:
    """批次主站点适配器的 ``{key, version}`` 快照；解析不出返回空 dict。

    一个批次在结构上允许跨站点（当前只有 BOSS），这里取**第一条能解析出适配器**的岗位
    作为"主站点"。解析不出（岗位全被删 / 来源不支持）就不写——诊断里宁可缺一项，也不
    伪造一个站点名。版本号是适配器自报的 ``version`` 类属性（``0`` = 未标识）。
    """
    for item in items:
        job = session.get(Job, item.job_id) if item.job_id else None
        if job is None:
            continue
        adapter = registry.resolve_for_job(job)
        if adapter is not None:
            return {
                "key": str(adapter.key),
                "version": str(getattr(adapter, "version", "") or "0"),
            }
    return {}


def pause_with_message(runner: Any, session: Any, task: ApplyTask, message: str) -> None:
    runner._resume.clear()
    task.status = TASK_STATUS_PAUSED
    task.message = message
    session.commit()


def breaker_pause(runner: Any, session: Any, task: ApplyTask, count: int) -> None:
    runner._resume.clear()
    task.status = TASK_STATUS_BREAKER_PAUSED
    task.stop_reason = STOP_REASON_BREAKER
    task.message = f"已因连续 {count} 次失败自动暂停，请查看记录并处理后点击「继续」"
    session.commit()


__all__ = [
    "ItemSkip",
    "adapter_snapshot",
    "breaker_pause",
    "company_key",
    "mark_failed",
    "pause_with_message",
    "record_step",
    "same_company_skip_reason",
]
