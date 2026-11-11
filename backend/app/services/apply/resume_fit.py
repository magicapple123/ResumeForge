# SPDX-License-Identifier: Apache-2.0
"""简历指派优化（15D）：``Job.keywords`` × 每份简历文本的**关键词覆盖率**，贪心分配。

**这里算的是「关键词覆盖」，不是「匹配度」也不是 14B 的「参考分」。** 三者的区别必须
在命名、日志、返回字段上保持一致，否则用户看到两个叫"分"的数字给出相反建议，只会认为
系统自相矛盾：

- **关键词覆盖**（本模块）= 岗位技能标签里有几个**字面出现**在这份简历的文本里，
  分母是标签总数，结果 0–100 的整数。纯字符串匹配，零模型成本，可复现。
- 「参考分」（``services/apply/signals.reference_score``）= 读匹配分析结论打的分。

两条设计取舍：

1. **覆盖率是字面匹配**，所以 ``"Spring Boot"`` 打不中简历里写的 ``"SpringBoot"``。
   这是刻意接受的假阴性：做词形归一会引入同义词表，而同义词表一旦出错会把"没做过"
   算成"做过"——那比漏判严重得多。覆盖率因此**只会低估、不会虚高**。
2. **贪心而不是全局最优**（详册 15D 明写）。目标是"别 20 条全推同一份"，不是最优解：
   按（当前覆盖率低、潜在提升大）排序，逐条挑当前覆盖率最高、且还没超
   :data:`RESUME_CAP` 的简历。``6`` 这个常数就是"每份简历最多服务几条"——超过之后
   推荐就失去意义（一份简历投 20 个岗位，和现在"全都用同一份"没有区别）。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.apply import ApplyQueueItem
from ...models.job import Job
from ...models.resume import ResumeRecord, saved_only
from ...schemas.apply.insights import ApplyResumeFitItemOut, ApplyResumeFitOut
from .. import trash
from ._queue import MAX_QUEUE_LIST

# 一份简历最多服务几条岗位。超过之后"推荐"没有意义：一份简历投 20 个岗位，
# 与"全都用同一份"在用户那里是同一件事。
RESUME_CAP = 6

# 岗位没有关键词时的固定说明（前端按这句话判断"这条算不出来"）。
NO_KEYWORDS_REASON = "岗位没有关键词"


def keyword_names(keywords: Any) -> list[str]:
    """从 ``Job.keywords`` 里取出技能标签名，**去重并保序**。

    标签是规则解析出来的 ``[{"name": "Python", "category": "编程语言"}, ...]``；历史数据
    里也可能直接是字符串。去重按 casefold 后的值——同一个技能在不同维度各命中一次
    （解析器合并来源时常见）会让分母虚增、覆盖率虚低。
    """
    names: list[str] = []
    seen: set[str] = set()
    for entry in keywords or []:
        # 标签是 ``{"name": ...}``；历史数据里也可能直接是字符串（同一处兼容，别分两条路）。
        raw = (entry.get("name") or entry.get("skill") or "") if isinstance(entry, dict) else entry
        text = str(raw or "").strip()
        if not text:
            continue
        folded = text.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        names.append(text)
    return names


def _flatten(value: Any, out: list[str]) -> None:
    """把结构化简历里的**字符串叶子**按出现顺序收集起来。

    只收值、不收键：``content`` 的键是 ``skills`` / ``experience`` 这类英文结构名，
    收进文本会让"Skills"这种标签无条件命中，覆盖率凭空变高。
    """
    if isinstance(value, str):
        if value.strip():
            out.append(value)
        return
    if isinstance(value, dict):
        for item in value.values():
            _flatten(item, out)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _flatten(item, out)


def resume_text(content: Any) -> str:
    """简历 ``content`` → 一段可做子串匹配的文本（已 casefold）。

    不做华丽渲染：覆盖率只要"这个词有没有出现过"，拼接顺序与排版都不影响结果。
    """
    parts: list[str] = []
    _flatten(content, parts)
    return "\n".join(parts).casefold()


def coverage_percent(names: Sequence[str], text: str) -> int | None:
    """关键词覆盖率（0–100 整数）。``names`` 为空 → ``None``（分母为 0，不给百分比）。"""
    if not names:
        return None
    hits = sum(1 for name in names if name.casefold() in text)
    return int(round(hits * 100 / len(names)))


@dataclass
class _Plan:
    """一条岗位的待分配状态（贪心过程中的中间量）。"""

    item: ApplyQueueItem
    names: list[str]
    current_coverage: int | None
    best_possible: int

    @property
    def sort_key(self) -> tuple[int, int, int]:
        """优先级：**当前覆盖率低**的先分配（最需要换的优先拿到好简历），
        其次**潜在提升大**的先（同样缺，能提升多的先得），最后按 id 保证结果稳定。
        """
        baseline = self.current_coverage if self.current_coverage is not None else -1
        return (baseline, -(self.best_possible - max(0, self.current_coverage or 0)), self.item.id)


def _load_items(db: Session, queue_ids: Sequence[int] | None) -> list[ApplyQueueItem]:
    """取要分析的队列条目：给了 id 就只取这些，否则取整个队列（与 ``list_queue`` 同序）。"""
    query = db.query(ApplyQueueItem)
    if queue_ids:
        query = query.filter(ApplyQueueItem.id.in_(sorted(set(queue_ids))))
    return (
        query.order_by(ApplyQueueItem.sort_order.desc(), ApplyQueueItem.id.desc())
        .limit(MAX_QUEUE_LIST)
        .all()
    )


def _load_resumes(db: Session) -> tuple[list[ResumeRecord], dict[int, str]]:
    """参与分配的简历：**已保存**（草稿不算）、未进回收站、正文非空。

    草稿必须排除（``saved_only()``）：用户还没认可的内容不能拿来当"该用这份"的建议。
    正文文本顺手算好一起返回——同一份简历在一次分析里只做一次文本化。
    """
    candidates = (
        db.query(ResumeRecord)
        .filter(trash.live_only(ResumeRecord), saved_only())
        .order_by(ResumeRecord.id)
        .all()
    )
    usable: list[ResumeRecord] = []
    texts: dict[int, str] = {}
    for record in candidates:
        text = resume_text(record.content)
        if not text:
            continue
        usable.append(record)
        texts[record.id] = text
    return usable, texts


def _keep_reason(coverage: int | None) -> str:
    """不换简历时的说明。"""
    if coverage is None:
        return NO_KEYWORDS_REASON
    return f"当前简历的关键词覆盖 {coverage}%，已是最优，不必更换"


def resume_fit(db: Session, queue_ids: Sequence[int] | None = None) -> ApplyResumeFitOut:
    """给每条队列条目算一次简历指派建议（只读，纯本地字符串匹配）。

    返回顺序与 ``GET /queue`` 一致（``sort_order`` 倒序），前端可以直接按 ``queue_id``
    配回行；只有显式点名的那几条会出现在 ``items`` 里（找不到的 id 静默跳过——
    队列是用户随时会改的活数据）。
    """
    items = _load_items(db, queue_ids)
    if not items:
        return ApplyResumeFitOut()
    resumes, texts = _load_resumes(db)
    title_of = {record.id: (record.title or f"简历 #{record.id}") for record in resumes}
    job_ids = sorted({item.job_id for item in items if item.job_id is not None})
    jobs = (
        {job.id: job for job in db.query(Job).filter(Job.id.in_(job_ids)).all()} if job_ids else {}
    )

    plans: list[_Plan] = []
    for item in items:
        job = jobs.get(item.job_id) if item.job_id is not None else None
        names = keyword_names(job.keywords if job is not None else None)
        current_coverage = (
            coverage_percent(names, texts[item.resume_id])
            if names and item.resume_id in texts
            else None
        )
        best_possible = max(
            (coverage_percent(names, text) or 0 for text in texts.values()), default=0
        )
        plans.append(
            _Plan(
                item=item,
                names=names,
                current_coverage=current_coverage,
                best_possible=best_possible,
            )
        )

    # 覆盖率矩阵按需算、算过就记：一条岗位 × N 份简历，同一格不做第二次子串扫描。
    matrix: dict[int, dict[int, int | None]] = {}
    usage: dict[int, int] = {record.id: 0 for record in resumes}
    decided: dict[int, ApplyResumeFitItemOut] = {}
    for plan in sorted(plans, key=lambda current: current.sort_key):
        item = plan.item
        job_missing = item.job_id is not None and item.job_id not in jobs
        if not plan.names:
            decided[item.id] = ApplyResumeFitItemOut(
                queue_id=item.id,
                job_id=item.job_id,
                current_resume_id=item.resume_id,
                # 没有关键词 = 分母为 0，不给百分比（也不假装 0%）。
                current_coverage=None,
                recommended_resume_id=None,
                recommended_coverage=None,
                gain=0,
                reason=(
                    "岗位已删除或不存在，无法计算关键词覆盖" if job_missing else NO_KEYWORDS_REASON
                ),
            )
            continue
        per_item = matrix.setdefault(
            item.id,
            {record.id: coverage_percent(plan.names, texts[record.id]) for record in resumes},
        )
        open_resumes = [record for record in resumes if usage.get(record.id, 0) < RESUME_CAP]
        if not open_resumes:
            # 一份可用简历都没有（新用户 / 全是草稿）：说清楚是"没有简历"，
            # 别拿"已达上限"去解释——那会把用户引到错误的下一步。
            reason = (
                f"每份简历最多服务 {RESUME_CAP} 条，暂不指派"
                if resumes
                else "还没有可用的已保存简历（草稿不计），先保存一份简历再指派"
            )
            decided[item.id] = ApplyResumeFitItemOut(
                queue_id=item.id,
                job_id=item.job_id,
                current_resume_id=item.resume_id,
                current_coverage=plan.current_coverage,
                recommended_resume_id=item.resume_id,
                recommended_coverage=plan.current_coverage,
                gain=0,
                reason=reason,
            )
            if item.resume_id is not None:
                usage[item.resume_id] = usage.get(item.resume_id, 0) + 1
            continue
        # 覆盖率同分时优先"就用现在这份"，其次按 id 小的（结果稳定、可复现）。
        best = max(
            open_resumes,
            key=lambda record: (
                per_item.get(record.id) or 0,
                record.id == item.resume_id,
                -record.id,
            ),
        )
        best_coverage = per_item.get(best.id) or 0
        baseline = plan.current_coverage or 0
        if plan.current_coverage is not None and best_coverage <= plan.current_coverage:
            # 换过去没有收益：不推荐换（不给用户制造无意义的改动）。
            decided[item.id] = ApplyResumeFitItemOut(
                queue_id=item.id,
                job_id=item.job_id,
                current_resume_id=item.resume_id,
                current_coverage=plan.current_coverage,
                recommended_resume_id=item.resume_id,
                recommended_coverage=plan.current_coverage,
                gain=0,
                reason=_keep_reason(plan.current_coverage),
            )
            if item.resume_id is not None:
                usage[item.resume_id] = usage.get(item.resume_id, 0) + 1
            continue
        gain = best_coverage - baseline
        if plan.current_coverage is None:
            reason = (
                f"队列未指定简历，推荐「{title_of.get(best.id, '')}」：关键词覆盖 {best_coverage}%"
            )
        else:
            reason = (
                f"换成「{title_of.get(best.id, '')}」：关键词覆盖 "
                f"{plan.current_coverage}% → {best_coverage}%（+{gain}）"
            )
        decided[item.id] = ApplyResumeFitItemOut(
            queue_id=item.id,
            job_id=item.job_id,
            current_resume_id=item.resume_id,
            current_coverage=plan.current_coverage,
            recommended_resume_id=best.id,
            recommended_coverage=best_coverage,
            gain=gain,
            reason=reason,
        )
        usage[best.id] = usage.get(best.id, 0) + 1

    # 出口顺序与入参顺序一致（前端按 queue_id 配行，但顺序稳定能省一次排序）。
    ordered = [decided[item.id] for item in items if item.id in decided]
    return ApplyResumeFitOut(items=ordered)


__all__ = [
    "NO_KEYWORDS_REASON",
    "RESUME_CAP",
    "coverage_percent",
    "keyword_names",
    "resume_fit",
    "resume_text",
]
