# SPDX-License-Identifier: Apache-2.0
"""职业场景接口（A1）：内置目录、当前数据集场景 CRUD 与归档。

四个端点（契约 §2.4）：

- `GET /api/career-scenarios/catalog`：内置快捷场景 + 目录版本 + 限量。目录损坏返回 503，
  **不阻断**旧生成——前端继续可使用"不带场景"的流程（计划 §7.3）。
- `GET /api/career-scenarios`：当前数据集已保存场景；默认不含 archived
  （`include_archived=true` 可显式查看）。
- `POST /api/career-scenarios`：创建受限配置（201）；超量/格式错误 400/422。
- `PATCH /api/career-scenarios/{id}`：条件更新（`expected_revision` 不符 → 409，顶层
  `code=career_scenario_revision_conflict`，并回传库里当前 `revision`）；归档同样走这里。

错误响应形状与既有 `resume_revision_conflict` 一致（`{"detail", "code", "revision"}`），
前端 `ApiError.businessCode` 已在读顶层 `code`，不新建第二套错误契约。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.career_scenario import (
    CareerScenarioCatalogOut,
    CareerScenarioCreate,
    CareerScenarioListOut,
    CareerScenarioOut,
    CareerScenarioUpdate,
    CatalogLimitsOut,
    CatalogPresetOut,
)
from ..services.career_scenarios import catalog, store

router = APIRouter(prefix="/api/career-scenarios", tags=["career-scenarios"])


def _store_error_response(exc: store.ScenarioStoreError) -> JSONResponse:
    content: dict[str, object] = {"detail": exc.detail, "code": exc.code}
    if isinstance(exc, store.ScenarioRevisionConflict):
        content["revision"] = exc.current_revision
    return JSONResponse(status_code=exc.status_code, content=content)


@router.get(
    "/catalog",
    response_model=CareerScenarioCatalogOut,
    responses={503: {"description": "内置场景目录不可用；前端可继续不带场景使用"}},
)
def read_catalog():
    """内置目录。失败可继续用旧生成；这里只如实报告不可用，不返回空目录冒充成功。"""
    try:
        builtin = catalog.load_catalog()
    except catalog.CatalogError as exc:
        return JSONResponse(
            status_code=503, content={"detail": exc.detail, "code": exc.code}
        )
    return CareerScenarioCatalogOut(
        catalog_version=builtin.catalog_version,
        schema_version=builtin.schema_version,
        limits=CatalogLimitsOut(),
        presets=[
            CatalogPresetOut(
                key=preset.key,
                name=preset.name,
                config=preset.config,
                suggested_sections=list(preset.suggested_sections),
                guidance=list(preset.guidance),
            )
            for preset in builtin.presets
        ],
    )


@router.get("", response_model=CareerScenarioListOut)
def read_scenarios(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    rows, total = store.list_scenarios(db, include_archived=include_archived)
    return CareerScenarioListOut(
        items=[CareerScenarioOut.model_validate(row) for row in rows],
        total=total,
    )


@router.post("", response_model=CareerScenarioOut, status_code=201)
def create_scenario(payload: CareerScenarioCreate, db: Session = Depends(get_db)):
    try:
        row = store.create_scenario(db, payload)
    except store.ScenarioStoreError as exc:
        return _store_error_response(exc)
    return CareerScenarioOut.model_validate(row)


@router.patch(
    "/{scenario_id}",
    response_model=CareerScenarioOut,
    responses={
        404: {"description": "场景不存在"},
        409: {"description": "expected_revision 与库里当前版本不一致"},
    },
)
def update_scenario(
    payload: CareerScenarioUpdate,
    scenario_id: int = Path(ge=1),
    db: Session = Depends(get_db),
):
    try:
        row = store.update_scenario(db, scenario_id, payload)
    except store.ScenarioStoreError as exc:
        return _store_error_response(exc)
    return CareerScenarioOut.model_validate(row)


__all__ = ["router"]
