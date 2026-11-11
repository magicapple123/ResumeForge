# SPDX-License-Identifier: Apache-2.0
"""采集历史（15A 僵尸岗雷达 / 15B JD 变更）：把「重采跳过」变成「重采留痕」。

本模块只做两件事，拆出来的首要理由是行数（``collector.py`` 当时已 499/500，而这一批要
往里加"每条结果记一次采样"），职责边界本身很清楚：

- :func:`already_known` —— 去重判据。**从 ``collector.py`` 原样搬来**，语义一个字没改
  （只把"查岗位"这一步提到调用方，见下）；
- :func:`record_sighting` —— 把这次见到的岗位写进 ``job_seen``（**不 commit**，由采集
  ``run`` 统一提交，与暂存候选同一个事务）。

三条纪律：

1. **去重判据只有一份**：岗位广场 + 备选暂存区都要查（少查一边的症状写在
   :func:`already_known` 的 docstring 里）。这条判据与"勾选导入"的重复判定同源，
   任何一处另写一份必然漂移。
2. **每条结果只查一次岗位**：``already_known`` 与 ``record_sighting`` 都需要"这个岗位在
   不在岗位上"，所以查一次、两边复用（:func:`known_job_of`）。写死成每个函数各查一次的话，
   每条结果会多两次 SQL——采集一页就是几十次白查。
3. **采样不抓详情**：列表页的 ``extra``（薪资 / HR 活跃）已经够 15A 用；为了记一次采样去
   打开详情页，等于把采集速度砍一半、还多一次风控暴露。JD 指纹只在**岗位已入库**时从
   ``job.description`` 取——那是本地已有的正文，不额外联网。
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.job_seen import JobSeen
from ...models.profile import utcnow
from .. import trash
from ..candidate_jobs import find_staged_candidate
from ..job.job_service import find_job_by_identity
from ..sites.base import SearchResult

# ``already_known`` 的三种返回值。空串沿用旧名（"没采过"），不提成常量是为了让
# ``if known:`` / ``known == "trashed"`` 这些既有调用点一个字都不用改。
KNOWN_NEW = ""
KNOWN_EXISTING = "existing"
KNOWN_TRASHED = "trashed"

# JD 快照只存前 2000 字：15B 的界面是"before → after 两段并排"，2000 字足够看清改了什么；
# 存全文会让 job_seen 随采集次数按 JD 体量成倍膨胀（一条 JD 常有 5–20KB）。
MAX_DESCRIPTION_SNAPSHOT = 2000

# 列宽（与迁移 0012 一致）。在写入处再裁一次是刻意的：SQLite 不校验 VARCHAR 长度，
# 不裁的话一个超长公司名会以"能存进去"的方式活下来，直到换库/导出时才炸。
MAX_URL_CHARS = 512
MAX_TITLE_CHARS = 128
MAX_COMPANY_CHARS = 128
MAX_SALARY_CHARS = 64
MAX_HR_ACTIVE_CHARS = 32
MAX_HR_ACTIVE_TIME_CHARS = 64


def _clip(value: object, limit: int) -> str:
    """取文本并按列宽裁剪（``None`` → 空串；非字符串一律 ``str()``）。"""
    text = "" if value is None else str(value)
    return text.strip()[:limit]


def known_job_of(session: Session, result: SearchResult) -> Job | None:
    """按去重判据里的同一组身份字段，查一次岗位广场。

    返回 ``None`` 表示"岗位上没有这条"（它可能还在备选暂存区里，也可能两条都没有——
    后者由 :func:`already_known` 区分）。调用方拿这次结果同时喂给
    :func:`already_known` 与 :func:`record_sighting`，两边不再各查一次。
    """
    return find_job_by_identity(
        session,
        title=result.title,
        company=result.company,
        source_url=result.url,
    )


def already_known(session: Session, result: SearchResult, *, job: Job | None) -> str:
    """这个岗位是否已经有"正式岗位"或"待处理的候选"，以及**在不在回收站里**。

    返回 ``""``（没采过）/ ``"existing"``（库里已有）/ ``"trashed"``（在回收站里）。

    **两张表都要查**，少查一边都会出问题：只查岗位广场，暂存区里会堆出同一岗位的多条
    候选（用户勾一次就重复导入一次）；只查暂存区，则会把已经在岗位广场里的岗位重新捞回来，
    让用户以为采到了新东西。去重判据本身走 ``find_by_job_identity``——与后续"勾选导入"
    的重复判定是同一份实现，且对岗位广场**刻意不过滤软删除**。

    区分"在回收站里"是因为这两种"跳过"对用户的含义完全不同：一种是"早就在库里了"，
    另一种是"你之前删过它"——后者得说清楚，否则用户会以为删除没生效（或者以为工具坏了）。

    **暂存区那一句不区分**：候选岗位（0050 起也在回收站范围内）的去重显式排除已删的
    （``find_staged_candidate`` 传 ``skip_deleted=True``），所以走到这里的候选必定没删。
    这是刻意的——用户删掉一条候选正是让它从待办里消失，把已删的仍算"采过"等于让这条
    岗位再也采不回来。

    ``job`` 必须是调用方用 :func:`known_job_of` 查出来的那一次结果（可空）：15A 起每条
    结果都要记采样，两处各查一次会让每条结果多一次 SQL。
    """
    if job is not None:
        return KNOWN_TRASHED if trash.is_deleted(job) else KNOWN_EXISTING
    candidate = find_staged_candidate(
        session, title=result.title, company=result.company, source_url=result.url
    )
    return KNOWN_EXISTING if candidate is not None else KNOWN_NEW


def description_snapshot(description: str) -> tuple[str, str]:
    """JD 正文 → ``(sha256 指纹, 前 2000 字快照)``；空正文返回 ``("", "")``。

    空正文**不给指纹**（而不是给"空串的 sha256"）：15B 的判定是"指纹不同的相邻两次采样
    = JD 变了"，把"没抓到正文"也算成一种指纹，会让"第一次详情抓失败、第二次抓到了"
    报成一次变更——那是采集的抖动，不是企业改了 JD。
    """
    text = (description or "").strip()
    if not text:
        return ("", "")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return (digest, text[:MAX_DESCRIPTION_SNAPSHOT])


def record_sighting(
    session: Session,
    result: SearchResult,
    *,
    known_job: Job | None,
    run_id: int | None = None,
    now: datetime | None = None,
) -> JobSeen:
    """把"这次又见到了这条岗位"写进 ``job_seen``。**不 commit**（由采集 run 统一提交）。

    **每一条采集结果都要记**，包括"库里早就有"和"这次会被筛掉"的：

    - 已知岗位不记 → 15A 永远只有 1 条采样，"复采次数"这一项证据永远拿不到；
    - 新岗位不记 → 它在被用户导入之前完全没有生命周期，而"挂了半年没人导入"恰恰是
      最典型的僵尸岗形态（所以 ``job_id`` 允许为空）。

    ``known_job`` 由调用方传入（:func:`known_job_of` 的结果），本函数不再查库；JD 指纹
    与快照只在岗位已入库且已有正文时才有——列表页拿不到正文，这里也**不去抓**。
    """
    digest, snapshot = ("", "")
    if known_job is not None:
        digest, snapshot = description_snapshot(getattr(known_job, "description", "") or "")
    extra = result.extra if isinstance(result.extra, dict) else {}
    sighting = JobSeen(
        job_id=known_job.id if known_job is not None else None,
        source_url=_clip(result.url, MAX_URL_CHARS),
        title=_clip(result.title, MAX_TITLE_CHARS),
        company=_clip(result.company, MAX_COMPANY_CHARS),
        run_id=run_id,
        seen_at=now or utcnow(),
        salary_text=_clip(result.salary, MAX_SALARY_CHARS),
        hr_active=_clip(extra.get("hr_active"), MAX_HR_ACTIVE_CHARS),
        hr_active_time=_clip(extra.get("hr_active_time"), MAX_HR_ACTIVE_TIME_CHARS),
        description_hash=digest,
        description_text=snapshot,
    )
    session.add(sighting)
    return sighting


__all__ = [
    "KNOWN_EXISTING",
    "KNOWN_NEW",
    "KNOWN_TRASHED",
    "MAX_DESCRIPTION_SNAPSHOT",
    "already_known",
    "description_snapshot",
    "known_job_of",
    "record_sighting",
]
