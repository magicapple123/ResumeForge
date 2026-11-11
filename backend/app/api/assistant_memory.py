# SPDX-License-Identifier: Apache-2.0
"""助手语义记忆接口（#31C / #18D）：设置页列表、手填、逐条编辑、删除与自动抽取开关。

与 #31A/#31B 的关系：写入由这里（手动）或后台抽取任务完成；注入由系统提示装配读取。
设置页是唯一的人工维护入口——**不可见不可改的记忆是负债**，所以自动抽取默认关闭，
直到这个页面可用。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant_memory import MEMORY_KIND_LABELS, MEMORY_KINDS
from ..schemas.assistant_memory import (
    AssistantMemoryCreate,
    AssistantMemoryOut,
    AssistantMemorySettings,
    AssistantMemoryUpdate,
)
from ..services.assistant import memory

router = APIRouter(prefix="/api/assistant/memories", tags=["assistant"])


def _out(record: memory.AssistantMemory) -> AssistantMemoryOut:
    """ORM 行 -> 设置页视图；展示名在这里补（后端不翻译，前端按 kind 也有映射）。"""
    payload = AssistantMemoryOut.model_validate(record)
    payload.kind_label = MEMORY_KIND_LABELS.get(record.kind, record.kind)
    return payload


@router.get("/settings", response_model=AssistantMemorySettings)
def read_memory_settings(db: Session = Depends(get_db)):
    """读取自动抽取开关（默认 false）。"""
    return AssistantMemorySettings(auto_extract=memory.auto_extract_enabled(db))


@router.put("/settings", response_model=AssistantMemorySettings)
def update_memory_settings(payload: AssistantMemorySettings, db: Session = Depends(get_db)):
    """打开/关闭自动抽取（#31A 的写入总开关）。"""
    enabled = memory.set_auto_extract(db, payload.auto_extract)
    return AssistantMemorySettings(auto_extract=enabled)


@router.get("", response_model=list[AssistantMemoryOut])
def list_memories(
    status: str | None = Query(
        default=None, description="active/superseded/deleted；空=不含已删除"
    ),
    kind: str = Query(default="", description="按类型筛选"),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """设置页列表：内容 / 来源（可点回对话）/ 时间 / 置信度 / 状态。"""
    rows = memory.list_memories(db, status=status, kind=kind, limit=limit)
    return [_out(row) for row in rows]


@router.get("/kinds", response_model=list[dict])
def read_memory_kinds():
    """kind 白名单 + 展示名（前端表单的下拉选项）。"""
    return [{"kind": kind, "label": MEMORY_KIND_LABELS.get(kind, kind)} for kind in MEMORY_KINDS]


@router.post("", response_model=AssistantMemoryOut, status_code=201)
def create_memory_endpoint(payload: AssistantMemoryCreate, db: Session = Depends(get_db)):
    """手填一条记忆（#18D 结构化画像，source=manual）。冲突时旧的置 superseded。"""
    try:
        record = memory.create_memory(
            db,
            kind=payload.kind,
            value=payload.value,
            key=payload.key,
            confidence=payload.confidence if payload.confidence is not None else 1.0,
            source="manual",
            conversation_id=payload.conversation_id,
            message_id=payload.message_id,
        )
    except memory.MemoryValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _out(record)


@router.patch("/{memory_id}", response_model=AssistantMemoryOut)
def update_memory_endpoint(
    memory_id: int, payload: AssistantMemoryUpdate, db: Session = Depends(get_db)
):
    """逐条编辑（内容 / 键 / 置信度）。已删除的记忆不允许再改。"""
    record = memory.memory_or_none(db, memory_id, include_deleted=False)
    if record is None:
        raise HTTPException(status_code=404, detail="这条记忆不存在或已被删除")
    try:
        updated = memory.update_memory(
            db, record, value=payload.value, key=payload.key, confidence=payload.confidence
        )
    except memory.MemoryValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _out(updated)


@router.delete("/{memory_id}", status_code=204)
def delete_memory_endpoint(memory_id: int, db: Session = Depends(get_db)):
    """删除一条记忆（软删 status=deleted，不再注入；保留行以便回溯）。"""
    record = memory.memory_or_none(db, memory_id, include_deleted=False)
    if record is None:
        raise HTTPException(status_code=404, detail="这条记忆不存在或已被删除")
    memory.delete_memory(db, record)


@router.post("/{memory_id}/never-use", response_model=AssistantMemoryOut)
def never_use_memory_endpoint(memory_id: int, db: Session = Depends(get_db)):
    """标「永不使用」：与删除同一效果（不再注入），但作为显式动作单列一个端点。

    migration 0015 的 status 只有 active/superseded/deleted 三态；"永不使用"在语义上是
    "用户主动停用"，复用 deleted 而不新增状态——它在列表里仍可被 status=deleted 查到，
    从而保留"助手记过什么"的可回溯性。
    """
    record = memory.memory_or_none(db, memory_id, include_deleted=False)
    if record is None:
        raise HTTPException(status_code=404, detail="这条记忆不存在或已被删除")
    memory.delete_memory(db, record)
    return _out(record)


__all__ = ["router"]
