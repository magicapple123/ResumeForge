# SPDX-License-Identifier: Apache-2.0
"""知识库接口：条目的增删改查与分类建议（含 #29 的 Markdown 目录导出）。"""

import io
import logging
import re
import zipfile
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.knowledge_entry import KnowledgeEntry
from ..schemas.common import Page
from ..schemas.knowledge import (
    KNOWLEDGE_CATEGORIES,
    KNOWLEDGE_CONTENT_EXCERPT_CHARS,
    KnowledgeBatchDeleteResult,
    KnowledgeBatchRequest,
    KnowledgeEntrySummary,
    KnowledgeFromSourceOut,
    KnowledgeFromSourceRequest,
    KnowledgeRelatedOut,
    KnowledgeReviewPromptOut,
    KnowledgeSearchHit,
    KnowledgeSearchOut,
    KnowledgeTagsOut,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.knowledge import knowledge_actions
from ..services.knowledge_rag import chunk_embedding_text, entry_chunks, hybrid_search
from ..services.knowledge_service import (
    delete_knowledge,
    knowledge_categories,
    knowledge_companies,
    list_knowledge_page,
    list_knowledge_tags,
    related_knowledge,
    review_candidates,
)

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


# T28 Batch B：GET /api/knowledge 由契约层生成（ActionSpec 是参数/权限唯一真源）。
# 注册位置仍由本文件里的调用点显式决定（原来的装饰器位置，保持注册顺序）。
add_action_route(router, knowledge_actions()["list_knowledge"])


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
        # 0014：列表卡片直接显示 reason（#29C）与 summary/key_points（#29E）。
        reason=entry.reason or "",
        company=entry.company or "",
        job_id=entry.job_id,
        summary=entry.summary or "",
        key_points=list(entry.key_points or []),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("/page", response_model=Page[KnowledgeEntrySummary])
def read_knowledge_page(
    q: str = Query(default=""),
    category: str = Query(default=""),
    tag: str = Query(default="", description="按标签筛选：精确匹配 tags 中的成员"),
    company: str = Query(default="", description="按关联公司筛选（#29D，精确匹配）"),
    uncategorized: bool = Query(default=False, description="只看未分类（#29G，分类为空）"),
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
        db,
        q=q,
        category=category,
        tag=tag,
        company=company,
        uncategorized=uncategorized,
        page=page,
        page_size=page_size,
    )
    return Page(items=[_knowledge_summary(entry) for entry in entries], total=total)


# #29A：知识库混合检索（关键词 + 向量）。返回 {id,title,snippet,score}，正文仍由
# GET /api/knowledge/{id} 取——避免一次把全文塞进助手上下文。
@router.get("/search", response_model=KnowledgeSearchOut)
async def search_knowledge(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=8, ge=1, le=30),
    company: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """混合检索（#29A）：关键词路 + 向量路融合；模型不可用时回退关键词。

    向量路复用 services/llm/embeddings 的现有运行时（不起第二份模型）。任何异常
    （未配置 / 本地运行时缺失 / 超时）都退回关键词路并记 fallback_reason，
    与 rag_service 的失败语义一致：检索失败不能让接口 500。
    """
    from ..services.llm.embeddings import create_embedding_provider, resolve_embedding_spec

    query_vector = None
    chunk_vectors = None
    try:
        provider = create_embedding_provider(resolve_embedding_spec())
        if provider is not None:
            query_vector = await provider.embed_query(q)
            flat = [chunk for group in entry_chunks(db).values() for chunk in group]
            if flat:
                batch = await provider.embed_documents(
                    [chunk_embedding_text(chunk) for chunk in flat]
                )
                chunk_vectors = {
                    chunk.chunk_id: vector
                    for chunk, vector in zip(flat, batch.vectors, strict=True)
                }
    except Exception:  # noqa: BLE001 - 任何模型侧异常都回退关键词路，绝不 500
        logger.info("知识库检索 embedding 不可用，回退关键词路", exc_info=True)
        query_vector = None
        chunk_vectors = None
    hits, diagnostics = hybrid_search(
        db,
        q,
        limit=limit,
        company=company,
        query_vector=query_vector,
        chunk_vectors=chunk_vectors,
    )
    return KnowledgeSearchOut(
        items=[
            KnowledgeSearchHit(
                id=hit.entry_id,
                title=hit.title,
                snippet=hit.snippet,
                score=hit.score,
                matched_heading=hit.matched_heading,
                used_vector=hit.used_vector,
            )
            for hit in hits
        ],
        keyword_count=int(diagnostics.get("keyword_count", 0)),
        vector_count=int(diagnostics.get("vector_count", 0)),
        fallback_reason=str(diagnostics.get("fallback_reason", "")),
    )


# #29D：与一家公司 / 一条岗位相关的知识（面试页「这家公司面经 N 条」、岗位详情
# 「相关知识 N 条」共用这一个端点；company/job_id 都是可空列，不做多对多表）。
@router.get("/related", response_model=KnowledgeRelatedOut)
def read_related_knowledge(
    company: str = Query(default=""),
    job_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
):
    total, entries = related_knowledge(db, company=company, job_id=job_id, limit=limit)
    return KnowledgeRelatedOut(
        total=total, items=[_knowledge_summary(entry) for entry in entries]
    )


# #29D：按公司筛选的下拉选项（已用过的公司名，字典序）。
@router.get("/companies", response_model=list[str])
def read_knowledge_companies(db: Session = Depends(get_db)):
    return knowledge_companies(db)


# #29F：复习提醒候选（长期没更新的条目）。「每周提示一次」由前端按周去重，
# 服务端不做定时任务，也不做 SRS（问题清单明确不做）。
@router.get("/review-prompt", response_model=KnowledgeReviewPromptOut)
def read_review_prompt(
    stale_days: int = Query(default=30, ge=7, le=365),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    entries = review_candidates(db, stale_days=stale_days, limit=limit)
    return KnowledgeReviewPromptOut(
        count=len(entries), items=[_knowledge_summary(entry) for entry in entries]
    )

# #29B 知识回流（三个入口共用）：source + source_id，服务端取源数据生成条目。
# 响应 created=False 表示已有同内容条目（重复点击不重复记录）。
@router.post("/from-source", response_model=KnowledgeFromSourceOut, status_code=201)
async def create_knowledge_from_source(
    payload: KnowledgeFromSourceRequest, db: Session = Depends(get_db)
):
    from ..services.knowledge_capture import CaptureSourceError, create_from_source

    try:
        entry, created = await create_from_source(db, payload.source, payload.source_id)
    except CaptureSourceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return KnowledgeFromSourceOut(
        id=int(entry.id),
        title=entry.title,
        category=entry.category,
        source=entry.source,
        created=created,
    )


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



# ===== #29 知识库 Markdown 目录导出（#34C 桌面菜单的数据源之一）=====

#: 单次导出最多多少条：本地单用户够用，同时避免一次把超大知识库全读进内存。
MAX_EXPORT_ENTRIES = 2000
#: zip 成员文件名里不允许出现的字符（Windows/macOS/Linux 三平台取交集）。
_FILENAME_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
#: 文件名里标题的最大长度（给序号与 .md 后缀留余量）。
_FILENAME_TITLE_CHARS = 60


def _safe_export_name(title: str, index: int, used: set[str]) -> str:
    """把条目标题变成安全的 zip 成员名：001-标题.md，非法字符替换、重名加序号。

    导出的是用户自己的知识库，文件名用中文标题可读性最好；只做 sanitize 不做转写，
    正文里也没有任何路径拼接——zip 成员名是固定构造的，不存在 zip-slip 面。
    """
    base = _FILENAME_BAD_CHARS.sub("-", (title or "").strip())
    base = re.sub(r"\s+", " ", base).strip(" .-_")
    base = base[:_FILENAME_TITLE_CHARS] or "未命名条目"
    name = f"{index:03d}-{base}.md"
    suffix = 2
    while name in used:
        name = f"{index:03d}-{base}-{suffix}.md"
        suffix += 1
    used.add(name)
    return name


def _entry_markdown(entry: KnowledgeEntry) -> str:
    """一条知识库条目的 Markdown：H1 标题 + 元信息 + 蒸馏摘要/要点 + 原正文。

    正文原样保留（它就是 Markdown）；摘要与要点放在正文之前，便于导出后直接浏览。
    """
    lines: list[str] = [f"# {entry.title}", ""]
    meta = [f"- 分类：{entry.category or '未分类'}"]
    if entry.company:
        meta.append(f"- 公司：{entry.company}")
    if entry.job_id:
        meta.append(f"- 关联岗位：#{entry.job_id}")
    if entry.tags:
        meta.append(f"- 标签：{'、'.join(str(tag) for tag in entry.tags)}")
    if entry.source:
        meta.append(f"- 来源：{entry.source}")
    if entry.updated_at:
        meta.append(f"- 更新时间：{entry.updated_at:%Y-%m-%d %H:%M}")
    lines.extend(meta)
    if entry.reason:
        lines.extend(["", f"> 为什么记这条：{entry.reason}"])
    if entry.summary:
        lines.extend(["", "## 摘要", "", entry.summary])
    if entry.key_points:
        lines.extend(["", "## 要点", ""])
        lines.extend(f"- {point}" for point in entry.key_points)
    content = (entry.content or "").strip()
    if content:
        lines.extend(["", "---", "", content])
    return "\n".join(lines).strip() + "\n"


@router.get("/export")
def export_knowledge_markdown(db: Session = Depends(get_db)):
    """把整个知识库按标题导出成 Markdown 目录（zip，UTF-8）。

    响应形状（#34C 桌面菜单与后续导出功能共用）：

    - 200 application/zip；Content-Disposition: attachment（filename* 用 UTF-8
      百分号编码，避免中文文件名在 latin-1 头里乱码）；
    - 每个条目一个成员：001-标题.md（标题 sanitize，重名追加 -2）；
    - 成员内容是 UTF-8 Markdown：H1 标题、分类/公司/标签/来源/更新时间、可选
      「为什么记这条」、摘要、要点、原正文；
    - X-Knowledge-Exported 头给出条目数（桌面壳/自动化不用解压就能读到数量）。

    空知识库返回 404（前端据此给「还没有可导出的条目」而不是下载一个空 zip）。
    只导出未删除条目；按 updated_at 倒序编号，与列表排序一致。
    """
    entries = (
        db.query(KnowledgeEntry)
        .filter(trash.live_only(KnowledgeEntry))
        .order_by(KnowledgeEntry.updated_at.desc(), KnowledgeEntry.id.desc())
        .limit(MAX_EXPORT_ENTRIES)
        .all()
    )
    if not entries:
        raise HTTPException(status_code=404, detail="知识库还没有可导出的条目")
    buffer = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, entry in enumerate(entries, start=1):
            archive.writestr(_safe_export_name(entry.title, index, used), _entry_markdown(entry))
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    download_name = f"知识库导出-{stamp}.zip"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name, safe='')}",
        "X-Knowledge-Exported": str(len(entries)),
    }
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)

# T28 Batch B：POST /api/knowledge 由契约层生成（可逆写，带 preview）。
add_action_route(router, knowledge_actions()["create_knowledge"])


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


# T28 Batch B：GET /api/knowledge/{knowledge_id} 由契约层生成（只读）。
add_action_route(router, knowledge_actions()["get_knowledge"])


# T28 Batch B：PUT /api/knowledge/{knowledge_id} 由契约层生成（可逆写，带 preview）。
add_action_route(router, knowledge_actions()["update_knowledge"])


@router.delete("/{knowledge_id}", status_code=204)
def remove_knowledge_entry(knowledge_id: int, db: Session = Depends(get_db)):
    if not delete_knowledge(db, knowledge_id):
        raise HTTPException(status_code=404, detail="知识库条目不存在或已被删除")
