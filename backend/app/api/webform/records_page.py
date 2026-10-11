"""网申填充记录的分页端点（RF-08）。

契约（rf-opt 架构 §2.5）钉死了路径 ``/api/apply/webform/records/page``——它不在
``/api/webform`` 前缀下，所以单独成模块、由 ``api/apply.py`` include 进
``/api/apply`` 路由树（**这里不写 prefix**：include 会把宿主路由的 ``/api/apply``
再前置一遍，路由路径只写 ``/webform/records/page``）。过滤与排序复用
``webform.history`` 的同一份查询构造，列表 DTO 只带摘要字段（不含填写值 ``items``
与页面快照 ``page_snapshot``）。
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.common import Page
from ...schemas.webform import WebFormRecordSummary
from ...services.webform import history

router = APIRouter(tags=["apply"])


@router.get("/webform/records/page", response_model=Page[WebFormRecordSummary])
def list_webform_records_page(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出网申填充记录（RF-08）：``created_at desc, id desc``，只含未软删除的。

    填写值明细（``items``）与页面快照（``page_snapshot``）含用户填进页面的真实值，
    **不进列表响应**——列表页只显示"成功 N / 未核对 N / 失败 N"计数；回看单条时走
    既有详情端点 ``GET /api/webform/records/{id}``。旧列表端点
    ``GET /api/webform/records``（上限 200）保持原样，供旧调用方继续使用。
    """
    records, total = history.list_records_page(db, page=page, page_size=page_size)
    return Page(items=records, total=total)
