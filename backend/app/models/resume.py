# SPDX-License-Identifier: Apache-2.0
"""简历生成记录模型：每次生成都落库，支持历史查看与导出。"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ResumeRecord(Base):
    __tablename__ = "resume_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    # 目标岗位（快照保存，岗位被删除后记录仍完整可用）
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    job_title: Mapped[str] = mapped_column(String(128), default="")
    company: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # 结构化简历
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)  # 一致性校验提醒
    # 历史记录没有该字段时由 SQLite 迁移默认标记为 AI 生成。
    source: Mapped[str] = mapped_column(String(16), default="ai", nullable=False)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 简历制作台的**草稿**（0051）：点「前往简历制作台」时先建一行，但它还不是一份
    # 用户认可的简历。存在这一列之前，那个入口会立刻 POST 出一条记录，于是用户只是
    # "点进去看了看、什么都没存就关掉"，简历中心里也多出一份空白简历。
    #
    # 判据与落点：所有**面向用户的列表/搜索/统计**都必须排除草稿（`saved_only()`），
    # 而内容写入（`PUT /resumes/{id}`）或版式写入（`PATCH /resumes/{id}/layout`）任一
    # 成功即置 False——用户点过保存，这份简历就"存在"了。
    draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    model: Mapped[str] = mapped_column(String(64), default="")
    # 旧数据库中的 tone 列为 NOT NULL 且没有服务端默认值。继续写入默认值仅为
    # 兼容历史表结构；API 和前端均不再暴露定制风格功能。
    tone: Mapped[str] = mapped_column(String(32), default="standard")
    enhancement_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    enhancement_level: Mapped[str] = mapped_column(String(16), default="balanced")
    # 生成时选择的版式参数：重新预览/导出时按同一套参数渲染，改参数不必重新生成。
    template: Mapped[str] = mapped_column(String(32), default="classic", server_default="classic")
    # 版式：一组排版覆盖的名字（内置预设名或用户自制版式名）；空串表示用模板
    # 默认的版式。
    format_name: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 只属于这份简历的版式覆盖，叠加在 format_name 解析出来的配置之上。
    #
    # 存在的理由：`format_name` 指向的是**具名**版式，改了它所有引用它的简历一起变。
    # 而「自动一页」试出来的方案只对当前这份内容成立（换一份内容就不一样了），不该
    # 反过来去污染用户的模板清单，所以按简历单独存一份。
    format_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    page_limit: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    font_scale: Mapped[str] = mapped_column(
        String(16), default="standard", server_default="standard"
    )
    # 这份简历的**纸面固定文案**用哪种语言（"zh-CN" / "en-US"，BCP 47 风格）。
    # 只影响小节标题与字段前缀（见 ``services/resume/resume_labels.py``），
    # **不翻译正文**（用户写的内容原样输出），也不参与生成链路。
    # 语言属于内容元数据而不是版式覆盖：换一个版式不该悄悄改掉简历的语言。
    # 旧行为空/未知值（被外部工具改过的库）读取侧一律按 "zh-CN" 处理，
    # 所以升级后旧简历的导出输出逐字不变（迁移 0049 用 DEFAULT 回填）。
    language: Mapped[str] = mapped_column(String(16), default="zh-CN", server_default="zh-CN")
    # 用户补充的生成要求原文，留痕以便查看和重新生成。
    custom_instruction: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 用户给这份简历写的备注（列表默认可见、详情可编辑）。
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    parse_error: Mapped[str] = mapped_column(Text, default="")  # JSON 解析失败时留痕
    # 结构化的"没写进这份简历"清单（JSON 数组：section/names/filtered/model_omitted）。
    # 与 warnings 分开：那是"疑似虚构"的红色核对项，这是岗位导向筛选的正常结果。
    # server_default 让建表（create_all）后就能插入不带该列的遗留行（如匿名/孤立
    # 简历），旧行读取到 [] 即"没有说明"；alembic 侧由 0037 迁移负责（旧行保持 NULL，
    # 读取方用 ``or []`` 兜底，两条路径语义一致）。
    coverage_notes: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    # 事实来源标注（RF-13）：生成时每一段内容是从哪条资料事实来的（grounded /
    # restored / enhanced_kept），纯收集已有映射、不调模型。旧行读取 `or []` 兜底，
    # 与 coverage_notes 同一套语义；alembic 侧由 0039 迁移负责。
    fact_annotations: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    # 生成说明：这份简历是怎么选出来的（岗位信号、候选组成、省略原因、事实约束），
    # 在预览里折叠展示，回答"为什么是这样一份简历"。
    rationale: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    # 最后修改时间（0047）：列表「最近修改」排序用。`onupdate` 在 ORM 更新这一行时
    # 自动刷新——改内容、调版式、改备注都算"动过它"，这正是用户想找的那一份。
    # 旧行升级时用 created_at 回填（见迁移 0047），所以排序不会因为升级而突变。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True, index=True
    )
    # 软删除时间戳：NULL 表示「没删」。列表查询一律加 `deleted_at IS NULL`，
    # 回收站里则只看非 NULL 的行（见 ``services/trash.py``）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 版本血缘（RF-17）：这份简历由哪份简历派生而来（修订/复制当时记下）。
    # NULL 表示独立版本——旧行与手写简历都是 NULL，读取方不做任何推断。
    parent_revision_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True
    )


# ===== 查询口径 =====


def saved_only() -> Any:
    """查询条件：只取**已保存**的简历（排除简历制作台的草稿）。

    与 ``services.trash.live_only`` 是同一种东西（"判据只写一次"）：草稿一旦漏进某个
    读取入口，用户就会在简历中心/搜索/统计里看到一份自己没打算建的空白简历，而且
    没有任何办法把它和真简历区分开。所以凡是"给人看简历清单"的查询都必须带上它，
    只有按 id 取详情（制作台自己要读那份草稿）不加。

    单独成函数而不是写死在各处的理由与 ``live_only`` 相同：写错了**不会报错**，只会
    静默地多出一份简历，而这正是本列要消灭的现象。
    """
    return ResumeRecord.draft.is_(False)


# ===== 简历生成后台任务状态机 =====
# 「后台继续」= 真后台：关掉弹窗后生成继续跑，用户回来能看到结果。为此把生成从
# 「一次 SSE 请求」改成「一条可轮询的任务」：状态落库、后台线程执行、完成才回填
# resume_id。状态取值与前端 types/resume.ts 镜像的字符串**逐字一致**。
GENERATE_STATUS_PENDING = "pending"
GENERATE_STATUS_RUNNING = "running"
GENERATE_STATUS_COMPLETED = "completed"
GENERATE_STATUS_CANCELLED = "cancelled"
GENERATE_STATUS_FAILED = "failed"
GENERATE_STATUSES = (
    GENERATE_STATUS_PENDING,
    GENERATE_STATUS_RUNNING,
    GENERATE_STATUS_COMPLETED,
    GENERATE_STATUS_CANCELLED,
    GENERATE_STATUS_FAILED,
)

# 仍在推进、需要前端继续轮询的状态。
GENERATE_ACTIVE_STATUSES = (GENERATE_STATUS_PENDING, GENERATE_STATUS_RUNNING)


class ResumeGenerateTask(Base):
    """一次简历生成后台任务。

    为什么单独一张表而不是复用 ``apply_task``：``apply_task`` 深度耦合采集/投递的
    CDP 内核（``current_step`` 是打开页面/填表/上传，``config`` 是限速/熔断阈值），
    简历生成没有这些概念，硬塞进去只会让两种任务的字段互相迁就。这里只保留生成真正
    需要的：状态、完成后回填的 resume_id、错误信息、以及重跑所需的请求快照。
    """

    __tablename__ = "resume_generate_task"

    id: Mapped[int] = mapped_column(primary_key=True)
    # pending/running/completed/cancelled/failed（取值见模块顶部常量）。
    status: Mapped[str] = mapped_column(String(16), default=GENERATE_STATUS_PENDING, index=True)
    # 完成后回填；取消/失败时保持 NULL（**绝不写半成品简历**）。
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True
    )
    # 失败/取消原因，可直接展示给用户。
    error: Mapped[str] = mapped_column(Text, default="")
    # 最近一条 progress 文案：前端用它映射阶段条、也用于展示"正在做什么"。
    message: Mapped[str] = mapped_column(Text, default="")
    # 已接收的模型原始输出字符数（**只做字数计数，不做百分比**——总长未知）。
    received_chars: Mapped[int] = mapped_column(Integer, default=0)
    # 重跑所需的请求快照：岗位、自定义标题、生成选项。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(256), default="")
    options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
