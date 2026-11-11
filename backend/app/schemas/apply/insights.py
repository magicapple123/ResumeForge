# SPDX-License-Identifier: Apache-2.0
"""#15 市场差位的三个只读分析（15C / 15D / 15E）的响应结构。

**字段名就是前后端契约**，改名等于破坏接口。三块结构各自守一条纪律，写在这里、实现处
不再重复论证：

1. **15C 岗位体检**（``ApplyJobInspectOut``）：三项指标全部来自本地已有数据（岗位表 /
   队列 / 投递记录 / 求职进度），**不联网、不调模型**。薪资一栏有硬样本门槛：样本不足时
   ``status="insufficient"`` 且 ``median`` / ``delta_percent`` / ``direction`` 一律为
   ``null``——**宁可不说话，也不许拿 3 条样本算出一个百分比**给用户当参考。
2. **15D 简历指派**（``ApplyResumeFitOut``）：这里的分数叫**「关键词覆盖」**
   （``*_coverage``），单位是 0–100 的整数百分比。它与 14B 的「参考分」
   （``ApplyQueueItemOut.match_score``）是**两个不同的东西**，绝不混排——一个算的是
   "这份简历的文本命中了岗位几个技能标签"，另一个算的是"匹配分析的结论打分"。命名上
   一旦混用，用户会以为系统自相矛盾。
3. **15E 边际收益停止线**（``ApplyStoppingPointOut``）：投递数 < 10 时 ``status=
   "insufficient"``、两条 rate 都是 ``null``，``message`` 只许说「样本不足（N 条投递）」
   ——**不许出现任何百分比**。这是本模块唯一一条"没数据就闭嘴"的硬约束。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# 薪资结论码：``ok`` = 有结论；``insufficient`` = 样本不足，只报样本数。
SalaryStatus = Literal["ok", "insufficient"]
# 偏离方向：高于同城同族中位 ±10% 记 high / low，落在 ±10% 内记 same。
SalaryDirection = Literal["high", "low", "same"]
# 停止线结论码：``insufficient`` 样本不足 / ``ok`` 还没过拐点 / ``past`` 已过拐点。
StoppingStatus = Literal["insufficient", "ok", "past"]


# ===== 15C 岗位体检 =====


class ApplySalaryInspectOut(BaseModel):
    """薪资偏离：本条岗位的薪资中位 vs 同城同职位族的历史中位。

    ``sample`` 是**参与比较的样本条数**（不含本条岗位自己），不是岗位总数——
    用户问的是"拿几条跟我比"，把"我"算进去会让 1 条样本显示成 2 条。
    """

    status: SalaryStatus = "insufficient"
    sample: int = 0
    # 单位统一是「元/月」，且只收能解析成月薪的写法：日薪（几百元量级）与读不出的
    # 写法都不进样本，否则中位数会被两种单位搅坏。
    median: int | None = None
    target: int | None = None
    delta_percent: float | None = None
    direction: SalaryDirection | None = None


class ApplySameCompanyOut(BaseModel):
    """同司多投：这家公司你一共放了几条、其中队列里几条、已经投出去几条。

    两个分量都是**行数**（队列条目数 / 投递记录数），``count`` 就是两者之和——
    单位一致才能相加；这里刻意不做"按岗位去重"，因为"同一 HR 一天收你三份"看的
    正是**动作次数**。
    """

    count: int = 0
    in_queue: int = 0
    applied: int = 0


class ApplyHistoryOut(BaseModel):
    """历史结果：这家公司的投递历史（成功 / 失败 / 无回音）。

    ``no_reply`` 只数**投成功之后进度还停在「已投递 / 筛选中」或根本没有进度的**条数：
    有回音的（测评/面试/Offer/已结束）不算无回音。
    """

    applied: int = 0
    succeeded: int = 0
    failed: int = 0
    no_reply: int = 0


class ApplyJobInspectOut(BaseModel):
    """一条队列条目的体检报告：三项指标各自独立，任何一项算不出来都只影响它自己。"""

    queue_id: int
    salary: ApplySalaryInspectOut = Field(default_factory=ApplySalaryInspectOut)
    same_company: ApplySameCompanyOut = Field(default_factory=ApplySameCompanyOut)
    history: ApplyHistoryOut = Field(default_factory=ApplyHistoryOut)


# ===== 15D 简历指派 =====


class ApplyResumeFitItemOut(BaseModel):
    """一条岗位的简历指派建议。

    ``current_coverage`` / ``recommended_coverage`` 是**关键词覆盖率**（0–100 整数），
    岗位没有关键词时为 ``null``（分母为 0，不给百分比）。``gain`` 是推荐后的净提升
    （``recommended_coverage - current_coverage``，没有当前简历时按 0 起算）；
    ``gain == 0`` 表示"现在这份就是最好的，不必换"。
    """

    queue_id: int
    job_id: int | None = None
    current_resume_id: int | None = None
    current_coverage: int | None = None
    recommended_resume_id: int | None = None
    recommended_coverage: int | None = None
    gain: int = 0
    reason: str = ""


class ApplyResumeFitOut(BaseModel):
    items: list[ApplyResumeFitItemOut] = Field(default_factory=list)


# ===== 15B JD 变更（被动式）=====


class ApplyJdChangeOut(BaseModel):
    """一条队列条目的 JD 变更：``changed`` + before/after 两段正文。

    三条纪律：

    1. **被动式**：数据来自采集历史，只有下次采集才会更新。前端必须标明「下次采集时更新」，
       否则用户会因为"刚改完 JD 这里没反应"而以为功能坏了。
    2. **没有可比对的历史就说没变**（``changed=false``、``before`` / ``after`` 都是空串），
       不许拿空值渲染成"从空变成了一段话"。
    3. ``seen_at`` 是**后一次**采样的时间（ISO 8601，秒级，无时区 UTC）；无历史时为 null。
    """

    changed: bool = False
    before: str = ""
    after: str = ""
    seen_at: str | None = None


# ===== 15A 忽略僵尸提示（本模块唯一一个**写**端点）=====


class ApplyGhostIgnoreIn(BaseModel):
    """``PUT /queue/{queue_id}/ghost-ignore`` 的请求体：只有一位开关。

    ``extra="forbid"`` 是刻意的：前端若把整条 ``ApplyQueueItemOut`` 直接 PUT 上来，
    里面还带着 ``ghost_score`` / ``ghost_evidence`` 这些**派生字段**，宽松解析会让"顺手
    写回分数"变成一条隐蔽的后门。多一个字段就 422，契约只有 ``{ignored}``。
    """

    model_config = ConfigDict(extra="forbid")

    ignored: bool


class ApplyGhostIgnoreOut(BaseModel):
    """回显这条队列条目现在的新状态：``{queue_id, ignored}``。

    只回两位，不回整条队列条目——前端本地已有那一行，回整条会让人以为"这里改了别的东西"
    （实际只动了 ``job.ghost_ignored``；分数、采样、队列顺序都没变）。
    """

    queue_id: int
    ignored: bool = False


# ===== 15E 边际收益停止线 =====


class ApplyStoppingWeekOut(BaseModel):
    """一个周桶：从 ``start``（YYYY-MM-DD）起的 7 天里投了几条、其中几条进了面试。"""

    start: str = ""
    applied: int = 0
    interviews: int = 0


class ApplyStoppingPointOut(BaseModel):
    """边际收益停止线：投递数 vs 进入面试数，按周分桶后比"最近两周"与"此前各周"。

    ``baseline_rate`` / ``recent_rate`` 是**面试率**（0–1 的小数，保留 4 位），
    样本不足或某一侧没有投递时为 ``null``——**null 不等于 0**，界面上不许把它渲染成 0%。
    """

    status: StoppingStatus = "insufficient"
    applied: int = 0
    interviews: int = 0
    baseline_rate: float | None = None
    recent_rate: float | None = None
    weeks: list[ApplyStoppingWeekOut] = Field(default_factory=list)
    message: str = ""


__all__ = [
    "ApplyGhostIgnoreIn",
    "ApplyGhostIgnoreOut",
    "ApplyHistoryOut",
    "ApplyJdChangeOut",
    "ApplyJobInspectOut",
    "ApplyResumeFitItemOut",
    "ApplyResumeFitOut",
    "ApplySalaryInspectOut",
    "ApplySameCompanyOut",
    "ApplyStoppingPointOut",
    "ApplyStoppingWeekOut",
    "SalaryDirection",
    "SalaryStatus",
    "StoppingStatus",
]
