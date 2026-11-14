# SPDX-License-Identifier: Apache-2.0
"""从 ``apply/collector.py`` 拆出：把采集账目汇总成写进 ``task.config`` 的摘要。

纯函数（不碰数据库、不读时钟），参数都是 ``Collector.run`` 当场持有的状态；
``collector.py`` 侧只保留调用与"有摘要才覆盖"的两行。
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ..sites.base import CollectQuery, FilterResolution, SiteAdapter
from .collect_filters import FilterTally
from .collector_report import CollectReport


def build_task_config_summary(
    report: CollectReport,
    *,
    query: CollectQuery,
    adapter: SiteAdapter,
    tally: FilterTally,
    site_filters: FilterResolution,
    backfill_job_ids: Sequence[int] | None,
) -> dict[str, Any]:
    """组装 ``task.config`` 的账目摘要；没有可写项时返回空字典。"""
    # 筛选的账目写进 ``task.config``（不新增数据库列，与 ``unmapped_conditions`` 同一套做法）：
    # 「筛掉几条、按哪条筛的、有几条因为岗位没给字段而没能判断」都要给用户看到——
    # 只留一个"已暂存 N 个"会让人以为筛选生效了，而不知道实际筛掉了多少、漏了多少。
    summary: dict[str, Any] = {}
    if report.unmapped_conditions:
        summary["unmapped_conditions"] = report.unmapped_conditions
    if report.skipped_trashed:
        summary["skipped_trashed"] = report.skipped_trashed
    if report.backfilled or report.backfill_skipped:
        # 补详情的账目：补到几条、跳过几条（跳过包括"已经有描述"和"仍然抓不到"）。
        # 不给这两个数，用户看到"任务完成"却不知道到底补上没有。
        summary["backfilled"] = report.backfilled
        summary["backfill_skipped"] = report.backfill_skipped
    if not backfill_job_ids:
        # 只有**搜索采集**才写"详情缺失"这条账目：它是站点漂移的早期信号，站点健康度靠它
        # 识别"能采到列表却抓不到 JD"。补详情模式不写这个键（它走 backfilled/backfill_skipped），
        # 两套口径不混一起——否则用户一次"点名补详情"会把漂移计数搅乱。
        summary["detail_missing"] = report.detail_missing
    configured_filters = {
        "薪资": query.salary_min is not None,
        "经验": bool(query.experience),
        "学历": bool(query.education),
        "岗位类型": bool(query.job_type),
    }
    # 「采集后筛选」已下线（无适配器声明 post_filter_conditions），此账目分支当前不可达；
    # 与 collect_filters 一并保留供未来站点复用。
    applied_filters = [
        condition
        for condition in adapter.post_filter_conditions
        if configured_filters.get(condition, False)
    ]
    if applied_filters:
        # 保留适配器声明的顺序（与界面上的字段顺序一致），不排序——排序会把
        # "薪资 / 经验 / 学历"变成按码位排的"学历 / 经验 / 薪资"，读起来别扭。
        summary["filter_applied"] = applied_filters
        summary["filtered_out"] = report.filtered
        summary["filter_reasons"] = sorted(tally.reasons)
        summary["filter_undecided"] = sorted(tally.undecided)
        summary["filter_undecided_count"] = tally.undecided_count
        summary["filter_unapplied"] = sorted(tally.unapplied)
    if site_filters.applied or site_filters.unapplied:
        # 站点侧筛选的账目：**生效了哪几条**（站点在接口侧就筛掉了，用户能少翻很多页）、
        # **哪几条没能生效**。后者必须说出来——用户选了「公司规模：1000人以上」却拿到
        # 各种规模的岗位，唯一能解释这件事的就是这句话。
        summary["site_filter_applied"] = list(site_filters.applied)
        summary["site_filter_unapplied"] = list(site_filters.unapplied)
    if report.pagination_stopped_at:
        summary["pagination_stopped_at"] = report.pagination_stopped_at
    return summary
