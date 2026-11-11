# SPDX-License-Identifier: Apache-2.0
"""投递前体检（14A）：只读地回答"这一条现在投出去会不会白投"。

与准入（``admission``）的分工——两者刻意都不是对方的替代品：

- ``admission`` 回答「**岗位要求我够不够**」，由匹配结论收口；
- 体检回答「**这一条现在能不能投**」：来源投不了、简历缺失、还没分析、参考分偏低、
  招呼语太短或与上一条重复。后三类 ``admission`` 根本不管。

整个模块**只读**：不写库、不改任何状态，前端可以在点「开始投递」时随手跑一次。

15A 起多一条 ``ghost_job``（僵尸岗提示，warning）：它读的是**采集历史**（``job_seen``），
不是岗位正文，所以同样不联网、不调模型。分档与判据全在 ``services/apply/lifecycle.py``，
这里只负责"够不够格变成一条提示"（>70 分、且用户没点过忽略）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ...models.apply import ApplyQueueItem
from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.apply import (
    ApplyPreflightIssue,
    ApplyPreflightItemOut,
    ApplyPreflightOut,
    ApplyPreflightSummary,
)
from ...schemas.apply.extras import PreflightCode, PreflightSeverity
from ._match import _admission_of_match, latest_match
from ._queue import job_apply_site, resolve_resume
from .lifecycle import (
    EVIDENCE_INSUFFICIENT,
    GHOST_ALERT_THRESHOLD,
    ghost_score,
    seens_for_job,
)
from .signals import reference_score

logger = logging.getLogger(__name__)

# 招呼语"太短"的门槛：15 字以下基本只是「您好，我想投递该岗位」，HR 一眼就过。
MIN_GREETING_CHARS = 15
# 参考分偏低的门槛：与前端配色（<60 灰）同一口径，改这里必须同步前端阈值。
WEAK_MATCH_SCORE = 60

# 常量按 schema 的 Literal 标注：``_Issue`` 要直接喂给 ``ApplyPreflightIssue``，
# 声明成裸 ``str`` 的话 pyright 会在构造处报「str 不是 Literal」。
CODE_SOURCE_UNSUPPORTED: PreflightCode = "source_unsupported"
CODE_RESUME_MISSING: PreflightCode = "resume_missing"
CODE_MATCH_MISSING: PreflightCode = "match_missing"
CODE_MATCH_WEAK: PreflightCode = "match_weak"
CODE_GREETING_WEAK: PreflightCode = "greeting_weak"
# 15A：僵尸岗提示。它是本模块唯一一条"关于岗位而不是关于你"的结论，所以措辞上必须
# 明确它是**提示**：可能挂着不招，但没人能替用户决定投不投。
CODE_GHOST_JOB: PreflightCode = "ghost_job"

SEVERITY_BLOCKING: PreflightSeverity = "blocking"
SEVERITY_WARNING: PreflightSeverity = "warning"


@dataclass(frozen=True)
class _Issue:
    """内部用的小结构：构造后立刻转成 schema，便于在纯函数里断言顺序。"""

    code: PreflightCode
    severity: PreflightSeverity
    message: str
    fix: str

    def out(self) -> ApplyPreflightIssue:
        # code / severity 的取值由本模块常量收口，运行期再经 pydantic 的 Literal 校验一次。
        return ApplyPreflightIssue(
            code=self.code,
            severity=self.severity,
            message=self.message,
            fix=self.fix,
        )


def _issue(code: PreflightCode, severity: PreflightSeverity, message: str, fix: str) -> _Issue:
    return _Issue(code=code, severity=severity, message=message, fix=fix)


def _resume_is_empty(resume: ResumeRecord | None) -> bool:
    """简历不存在或"正文为空"。``content`` 是渲染用的结构，任一顶层字段有值就算有正文。"""
    if resume is None:
        return True
    content = resume.content
    if isinstance(content, dict):
        return not any(bool(value) for value in content.values())
    return not bool(content)


def _source_issues(job: Job | None) -> list[_Issue]:
    """来源不支持：这条根本走不到投递链路，属**阻断**项。"""
    if job_apply_site(job) is not None:
        return []
    title = (job.title if job is not None else "") or "该岗位"
    return [
        _issue(
            CODE_SOURCE_UNSUPPORTED,
            SEVERITY_BLOCKING,
            f"「{title}」的来源不是投递台支持的招聘网站，点投递只会得到一条失败记录。",
            "移出队列，到对应招聘网站里手动投递",
        )
    ]


def _resume_issues(db: Session, item: ApplyQueueItem) -> list[_Issue]:
    """简历缺失：与真实投递链路同一判据（``resolve_resume`` + 正文非空）。"""
    resume = resolve_resume(db, item.job_id, item.resume_id)
    if not _resume_is_empty(resume):
        return []
    return [
        _issue(
            CODE_RESUME_MISSING,
            SEVERITY_BLOCKING,
            "这一条没有可用简历（未选简历，或该岗位没有已保存的简历，或简历正文为空），"
            "投递会在填写阶段被跳过。",
            "换成可用简历",
        )
    ]


def _match_issues(db: Session, item: ApplyQueueItem, job: Job | None, cache: dict) -> list[_Issue]:
    """未分析（warning）与参考分偏低（warning）——两者互斥，同级展示。"""
    match = latest_match(db, item.job_id)
    if match is None or _admission_of_match(match) is None:
        title = (job.title if job is not None else "") or item.job_title or "该岗位"
        return [
            _issue(
                CODE_MATCH_MISSING,
                SEVERITY_WARNING,
                f"「{title}」还没做过匹配分析，投出去之前建议先看一眼岗位要求对不对得上。",
                "去岗位广场做匹配分析",
            )
        ]
    score = reference_score(db, job, match, cache=cache)
    if score is None or score >= WEAK_MATCH_SCORE:
        return []
    return [
        _issue(
            CODE_MATCH_WEAK,
            SEVERITY_WARNING,
            f"参考分只有 {score} 分（低于 {WEAK_MATCH_SCORE} 分），"
            "按当前简历投出去可能对不上岗位要求。",
            "换简历、改招呼语，或确认仍要投",
        )
    ]


def _greeting_issues(item: ApplyQueueItem, previous_greeting: str) -> list[_Issue]:
    """招呼语为空 / 太短 / 与上一条完全相同。"""
    greeting = (item.greeting or "").strip()
    if not greeting:
        return [
            _issue(
                CODE_GREETING_WEAK,
                SEVERITY_WARNING,
                "这一条没有自己的招呼语，会用默认招呼语发出去。",
                "从话术模板里套一条，或按岗位改一句",
            )
        ]
    if len(greeting) < MIN_GREETING_CHARS:
        return [
            _issue(
                CODE_GREETING_WEAK,
                SEVERITY_WARNING,
                f"招呼语只有 {len(greeting)} 字，太短，HR 看不出你为什么合适。",
                "补到能把「为什么是你」说清楚，或套用话术模板",
            )
        ]
    previous = (previous_greeting or "").strip()
    if previous and greeting == previous:
        return [
            _issue(
                CODE_GREETING_WEAK,
                SEVERITY_WARNING,
                "招呼语与上一条完全相同，连投两家同一段话容易被当成群发。",
                "至少改掉开头一句，或套用另一条话术模板",
            )
        ]
    return []


def _ghost_issues(db: Session, job: Job | None) -> list[_Issue]:
    """15A：僵尸岗提示（warning，**严格 >70 分**才报；岗位被显式忽略则不报）。

    三条"不报"的出口都是刻意的：

    - 采样 < 2 条（``score is None``）→ 不报。冷启动期拿一条采样下结论，等于把我们自己
      刚装上这个功能说成"这条岗位有问题"；
    - ``job.ghost_ignored`` → 不报。用户已经看过这条提示并选择仍然要投，反复念同一句是
      噪音（采集侧照常记采样，历史不断）；
    - 岗位已被删除 / 队列条目挂在空 job_id 上 → 不报，没有历史可言。
    """
    if job is None or getattr(job, "ghost_ignored", False):
        return []
    verdict = ghost_score(job, seens_for_job(db, job.id))
    score = verdict["score"]
    if score is None or score <= GHOST_ALERT_THRESHOLD:
        return []
    evidence = [item for item in verdict["evidence"] if item != EVIDENCE_INSUFFICIENT]
    detail = "、".join(evidence) if evidence else "采到多次但一直没变化"
    title = job.title or "该岗位"
    return [
        _issue(
            CODE_GHOST_JOB,
            SEVERITY_WARNING,
            f"「{title}」疑似长期挂着不招（僵尸分 {score}：{detail}）。"
            "有些企业的岗位常年挂着但并没有在招，投过去可能一直没人看。",
            "仍要投 / 忽略此岗位的僵尸提示",
        )
    ]


def check_item(
    db: Session,
    item: ApplyQueueItem,
    *,
    previous_greeting: str = "",
    cache: dict | None = None,
) -> list[ApplyPreflightIssue]:
    """体检一条队列条目，返回 issues（顺序与规则表一致，前端可稳定分组）。

    ``previous_greeting`` 是**界面上它上面那条**的招呼语（同一个顺序口径见
    :func:`ordered_items`），用来判"与上一条完全相同"。
    """
    job = db.get(Job, item.job_id) if item.job_id else None
    issues: list[_Issue] = []
    issues.extend(_source_issues(job))
    issues.extend(_resume_issues(db, item))
    issues.extend(_match_issues(db, item, job, cache if cache is not None else {}))
    issues.extend(_greeting_issues(item, previous_greeting))
    # 15A 放在最后：僵尸分是"这条岗位值不值得投"的补充信息，不是否决项（severity=warning），
    # 排在其他结论之后，界面按顺序展示时不会被它抢在前面。
    issues.extend(_ghost_issues(db, job))
    return [issue.out() for issue in issues]


def ordered_items(db: Session, queue_ids: list[int] | None = None) -> list[ApplyQueueItem]:
    """按**界面顺序**取待体检的条目（``sort_order`` 倒序，与 ``list_queue`` 配对）。

    ``queue_ids`` 给了就只体检这几条，但**仍按界面顺序**返回——否则"与上一条相同"
    的判定会随调用方传参顺序变化，同一个队列每次体检出不同结论。
    """
    query = db.query(ApplyQueueItem).order_by(
        ApplyQueueItem.sort_order.desc(), ApplyQueueItem.id.desc()
    )
    if queue_ids:
        query = query.filter(ApplyQueueItem.id.in_(list(queue_ids)))
    return query.all()


def preflight(db: Session, queue_ids: list[int] | None = None) -> ApplyPreflightOut:
    """跑一次全量体检（只读）。空队列返回空 items 与全零 summary，不报错。"""
    items = ordered_items(db, queue_ids)
    cache: dict = {}
    out_items: list[ApplyPreflightItemOut] = []
    blocking = 0
    warnings = 0
    previous_greeting = ""
    for item in items:
        issues = check_item(db, item, previous_greeting=previous_greeting, cache=cache)
        if any(issue.severity == SEVERITY_BLOCKING for issue in issues):
            blocking += 1
        if any(issue.severity == SEVERITY_WARNING for issue in issues):
            warnings += 1
        if issues:
            out_items.append(ApplyPreflightItemOut(queue_id=item.id, issues=issues))
        previous_greeting = item.greeting or ""
    return ApplyPreflightOut(
        items=out_items,
        summary=ApplyPreflightSummary(blocking=blocking, warnings=warnings),
    )


__all__ = [
    "CODE_GHOST_JOB",
    "CODE_GREETING_WEAK",
    "CODE_MATCH_MISSING",
    "CODE_MATCH_WEAK",
    "CODE_RESUME_MISSING",
    "CODE_SOURCE_UNSUPPORTED",
    "MIN_GREETING_CHARS",
    "SEVERITY_BLOCKING",
    "SEVERITY_WARNING",
    "WEAK_MATCH_SCORE",
    "check_item",
    "ordered_items",
    "preflight",
]
