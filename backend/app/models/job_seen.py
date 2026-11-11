# SPDX-License-Identifier: Apache-2.0
"""岗位采样流水（15A 僵尸岗雷达 / 15B JD 变更监控）：一次采集一条，重采不再无痕。

这张表刻意**没有任何唯一约束、也没有合并逻辑**：它的价值就是**序列**——第几次见到、
每次的薪资 / HR 活跃度 / JD 指纹。任何"只保留最近一次"的写法都会把 15A/15B 需要的
证据删掉（详见 ``migrations/versions/0012_job_seen.py`` 的三条不变量）。

读写纪律：

- 写：只在 ``services/apply/collector_history.record_sighting`` 一处，且**不 commit**
  （由采集 ``run`` 统一提交，与暂存候选同一事务）；
- 读：只在 ``services/apply/lifecycle.py``（纯函数 + 只读查询）。
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class JobSeen(Base):
    """一条「我在某次采集里又见到了这条岗位」。

    ``job_id`` 为空表示这条岗位当时还**没有**进岗位广场（采集先进备选岗位暂存区，
    用户勾选后才导入）。这类行不是垃圾数据：它同样证明"这条岗位挂在那里很久了"。
    """

    __tablename__ = "job_seen"
    # 与迁移 0012 建的两个索引逐字一致：``create_all``（测试库）与迁移链（生产库）
    # 必须长成同一个样子，否则"测试里能查、线上查不动"这种问题永远发现不了。
    __table_args__ = (
        Index("ix_job_seen_job_id_seen_at", "job_id", "seen_at"),
        Index("ix_job_seen_source_url_company", "source_url", "company"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # ON DELETE SET NULL：岗位被彻底删除后采样行留着（历史不跟着一条记录消失）。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    # 采样当时的身份快照：``job_id`` 为空时，这三列是唯一能认出"这是同一条岗位"的东西。
    source_url: Mapped[str] = mapped_column(String(512), default="", server_default="")
    title: Mapped[str] = mapped_column(String(128), default="", server_default="")
    company: Mapped[str] = mapped_column(String(128), default="", server_default="")
    # 采集任务 id（apply_task.id）。不做外键：删批次不该被流水挡住。
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    # 站点给的薪资展示文本（``xx-xxK·14薪``）。15A 用"从未变过"当证据，所以存原样文本，
    # 不存解析后的数字——解析失败时原文还能给人看。
    salary_text: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # HR 活跃信号（BOSS 列表接口的 ``bossOnline`` / 详情接口的 ``activeTimeDesc``）。
    # 两者分开存：一个是"现在在线吗"，一个是"多久前活跃"，判定规则不同。
    hr_active: Mapped[str] = mapped_column(String(32), default="", server_default="")
    hr_active_time: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # JD 指纹与前 2000 字快照：15B 的 before→after 全靠这两列。
    # 指纹为空 = 那次没拿到正文（详情抓取失败 / 岗位本来没有正文），不参与变更比对。
    description_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    description_text: Mapped[str] = mapped_column(Text, default="", server_default="")


__all__ = ["JobSeen"]
