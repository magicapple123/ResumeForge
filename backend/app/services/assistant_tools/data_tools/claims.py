"""事实台账（claims）域的工具实现。

台账是"用户自己核对过的事实"，所以助手在这里的权限是**可以补内容、不能替用户确认**：
所有写入路径都不接受 `verification_status`，新建的条目一律是「待确认」。让模型把某条
主张标成「已确认」，等于让它可以自己给自己发通行证——那正是台账要防的事。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult


def _claim_or_error(db: Session, arguments: dict):
    from ...claims import claim_or_none

    try:
        claim_id = int(arguments.get("claim_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供台账条目 id（可以先用 list_claims 查）") from None
    record = claim_or_none(db, claim_id)
    if record is None:
        raise ValueError(f"台账条目 {claim_id} 不存在")
    return record


def _tool_list_claims(db: Session, arguments: dict) -> ToolResult:
    from ...claims import claim_brief, list_claims

    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    records = list_claims(
        db,
        keyword=str(arguments.get("keyword") or ""),
        category=str(arguments.get("category") or ""),
        status=str(arguments.get("status") or ""),
    )
    shown = records[:limit]
    payload = {
        "总数": len(records),
        "返回": len(shown),
        "条目": [claim_brief(item) for item in shown],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了事实台账里的 {len(shown)} 条记录",
        link="/claims",
    )


def _tool_get_claim(db: Session, arguments: dict) -> ToolResult:
    from ...claims import claim_detail_text

    record = _claim_or_error(db, arguments)
    return ToolResult(
        text=claim_detail_text(record),
        summary=f"读取了台账条目「{record.title or record.subject}」",
        link="/claims",
    )


def _tool_create_claim(db: Session, arguments: dict) -> ToolResult:
    from ....schemas.claim import ClaimCreate
    from ...claims import create_claim

    # 只放行工具声明过的字段；`verification_status` 不在其中，新建的一律是「待确认」。
    payload = ClaimCreate.model_validate(
        {
            key: value
            for key, value in arguments.items()
            if key
            in {
                "title",
                "category",
                "subject",
                "source_fact",
                "candidate_wording",
                "responsibility_level",
                "boundary",
                "risk_notes",
                "sources",
                "allowed_uses",
                "interview_details",
                "last_verified",
            }
        }
    )
    record = create_claim(db, payload)
    return ToolResult(
        text=json.dumps(
            {"id": record.id, "核实状态": record.verification_status}, ensure_ascii=False
        ),
        summary=f"把「{record.title or record.subject}」记进了事实台账（待你确认）",
        link="/claims",
        changed=True,
    )


def _tool_update_claim(db: Session, arguments: dict) -> ToolResult:
    from ....schemas.claim import ClaimUpdate
    from ...claims import update_claim

    record = _claim_or_error(db, arguments)
    mutable = {
        key: value
        for key, value in arguments.items()
        if key
        in {
            "title",
            "category",
            "subject",
            "source_fact",
            "candidate_wording",
            "responsibility_level",
            "boundary",
            "risk_notes",
            "sources",
            "allowed_uses",
            "interview_details",
            "last_verified",
        }
    }
    if not mutable:
        # 区分"什么都没给"和"只给了不能改的字段"：后者最常见的就是想改核实状态。
        # 只说"没有给出要修改的字段"会让模型以为参数格式错了，于是反复重试同一个调用。
        if "verification_status" in arguments:
            raise ValueError(
                "核实状态不能由助手修改——一条主张能不能进正式简历要由用户自己判断，"
                "请让他在「事实台账」页上确认"
            )
        raise ValueError("没有给出要修改的字段")
    payload = ClaimUpdate.model_validate(
        {
            "title": record.title,
            "category": record.category,
            "subject": record.subject,
            "source_fact": record.source_fact,
            "candidate_wording": record.candidate_wording,
            "sources": record.sources or [],
            "responsibility_level": record.responsibility_level,
            # 核实状态保持不变：助手不能替用户确认或作废一条主张。
            "verification_status": record.verification_status,
            "allowed_uses": record.allowed_uses or [],
            "interview_details": record.interview_details or {},
            "boundary": record.boundary,
            "risk_notes": record.risk_notes or [],
            "last_verified": record.last_verified,
            **mutable,
        }
    )
    updated = update_claim(db, record, payload)
    return ToolResult(
        text=json.dumps(
            {"id": updated.id, "updated": sorted(mutable), "核实状态": updated.verification_status},
            ensure_ascii=False,
        ),
        summary=f"更新了台账条目「{updated.title or updated.subject}」",
        link="/claims",
        changed=True,
    )
