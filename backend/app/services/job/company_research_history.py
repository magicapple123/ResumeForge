# SPDX-License-Identifier: Apache-2.0
"""公司调研历史（T07）：每次调研留一条快照，知识库仍只留最新一份。

与 ``company_research_store`` 的分工是刻意的：

- **知识库**回答"这家公司现在长什么样"——同一家公司 ``company + source`` 原地更新，
  只有最新一条（用户可在知识库页面编辑/删除）；
- **历史**回答"我上次看到的是什么"——按运行追加，正文/来源/卡片各存一份快照，
  删历史**不动知识库**，删知识库也不影响历史（``knowledge_entry_id`` 会被置空）。

写路径的纪律：``record_run`` **自己开会话、自己提交**，异常只记日志。调研已经花过搜索费，
"历史没写进去"不能变成"这次调研白跑了"。读路径（列表/详情/删除/清空）都要求调用方
传会话，便于在同一个请求里复用连接。
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...database import SessionLocal
from ...models.company_research import CompanyResearchRun
from ...schemas.research import DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT
from .company_research_store import normalize_company_name

logger = logging.getLogger(__name__)

#: JD 快照上限：与 ``MAX_JD_CHARS`` 同量级，历史不需要比一次调研的输入更长。
MAX_JD_EXCERPT_CHARS = 5_000
#: 页大小的真相在 schema 层（接口与后台任务共用同一组数字）。
DEFAULT_LIMIT = DEFAULT_HISTORY_LIMIT
MAX_LIMIT = MAX_HISTORY_LIMIT


def _clamp_limit(limit: int | None) -> int:
    """把页大小夹进 ``[1, MAX_LIMIT]``：0 或负数会让游标翻页原地打转。"""
    try:
        value = int(limit if limit is not None else DEFAULT_LIMIT)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(value, MAX_LIMIT))


def _jd_digest(jd: str) -> str:
    """JD 指纹：只用于"这次和上次的 JD 一不一样"，不存全文即可比对。"""
    text = str(jd or "")
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def encode_cursor(run: CompanyResearchRun) -> str:
    """游标 = ``created_at|id`` 的 base64url。

    不用偏移量：历史是只追加的，翻页期间新插入一条会让 ``offset`` 之后的行整体后移，
    用户会看到重复条目。``(created_at, id)`` 是严格递减的稳定键。
    """
    raw = f"{run.created_at.isoformat()}|{run.id}".encode()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    """解析游标；格式不对直接抛 ``ValueError``（由接口层转 400，不静默从头开始）。"""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        stamp, _, run_id = raw.rpartition("|")
        return datetime.fromisoformat(stamp), int(run_id)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise ValueError("cursor 无法解析") from exc


def _filters(company: str | None, job_id: int | None) -> list[Any]:
    """公司名归一化后再过滤，与知识库的口径一致（「字节跳动有限公司」= 「字节跳动」）。"""
    conditions: list[Any] = []
    if company:
        normalized = normalize_company_name(company)
        if normalized:
            conditions.append(CompanyResearchRun.company == normalized)
    if job_id:
        conditions.append(CompanyResearchRun.job_id == int(job_id))
    return conditions


def _estimate_bytes(db: Session, conditions: list[Any]) -> int:
    """估算这批历史占多少字节：只数会随历史增长的三列，给前端「约 X MB」。

    用 ``length()`` 在库侧求和而不是把正文读进内存——历史可以长到几百条，
    把它们全查出来只为了加个数字不值得。
    """
    row = (
        db.query(
            func.coalesce(func.sum(func.length(CompanyResearchRun.brief_markdown)), 0),
            func.coalesce(func.sum(func.length(CompanyResearchRun.jd_excerpt)), 0),
            func.coalesce(func.sum(func.length(CompanyResearchRun.sources)), 0),
            func.coalesce(func.sum(func.length(CompanyResearchRun.cards)), 0),
        )
        .filter(*conditions)
        .one_or_none()
    )
    if row is None:
        return 0
    return sum(int(value or 0) for value in row)


def _brief_payload(run: CompanyResearchRun) -> dict[str, Any]:
    """把历史行还原成 ``ResearchBrief`` 形状，前端才能原样复用简报组件。

    历史只存了状态、正文与来源；其余计数（工具调用次数、账单搜索数）是当次运行时
    才有意义的数字，这里补零而不是编一个值。``reason`` 同理：失败原因没有落库，
    详情页对它显示通用说明。
    """
    return {
        "status": run.status or "ok",
        "reason": "",
        "reason_code": "",
        "markdown": run.brief_markdown or "",
        "sources": list(run.sources or []),
        "deep": bool(run.deep),
        "tool_calls": 0,
        "query_terms": 0,
        "billed_searches": 0,
        "fetched_pages": 0,
        "tool_call_budget": 0,
        "tool_budget_exceeded": False,
        "elapsed_ms": int(run.elapsed_ms or 0),
    }


def run_to_dict(run: CompanyResearchRun, *, detail: bool = False) -> dict[str, Any]:
    """列表项只要元信息，详情再带上正文与卡片（一页 20 条正文能有几百 KB）。"""
    payload: dict[str, Any] = {
        "id": run.id,
        "company": run.company,
        "company_raw": run.company_raw,
        "role": run.role,
        "deep": bool(run.deep),
        "status": run.status,
        "search_count": int(run.search_count or 0),
        "elapsed_ms": int(run.elapsed_ms or 0),
        "job_id": run.job_id,
        "knowledge_entry_id": run.knowledge_entry_id,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    if not detail:
        # 列表里给一句话摘要（正文首段），不带整篇 Markdown。
        payload["excerpt"] = _excerpt(run.brief_markdown or "")
        return payload
    payload["jd_excerpt"] = run.jd_excerpt or ""
    payload["jd_hash"] = run.jd_hash or ""
    payload["brief"] = _brief_payload(run)
    payload["sources"] = list(run.sources or [])
    payload["cards"] = list(run.cards or [])
    return payload


def _excerpt(markdown: str, limit: int = 120) -> str:
    """取正文第一段有内容的文字，去掉 Markdown 记号，给列表做一行摘要。"""
    for raw_line in markdown.splitlines():
        line = raw_line.lstrip("#>-*` ").strip()
        if line:
            return line[:limit]
    return ""


def record_run(
    db: Session | None = None,
    *,
    result: dict[str, Any],
    company_raw: str = "",
    jd: str = "",
    job_id: int | None = None,
    knowledge_entry_id: int | None = None,
) -> int | None:
    """把一次调研写成历史行。**独立会话、独立提交**，失败只记日志并返回 ``None``。

    Args:
        db: 已有会话（测试与批处理用）；为 ``None`` 时自己开一个，保证这次写入
            与调用方的事务/连接完全隔离。
        result: :func:`run_company_research_with` 的返回值。
        company_raw: 用户输入的原样公司名（``result["company"]`` 已归一化）。
        jd: 本次的 JD 全文，入库前截断到 :data:`MAX_JD_EXCERPT_CHARS`。
        job_id: 发起调研时的岗位 id。
        knowledge_entry_id: 这次写进/更新的知识条目 id。

    Returns:
        新行的 id；写失败或没有可记录的内容时 ``None``。
    """
    company = normalize_company_name(str(result.get("company") or ""))
    if not company:
        return None
    brief = result.get("brief") or {}
    usage = result.get("usage") or {}
    session = db if db is not None else SessionLocal()
    owns_session = db is None
    try:
        run = CompanyResearchRun(
            company=company,
            company_raw=str(company_raw or result.get("company") or "")[:128],
            role=str(result.get("role") or "")[:80],
            jd_excerpt=str(jd or "").strip()[:MAX_JD_EXCERPT_CHARS],
            jd_hash=_jd_digest(jd),
            deep=bool(result.get("deep")),
            status=str(brief.get("status") or ""),
            brief_markdown=str(brief.get("markdown") or ""),
            sources=list(result.get("sources") or brief.get("sources") or []),
            cards=list(result.get("cards") or []),
            search_count=int(usage.get("search_calls") or 0),
            elapsed_ms=int(usage.get("elapsed_ms") or brief.get("elapsed_ms") or 0),
            knowledge_entry_id=knowledge_entry_id,
            job_id=job_id,
        )
        session.add(run)
        session.commit()
        logger.info(
            "调研历史已记录 id=%s company=%r status=%s",
            run.id,
            company,
            run.status,
        )
        return run.id
    except Exception:  # noqa: BLE001 - 历史是增强项：写失败不能影响调研结果
        session.rollback()
        logger.warning("调研历史写入失败 company=%r", company, exc_info=True)
        return None
    finally:
        if owns_session:
            session.close()


def list_runs(
    db: Session,
    company: str | None = None,
    job_id: int | None = None,
    cursor: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按时间倒序翻页。返回 ``{items, next_cursor, total, bytes}``。

    ``total`` 是**当前筛选条件下**的条数（与列表底部「共 N 条」一致），
    ``bytes`` 是同一批数据的估算体积。
    """
    conditions = _filters(company, job_id)
    page_size = _clamp_limit(limit)
    query = db.query(CompanyResearchRun).filter(*conditions)
    if cursor:
        stamp, last_id = decode_cursor(cursor)
        query = query.filter(
            (CompanyResearchRun.created_at < stamp)
            | ((CompanyResearchRun.created_at == stamp) & (CompanyResearchRun.id < last_id))
        )
    rows = (
        query.order_by(CompanyResearchRun.created_at.desc(), CompanyResearchRun.id.desc())
        # 多取一条用来判断"还有没有下一页"，比再发一次 count 便宜。
        .limit(page_size + 1)
        .all()
    )
    has_more = len(rows) > page_size
    page = rows[:page_size]
    total = int(db.query(func.count(CompanyResearchRun.id)).filter(*conditions).scalar() or 0)
    return {
        "items": [run_to_dict(run) for run in page],
        "next_cursor": encode_cursor(page[-1]) if has_more and page else None,
        "total": total,
        "bytes": _estimate_bytes(db, conditions),
    }


def get_run(db: Session, run_id: int) -> CompanyResearchRun | None:
    """按 id 取历史详情；不存在返回 ``None``。"""
    return db.get(CompanyResearchRun, int(run_id))


def get_run_detail(db: Session, run_id: int) -> dict[str, Any] | None:
    """详情 DTO。转换在 worker 线程里做完，接口层拿到的就是纯 dict（不懒加载）。"""
    run = get_run(db, run_id)
    return run_to_dict(run, detail=True) if run is not None else None


def delete_run(db: Session, run_id: int) -> bool:
    """删掉这一条历史。**不动知识库**——历史与知识库是两份独立的真相。"""
    run = db.get(CompanyResearchRun, int(run_id))
    if run is None:
        return False
    db.delete(run)
    db.commit()
    return True


def clear(db: Session, company: str | None = None, *, allow_all: bool = False) -> int:
    """清空某家公司的全部历史，返回删除条数。

    不带 ``company`` 时必须显式 ``allow_all=True``：这条路径会删掉**所有公司**的历史且
    不可恢复，接口层因此要求 ``all=true`` 才放行——默认行为不能是"什么都不传就全清"。
    """
    conditions = _filters(company, None)
    if not conditions:
        if not allow_all:
            raise ValueError("清空历史需要指定公司名，或显式 all=true")
        query = db.query(CompanyResearchRun)
    else:
        query = db.query(CompanyResearchRun).filter(*conditions)
    deleted = query.delete(synchronize_session=False)
    db.commit()
    logger.info("调研历史已清空 company=%r deleted=%s", company, deleted)
    return int(deleted or 0)


__all__ = [
    "DEFAULT_LIMIT",
    "MAX_JD_EXCERPT_CHARS",
    "MAX_LIMIT",
    "clear",
    "decode_cursor",
    "delete_run",
    "encode_cursor",
    "get_run",
    "get_run_detail",
    "list_runs",
    "record_run",
    "run_to_dict",
]
