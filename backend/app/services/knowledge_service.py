"""知识库：条目的持久化、检索与软删除。

检索口径集中在 ``list_knowledge``：标题/正文按关键词命中（``q``）、分类精确筛选
（``category``）、只取未删除的行（``live_only``）、按 ``updated_at`` 倒序。删除一律走
``trash.soft_delete`` 进回收站（``knowledge_entry`` 已在 ``TRASH_SPECS`` 注册）。
"""
from __future__ import annotations

import logging

from sqlalchemy import func, literal, or_, select
from sqlalchemy.orm import Query, Session

from ..models.knowledge_entry import KnowledgeEntry
from ..schemas.knowledge import KnowledgeCreate, KnowledgeUpdate
from . import trash

logger = logging.getLogger(__name__)


def _tag_expression(tag: str):
    """``tag ∈ tags`` 的 SQL 形态（SQLite JSON1）：与前端 ``tags.includes(tag)`` 同语义。

    **必须精确成员判定**而不是 LIKE 子串：标签「面」不该命中「面经」。``tags`` 是
    JSON 数组列，用 ``json_each`` 展开成行再比对，数据库层完成过滤——这样分页与
    total 都建立在筛选后的集合上，而不是"先翻页再在页内挑标签"。
    """
    values = func.json_each(KnowledgeEntry.tags).table_valued("value")
    return select(literal(1)).select_from(values).where(values.c.value == tag).exists()


def _filtered_query(db: Session, *, q: str = "", category: str = "") -> Query[KnowledgeEntry]:
    """list_knowledge 与 list_knowledge_page **共用的过滤口径**。

    检索口径集中在这一处：标题/正文按关键词命中（``q``）、分类精确筛选（``category``）、
    只取未删除的行。两处各写一遍迟早会改漏一边。
    """
    query = db.query(KnowledgeEntry).filter(trash.live_only(KnowledgeEntry))
    if category.strip():
        query = query.filter(KnowledgeEntry.category == category.strip())
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                KnowledgeEntry.title.like(like),
                KnowledgeEntry.content.like(like),
            )
        )
    return query


def list_knowledge(db: Session, *, q: str = "", category: str = "") -> list[KnowledgeEntry]:
    """列表：按分类/关键词筛选，只看未删除条目，按更新时间倒序。"""
    return _filtered_query(db, q=q, category=category).order_by(
        KnowledgeEntry.updated_at.desc(), KnowledgeEntry.id.desc()
    ).all()


def list_knowledge_page(
    db: Session,
    *,
    q: str = "",
    category: str = "",
    tag: str = "",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[KnowledgeEntry], int]:
    """分页列出知识库条目（RF-08）：过滤与排序与 :func:`list_knowledge` 完全一致。

    ``tag`` 是分页端点的**新增**筛选（旧全量列表把标签筛选留在前端做，迁移到分页后
    必须下沉到查询里，否则标签筛选会退化成"当前页内挑标签"）：精确成员判定，见
    :func:`_tag_expression`。筛选全部发生在**分页之前**，total 反映筛选后的集合。
    """
    query = _filtered_query(db, q=q, category=category)
    if tag.strip():
        query = query.filter(_tag_expression(tag.strip()))
    total = query.count()
    rows = (
        query.order_by(KnowledgeEntry.updated_at.desc(), KnowledgeEntry.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total


def list_knowledge_tags(db: Session) -> list[str]:
    """全库（未删除条目）标签的去重集合，按**字典序**升序返回。

    ``GET /api/knowledge/tags`` 的数据源：服务端分页之后前端不再持有全量列表，标签
    下拉的选项改由这里聚合。与 :func:`_tag_expression` 同源——同一份 ``tags`` JSON
    存储、同一口径的 ``live_only``。空库返回空数组。

    实现取舍：考虑过 ``SELECT DISTINCT value FROM entries, json_each(entries.tags)``
    的 SQL 聚合，但 SQLAlchemy 会把这种关联表值函数判成笛卡尔积并发 SAWarning；
    而本查询只取 ``tags`` 列（不含正文），条目量级下 Python 聚合等价且跨方言可移植，
    故在应用层去重排序。排序取**字典序**而不是使用频次：频次随数据漂移（新增一条
    就可能换序），字典序稳定可测试；下拉选项本来就全量展示，不需要频次语义。
    """
    rows = db.query(KnowledgeEntry.tags).filter(trash.live_only(KnowledgeEntry)).all()
    return sorted({str(tag) for (tags,) in rows for tag in (tags or [])})


def knowledge_or_none(db: Session, knowledge_id: int) -> KnowledgeEntry | None:
    """取一条条目；**已在回收站里的当作不存在**（与资料箱 ``material_or_none`` 同语义）。"""
    entry = db.get(KnowledgeEntry, knowledge_id)
    if entry is None or trash.is_deleted(entry):
        return None
    return entry


def create_knowledge(db: Session, payload: KnowledgeCreate) -> KnowledgeEntry:
    """新增一条知识库条目。"""
    entry = KnowledgeEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    logger.info(
        "已新增知识库条目 id=%s category=%s 标签=%s",
        entry.id,
        entry.category,
        len(entry.tags),
    )
    return entry


def update_knowledge(
    db: Session, entry: KnowledgeEntry, payload: KnowledgeUpdate
) -> KnowledgeEntry:
    for field, value in payload.model_dump().items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return entry


def delete_knowledge(db: Session, knowledge_id: int) -> bool:
    """移入回收站（软删除）；彻底删除在「回收站」里单独提供。"""
    entry = db.get(KnowledgeEntry, knowledge_id)
    if entry is None or trash.is_deleted(entry):
        return False
    trash.soft_delete(db, "knowledge_entry", entry)
    db.commit()
    return True


def knowledge_categories(db: Session) -> list[str]:
    """已使用过的分类，供界面与接口给出建议。"""
    rows = db.query(KnowledgeEntry.category).distinct().all()
    return sorted({row[0] for row in rows if row[0]})


__all__ = [
    "create_knowledge",
    "delete_knowledge",
    "knowledge_categories",
    "knowledge_or_none",
    "list_knowledge",
    "list_knowledge_page",
    "list_knowledge_tags",
    "update_knowledge",
]

