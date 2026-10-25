# SPDX-License-Identifier: Apache-2.0
"""补充事实接口：九类事实的本地 CRUD + 字段设置（隐藏/自定义字段）。

薄路由：参数校验、调 service、返回 schema。生成候选的只读读取在
services/profile/fact_context.py；本文件不碰生成链路。

删除只做软删（deleted_at）：恢复与彻底删除走既有 /api/trash（type_key=profile_fact）——
删除永远先经过可恢复的一步，不在这里写第二套恢复逻辑。

字段设置（灵活化契约 §3-4）：GET /schema 读九类定义；PUT /schema/{kind} 条件写；
POST /schema/{kind}/reset 恢复默认。revision 冲突返回 409 + 顶层 code；格式/超限/
未知字段返回 400（这是配置错误，不是"事实数据不合法"的 422）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.profile_fact import PROFILE_FACT_KINDS
from ..schemas.profile_facts import (
    FACT_CUSTOM_FIELD_VALUE_MAX,
    FACT_LIST_LIMIT_DEFAULT,
    FACT_LIST_LIMIT_MAX,
    FactCustomFieldDefinitionOut,
    KindFieldSchemaOut,
    ProfileFactCreate,
    ProfileFactDeleteOut,
    ProfileFactFieldSchemaReset,
    ProfileFactFieldSchemasOut,
    ProfileFactFieldSchemaUpdate,
    ProfileFactKind,
    ProfileFactListOut,
    ProfileFactOut,
    ProfileFactUpdate,
)
from ..services.profile import fact_field_schema, fact_store

router = APIRouter(prefix="/api/profile/facts", tags=["profile-facts"])

# 冲突文案要说明"发生了什么 + 怎么办"：用户下一步是刷新比较或另存，而不是重试。
CONFLICT_DETAIL = "这条补充事实已在其他窗口被修改，请刷新后再保存"


def _conflict_response(current_revision: int) -> JSONResponse:
    """409 冲突响应体（detail + 顶层 code + 当前 revision）。

    与简历保存冲突同一形状：前端的 ApiError.businessCode 已经在读顶层 code，
    不新建第二套错误契约。
    """
    return JSONResponse(
        status_code=409,
        content={
            "detail": CONFLICT_DETAIL,
            "code": fact_store.PROFILE_FACT_CONFLICT_CODE,
            "revision": current_revision,
        },
    )


# 字段设置的冲突文案：告诉用户下一步（刷新比较），而不是只说"服务器拒绝"。
SCHEMA_CONFLICT_DETAIL = "字段设置已在其他窗口被修改，请刷新后再保存"


def _schema_conflict_response(current_revision: int) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": SCHEMA_CONFLICT_DETAIL,
            "code": fact_field_schema.PROFILE_FACT_SCHEMA_CONFLICT_CODE,
            "revision": current_revision,
        },
    )


def _fact_out(row) -> ProfileFactOut:
    """读取形状：旧记录补 custom_fields=[]，让前端不必为历史数据做特判。

    灵活字段上线前的 payload 没有 custom_fields；若原样返回，前端自定义字段展示
    会对 undefined 调 map（整页错误）。只在读出边界补这一个新键，不改库、不改其它字段。
    """
    item = ProfileFactOut.model_validate(row)
    payload = dict(item.payload or {})
    if not isinstance(payload.get("custom_fields"), list):
        payload["custom_fields"] = []
    return item.model_copy(update={"payload": payload})


def _schema_out(schema: fact_field_schema.KindFieldSchema) -> KindFieldSchemaOut:
    return KindFieldSchemaOut(
        kind=schema.kind,
        revision=schema.revision,
        default_fields=list(fact_field_schema.FACT_DEFAULT_FIELDS[schema.kind]),
        hidden_fields=list(schema.hidden_fields),
        custom_fields=[
            FactCustomFieldDefinitionOut(key=item["key"], label=item["label"])
            for item in schema.custom_fields
        ],
        max_custom_fields=fact_field_schema.CUSTOM_FIELD_LIMIT,
    )


@router.get("/schema", response_model=ProfileFactFieldSchemasOut)
def read_fact_field_schemas(db: Session = Depends(get_db)) -> ProfileFactFieldSchemasOut:
    """九类事实的字段设置：默认字段全集、隐藏项、自定义字段定义与 revision。"""
    schemas = fact_field_schema.load_field_schemas(db)
    return ProfileFactFieldSchemasOut(
        kinds=[_schema_out(schemas[kind]) for kind in PROFILE_FACT_KINDS],
        max_custom_field_value_chars=FACT_CUSTOM_FIELD_VALUE_MAX,
    )


@router.put("/schema/{kind}", response_model=KindFieldSchemaOut)
def update_fact_field_schema(
    kind: ProfileFactKind,
    payload: ProfileFactFieldSchemaUpdate,
    db: Session = Depends(get_db),
) -> KindFieldSchemaOut | JSONResponse:
    """条件更新一种类型的字段设置；custom_fields 里无 key 的项由服务端生成。"""
    try:
        schema = fact_field_schema.update_field_schema(
            db,
            kind,
            hidden_fields=list(payload.hidden_fields),
            custom_fields=[item.model_dump() for item in payload.custom_fields],
            expected_revision=payload.expected_revision,
        )
    except fact_field_schema.SchemaRevisionConflict as exc:
        return _schema_conflict_response(exc.current_revision)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _schema_out(schema)


@router.post("/schema/{kind}/reset", response_model=KindFieldSchemaOut)
def reset_fact_field_schema(
    kind: ProfileFactKind,
    payload: ProfileFactFieldSchemaReset,
    db: Session = Depends(get_db),
) -> KindFieldSchemaOut | JSONResponse:
    """恢复默认：清空隐藏项与自定义字段定义（已录事实的旧值保留在 payload 里）。"""
    try:
        schema = fact_field_schema.reset_field_schema(
            db, kind, expected_revision=payload.expected_revision
        )
    except fact_field_schema.SchemaRevisionConflict as exc:
        return _schema_conflict_response(exc.current_revision)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _schema_out(schema)


@router.get("", response_model=ProfileFactListOut)
def list_profile_facts(
    kind: ProfileFactKind | None = Query(default=None, description="按事实种类过滤"),
    include_deleted: bool = Query(default=False, description="是否包含回收站里的事实"),
    offset: int = Query(default=0, ge=0, description="从第几条开始"),
    limit: int = Query(
        default=FACT_LIST_LIMIT_DEFAULT,
        ge=1,
        le=FACT_LIST_LIMIT_MAX,
        description="本次最多返回多少条",
    ),
    db: Session = Depends(get_db),
) -> ProfileFactListOut:
    """当前数据集的事实列表：默认不含软删，按 sort_order、id 升序。"""
    rows, total = fact_store.list_facts(
        db,
        kind=kind,
        include_deleted=include_deleted,
        offset=offset,
        limit=limit,
    )
    return ProfileFactListOut(
        items=[_fact_out(row) for row in rows],
        total=total,
    )


@router.post("", response_model=ProfileFactOut, status_code=201)
def create_profile_fact(
    payload: ProfileFactCreate, db: Session = Depends(get_db)
) -> ProfileFactOut:
    """新增一条事实；fact_id 由服务端生成（稳定身份，不由前端指定）。"""
    try:
        fact = fact_store.create_fact(
            db,
            kind=payload.kind,
            payload=payload.payload.model_dump(mode="json"),
            sort_order=payload.sort_order,
        )
    except ValueError as exc:
        # 正常情况下判别联合已在请求解析时拦下非法 payload；这里是服务层防御的出口。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ProfileFactOut.model_validate(fact)


@router.patch("/{fact_id}", response_model=ProfileFactOut)
def update_profile_fact(
    fact_id: str, payload: ProfileFactUpdate, db: Session = Depends(get_db)
) -> ProfileFactOut | JSONResponse:
    """条件更新：payload 整份替换；expected_revision 不符返回 409。"""
    try:
        fact = fact_store.update_fact(
            db,
            fact_id,
            payload=payload.payload,
            sort_order=payload.sort_order,
            expected_revision=payload.expected_revision,
        )
    except fact_store.RevisionConflict as exc:
        return _conflict_response(exc.current_revision)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        # payload 按事实的既有 kind 重新校验失败 → 422，且不修改旧值。
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ProfileFactOut.model_validate(fact)


@router.delete("/{fact_id}", response_model=ProfileFactDeleteOut)
def delete_profile_fact(fact_id: str, db: Session = Depends(get_db)) -> ProfileFactDeleteOut:
    """软删进回收站（可恢复），重复删除幂等；彻底删除走 /api/trash。"""
    try:
        fact_store.soft_delete_fact(db, fact_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ProfileFactDeleteOut()
