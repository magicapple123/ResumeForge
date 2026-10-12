"""事实台账接口。

路由顺序有讲究：``/baseline`` 与 ``/draft`` 必须注册在 ``/{claim_id}`` **之前**，
否则 FastAPI 会先匹配到带路径参数的那条，把 ``baseline`` 当成 claim_id 去解析成整数，
返回一个和"路由不存在"很像的 422。
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
    ClaimCreate,
    ClaimDigestOut,
    ClaimDraftOut,
    ClaimDraftRequest,
    ClaimListOut,
    ClaimOut,
    ClaimPageListOut,
    ClaimSummary,
    ClaimUpdate,
)
from ..services import trash
from ..services.claim_draft import draft_from_text
from ..services.claims import (
    build_baseline,
    claim_or_none,
    claim_out,
    claim_warnings,
    create_claim,
    delete_claim,
    list_claims,
    list_claims_page,
    summarize,
    summarize_query,
    update_claim,
)
from ..services.llm.base import LLMError

router = APIRouter(prefix="/api/claims", tags=["claims"])
logger = logging.getLogger(__name__)


@router.get("", response_model=ClaimListOut)
def read_claims(
    category: str = Query(default=""),
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """列出事实台账条目；可按分类、核实状态与关键词过滤。"""
    if category and category not in CLAIM_CATEGORIES:
        raise HTTPException(status_code=422, detail="未知的台账分类")
    if status and status not in VERIFICATION_STATUSES:
        raise HTTPException(status_code=422, detail="未知的核实状态")
    records = list_claims(db, category=category, status=status, keyword=keyword)
    return ClaimListOut(
        items=[claim_out(record) for record in records],
        **summarize(records),
    )


@router.post("", response_model=ClaimOut, status_code=201)
def create_claim_entry(payload: ClaimCreate, db: Session = Depends(get_db)):
    return claim_out(create_claim(db, payload))


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


def _claim_summary(record) -> ClaimSummary:
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
        warnings=claim_warnings(record),
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

    旧端点 ``GET /api/claims`` 一次返回**全量**条目（DTO 还带 8_000 字符级的原文
    与表述全文），千级台账时既拖响应也拖渲染；本端点按页取摘要行，汇总
    （total/confirmed/pending/category_counts）对**同一份过滤集合**用 SQL 计数，
    口径与旧端点的内存汇总一致（一致性由测试钉住）。**声明在 ``/{claim_id}``
    之前**（同 ``/baseline`` 的理由）。
    """
    if category and category not in CLAIM_CATEGORIES:
        raise HTTPException(status_code=422, detail="未知的台账分类")
    if status and status not in VERIFICATION_STATUSES:
        raise HTTPException(status_code=422, detail="未知的核实状态")
    records, _total = list_claims_page(
        db, category=category, status=status, keyword=keyword, page=page, page_size=page_size
    )
    summary = summarize_query(db, category=category, status=status, keyword=keyword)
    return ClaimPageListOut(
        items=[_claim_summary(record) for record in records],
        **summary,
    )


@router.post("/batch-delete", response_model=ClaimBatchDeleteResult)
def batch_delete_claims(payload: ClaimBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 ``DELETE /{claim_id}``：任何一条 id 不存在或已在回收站里即整体
    404 并附缺失 id 清单，不做"删一半"。**声明在 ``/{claim_id}`` 之前**（同
    ``/baseline`` 的理由）。
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


@router.get("/{claim_id}", response_model=ClaimOut)
def read_claim(claim_id: int, db: Session = Depends(get_db)):
    record = claim_or_none(db, claim_id)
    if record is None:
        raise HTTPException(status_code=404, detail="台账条目不存在或已被删除")
    return claim_out(record)


@router.put("/{claim_id}", response_model=ClaimOut)
def save_claim(claim_id: int, payload: ClaimUpdate, db: Session = Depends(get_db)):
    record = claim_or_none(db, claim_id)
    if record is None:
        raise HTTPException(status_code=404, detail="台账条目不存在或已被删除")
    return claim_out(update_claim(db, record, payload))


@router.delete("/{claim_id}", status_code=204)
def remove_claim(claim_id: int, db: Session = Depends(get_db)):
    if not delete_claim(db, claim_id):
        raise HTTPException(status_code=404, detail="台账条目不存在或已被删除")
