# SPDX-License-Identifier: Apache-2.0
"""事实台账接口。

路由顺序有讲究：`/baseline` 与 `/draft` 必须注册在 `/{claim_id}` **之前**，
否则 FastAPI 会先匹配到带路径参数的那条，把 `baseline` 当成 claim_id 去解析成整数，
返回一个和"路由不存在"很像的 422。

T28 Batch B 起，列表/单条读取/新建/修改四条由 action 契约层生成（一份 ActionSpec 同时是
工具与路由的唯一真源）；生成路由都注册在原装饰器位置，注册顺序不变。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.claim import CLAIM_CATEGORIES, VERIFICATION_STATUSES, ClaimRecord
from ..schemas.claim import (
    MAX_CLAIM_LIST_EXCERPT_CHARS,
    ClaimBatchDeleteResult,
    ClaimBatchRequest,
    ClaimDigestOut,
    ClaimDraftOut,
    ClaimDraftRequest,
    ClaimPageListOut,
    ClaimSummary,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.claims import claim_actions
from ..services.actions.pilots import pilot_actions
from ..services.claim_draft import draft_from_text
from ..services.claims import (
    build_baseline,
    claim_warnings,
    delete_claim,
    list_claims_page,
    summarize_query,
)
from ..services.llm.base import LLMError
from ..services.ui_locale import get_ui_locale

router = APIRouter(prefix="/api/claims", tags=["claims"])
logger = logging.getLogger(__name__)


# T27 试点 1：GET /api/claims 由契约层生成（ActionSpec 是参数/权限/描述的唯一真源）。
# 注册位置仍由本文件里的调用点显式决定（原来的装饰器位置，保持注册顺序）。
add_action_route(router, pilot_actions()["list_claims"])


# T28 Batch B：POST /api/claims 由契约层生成（原 create_claim_entry 位置）。
add_action_route(router, claim_actions()["create_claim"])


@router.get("/baseline", response_model=ClaimDigestOut)
def read_baseline(db: Session = Depends(get_db)):
    """当前可用于生成的事实基线（已确认事实 + 必须避开的未确认说法）。"""
    return build_baseline(db)


@router.post("/draft", response_model=ClaimDraftOut)
async def draft_claims(payload: ClaimDraftRequest, db: Session = Depends(get_db)):
    """按一段资料草拟台账条目；只返回草稿，不落库，等用户确认后再保存。"""
    try:
        return await draft_from_text(db, payload)
    except LLMError as exc:
        logger.warning("草拟台账条目失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"提取台账草稿失败：{exc}") from exc


def _claim_summary(record, locale: str | None = None) -> ClaimSummary:
    """分页列表行摘要：长文本只带 200 字截断，改进建议仍由服务端算出。"""
    return ClaimSummary(
        id=record.id,
        title=record.title,
        category=record.category,
        subject=record.subject,
        source_fact_excerpt=(record.source_fact or "")[:MAX_CLAIM_LIST_EXCERPT_CHARS],
        candidate_wording_excerpt=(record.candidate_wording or "")[:MAX_CLAIM_LIST_EXCERPT_CHARS],
        responsibility_level=record.responsibility_level,
        verification_status=record.verification_status,
        last_verified=record.last_verified,
        warnings=claim_warnings(record, locale),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.get("/page", response_model=ClaimPageListOut)
def read_claims_page(
    category: str = Query(default=""),
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出事实台账（RF-08 续）：过滤语义与旧端点一致，汇总改 SQL 计数。

    旧端点 `GET /api/claims` 一次返回**全量**条目（DTO 还带 8_000 字符级的原文
    与表述全文），千级台账时既拖响应也拖渲染；本端点按页取摘要行，汇总
    （total/confirmed/pending/category_counts）对**同一份过滤集合**用 SQL 计数，
    口径与旧端点的内存汇总一致（一致性由测试钉住）。**声明在 `/{claim_id}`
    之前**（同 `/baseline` 的理由）。
    """
    if category and category not in CLAIM_CATEGORIES:
        raise HTTPException(status_code=422, detail="未知的台账分类")
    if status and status not in VERIFICATION_STATUSES:
        raise HTTPException(status_code=422, detail="未知的核实状态")
    records, _total = list_claims_page(
        db, category=category, status=status, keyword=keyword, page=page, page_size=page_size
    )
    summary = summarize_query(db, category=category, status=status, keyword=keyword)
    locale = get_ui_locale(db)
    return ClaimPageListOut(
        items=[_claim_summary(record, locale) for record in records],
        **summary,
    )


@router.post("/batch-delete", response_model=ClaimBatchDeleteResult)
def batch_delete_claims(payload: ClaimBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 `DELETE /{claim_id}`：任何一条 id 不存在或已在回收站里即整体
    404 并附缺失 id 清单，不做"删一半"。**声明在 `/{claim_id}` 之前**（同
    `/baseline` 的理由）。
    """
    records: list[ClaimRecord] = []
    missing: list[int] = []
    for claim_id in payload.claim_ids:
        record = trash.get_live(db, ClaimRecord, claim_id)
        if record is None:
            missing.append(claim_id)
        else:
            records.append(record)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下台账条目不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for record in records:
        trash.soft_delete(db, "claim", record)
    db.commit()
    return ClaimBatchDeleteResult(deleted=len(records))


# T28 Batch B：GET /api/claims/{claim_id} 由契约层生成（原 read_claim 位置）。
add_action_route(router, claim_actions()["get_claim"])


# T28 Batch B：PUT /api/claims/{claim_id} 由契约层生成（原 save_claim 位置）。
add_action_route(router, claim_actions()["update_claim"])


@router.delete("/{claim_id}", status_code=204)
def remove_claim(claim_id: int, db: Session = Depends(get_db)):
    if not delete_claim(db, claim_id):
        raise HTTPException(status_code=404, detail="台账条目不存在或已被删除")
