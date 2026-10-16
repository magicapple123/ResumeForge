"""知识库接口：条目的增删改查与分类建议。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.knowledge_entry import KnowledgeEntry
from ..schemas.common import Page
from ..schemas.knowledge import (
    KNOWLEDGE_CATEGORIES,
    KNOWLEDGE_CONTENT_EXCERPT_CHARS,
    KnowledgeBatchDeleteResult,
    KnowledgeBatchRequest,
    KnowledgeCreate,
    KnowledgeEntrySummary,
    KnowledgeOut,
    KnowledgeTagsOut,
    KnowledgeUpdate,
)
from ..services import trash
from ..services.knowledge_service import (
    create_knowledge,
    delete_knowledge,
    knowledge_categories,
    knowledge_or_none,
    list_knowledge,
    list_knowledge_page,
    list_knowledge_tags,
    update_knowledge,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


@router.get("", response_model=list[KnowledgeEntrySummary])
def read_knowledge(
    q: str = Query(default=""),
    category: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """旧全量列表端点（P1-6）：改用摘要 DTO，``content`` 只带 200 字截断。

    搜索（``q``）与分类过滤的语义不变；全文仍走 ``GET /{knowledge_id}``。条目数千
    之后全量正文会把响应拖到 MB 级，而列表消费方（历史前端、助手工具）只需要标题、
    分类、标签与摘要——QA 实测同一份压力数据下搜索响应从 2.12MB 降到 KB 级。
    """
    return [_knowledge_summary(entry) for entry in list_knowledge(db, q=q, category=category)]


def _knowledge_summary(entry: KnowledgeEntry) -> KnowledgeEntrySummary:
    """列表行的摘要视图：``content`` 只带 200 字截断，全文走详情端点。

    截断留在 API 层（service 不依赖响应 DTO 的组装细节），长度上限由
    :data:`KNOWLEDGE_CONTENT_EXCERPT_CHARS` 与 schema 的 ``Field(max_length=...)``
    共同钉住——两处用的是同一个常量，不会漂移。
    """
    return KnowledgeEntrySummary(
        id=entry.id,
        title=entry.title,
        category=entry.category,
        tags=list(entry.tags or []),
        source=entry.source,
        content_excerpt=(entry.content or "")[:KNOWLEDGE_CONTENT_EXCERPT_CHARS],
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("/page", response_model=Page[KnowledgeEntrySummary])
def read_knowledge_page(
    q: str = Query(default=""),
    category: str = Query(default=""),
    tag: str = Query(default="", description="按标签筛选：精确匹配 tags 中的成员"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出知识库条目（RF-08）：过滤与排序与旧列表端点完全一致。

    旧端点 ``GET /api/knowledge`` 一次返回**全量**条目（``.all()`` 无上限），条目
    数千之后每次都拖一份含正文的大响应；本端点按页取，且列表 DTO 只带摘要——
    ``content`` 全文不进列表响应，回看单条时走详情端点。``tag`` 筛选在**分页之前**
    生效（服务层 SQL 过滤），total 反映筛选后的集合——旧的标签筛选是前端在全量列表
    上做的，迁移到分页后必须下沉到查询里，否则会退化成"当前页内挑标签"。
    **声明在 ``/{knowledge_id}`` 之前**：字面量段必须排在参数段前面（同
    ``/categories`` 的理由）。
    """
    entries, total = list_knowledge_page(
        db, q=q, category=category, tag=tag, page=page, page_size=page_size
    )
    return Page(items=[_knowledge_summary(entry) for entry in entries], total=total)


# 字面量段 /categories 必须排在 /{knowledge_id} 之前，否则会被参数段吞掉。
@router.get("/categories", response_model=list[str])
def read_categories(db: Session = Depends(get_db)):
    """候选分类：内置分类在前，用户已用过的自定义分类在后。"""
    used = knowledge_categories(db)
    return list(dict.fromkeys([*KNOWLEDGE_CATEGORIES, *used]))


@router.get("/tags", response_model=KnowledgeTagsOut)
def read_knowledge_tags(db: Session = Depends(get_db)):
    """全库标签下拉选项：所有未删除条目 tags 的去重集合（字典序升序）。

    服务端分页之后前端不再持有全量列表，标签下拉的数据源断在这里补上；用
    ``tag`` 参数回查 :samp:`GET /api/knowledge/page` 时，两侧语义同源（同一份
    tags 存储、同一个精确成员判定）。排序取字典序而不是使用频次：频次随数据
    漂移、字典序稳定可测试。声明在 ``/{knowledge_id}`` 之前（同 ``/categories``）。
    """
    return KnowledgeTagsOut(tags=list_knowledge_tags(db))


@router.post("", response_model=KnowledgeOut, status_code=201)
def create_knowledge_entry(payload: KnowledgeCreate, db: Session = Depends(get_db)):
    return create_knowledge(db, payload)


@router.post("/batch-delete", response_model=KnowledgeBatchDeleteResult)
def batch_delete_knowledge(payload: KnowledgeBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 ``DELETE /{knowledge_id}``：任何一条 id 不存在或已在回收站里即
    整体 404 并附缺失 id 清单，不做"删一半"。**声明在 ``/{knowledge_id}`` 之前**
    （字面量段排在参数段前面，同 ``/categories``）。
    """
    entries: list[KnowledgeEntry] = []
    missing: list[int] = []
    for knowledge_id in payload.knowledge_ids:
        entry = trash.get_live(db, KnowledgeEntry, knowledge_id)
        if entry is None:
            missing.append(knowledge_id)
        else:
            entries.append(entry)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下知识库条目不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for entry in entries:
        trash.soft_delete(db, "knowledge_entry", entry)
    db.commit()
    return KnowledgeBatchDeleteResult(deleted=len(entries))


@router.get("/{knowledge_id}", response_model=KnowledgeOut)
def read_knowledge_entry(knowledge_id: int, db: Session = Depends(get_db)):
    entry = knowledge_or_none(db, knowledge_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识库条目不存在或已被删除")
    return entry


@router.put("/{knowledge_id}", response_model=KnowledgeOut)
def save_knowledge_entry(
    knowledge_id: int, payload: KnowledgeUpdate, db: Session = Depends(get_db)
):
    entry = knowledge_or_none(db, knowledge_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="知识库条目不存在或已被删除")
    return update_knowledge(db, entry, payload)


@router.delete("/{knowledge_id}", status_code=204)
def remove_knowledge_entry(knowledge_id: int, db: Session = Depends(get_db)):
    if not delete_knowledge(db, knowledge_id):
        raise HTTPException(status_code=404, detail="知识库条目不存在或已被删除")
