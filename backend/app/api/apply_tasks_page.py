# SPDX-License-Identifier: Apache-2.0
"""采集/投递批次的历史分页端点（RF-08 收口增量）。

前端接入分页时发现旧 ``GET /api/apply/tasks`` 只有 ``kind``/``limit(1–100)``——批次
历史超过 100 条之后不可达。契约新增 ``GET /api/apply/tasks/page``：过滤（``kind``）
与排序（``id desc``）与旧列表完全一致，查询走 ``apply_service.list_apply_tasks_page``。

独立成模块的原因：``api/apply.py`` 的行数预算只剩个位数（``test_file_size_budget``
守卫 500 行），由 ``api/apply.py`` include 进 ``/api/apply`` 路由树（**这里不写
prefix**：include 会把宿主路由的 ``/api/apply`` 再前置一遍）。旧端点零改动。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.apply import TASK_KIND_APPLY, TASK_KIND_COLLECT
from ..schemas.apply import ApplyTaskOut
from ..schemas.common import Page
from ..services.apply import apply_service

router = APIRouter(tags=["apply"])


@router.get("/tasks/page", response_model=Page[ApplyTaskOut])
def list_apply_tasks_page(
    kind: str = Query(default="", description="collect / apply；留空表示不限"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出历史批次（投递 / 采集）：``id desc``，与旧列表同款 DTO。

    「采集记录」面板迁移到这里翻页：采集批次是"跑完就看不见过程"的动作，历史批次
    是用户回溯"上次按什么条件采的、采到了几条"的唯一凭据，不该被 limit 100 截断。
    **声明在 ``/tasks/{task_id}`` 之前**（子路由先于宿主路由注册）：字面量段必须排在
    参数段前面，否则 "page" 会被当成 task_id 去解析。
    """
    if kind and kind not in (TASK_KIND_APPLY, TASK_KIND_COLLECT):
        raise HTTPException(status_code=422, detail="无效的批次类型")
    tasks, total = apply_service.list_apply_tasks_page(
        db, kind=kind, page=page, page_size=page_size
    )
    return Page(items=tasks, total=total)
