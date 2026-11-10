# SPDX-License-Identifier: Apache-2.0
"""事实台账的服务层：增删改查与改进建议。

两件事在这里收口：

- **CRUD**：只做存取与排序，不做判断。
- **改进建议**（:func:`claim_warnings`）：把"这样写会在面试里出问题"的规则集中在一处，
  由接口随条目一起下发。它是**建议不是拦截**——硬拦会让用户放弃维护台账，反而拿不到
  这套规则的好处；唯一被硬拦的是"已确认却带占位符"那种自相矛盾（在 schema 里挡）。

事实基线（:func:`build_baseline`）为守住 500 行文件预算已拆到
:mod:`app.services.claim_baseline`，本模块 re-export 同名符号，既有 import 路径不变。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.claim import (
    CLAIM_CATEGORIES,
    RESPONSIBILITY_PARTICIPATED,
    STRONG_RESPONSIBILITY_LEVELS,
    VERIFICATION_CONFIRMED,
    VERIFICATION_EXPIRED,
    VERIFICATION_PENDING,
    VERIFICATION_REJECTED,
    ClaimRecord,
    has_placeholder,
)
from ..schemas.claim import ClaimCreate, ClaimOut, ClaimUpdate
from . import claims_i18n, trash
from .claim_baseline import build_baseline, claim_linked, current_entry_ids
from .ui_locale import is_english

logger = logging.getLogger(__name__)

# 助手读取单条台账时的返回上限：它的长文本是给模型看追问依据用的，
# 不是让它把整条主张原文复述给用户。
MAX_CLAIM_TOOL_CHARS = 6_000
# 表述强度检查：这些词把一条经历的"份量"抬高，如果承担程度只是"参与"，两者不一致
# 会在面试里第一个被追问。只在候选表述里找，不去猜原始事实的口气。
_STRONG_WORDING_MARKERS = (
    "主导",
    "独立完成",
    "从 0 到 1",
    "从0到1",
    "从零到一",
    "牵头",
    "架构设计",
    "负责人",
    "owner",
    "显著提升",
    "大幅提升",
)


def claim_or_none(db: Session, claim_id: int) -> ClaimRecord | None:
    """取一条台账；**已在回收站里的当作不存在**。

    单条读取与修改都走这里，所以"回收站里的内容打不开、也不能再改"这条规则只写一次。
    删除路径刻意不用它——否则进了回收站就再也动不了。
    """
    record = db.get(ClaimRecord, claim_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


def _claims_query(
    db: Session,
    *,
    category: str = "",
    status: str = "",
    keyword: str = "",
):
    """列表共用的过滤与排序：旧全量端点、分页端点与 SQL 汇总必须同源。"""
    query = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord))
    if category:
        query = query.filter(ClaimRecord.category == category)
    if status:
        query = query.filter(ClaimRecord.verification_status == status)
    target = (keyword or "").strip()
    if target:
        like = f"%{target}%"
        query = query.filter(
            ClaimRecord.title.like(like)
            | ClaimRecord.subject.like(like)
            | ClaimRecord.source_fact.like(like)
            | ClaimRecord.candidate_wording.like(like)
        )
    return query.order_by(ClaimRecord.updated_at.desc(), ClaimRecord.id.desc())


def list_claims(
    db: Session,
    *,
    category: str = "",
    status: str = "",
    keyword: str = "",
) -> list[ClaimRecord]:
    """按分类 / 核实状态 / 关键词检索；默认按最近更新排序。"""
    return _claims_query(db, category=category, status=status, keyword=keyword).all()


def list_claims_page(
    db: Session,
    *,
    category: str = "",
    status: str = "",
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ClaimRecord], int]:
    """分页取台账：过滤与排序与 :func:`list_claims` 完全一致，total 反映筛选后集合。"""
    base = _claims_query(db, category=category, status=status, keyword=keyword)
    total = base.count()
    rows = base.offset((max(1, page) - 1) * page_size).limit(max(1, page_size)).all()
    return rows, total


def _apply_payload(record: ClaimRecord, payload: ClaimCreate | ClaimUpdate) -> None:
    record.title = payload.title.strip() or payload.subject.strip()
    record.category = payload.category
    record.subject = payload.subject.strip()
    record.source_fact = payload.source_fact
    record.candidate_wording = payload.candidate_wording
    record.sources = [item.model_dump() for item in payload.sources]
    record.responsibility_level = payload.responsibility_level
    record.verification_status = payload.verification_status
    record.allowed_uses = list(payload.allowed_uses)
    record.interview_details = dict(payload.interview_details)
    record.boundary = payload.boundary
    record.risk_notes = list(payload.risk_notes)
    record.last_verified = payload.last_verified
    # 关联资料条目：**只有请求里显式带了 entry_ids 才改写**。
    # 旧客户端（以及助手的"局部合并"更新）不会传这个字段，此时必须保留既有链接——
    # PUT 整体替换语义不该顺手清掉一个用户看不见的关联。
    if "entry_ids" in getattr(payload, "model_fields_set", set()):
        cleaned = list(payload.entry_ids)
        if cleaned != list(record.entry_ids or []):
            record.entry_ids = cleaned
            # 用户自己重选了关联：迁移期「已自动关联，请核对」的标记到此为止。
            record.entry_ids_auto = False
    elif record.entry_ids is None:
        record.entry_ids = []


def create_claim(db: Session, payload: ClaimCreate) -> ClaimRecord:
    """新增一条台账主张（新建一律「待确认」）。"""
    record = ClaimRecord()
    _apply_payload(record, payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_claim(db: Session, record: ClaimRecord, payload: ClaimUpdate) -> ClaimRecord:
    _apply_payload(record, payload)
    db.commit()
    db.refresh(record)
    return record


def delete_claim(db: Session, claim_id: int) -> bool:
    """移入回收站（软删除）；彻底删除在「回收站」里单独提供。"""
    record = db.get(ClaimRecord, claim_id)
    if record is None or trash.is_deleted(record):
        return False
    trash.soft_delete(db, "claim", record)
    db.commit()
    return True


def _has_interview_details(details: dict[str, Any] | None) -> bool:
    if not details:
        return False
    if str(details.get("result") or "").strip():
        return True
    return any(
        isinstance(details.get(key), list) and details[key]
        for key in ("decisions", "difficulties", "verification")
    )


def _wording_strength_conflict(record: ClaimRecord) -> bool:
    wording = (record.candidate_wording or "").casefold()
    if not wording:
        return False
    if not any(marker.casefold() in wording for marker in _STRONG_WORDING_MARKERS):
        return False
    return record.responsibility_level == RESPONSIBILITY_PARTICIPATED


def claim_warnings(record: ClaimRecord, locale: str | None = None) -> list[str]:
    """把"这样写会在面试里出问题"的规则集中在这里。

    中文是原文，逐字不动（日志、测试、中文界面都引用它）；``locale`` 是英文时改取
    ``claims_i18n`` 里的同义文案——每条规则**都要有英文分支**，否则英文界面会漏出中文。
    规则本身的判断条件只有一份，翻译只发生在"往数组里塞哪句话"这一步。
    """
    warnings: list[str] = []
    english = is_english(locale)
    status = record.verification_status

    if record.responsibility_level in STRONG_RESPONSIBILITY_LEVELS and not _has_interview_details(
        record.interview_details
    ):
        warnings.append(
            claims_i18n.STRONG_RESPONSIBILITY_WARNING.format(
                level=claims_i18n.responsibility_label(record.responsibility_level)
            )
            if english
            else (
                f"承担程度是「{record.responsibility_level}」，这类强主张面试时一定会被追问；"
                "建议补上当时的决策、难点、怎么验证和结果"
            )
        )
    if status == VERIFICATION_CONFIRMED and not (record.boundary or "").strip():
        warnings.append(
            claims_i18n.NO_BOUNDARY_WARNING
            if english
            else (
                "这条会进入正式简历，但没写个人边界；"
                "建议写清团队做了什么、你做了什么，避免把团队成果说成个人成果"
            )
        )
    if status == VERIFICATION_CONFIRMED and not record.sources:
        warnings.append(
            claims_i18n.NO_SOURCES_WARNING if english else "已确认但没有留下证据来源，之后需要复核时将无从回溯"
        )
    if (
        status == VERIFICATION_PENDING
        and (record.candidate_wording or "").strip()
        and not has_placeholder(record.candidate_wording)
    ):
        warnings.append(
            claims_i18n.PENDING_PLACEHOLDER_WARNING
            if english
            else "待确认的表述没有加【待补】占位符；导出终稿时会因为看不出它还没核实而被误用"
        )
    if status == VERIFICATION_EXPIRED:
        warnings.append(
            claims_i18n.EXPIRED_WARNING if english else "这条已标记为过期，使用前请更新内容并重新核实"
        )
    if status == VERIFICATION_REJECTED and (record.candidate_wording or "").strip():
        warnings.append(
            claims_i18n.REJECTED_WARNING if english else "已标记为不采用，生成简历时会显式避开这条表述"
        )
    if _wording_strength_conflict(record):
        warnings.append(
            claims_i18n.WORDING_CONFLICT_WARNING
            if english
            else (
                "表述里出现了「主导 / 独立完成 / 负责」这类强措辞，"
                "但承担程度填的是「参与」——两者不一致，面试时容易被问穿"
            )
        )
    return warnings


def claim_out(record: ClaimRecord, locale: str | None = None) -> ClaimOut:
    """ORM 记录 → 对外结构，并附上服务端算出的改进建议。"""
    payload = ClaimOut.model_validate(record)
    payload.warnings = claim_warnings(record, locale)
    return payload


def summarize(records: list[ClaimRecord]) -> dict[str, Any]:
    """列表接口的汇总部分：各状态计数与各分类计数。"""
    category_counts = {category: 0 for category in CLAIM_CATEGORIES}
    confirmed = 0
    pending = 0
    for record in records:
        category_counts[record.category] = category_counts.get(record.category, 0) + 1
        if record.verification_status == VERIFICATION_CONFIRMED:
            confirmed += 1
        elif record.verification_status == VERIFICATION_PENDING:
            pending += 1
    return {
        "total": len(records),
        "confirmed_count": confirmed,
        "pending_count": pending,
        "category_counts": category_counts,
    }


def summarize_query(
    db: Session,
    *,
    category: str = "",
    status: str = "",
    keyword: str = "",
) -> dict[str, Any]:
    """:func:`summarize` 的 SQL 版：计数下推数据库，不再把全量记录拉进内存。

    口径与 :func:`summarize` 完全一致（对**同一份过滤集合**计数）——分页端点用
    它代替"先拉全量再数"，千级台账时省掉整表 ORM 实例化。两侧的一致性由
    ``test_batch_b_page_endpoints`` 的同数据比对用例钉住。
    """
    base = _claims_query(db, category=category, status=status, keyword=keyword)
    total = base.count()
    confirmed = base.filter(ClaimRecord.verification_status == VERIFICATION_CONFIRMED).count()
    pending = base.filter(ClaimRecord.verification_status == VERIFICATION_PENDING).count()
    rows = (
        base.with_entities(ClaimRecord.category, func.count(ClaimRecord.id))
        .group_by(ClaimRecord.category)
        .all()
    )
    category_counts = {cat: 0 for cat in CLAIM_CATEGORIES}
    for cat, count in rows:
        category_counts[cat] = category_counts.get(cat, 0) + int(count)
    return {
        "total": total,
        "confirmed_count": confirmed,
        "pending_count": pending,
        "category_counts": category_counts,
    }


def claim_brief(record: ClaimRecord) -> dict[str, Any]:
    """列表视图：够判断"这是不是用户说的那一条"，不铺开长文本占满助手上下文。"""
    return {
        "id": record.id,
        "标题": record.title,
        "分类": record.category,
        "主体": record.subject,
        "核实状态": record.verification_status,
        "承担程度": record.responsibility_level,
        "原始事实": (record.source_fact or "")[:200],
        "简历表述": (record.candidate_wording or "")[:200],
    }


def claim_detail_text(record: ClaimRecord, max_chars: int = MAX_CLAIM_TOOL_CHARS) -> str:
    """单条完整内容，含只有被追问时才用得上的面试细节与个人边界。"""
    payload = {
        "id": record.id,
        "标题": record.title,
        "分类": record.category,
        "主体": record.subject,
        "核实状态": record.verification_status,
        "承担程度": record.responsibility_level,
        "原始事实": record.source_fact,
        "简历表述": record.candidate_wording,
        "个人边界": record.boundary,
        "证据来源": record.sources,
        "可用范围": record.allowed_uses,
        "面试细节": record.interview_details,
        "风险备注": record.risk_notes,
        "最近核实": record.last_verified,
        "待改进": claim_warnings(record),
    }
    return json.dumps(payload, ensure_ascii=False)[:max_chars]


__all__ = [
    "MAX_CLAIM_TOOL_CHARS",
    "build_baseline",
    "current_entry_ids",
    "claim_brief",
    "claim_detail_text",
    "claim_linked",
    "claim_or_none",
    "claim_out",
    "claim_warnings",
    "create_claim",
    "delete_claim",
    "list_claims",
    "list_claims_page",
    "summarize",
    "summarize_query",
    "update_claim",
]
