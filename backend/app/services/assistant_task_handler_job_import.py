# SPDX-License-Identifier: Apache-2.0
"""#18A job_import 的三个步骤：fetch / detail / import。

复用 services/web_fetch 的真实抓取/抽取/导入链路；步骤间结果放进程内缓存，缓存丢了
（进程重启）对应步骤重新抓取。**不自动入队、不投递**——只写岗位广场。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask, AgentTaskStep
from .assistant_task_handler_common import StepResult, run_async, stage_of, task_params
from .web_fetch import import_service as web_import

logger = logging.getLogger(__name__)


def _previous_failed(db: Session, task: AgentTask) -> list[dict]:
    """列表/详情阶段的中间结果；缓存丢失时重新预览一次（如实重取，不伪造）。"""
    stage = stage_of(task.id)
    cached = stage.get("rows")
    if isinstance(cached, list) and cached:
        return cached
    params = task_params(task)
    url = str(params.get("url") or "").strip()
    limit = int(params.get("limit") or 0)
    preview = run_async(web_import.preview_from_url(db, url, limit=limit))
    rows = list(preview.get("rows") or [])
    stage["rows"] = rows
    stage["page_url"] = str(preview.get("url") or url)
    return rows


def fetch_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    url = str(params.get("url") or "").strip()
    limit = int(params.get("limit") or 0)
    try:
        preview = run_async(web_import.preview_from_url(db, url, limit=limit))
    except Exception as exc:  # noqa: BLE001 - 抓取失败要如实变成任务失败原因
        return StepResult(False, error=f"抓取岗位列表失败：{exc}"[:500])
    rows = list(preview.get("rows") or [])
    stage = stage_of(task.id)
    stage["rows"] = rows
    stage["page_url"] = str(preview.get("url") or url)
    if not rows:
        return StepResult(False, error="这个链接没有抽到岗位（页面结构可能变了或不是岗位列表）")
    return StepResult(
        True,
        {
            "total": len(rows),
            "engine": str(preview.get("engine") or ""),
            "method": str(preview.get("method") or ""),
        },
    )


def detail_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    try:
        rows = _previous_failed(db, task)
        if not rows:
            return StepResult(False, error="没有可补详情的预览行")
        page_url = str(stage_of(task.id).get("page_url") or "")
        result = run_async(web_import.fetch_details(db, rows, page_url=page_url))
    except Exception as exc:  # noqa: BLE001
        return StepResult(False, error=f"补详情失败：{exc}"[:500])
    updated = list(result.get("rows") or [])
    stage_of(task.id)["rows"] = updated
    failed = sum(
        1 for row in updated if (row.get("field_states") or {}).get("description") == "fetch_failed"
    )
    filled = sum(
        1 for row in updated if (row.get("field_states") or {}).get("description") == "filled"
    )
    if updated and filled == 0 and failed == len(updated):
        return StepResult(False, error="详情页全部抓取失败，无法导入完整岗位")
    return StepResult(True, {"processed": len(updated), "filled": filled, "failed": failed})


def import_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    try:
        rows = _previous_failed(db, task)
        if not rows:
            return StepResult(False, error="没有可导入的预览行")
        outcome = web_import.commit_rows(db, rows)
    except Exception as exc:  # noqa: BLE001
        return StepResult(False, error=f"写入岗位广场失败：{exc}"[:500])
    imported = int(outcome.get("imported") or 0)
    updated = int(outcome.get("updated") or 0)
    failed = len(outcome.get("failed") or [])
    if imported + updated == 0 and failed > 0:
        return StepResult(False, error=f"{failed} 条岗位全部导入失败")
    return StepResult(
        True,
        {
            "imported": imported,
            "updated": updated,
            "skipped": len(outcome.get("skipped") or []),
            "failed": failed,
        },
    )


JOB_IMPORT_HANDLERS = {
    ("job_import", "fetch"): fetch_step,
    ("job_import", "detail"): detail_step,
    ("job_import", "import"): import_step,
}

__all__ = ["JOB_IMPORT_HANDLERS"]
