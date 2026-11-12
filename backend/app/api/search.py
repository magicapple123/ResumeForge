# SPDX-License-Identifier: Apache-2.0
"""全局搜索接口。

取数与组装已下沉到 ``services/global_search.global_search``（读路径第二批）：本文件只
声明查询参数与响应模型。检索路径（FTS trigram 优先、LIKE 回退）、各域的字段清单、
「我的资料」的可见性判据与排序决胜规则都跟着查询走，见该模块的模块说明。
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.search import SearchResult
from ..services.global_search import global_search

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchResult)
def search(
    q: str = Query(min_length=1, description="搜索关键词"),
    scope: str = Query(default="all", pattern="^(all|jobs|resumes|more)$"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """同时检索岗位、简历记录，以及内推/提醒/面经/台账/资料/我的资料。"""
    return global_search(db, q, scope=scope, limit=limit)
