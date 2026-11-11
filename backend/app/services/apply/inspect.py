# SPDX-License-Identifier: Apache-2.0
"""岗位体检（15C）：薪资偏离 / 同司多投 / 历史结果——三项只读指标，纯本地统计。

三项指标的回答对象是**用户点开的那一条队列条目**，因此入口只有一个
:func:`inspect_queue_item`，且**全程只读**（不写库、不联网、不调模型）。

三项指标各自的口径与最容易搞错的三点：

1. **薪资偏离**——"我的薪资在同城同职位里算高还是低"。
   - 只比**能解析成月薪**的样本：``parse_salary_text`` 对 ``"500-1000元/天"`` 返回的是
     日薪数字（几百量级），直接混进月薪中位数会把中位数拉到一个荒唐的值。所以样本侧
     用与 ``collect_filters.salary_band`` 相同的日薪上限（:data:`_DAILY_SALARY_CEILING`）
     把日薪剔掉——**单位不同就比不了，比不了就不进样本**。
   - 归一化口径是 ``Job.location`` 全等（去空白 + 大小写/全半角归一，见
     :func:`_city_key`）+ 职位族关键词有交集。职位族 = 标题去掉通用词后剩下的 token
     集合（见 :func:`title_tokens`）；``"高级后端开发工程师"`` 与 ``"后端"`` 是同一族，
     ``"前端开发"`` 不是。
   - 样本 < :data:`MIN_SALARY_SAMPLE` 时 ``status="insufficient"``、``median`` /
     ``delta_percent`` / ``direction`` 全为 ``None``。**这一条不许放宽**：3 条样本算出的
     "你比市场低 23%" 是编造事实，不是分析。
2. **同司多投**——按 ``company_key`` 归并（与 ``services/analytics`` 同一套：直接复用
   ``models.tracker.normalize_key``，另写一份归一化会让两处"同一家公司"的判定悄悄分叉）。
   ``count`` 是队列条目数 + 投递记录数的和，不做按岗位去重——"同一 HR 一天收你三份"
   看的正是动作次数。
3. **历史结果**——这家公司的投递记录分成功/失败，外加"无回音"（投成功了、进度仍停在
   已投递/筛选中，或压根没有进度）。"有没有回音"的判据是 ``STATUS_RANK``
   （与 ``funnel`` 同源）：rank ≥ 面试才算有回音。
"""

from __future__ import annotations

import re
import statistics
from typing import Any

from sqlalchemy.orm import Session

from ...models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.job import Job
from ...models.tracker import (
    STATUS_INTERVIEW,
    STATUS_RANK,
    ApplicationTrack,
    normalize_key,
)
from ...schemas.apply.insights import (
    ApplyHistoryOut,
    ApplyJobInspectOut,
    ApplySalaryInspectOut,
    ApplySameCompanyOut,
)
from .. import trash
from ..sites.boss_network import parse_salary_text
from ._base import ApplyNotFound

# 薪资结论的样本门槛（详册 15C：样本 ≥ 8 条才给结论）。
MIN_SALARY_SAMPLE = 8
# 偏离方向的分界：±10% 以内算"持平"。
DIRECTION_THRESHOLD_PERCENT = 10.0
# 日薪上限（元）。与 ``collect_filters._DAILY_SALARY_CEILING`` 同一口径：BOSS 的日薪在
# 几百元量级，``salary_high`` 落在 3000 以下就按日薪剔掉，不与月薪混算。
_DAILY_SALARY_CEILING = 3000
# 薪资样本池上限：本地库的岗位数量级在千位，取最近的这么多条足够代表"当前市场"，
# 也避免一次体检把全表拉进内存。新岗位优先（倒序取），旧岗位被挤出是合理取舍。
_MAX_SALARY_POOL = 5000

# 职位族的通用词：这些词只表达职级/岗位形态，不表达"什么职位"。
# 去掉它们之后剩下的 token 才是职位族的核心（"高级后端开发工程师" → {"后端"}）。
_TITLE_GENERIC_WORDS: tuple[str, ...] = (
    "高级",
    "资深",
    "初级",
    "中级",
    "首席",
    "专家",
    "实习",
    "全职",
    "兼职",
    "工程师",
    "开发",
    "研发",
    "经理",
    "主管",
    "专员",
    "助理",
    "总监",
)
# 标题里的分隔符：中文标题常常写成"后端开发（Python）/ 平台组"，不切开就永远比不中。
_TITLE_SPLIT_RE = re.compile(r"[\s\-—–_/,，、。;；:：()（）\[\]【】{}<>《》·|+&]+")
# 有回音的进度下限：rank ≥ 面试（口径与 ``funnel`` 同源，见 ``STATUS_RANK``）。
_INTERVIEW_RANK = STATUS_RANK[STATUS_INTERVIEW]


# ===== 职位族与城市 =====


def title_tokens(title: str) -> frozenset[str]:
    """把岗位标题折成**职位族 token 集合**（去通用词后剩下的部分）。

    ``"高级后端开发工程师"`` → ``{"后端"}``；``"Java 开发工程师"`` → ``{"java"}``；
    ``"数据分析师"`` → ``{"数据分析师"}``（没有通用词可去，整串保留）。
    空标题、或者整串都是通用词（如 ``"工程师"``）→ 空集合，表示**判不出族**，
    调用方按"比不了"处理，绝不退化成"所有岗位都是同一族"。
    """
    text = (title or "").casefold()
    # 全角转半角（与 ``tracker.normalize_key`` 同一区间），让"（Python）"和"(python)"等价。
    text = "".join(chr(ord(ch) - 0xFEE0) if "！" <= ch <= "～" else ch for ch in text)
    for word in _TITLE_GENERIC_WORDS:
        text = text.replace(word, " ")
    return frozenset(token for token in _TITLE_SPLIT_RE.split(text) if token)


def _city_key(location: str) -> str:
    """城市归一键：去空白 + casefold（``" 北京 "`` 与 ``"北京"`` 是同一座城）。

    不做"北京·朝阳 → 北京"这类切分：那会把"朝阳"当独立城市，也可能把两座同名区搞混，
    而用户看不出是系统替他把城市改了。多出来的后缀只会让样本变少（更保守），
    不会让样本变错。
    """
    return "".join((location or "").split()).casefold()


def _salary_mid(text: Any) -> int | None:
    """薪资文本 → **月薪中位**（元），读不出或判定为日薪时返回 ``None``。

    日薪判据只有一条：区间上限 ≤ :data:`_DAILY_SALARY_CEILING`。分不清单位时宁可不收，
    也不猜一个换算系数（一天几天工作日谁都不知道）。
    """
    band = parse_salary_text(text)
    if band is None:
        return None
    low, high = band
    if low <= 0 and high <= 0:
        return None
    low = low or high
    high = high or low
    if high <= _DAILY_SALARY_CEILING:
        return None
    return int(round((low + high) / 2))


def _same_family(left: frozenset[str], right: frozenset[str]) -> bool:
    """职位族是否可比：两侧都非空、且关键词有交集。"""
    return bool(left) and bool(right) and bool(left & right)


# ===== 三项指标 =====


def salary_inspect(db: Session, job: Job | None) -> ApplySalaryInspectOut:
    """本条岗位的薪资 vs 同城同职位族的历史中位。

    ``sample`` **不含本条岗位自己**：用户问的是"拿几条跟我比"，把自己算进去会让
    1 条样本显示成 2 条。
    """
    if job is None:
        return ApplySalaryInspectOut()
    target = _salary_mid(job.salary)
    city = _city_key(job.location)
    family = title_tokens(job.title)
    if target is None or not city or not family:
        return ApplySalaryInspectOut()
    rows = (
        db.query(Job.title, Job.location, Job.salary)
        .filter(trash.live_only(Job), Job.id != job.id, Job.salary != "")
        .order_by(Job.id.desc())
        .limit(_MAX_SALARY_POOL)
        .all()
    )
    sample_values: list[int] = []
    for other_title, other_location, other_salary in rows:
        if _city_key(other_location) != city:
            continue
        if not _same_family(family, title_tokens(other_title)):
            continue
        mid = _salary_mid(other_salary)
        if mid is None:
            # 读不出 / 日薪：单位不同就比不了，不进样本。
            continue
        sample_values.append(mid)
    sample = len(sample_values)
    if sample < MIN_SALARY_SAMPLE or not sample_values:
        # 样本不足：只报"有几条"，不给任何百分比/中位数。
        # ``not sample_values`` 与门槛是**两道**而不是一道：门槛常量被改成 0 时，
        # ``statistics.median([])`` 会抛运行期异常——体检整块 500，用户看到的是
        # "读取失败"而不是"样本不足"。宁可多判一次空。
        return ApplySalaryInspectOut(status="insufficient", sample=sample, target=target)
    median = int(round(statistics.median(sample_values)))
    if median <= 0:
        return ApplySalaryInspectOut(status="insufficient", sample=sample, target=target)
    delta = (target - median) / median * 100
    delta_percent = round(delta, 1)
    if delta >= DIRECTION_THRESHOLD_PERCENT:
        direction = "high"
    elif delta <= -DIRECTION_THRESHOLD_PERCENT:
        direction = "low"
    else:
        direction = "same"
    return ApplySalaryInspectOut(
        status="ok",
        sample=sample,
        median=median,
        target=target,
        delta_percent=delta_percent,
        direction=direction,
    )


def _company_key(company: str) -> str:
    """公司归并键：**直接复用** ``models.tracker.normalize_key``。

    与 ``services/analytics``（``ApplicationTrack.company_key`` 的写入口径）同一套。
    自己再写一份"去空白 + casefold"会让两处"同一家公司"的判定悄悄分叉——那种错不会
    报错，只会让同司多投在报表里和在体检里数出两个不同的数。
    """
    return normalize_key(company)


def same_company(db: Session, job: Job | None, company: str) -> ApplySameCompanyOut:
    """同司多投：队列条目数 + 已投记录数（都是行数，单位一致才相加）。

    "已投"只算**动过手**的记录（成功 + 失败），与 :func:`history` 同一口径：跳过的是
    "没投"、pending 是"还没投"，把它们算进"多投"会让用户以为自己已经投了三份。
    """
    key = _company_key(company or (job.company if job is not None else ""))
    if not key:
        # 没有公司名就没有"同一家公司"这个事实，判断不了就不做判断。
        return ApplySameCompanyOut()
    in_queue = sum(
        1
        for (queue_company,) in db.query(ApplyQueueItem.company).all()
        if _company_key(queue_company or "") == key
    )
    applied = sum(
        1
        for (record_company,) in db.query(ApplyTaskItem.company)
        .join(ApplyTask, ApplyTaskItem.task_id == ApplyTask.id)
        .filter(
            ApplyTask.kind == TASK_KIND_APPLY,
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.status.in_((ITEM_STATUS_SUCCESS, ITEM_STATUS_FAILED)),
        )
        .all()
        if _company_key(record_company or "") == key
    )
    return ApplySameCompanyOut(count=in_queue + applied, in_queue=in_queue, applied=applied)


def history(db: Session, job: Job | None, company: str) -> ApplyHistoryOut:
    """这家公司的投递历史：成功 / 失败 / 无回音。

    "无回音"= 投成功的记录里，进度 rank 仍 < 面试（含压根没有进度记录）。判据与
    ``funnel.stale_records`` 的"静默"是同一族，但这里更宽：没有进度记录也算无回音
    （投出去了、系统里没有任何后续，正是"没回音"的典型形态）。
    """
    key = _company_key(company or (job.company if job is not None else ""))
    if not key:
        return ApplyHistoryOut()
    rows = (
        db.query(ApplyTaskItem.job_id, ApplyTaskItem.company, ApplyTaskItem.status)
        .join(ApplyTask, ApplyTaskItem.task_id == ApplyTask.id)
        .filter(
            ApplyTask.kind == TASK_KIND_APPLY,
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.status.in_((ITEM_STATUS_SUCCESS, ITEM_STATUS_FAILED)),
        )
        .all()
    )
    matched = [row for row in rows if _company_key(row[1] or "") == key]
    succeeded = [row for row in matched if row[2] == ITEM_STATUS_SUCCESS]
    failed = [row for row in matched if row[2] == ITEM_STATUS_FAILED]
    # 逐个取值再判空：直接写集合推导的话 pyright 看不穿 ``row[0]`` 的收窄，
    # 会把 ``set[int | None]`` 喂给 ``sorted``（job_id 是 NOT NULL，这里只是让类型诚实）。
    reached_ids: set[int] = set()
    for row in succeeded:
        value = row[0]
        if value is not None:
            reached_ids.add(value)
    job_ids = sorted(reached_ids)
    ranks: dict[int, int] = {}
    if job_ids:
        track_rows = (
            db.query(ApplicationTrack.job_id, ApplicationTrack.status)
            .filter(trash.live_only(ApplicationTrack), ApplicationTrack.job_id.in_(job_ids))
            .all()
        )
        ranks = {
            int(track_job_id): STATUS_RANK.get(status, 0)
            for track_job_id, status in track_rows
            if track_job_id is not None
        }
    no_reply = 0
    for row in succeeded:
        job_id = row[0]
        if job_id is None:
            # 岗位被删除、快照还在：这条投递仍算"投成功过"，但没有任何进度可查 → 无回音。
            no_reply += 1
            continue
        if ranks.get(int(job_id), 0) < _INTERVIEW_RANK:
            no_reply += 1
    return ApplyHistoryOut(
        applied=len(matched),
        succeeded=len(succeeded),
        failed=len(failed),
        no_reply=no_reply,
    )


def inspect_queue_item(db: Session, queue_id: int) -> ApplyJobInspectOut:
    """一条队列条目的完整体检报告（只读）。

    条目不存在时抛 :class:`ApplyNotFound`（路由层翻 404）：体检针对的是"我正在看的
    那一条"，找不到就如实说找不到，不返回一份空报告让前端以为"数据都算不出来"。
    """
    item = db.get(ApplyQueueItem, queue_id)
    if item is None:
        raise ApplyNotFound("投递队列条目不存在或已被移除")
    job = db.get(Job, item.job_id) if item.job_id is not None else None
    company = item.company or (job.company if job is not None else "")
    return ApplyJobInspectOut(
        queue_id=item.id,
        salary=salary_inspect(db, job),
        same_company=same_company(db, job, company),
        history=history(db, job, company),
    )


__all__ = [
    "DIRECTION_THRESHOLD_PERCENT",
    "MIN_SALARY_SAMPLE",
    "history",
    "inspect_queue_item",
    "salary_inspect",
    "same_company",
    "title_tokens",
]
