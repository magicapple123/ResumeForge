"""岗位广场批量适配度分析的编排与历史记录。"""
from __future__ import annotations

import logging
import json
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.job_match_batch import JobMatchBatch
from ...schemas.job_match import JobMatchResult
from ...schemas.job_match_batch import (
    JobMatchBatchItem,
    JobMatchBatchSummary,
)
from ..apply import apply_service
from ..llm import create_provider
from ..llm.base import LLMError
from ..match_scoring import score_match_result
from ..profile.profile_service import get_profile_detail
from .job_match import analyze_match, finalize_match_result, job_payload, local_match_result
from .job_match_context import profile_is_empty, profile_text

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BatchMatchInput:
    job_id: int
    job_title: str
    company: str
    payload: dict[str, Any]
    profile_text: str
    resume_text: str
    existing_result: JobMatchResult | None
    existing_model: str


@dataclass(frozen=True)
class BatchMatchRun:
    items: list[JobMatchBatchItem]
    model: str


class BatchMatchCancelled(Exception):
    """后台批量分析在两个岗位之间收到取消信号时携带已完成结果。"""

    def __init__(self, items: list[JobMatchBatchItem], model: str) -> None:
        super().__init__("批量分析已取消")
        self.items = items
        self.model = model


def build_batch_inputs(db: Session, jobs: list[Job], *, force: bool) -> list[BatchMatchInput]:
    """在数据库连接仍可用时准备所有匹配输入，随后即可安全释放连接等待模型。"""
    profile = get_profile_detail(db)
    personal_text = profile_text(profile)
    inputs: list[BatchMatchInput] = []
    for job in jobs:
        resume = apply_service.resolve_resume(db, job.id, None)
        resume_text = ""
        if resume is not None:
            resume_text = json.dumps(
                {"title": resume.title, "job_title": resume.job_title, "content": resume.content},
                ensure_ascii=False,
            )
        existing_result: JobMatchResult | None = None
        existing_model = ""
        if not force:
            existing = apply_service.latest_match(db, job.id)
            if existing is not None and isinstance(existing.result, dict) and existing.result:
                try:
                    existing_result = JobMatchResult.model_validate(existing.result)
                    existing_model = existing.model or ""
                except ValidationError:
                    logger.warning("忽略无法解析的历史匹配结论 job_id=%s", job.id)
        inputs.append(
            BatchMatchInput(
                job_id=job.id,
                job_title=job.title,
                company=job.company,
                payload=job_payload(job),
                profile_text=personal_text,
                resume_text=resume_text,
                existing_result=existing_result,
                existing_model=existing_model,
            )
        )
    if profile_is_empty(profile) and not any(item.resume_text.strip() for item in inputs):
        raise ValueError("个人资料为空，请先在「我的资料」中填写后再做匹配分析")
    return inputs


def _configured(config: Any) -> bool:
    return bool(str(getattr(config, "base_url", "")).strip() and str(getattr(config, "model", "")).strip())


def _failed(item: BatchMatchInput, error: str) -> JobMatchBatchItem:
    return JobMatchBatchItem(
        job_id=item.job_id,
        job_title=item.job_title,
        company=item.company,
        status="failed",
        error=error,
    )


async def run_batch_match(
    inputs: list[BatchMatchInput],
    config: Any,
    *,
    on_item_complete: Callable[[JobMatchBatchItem], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> BatchMatchRun:
    """逐岗位分析并保留部分成功结果；单个模型失败不吞掉整批结果。"""
    configured = _configured(config)
    provider = None
    provider_error = ""
    if configured:
        try:
            provider = create_provider(config)
        except Exception:  # noqa: BLE001 - 配置错误按每项失败返回，历史记录仍可查看
            provider_error = "模型配置无效，无法创建模型连接，请检查设置后重试"
            logger.exception("创建批量岗位匹配模型失败")

    items: list[JobMatchBatchItem] = []
    for item in inputs:
        if should_cancel is not None and should_cancel():
            raise BatchMatchCancelled(sort_batch_items(items), str(getattr(config, "model", "")) if configured else "")
        if item.existing_result is not None:
            result = finalize_match_result(item.existing_result)
            source = "existing"
            model = item.existing_model
        elif configured and provider is None:
            # 已配置模型时，创建 provider 失败不能静默降级成本地结果：那会让用户以为
            # 得到了 AI 分析，且历史记录无法区分两种结果。保留失败项，方便本批次回看。
            completed_item = _failed(item, provider_error)
            items.append(completed_item)
            if on_item_complete is not None:
                on_item_complete(completed_item)
            continue
        elif provider is None:
            result = local_match_result(item.payload)
            source = "local"
            model = ""
        else:
            try:
                result = await analyze_match(provider, item.payload, item.profile_text, item.resume_text)
            except LLMError as exc:
                logger.warning("批量岗位匹配失败 job_id=%s error=%s", item.job_id, exc)
                completed_item = _failed(item, str(exc))
                items.append(completed_item)
                if on_item_complete is not None:
                    on_item_complete(completed_item)
                continue
            except Exception:  # noqa: BLE001 - 单个岗位失败不影响其余岗位
                logger.exception("批量岗位匹配发生内部错误 job_id=%s", item.job_id)
                completed_item = _failed(item, "模型分析失败，请稍后重试")
                items.append(completed_item)
                if on_item_complete is not None:
                    on_item_complete(completed_item)
                continue
            source = "new"
            model = str(getattr(config, "model", ""))

        reference_score = score_match_result(
            result, item.payload, item.profile_text, item.resume_text
        )
        completed_item = JobMatchBatchItem(
            job_id=item.job_id,
            job_title=item.job_title,
            company=item.company,
            status="completed",
            reference_score=reference_score,
            result=result,
            model=model,
            analysis_source=source,
        )
        items.append(completed_item)
        if on_item_complete is not None:
            on_item_complete(completed_item)
    return BatchMatchRun(items=sort_batch_items(items), model=str(getattr(config, "model", "")) if configured else "")


def sort_batch_items(items: list[JobMatchBatchItem]) -> list[JobMatchBatchItem]:
    """按参考分降序排列，失败项放在末尾；同分保持原选择顺序。"""
    indexed = list(enumerate(items))
    indexed.sort(
        key=lambda pair: (
            0 if pair[1].status == "completed" else 1,
            -(pair[1].reference_score.score if pair[1].reference_score else -1),
            pair[0],
        )
    )
    rank = 0
    sorted_items: list[JobMatchBatchItem] = []
    for _index, item in indexed:
        if item.status == "completed":
            rank += 1
            sorted_items.append(item.model_copy(update={"rank": rank}))
        else:
            sorted_items.append(item)
    return sorted_items


def persist_batch(
    db: Session, run: BatchMatchRun, *, requested_count: int | None = None
) -> JobMatchBatch:
    """保存批次快照，并同步成功结论到每个岗位的最近一次匹配结果。"""
    for item in run.items:
        if item.status != "completed" or item.result is None:
            continue
        job = db.get(Job, item.job_id)
        if job is not None:
            apply_service.persist_match(db, job, item.result, model=item.model)
    row = JobMatchBatch(
        requested_count=requested_count if requested_count is not None else len(run.items),
        completed_count=sum(item.status == "completed" for item in run.items),
        failed_count=sum(item.status == "failed" for item in run.items),
        items=[item.model_dump(mode="json") for item in run.items],
        model=run.model,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def batch_summary(row: JobMatchBatch) -> JobMatchBatchSummary:
    """把完整批次压缩成历史列表使用的轻量摘要。"""
    top_score: int | None = None
    for item in row.items or []:
        score = (item.get("reference_score") or {}).get("score") if isinstance(item, dict) else None
        if isinstance(score, int):
            top_score = score if top_score is None else max(top_score, score)
    return JobMatchBatchSummary(
        id=row.id,
        requested_count=row.requested_count,
        completed_count=row.completed_count,
        failed_count=row.failed_count,
        top_score=top_score,
        model=row.model,
        created_at=row.created_at,
    )


def list_batch_summaries(db: Session, *, limit: int = 30) -> list[JobMatchBatchSummary]:
    rows = (
        db.query(JobMatchBatch)
        .order_by(JobMatchBatch.created_at.desc(), JobMatchBatch.id.desc())
        .limit(limit)
        .all()
    )
    return [batch_summary(row) for row in rows]


__all__ = [
    "BatchMatchInput",
    "BatchMatchCancelled",
    "BatchMatchRun",
    "batch_summary",
    "build_batch_inputs",
    "list_batch_summaries",
    "persist_batch",
    "run_batch_match",
    "sort_batch_items",
]
