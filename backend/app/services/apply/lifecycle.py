# SPDX-License-Identifier: Apache-2.0
"""岗位生命周期（15A 僵尸岗雷达 / 15B JD 变更）：只用已有采集历史，纯本地、只读。

**为什么必须是纯本地**：15A/15B 的价值主张就是"不额外抓取"。任何一次"主动重抓"都会把
采集成本翻倍、把风控暴露的频次抬上去，等于用用户最容易踩雷的动作去换一个提示。所以这里
只吃 ``job_seen`` 里已经有的采样序列（采集器每见到一次就写一条，见
``services/apply/collector_history.py``）。

代价必须对用户说清楚：**你不去采集，就看不到任何变化**。15B 因此在 UI 上标注
「下次采集时更新」——被动式不是缺陷，是这段设计的前提。

三项判据都刻意留了"宁可不报"的出口：

- **采样 < 2 条 → 不给分**（``score=None`` + 证据「历史不足」）。冷启动期只有一条采样，
  任何分数都只是把"我们刚装上这个功能"说成"这条岗位有问题"；
- **薪资 / HR 活跃度只在有数据时才参与**：字段缺失不等于"从来没变过"，更不等于"一直
  不活跃"。拿缺失值凑证据，等于把"我们没采到"说成"这条岗位有问题"；
- **只有 > 70 分才在 14A 体检里报一条 warning**：体检是"投之前扫一眼"的清单，噪点多了
  会被整体无视——那比没有这个功能更糟。

一句话口径：**证据不足时说"证据不足"，绝不说"健康"。**
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import TypedDict

from sqlalchemy.orm import Session

from ...models.apply import ApplyQueueItem
from ...models.job import Job
from ...models.job_seen import JobSeen
from ...models.profile import utcnow
from ._base import ApplyConflict, ApplyNotFound

# ===== 15A 判据常量（改任何一条都要同批改 tests/test_apply_ghost.py 的用例）=====

# 采样少于两条就没有序列可言：一条采样既谈不上"复采"，也看不出"有没有变"。
GHOST_MIN_SIGHTINGS = 2
# 分档：首见 ≥30 天 +25；≥60 天再加 15（长期挂着的第一信号）。
FIRST_SEEN_DAYS = 30
FIRST_SEEN_DAYS_LONG = 60
POINTS_FIRST_SEEN = 25
POINTS_FIRST_SEEN_LONG = 15
# 复采次数门槛与分值：≥3 次意味着"我至少三次看到它还在"，不是偶然刷到。
RESIGHT_MIN = 3
POINTS_RESIGHT = 20
# 薪资一次都没变过（至少两次有薪资的采样）：常年同一口价是"挂而不招"的典型特征。
POINTS_SALARY_STABLE = 15
# HR 活跃时间全部 ≥7 天前：唯一一个**站点自己给的**证据，权重最高。
HR_STALE_DAYS = 7
POINTS_HR_INACTIVE = 25
GHOST_SCORE_CAP = 100
# 体检里的告警门槛：**严格大于** 70（见模块 docstring 的"噪点"一段）。
GHOST_ALERT_THRESHOLD = 70

EVIDENCE_INSUFFICIENT = "历史不足"

# HR 活跃时间的文本形态（BOSS 的 ``activeTimeDesc``）。三类模式：
# ①"就在刚刚/在线/今日/小时前"→ 明确是新鲜的；②"N 天/日"→ 天数；③"N 周"/"N 个月"。
# 认不出来的写法一律返回 None（= 不参与判定），绝不当成"很久没活跃"。
_FRESH_MARKERS = ("刚刚", "在线", "今日", "今天", "小时前", "分钟前", "本周", "秒前")
_DAYS_PATTERN = re.compile(r"(\d+)\s*(?:天|日)")
_WEEKS_PATTERN = re.compile(r"(\d+)\s*周")
_MONTHS_PATTERN = re.compile(r"(\d+)\s*个?月")
# "true"/"false" 是列表接口 ``bossOnline`` 被直接塞进 ``hr_active`` 的形态。
_HR_ONLINE_FLAGS = ("true", "1", "yes")


class GhostVerdict(TypedDict):
    """``ghost_score`` 的返回结构：分 + 证据。

    ``score is None`` 表示**给不出结论**（历史不足），与 ``0``（看过很多次、看不出问题）
    是两件完全不同的事——界面上必须分开显示，混成 0 分会让新采集的岗位看起来"很健康"。
    """

    score: int | None
    evidence: list[str]


class JdChange(TypedDict):
    """``jd_change_of`` 的返回结构：是否变过 + before/after + 后一次采样的时间。"""

    changed: bool
    before: str
    after: str
    seen_at: datetime | None


def _moment(value: datetime | None) -> datetime | None:
    """统一成**无时区 UTC**：库里 ``utcnow()`` 是无时区 UTC，调用方可能塞带时区的 now。"""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _ordered(seens: Iterable[JobSeen]) -> list[JobSeen]:
    """按 ``seen_at`` 升序（同一秒内用 id 兜底，保证结果与读库顺序无关）。"""
    return sorted(seens, key=lambda row: (row.seen_at or utcnow(), row.id or 0))


def hr_stale_days(*values: str) -> int | None:
    """HR 活跃时间文本 → **至少**多少天没活跃；判断不了返回 ``None``。

    返回的是**下界**而不是精确天数：``"2周内活跃"`` → 14 天，用它判 ≥7 天是安全的
    （真实天数只会更多）。反过来，``"本月活跃"`` 这种无法确定粒度的写法返回 ``None``
    ——它可能是一小时前，也可能是 29 天前，当证据用会直接诬告一条正常岗位。

    多个入参按顺序取第一个能读懂的值（``hr_active_time`` 优先，退到 ``hr_active``）。
    """
    for raw in values:
        text = (raw or "").strip()
        if not text:
            continue
        lowered = text.casefold()
        if lowered in _HR_ONLINE_FLAGS:
            return 0  # 明确在线 = 最新鲜
        for marker in _FRESH_MARKERS:
            if marker in text:
                return 0
        for pattern, factor in (
            (_WEEKS_PATTERN, 7),
            (_MONTHS_PATTERN, 30),
            (_DAYS_PATTERN, 1),
        ):
            matched = pattern.search(text)
            if matched:
                return int(matched.group(1)) * factor
        # 认不出来的写法：不参与判定（不要往下一条入参猜——那等于为缺失数据编造含义）。
        return None
    return None


def _hr_stale(row: JobSeen) -> bool | None:
    """这一条采样里 HR 是否 ≥7 天没活跃；没数据（或读不懂）返回 ``None`` = 不参与。"""
    days = hr_stale_days(row.hr_active_time or "", row.hr_active or "")
    if days is None:
        return None
    return days >= HR_STALE_DAYS


def ghost_score(
    job: Job | None,
    seens: Sequence[JobSeen],
    now: datetime | None = None,
) -> GhostVerdict:
    """僵尸分（0–100）与中文证据；采样不足两条时 ``score=None`` + 「历史不足」。

    四项证据各自独立加分，互不替代（缺一项只是少一项分，不影响其他项）：

    ==================================  ======  ====================================
    证据                                 分值    判据
    ==================================  ======  ====================================
    首见至今天数                         +25     ≥30 天（≥60 天再 +15）
    复采次数                             +20     ≥3 次采样
    薪资从未变过                         +15     有薪资的采样 ≥2 条且取值全同
    HR 活跃时间全部 ≥7 天前              +25     有该字段的采样全部命中
    ==================================  ======  ====================================

    "首见"取 ``job.created_at`` 与最早采样里**更早**的那个：岗位可能先手动/导入进了
    岗位广场、后来才开始被采到，那时 ``created_at`` 才是真实的"第一次见到"。
    """
    ordered = _ordered(seens)
    if len(ordered) < GHOST_MIN_SIGHTINGS:
        return {"score": None, "evidence": [EVIDENCE_INSUFFICIENT]}
    moment = _moment(now) or utcnow()
    evidence: list[str] = []
    score = 0

    first_seen = _moment(ordered[0].seen_at)
    if job is not None:
        created = _moment(getattr(job, "created_at", None))
        if created is not None and (first_seen is None or created < first_seen):
            first_seen = created
    if first_seen is not None:
        days = (moment - first_seen).days
        if days >= FIRST_SEEN_DAYS:
            score += POINTS_FIRST_SEEN
            evidence.append(f"首见 {days} 天前")
            if days >= FIRST_SEEN_DAYS_LONG:
                score += POINTS_FIRST_SEEN_LONG

    if len(ordered) >= RESIGHT_MIN:
        score += POINTS_RESIGHT
        evidence.append(f"复采 {len(ordered)} 次")

    salaries = [row.salary_text.strip() for row in ordered if (row.salary_text or "").strip()]
    if len(salaries) >= GHOST_MIN_SIGHTINGS and len(set(salaries)) == 1:
        score += POINTS_SALARY_STABLE
        evidence.append(f"薪资 {len(salaries)} 次未变")

    hr_flags = [flag for flag in (_hr_stale(row) for row in ordered) if flag is not None]
    if hr_flags and all(hr_flags):
        score += POINTS_HR_INACTIVE
        evidence.append(f"HR {HR_STALE_DAYS} 天未活跃")

    return {"score": min(score, GHOST_SCORE_CAP), "evidence": evidence}


def _two_last_differ(hashes: Sequence[str]) -> bool:
    """最后两个**非空**指纹是否不同——"JD 变过"的唯一判据（两处出口共用这一份）。

    单条（:func:`jd_change_of`）与批量（:func:`jd_changed_map`）各自实现一遍的话，两条
    出口迟早会给出相反答复：队列行说"改过"、记录行说"没改"，用户只会觉得这功能坏了。
    """
    return len(hashes) >= 2 and hashes[-1] != hashes[-2]


def jd_change_of(seens: Sequence[JobSeen]) -> JdChange:
    """15B：**最近两条带指纹的采样**指纹不同 → ``changed=True``，并给出 before/after。

    "带指纹"是刻意的前置条件：指纹为空表示那次没拿到正文（详情抓取失败、或岗位本来
    没有正文），把它算进比较会把"采集抖动"报成"企业改了 JD"。少于两条带指纹的采样时
    一律 ``changed=False`` —— 没有可比对的东西，就不许说"变了"。
    """
    fingerprints = [row for row in _ordered(seens) if (row.description_hash or "").strip()]
    if len(fingerprints) < 2:
        return {"changed": False, "before": "", "after": "", "seen_at": None}
    before_row, after_row = fingerprints[-2], fingerprints[-1]
    return {
        "changed": _two_last_differ(
            [before_row.description_hash.strip(), after_row.description_hash.strip()]
        ),
        "before": before_row.description_text or "",
        "after": after_row.description_text or "",
        "seen_at": _moment(after_row.seen_at),
    }


# ===== 读库（只读；本模块的唯一 DB 依赖）=====


def seens_for_job(db: Session, job_id: int | None) -> list[JobSeen]:
    """一条岗位的全部采样，按 ``seen_at`` 升序。``job_id`` 为空时返回空列表。"""
    if job_id is None:
        return []
    return (
        db.query(JobSeen)
        .filter(JobSeen.job_id == job_id)
        .order_by(JobSeen.seen_at, JobSeen.id)
        .all()
    )


def _cached_seens(db: Session, job_id: int, cache: dict | None) -> list[JobSeen]:
    """按 job_id 复用采样（``list_queue`` 一次列 500 条时不可能每条重查一遍）。"""
    if cache is None:
        return seens_for_job(db, job_id)
    key = f"seens:{job_id}"
    if key not in cache:
        cache[key] = seens_for_job(db, job_id)
    return cache[key]


def job_history(db: Session, job: Job | None, *, cache: dict | None = None) -> dict:
    """队列 / 记录出口要的三项派生值：``score`` / ``evidence`` / ``jd_changed``。

    合成一个函数是为了**一次读库**：三个字段都来自同一份采样序列，分三次读会让队列列表
    每条多两次查询（500 条 = 1000 次白查）。
    """
    if job is None or job.id is None:
        return {
            "score": None,
            "evidence": [EVIDENCE_INSUFFICIENT],
            "jd_changed": False,
        }
    seens = _cached_seens(db, int(job.id), cache)
    verdict = ghost_score(job, seens)
    return {
        "score": verdict["score"],
        "evidence": verdict["evidence"],
        "jd_changed": jd_change_of(seens)["changed"],
    }


def jd_changed_map(db: Session, job_ids: Iterable[int | None]) -> dict[int, bool]:
    """批量算"这些岗位的 JD 变过没有"（投递记录列表用，**一次查询**）。

    只取带指纹的采样（``description_hash != ""``），按 ``(job_id, seen_at)`` 排序后在内存里
    取每个岗位的最后两条比较——与 :func:`jd_change_of` 同一口径，只是把 N 次查询换成 1 次。
    """
    ids = sorted({int(job_id) for job_id in job_ids if job_id})
    if not ids:
        return {}
    rows = (
        db.query(JobSeen.job_id, JobSeen.description_hash)
        .filter(JobSeen.job_id.in_(ids), JobSeen.description_hash != "")
        .order_by(JobSeen.job_id, JobSeen.seen_at, JobSeen.id)
        .all()
    )
    hashes: dict[int, list[str]] = {}
    for job_id, digest in rows:
        if job_id is None:  # NOT NULL 列；显式跳过让类型与运行期行为一致
            continue
        hashes.setdefault(int(job_id), []).append(str(digest).strip())
    return {job_id: _two_last_differ(values) for job_id, values in hashes.items()}


def jd_change_of_queue_item(db: Session, queue_id: int) -> dict[str, object]:
    """15B 端点用：一条队列条目的 JD 变更（只读；无历史 → ``changed=False``）。

    队列条目不存在时抛 ``ApplyNotFound``（路由翻 404）——不能返回一份"没有变更"的空
    结论：那会让用户以为"这条岗位的 JD 没变"，而事实是"这条队列条目根本不存在"。
    """
    item = db.get(ApplyQueueItem, queue_id)
    if item is None:
        raise ApplyNotFound("投递队列条目不存在或已被移除")
    change = jd_change_of(seens_for_job(db, item.job_id))
    seen_at = change["seen_at"]
    return {
        "changed": change["changed"],
        "before": change["before"],
        "after": change["after"],
        "seen_at": seen_at.isoformat(timespec="seconds") if seen_at is not None else None,
    }


def set_ghost_ignored(db: Session, queue_id: int, ignored: bool) -> dict[str, object]:
    """15A：忽略 / 恢复一条队列条目的僵尸提示，回显 ``{queue_id, ignored}``。

    只写 ``Job.ghost_ignored`` **一个布尔位**——不删 ``job_seen``、不改 ``ghost_score``：
    采样是历史事实（采集器照常记录，历史不因忽略而断），分数是从采样算出来的派生值，
    改它等于伪造历史。用户的意思是"别再念这一句"，不是"这条岗位不僵尸了"。

    两种失败都明确报错，不静默成功：队列条目不存在 → 404；``job_id`` 为空或岗位已被
    删除 → 409（没有岗位可写，"恢复提示"也无从谈起，这不是"状态没变"）。
    """
    item = db.get(ApplyQueueItem, queue_id)
    if item is None:
        raise ApplyNotFound("投递队列条目不存在或已被移除")
    job = db.get(Job, item.job_id) if item.job_id is not None else None
    if job is None:
        raise ApplyConflict("这条队列条目对应的岗位已被删除，没有可忽略的提示")
    job.ghost_ignored = bool(ignored)
    db.commit()
    return {"queue_id": int(queue_id), "ignored": bool(ignored)}


__all__ = [
    "EVIDENCE_INSUFFICIENT",
    "FIRST_SEEN_DAYS",
    "FIRST_SEEN_DAYS_LONG",
    "GHOST_ALERT_THRESHOLD",
    "GHOST_MIN_SIGHTINGS",
    "GHOST_SCORE_CAP",
    "GhostVerdict",
    "HR_STALE_DAYS",
    "JdChange",
    "RESIGHT_MIN",
    "ghost_score",
    "hr_stale_days",
    "jd_change_of",
    "jd_change_of_queue_item",
    "jd_changed_map",
    "job_history",
    "seens_for_job",
    "set_ghost_ignored",
]
