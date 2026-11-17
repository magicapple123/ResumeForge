# SPDX-License-Identifier: Apache-2.0
"""公司调研历史（T07）：每一次调研各留一条，知识库仍只留最新一份。

**为什么单独一张表**：知识库里同一家公司按 ``company + source`` **原地覆盖**（见
``services/job/company_research_store``），语义是"这家公司现在长什么样"，用户不该
在那里翻到十份越来越旧的简报。但"上次调研说了什么"本身有价值（对比岗位变化、回看
当时引用了哪些资料），所以按**运行**追加，与知识库互不影响：

- 历史行是**快照**：正文、来源、卡片都在这里各存一份，知识库条目被删改也不影响历史；
- 不进回收站（没有 ``deleted_at``）：它不承载用户的编辑，删除是显式的
  ``DELETE /api/research/history/{id}``，删掉就没了；
- 外键都是 ``ondelete="SET NULL"``：知识条目或岗位被彻底删除后，历史仍然可读。

写入口只有 ``services/job/company_research_history.record_run`` 一处，且**独立事务**
——调研本身已经花了搜索费，历史写失败不能变成"调研失败"。
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class CompanyResearchRun(Base):
    """一次公司调研的运行记录（只追加，不原地改）。"""

    __tablename__ = "company_research_run"
    # 与迁移 0022 建的两个复合索引逐字一致：``create_all``（测试库）与迁移链（生产库）
    # 必须长成同一个样子，否则「历史列表按公司+时间翻页」只会在其中一条建库路径上快。
    __table_args__ = (
        Index("ix_company_research_run_company_created_at", "company", "created_at"),
        Index("ix_company_research_run_job_id_created_at", "job_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 归一化后的公司名（NFKC + 压空白 + 去责任形式后缀），与知识库条目的 company 同一口径，
    # 历史列表才能按公司聚合。
    company: Mapped[str] = mapped_column(String(128), default="", server_default="", index=True)
    # 用户当时输入的原样公司名：归一化会去掉「有限公司」，历史里要能看出用户问的是哪家。
    company_raw: Mapped[str] = mapped_column(String(128), default="", server_default="")
    role: Mapped[str] = mapped_column(String(80), default="", server_default="")
    # JD 快照只留前 5000 字：完整 JD 可达 6000 字且多为模板文本，历史列表不需要全文；
    # 需要判断"JD 变没变"用 hash，不需要正文。
    jd_excerpt: Mapped[str] = mapped_column(Text, default="", server_default="")
    jd_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    deep: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # 简报状态（``ok`` / ``failed`` / ``skipped``）：失败的那次也要留一条，
    # "上次失败了、这次成功了"是用户看得懂的信息。
    status: Mapped[str] = mapped_column(String(16), default="", server_default="")
    brief_markdown: Mapped[str] = mapped_column(Text, default="", server_default="")
    sources: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    cards: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    search_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 那次运行写进/更新的是哪条知识条目（历史被删时不动它）。
    knowledge_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_entry.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )


__all__ = ["CompanyResearchRun"]
