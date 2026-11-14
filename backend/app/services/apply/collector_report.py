# SPDX-License-Identifier: Apache-2.0
"""从 ``apply/collector.py`` 拆出：一次采集的统计结果 ``CollectReport``。

纯数据类：字段与说明和拆分前逐字一致；``collector.py`` 的模块命名空间里 re-export。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CollectReport:
    """一次采集的统计结果。

    ``collected`` 是**已暂存**的候选数（不是"已进入岗位广场"）；``skipped`` 是重复数
    （岗位广场里已有，或暂存区里已有）。
    """

    collected: int = 0
    skipped: int = 0
    pages: int = 0
    # 按用户填的学历 / 经验 / 薪资**明确筛掉**的条数（判断不了的不算，它们被保留了）。
    filtered: int = 0
    # 其中"跳过"里有几条是因为岗位广场的**回收站**里已经有一条（用户之前删过）。
    skipped_trashed: int = 0
    # 搜索采集里"暂存了、但正文（JD）为空"的条数。这是**站点漂移唯一留下的痕迹**：能翻到
    # 列表却读不出详情时，任务本身仍然是"成功"的，不计这个数就完全看不见——历史上"8 条岗位
    # JD 全空"的事故就是这么发生的。补详情模式有自己的账目（backfilled / backfill_skipped），
    # 两者刻意不混用，否则会把"用户点名去补"的语义算进"正常采集"的漂移里。
    detail_missing: int = 0
    # 「补齐详情」模式：成功补到的条数，以及因为"已经有描述 / 在回收站里 / 没有链接"跳过的条数。
    backfilled: int = 0
    backfill_skipped: int = 0
    blocked: int = 0  # 命中屏蔽清单被丢弃的条数：用户要知道"为什么这次采到的比往年少"
    # 翻页饱和提前停止的位置：站点从某一页起开始返回与前面**完全相同**的结果
    # （筛选组合下岗位总量就这么多，或站点对深层翻页重复推送），再翻只会原样重复到
    # 页数上限。0 表示没有触发（正常翻完或被上限/去重之外的路径终止）。
    pagination_stopped_at: int = 0
    unmapped_conditions: list[str] = field(default_factory=list)
