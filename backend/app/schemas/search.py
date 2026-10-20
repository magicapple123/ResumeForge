# SPDX-License-Identifier: Apache-2.0
"""搜索与统计 Schema。"""

from typing import Literal

from pydantic import BaseModel

from .job import JobListOut
from .resume import ResumeBrief

# 全局搜索"更多结果"覆盖的数据域：每一类对应一个真实前端路由（见 api/search.py）。
SearchHitType = Literal["referral", "reminder", "experience", "claim", "material", "skill"]


class SearchHit(BaseModel):
    """一类扩展数据域（内推/提醒/面经/台账/资料/技能）里的一条命中结果。

    与 ``jobs`` / ``resumes`` 分开放在 ``SearchResult.more`` 里：既让旧调用方（只读
    ``jobs`` / ``resumes``）完全不感知，也避免为每个新数据域各造一个字段。
    """

    type: SearchHitType
    id: int
    title: str
    subtitle: str = ""
    # 指向真实前端路由，前端据此跳转（内推→/apply、提醒→/tracker、面经→/interview、
    # 台账→/claims、资料→/materials、技能→/skills）。
    path: str


class SearchResult(BaseModel):
    """全局搜索的响应体。

    ``jobs`` 用**列表瘦身模型**（RR-08）：搜索结果卡片只需要 id/标题/公司/地点/薪资，
    而 JD 全文动辄 20KB 一条、``limit`` 上限 50——带上全文时这个端点最坏情况接近 1MB，
    首页与搜索这两个最高频入口白白拖慢（实测 500 岗位合成库上 106KB→瘦身后几 KB）。
    要全文走 ``GET /api/jobs/{id}``（详情抽屉、编辑、生成简历都是那么做的）。
    """

    jobs: list[JobListOut] = []
    resumes: list[ResumeBrief] = []
    # 扩展数据域的命中结果，默认空列表保证向后兼容。
    more: list[SearchHit] = []


class PendingClaimBrief(BaseModel):
    """待确认的台账条目：首页只报数，点进去才看详情。"""

    id: int
    title: str


class Stats(BaseModel):
    job_count: int
    open_job_count: int
    resume_count: int
    week_resume_count: int
    # 首页卡片同样只读摘要（RR-08）；JD 全文按 id 单取。
    latest_jobs: list[JobListOut] = []
    latest_resumes: list[ResumeBrief] = []
    # 首页"接下来做什么"需要的几个数。全部只报**待办**，不报"你做了多少"——
    # 概览页上真正能推动用户的只有"还有什么没做完"。
    favorite_job_count: int = 0
    pending_claim_count: int = 0
    pending_claims: list[PendingClaimBrief] = []
    stalled_application_count: int = 0
    apply_queue_count: int = 0
    # 首次使用"第一份交付"进度条用的两个总量口径（区别于上面的待办口径）：
    # 台账总数（含已确认/待确认等全部活跃态）与关联了岗位的简历数。
    claim_count: int = 0
    resume_with_job_count: int = 0
    # 最近投递结果：给首页一条"投出去之后怎么样了"的线索。
    latest_applications: list[dict] = []
