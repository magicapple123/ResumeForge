"""备选岗位（candidate_jobs）域的工具实现。"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from ....models.job import Job
from ....models.material import CANDIDATE_JOB_PENDING, CandidateJob
from ....schemas.job import JobCreate
from ....schemas.material import CandidateJobCreate
from ... import trash
from ...candidate_jobs import candidate_brief, candidate_detail_text, mark_candidate_imported
from ...job.job_service import create_job_record
from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult

logger = logging.getLogger(__name__)


def _candidate_or_error(db: Session, arguments: dict) -> CandidateJob:
    try:
        candidate_id = int(arguments.get("candidate_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供备选岗位 id（可以先用 list_candidate_jobs 查）") from None
    candidate = db.get(CandidateJob, candidate_id)
    if candidate is None:
        raise ValueError(f"备选岗位 {candidate_id} 不存在")
    return candidate


def _tool_list_candidate_jobs(db: Session, arguments: dict) -> ToolResult:
    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    status = str(arguments.get("status") or "").strip()
    query = db.query(CandidateJob)
    if status in {"pending", "imported"}:
        query = query.filter(CandidateJob.status == status)
    keyword = str(arguments.get("keyword") or "").strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            CandidateJob.title.like(like)
            | CandidateJob.company.like(like)
            | CandidateJob.raw_text.like(like)
        )
    candidates = query.order_by(CandidateJob.created_at.desc()).limit(limit).all()
    payload = {
        "返回": len(candidates),
        "备选岗位": [candidate_brief(item) for item in candidates],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了 {len(candidates)} 条备选岗位",
        link="/jobs",
    )


def _tool_get_candidate_job(db: Session, arguments: dict) -> ToolResult:
    candidate = _candidate_or_error(db, arguments)
    return ToolResult(
        text=candidate_detail_text(candidate),
        summary=f"读取了备选岗位「{candidate.title or candidate.company or candidate.id}」",
        link="/jobs",
    )


def _tool_create_candidate_job(db: Session, arguments: dict) -> ToolResult:
    payload = CandidateJobCreate.model_validate(
        {
            "title": str(arguments.get("title") or ""),
            "company": str(arguments.get("company") or ""),
            "raw_text": str(arguments.get("raw_text") or ""),
            "note": str(arguments.get("note") or ""),
            "source": "助手录入",
        }
    )
    candidate = CandidateJob(**payload.model_dump(), status=CANDIDATE_JOB_PENDING)
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    logger.info("助手新增备选岗位 id=%s", candidate.id)
    return ToolResult(
        text=json.dumps({"id": candidate.id, "title": candidate.title}, ensure_ascii=False),
        summary=f"把「{candidate.title or candidate.company or '招聘信息'}」放进了备选岗位",
        link="/jobs",
        changed=True,
    )


def _tool_update_candidate_job(db: Session, arguments: dict) -> ToolResult:
    candidate = _candidate_or_error(db, arguments)
    fields = {
        key: value
        for key, value in arguments.items()
        if key in {"title", "company", "raw_text", "note"}
    }
    if not fields:
        raise ValueError("没有给出要修改的字段")
    for key, value in fields.items():
        setattr(candidate, key, value)
    db.commit()
    db.refresh(candidate)
    return ToolResult(
        text=json.dumps({"id": candidate.id, "updated": sorted(fields)}, ensure_ascii=False),
        summary=f"更新了备选岗位「{candidate.title or candidate.id}」",
        link="/jobs",
        changed=True,
    )


def _tool_import_candidate_job(db: Session, arguments: dict) -> ToolResult:
    """把备选岗位正式导入岗位广场。

    已导入过的不再重复创建：直接告诉模型它在正式岗位里的 id，避免同一份招聘信息
    被记两次。
    """
    candidate = _candidate_or_error(db, arguments)
    if candidate.status == "imported" and candidate.imported_job_id:
        existing = trash.get_live(db, Job, candidate.imported_job_id)
        if existing is not None:
            return ToolResult(
                text=json.dumps(
                    {"job_id": existing.id, "title": existing.title, "already_imported": True},
                    ensure_ascii=False,
                ),
                summary=f"备选岗位已在岗位广场（id={existing.id}）",
                link="/jobs",
            )
    raw_text = (candidate.raw_text or "").strip()[:20_000]
    payload = JobCreate.model_validate(
        {
            "title": str(arguments.get("title") or candidate.title or "待补充岗位").strip()[:128],
            "company": str(arguments.get("company") or candidate.company or "").strip()[:128],
            "description": raw_text or str(arguments.get("description") or ""),
            "note": candidate.note or str(arguments.get("note") or ""),
            "recognition_source": "备选岗位导入",
        }
    )
    job = create_job_record(db, payload)
    mark_candidate_imported(db, candidate, job.id)
    return ToolResult(
        text=json.dumps({"job_id": job.id, "title": job.title}, ensure_ascii=False),
        summary=f"把备选岗位导入成正式岗位「{job.title}」",
        link="/jobs",
        changed=True,
    )
