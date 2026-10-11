"""求职进度：一家公司一个岗位一条记录，随通知往前推进。

投递台记录的是**动作**（这个岗位投出去了、失败了），本模块记录的是**结果**（对方走到哪一步了）。
两者刻意分开：一次投递成功只写一条「已投递」记录，之后的状态变化来自对方发来的通知，
而不是投递行为本身。

设计要点：

- **合并键是归一化后的「公司 + 岗位」**，同一组合只有一条记录，后来的通知覆盖早期的
  「已投递」——这正是漏斗视图成立的前提。归一化只做去空白、统一大小写与全角转半角，
  不做模糊匹配：把两家不同公司合并到一起比留两条重复要糟糕得多。
- **状态只能前进，除非是拒信**。乱序粘贴旧通知（先贴了面试邀请、又贴了三个月前的
  「申请已收到」）不该把进度打回去；而拒信是决定性的，任何时候都覆盖当前状态。
  这条规则收口在 :func:`resolve_status`，界面与接口都从这里取结论。
- **不做推断**：普通自动回执只能落到「已投递」，不能推断出面试或 Offer。识别不出来就
  是「待确认」，由用户自己判断——这是本模块唯一会误导用户的失误来源。
"""
from datetime import datetime, timedelta

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# ===== ① 状态：秋招漏斗的六个阶段 =====
STATUS_UNKNOWN = "unknown"
STATUS_APPLIED = "applied"
STATUS_SCREENING = "screening"
STATUS_ASSESSMENT = "assessment"
STATUS_INTERVIEW = "interview"
STATUS_OFFER = "offer"
STATUS_REJECTED = "rejected"

STATUSES = (
    STATUS_APPLIED,
    STATUS_SCREENING,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_UNKNOWN,
)

STATUS_LABELS = {
    STATUS_APPLIED: "已投递",
    STATUS_SCREENING: "筛选中",
    STATUS_ASSESSMENT: "测评/笔试",
    STATUS_INTERVIEW: "面试",
    STATUS_OFFER: "Offer",
    STATUS_REJECTED: "已结束",
    STATUS_UNKNOWN: "待确认",
}

# 漏斗推进顺序。**已结束不参与排序**——它不是"比 Offer 更进一步"，而是另一条分支，
# 所以单独走 :func:`resolve_status` 里的判定。
STATUS_RANK = {
    STATUS_UNKNOWN: 0,
    STATUS_APPLIED: 1,
    STATUS_SCREENING: 2,
    STATUS_ASSESSMENT: 3,
    STATUS_INTERVIEW: 4,
    STATUS_OFFER: 5,
}

# 「进行中」的定义：还没走到终态，界面上要突出显示。
ACTIVE_STATUSES = frozenset(
    {STATUS_APPLIED, STATUS_SCREENING, STATUS_ASSESSMENT, STATUS_INTERVIEW}
)

# ===== ② 记录来源 =====
SOURCE_APPLY = "apply"
SOURCE_MANUAL = "manual"
SOURCE_RECOGNIZED = "recognized"
SOURCES = (SOURCE_APPLY, SOURCE_MANUAL, SOURCE_RECOGNIZED)

SOURCE_LABELS = {
    SOURCE_APPLY: "投递台自动记录",
    SOURCE_MANUAL: "手动添加",
    SOURCE_RECOGNIZED: "识别导入",
}

# ===== ②′ 投递渠道（RF-18）：用户自己选的"这份工作从哪来的" =====
# 与 ``source``（记录来源：这一行**怎么进系统的**）是两个维度，不许混用。
# 未知是合法取值且是默认值：不知道就是不知道，宁可留空也不替用户编一个渠道。
CHANNEL_UNKNOWN = "unknown"
CHANNEL_REFERRAL = "referral"
CHANNEL_WEBSITE = "official_website"
CHANNEL_PLATFORM = "job_platform"
CHANNEL_HEADHUNTER = "headhunter"
CHANNEL_OTHER = "other"
CHANNELS = (
    CHANNEL_UNKNOWN,
    CHANNEL_REFERRAL,
    CHANNEL_WEBSITE,
    CHANNEL_PLATFORM,
    CHANNEL_HEADHUNTER,
    CHANNEL_OTHER,
)

CHANNEL_LABELS = {
    CHANNEL_UNKNOWN: "未知",
    CHANNEL_REFERRAL: "内推",
    CHANNEL_WEBSITE: "官网",
    CHANNEL_PLATFORM: "招聘平台",
    CHANNEL_HEADHUNTER: "猎头/中介",
    CHANNEL_OTHER: "其他",
}

# ===== ②″ 状态变化事件的来源（RF-18）：谁写的这条事件 =====
# ``user`` = 用户在表单里亲手改的；``system`` = 识别合并 / 投递台自动记录等程序写入。
# 是否"用户确认"单独一列（``user_confirmed``）：识别导入虽然由程序落库，
# 但经过了用户在确认页勾选，与全自动的投递台写入不是一回事。
EVENT_SOURCE_USER = "user"
EVENT_SOURCE_SYSTEM = "system"
EVENT_SOURCES = (EVENT_SOURCE_USER, EVENT_SOURCE_SYSTEM)

EVENT_SOURCE_LABELS = {
    EVENT_SOURCE_USER: "用户手动",
    EVENT_SOURCE_SYSTEM: "系统记录",
}

# ===== ③ 合并结论：让"这次识别改变了什么"能被如实回报 =====
# 只有三种。没有"跳过"——用户取消勾选的条目根本不会进入请求，让服务层再去区分
# "没被选中"和"选中了但没变化"只会把两件不同的事混成一个字段。
MERGE_CREATED = "created"
MERGE_UPDATED = "updated"
MERGE_UNCHANGED = "unchanged"
MERGE_RESULTS = (MERGE_CREATED, MERGE_UPDATED, MERGE_UNCHANGED)

MERGE_LABELS = {
    MERGE_CREATED: "新增记录",
    MERGE_UPDATED: "更新进度",
    MERGE_UNCHANGED: "已是最新，未改动",
}


def status_label(status: str) -> str:
    """面向用户的状态名；未知取值给出中性描述，不猜成「已投递」。"""
    return STATUS_LABELS.get(status, "未知状态")


def resolve_status(current: str, incoming: str) -> str:
    """合并时的状态取舍：**只能前进，拒信除外**。

    - 收到拒信：无条件覆盖（流程已经结束了，之后不该再有任何推送把它复活）。
    - 其它情况：只有不比当前更早的阶段才采纳。乱序粘贴旧通知时保留较新的结论，
      调用方据此把这次识别标成「未改变」而不是当作更新。
    - 当前是「待确认」时任何明确状态都能覆盖它（包括已结束）。
    - 当前已是「已结束」：这是**终态**，非拒信的通知一律不改写（RF-06）。已结束
      不在 ``STATUS_RANK`` 里，是漏斗之外的另一条分支——没有比它"更晚"的阶段，
      乱序旧回执更不可能把它复活。用户确要重开一条已结束的记录，走表单显式编辑
      （``update_track``），那是可追溯的用户动作，不经过自动合并。
    """
    if incoming == STATUS_REJECTED:
        return incoming
    if current == STATUS_REJECTED:
        # 终态语义：拒信之后到来的任何非拒信通知（乱序回执、延迟推送）都不能
        # 把这条记录拉回进行中的阶段。
        return current
    if incoming not in STATUS_RANK:
        return current
    if current not in STATUS_RANK:
        # 当前是待确认或未知：收到的第一个明确状态就是最新结论。
        return incoming
    if STATUS_RANK[incoming] >= STATUS_RANK[current]:
        return incoming
    return current


def is_active(status: str) -> bool:
    """是否仍在流程中（用于统计与高亮）。"""
    return status in ACTIVE_STATUSES


# 「卡住」的判定阈值：进行中的记录超过这么多天没有任何更新。
#
# **口径写在名字里**：``updated_at`` 会被**任何**编辑刷新（改一条备注里的错别字也算），
# 所以这条规则是「超过 N 天**没有更新**」，**不是**「面试卡住」——调用方把它讲成后者
# 就是在给用户一个听起来更精确、其实不成立的说法。
#
# 放在领域模型这一层而不是某个路由里：它是关于 ApplicationTrack 的规则，
# ``/api/stats`` 与求职看板必须用同一份（``test_stalled_count_matches_stats_endpoint``
# 钉住两处结论一致）。
STALLED_DAYS = 7


def is_stalled(
    status: str, updated_at: datetime | None, now: datetime, *, days: int = STALLED_DAYS
) -> bool:
    """进行中、且超过 ``days`` 天没有任何更新。

    终态（Offer / 已结束 / 待确认）不叫卡住——流程已经走完了，再久没动也只是归档。
    恰好 ``days`` 天算"还没超"（严格大于才计入），与原先 ``updated_at < now - 7d``
    的判定等价。``updated_at`` 缺失时返回 False：没有时间戳就不该被点名。
    """
    if not is_active(status) or updated_at is None:
        return False
    return (now - updated_at) > timedelta(days=days)


def normalize_key(value: str) -> str:
    """归一化合并键：去空白、统一大小写、全角转半角。

    只做这几件事是因为它们**不会把不同的东西变成同一个**。加"去掉「有限公司」后缀"
    之类的规则看着聪明，实际会把「XX科技」和「XX科技有限公司」合并——同一家还好，
    但「XX科技」和「XX科技有限公司（上海）」就是两家了，而用户没法撤销一次错误合并。
    """
    text = (value or "").strip()
    # 全角字符（！到～）映射回 ASCII，中文标点不在这个区间，不受影响。
    text = "".join(chr(ord(ch) - 0xFEE0) if "！" <= ch <= "～" else ch for ch in text)
    text = "".join(text.split()).casefold()
    return text[:128]


class ApplicationTrack(Base):
    """一家公司一个岗位的求职进度。"""

    __tablename__ = "application_track"
    __table_args__ = (
        UniqueConstraint("company_key", "title_key", name="uq_application_track_company_title"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company: Mapped[str] = mapped_column(String(128), default="")
    title: Mapped[str] = mapped_column(String(128), default="")
    # 归一化后的合并键：空白/大小写/全角差异不该产生第二条记录。
    company_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    title_key: Mapped[str] = mapped_column(String(128), default="", index=True)

    status: Mapped[str] = mapped_column(String(24), default=STATUS_APPLIED, index=True)
    # 状态补充说明，例如「二面」「HR 面」「技术面挂了」。状态本身只有六种，
    # 具体到第几轮放在这里，避免状态枚举无限膨胀。
    stage_note: Mapped[str] = mapped_column(String(64), default="")

    # 日期统一用 YYYY-MM-DD 字符串，与资料库既有的日期字段保持一致。
    applied_at: Mapped[str] = mapped_column(String(16), default="")
    # 当前状态对应的日期（通知里写的日期，没有则留空）。
    status_date: Mapped[str] = mapped_column(String(16), default="")

    next_action: Mapped[str] = mapped_column(String(255), default="")
    next_action_date: Mapped[str] = mapped_column(String(16), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    # 状态来源摘录（来自哪封通知/哪句话）。只存简短片段，不存整封邮件。
    evidence: Mapped[str] = mapped_column(Text, default="")

    # 关联的岗位与简历：删掉之后记录仍要可读，所以 SET NULL + 保留快照字段。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True
    )
    # 所用简历的标题快照（RF-17）：简历被删（resume_id 置 NULL）后仍能回答
    # "当时投的是哪一版"。旧行/未关联为空串，界面如实标注「历史关联未知」。
    resume_title: Mapped[str] = mapped_column(String(256), default="")
    # 投递渠道（RF-18）：用户自选的"这份工作从哪来的"。默认未知——历史行一律未知，
    # 不从任何现有字段推断。与 ``source``（记录来源）是两个维度。
    channel: Mapped[str] = mapped_column(String(24), default=CHANNEL_UNKNOWN)
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_MANUAL)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # 软删除时间戳：NULL 表示「没删」。列表查询一律加 `deleted_at IS NULL`，
    # 回收站里则只看非 NULL 的行（见 ``services/trash.py``）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ApplicationTrackEvent(Base):
    """一次状态变化的留痕（RF-18）：真实时间线的最小单元。

    **只对新增的状态变化写**：功能上线之前的旧记录没有历史可回填——从当前状态或
    ``updated_at`` 反推"曾经到过哪一步"就是在编造历史，这里刻意不做。旧行没有事件，
    分析侧据此如实标注覆盖率（见 ``services/track_events.py``）。

    日期有两列、各管一件事：

    - ``event_at``：落库时刻（naive UTC），永远存在，是"这事是什么时候被记录的"。
    - ``status_date``：通知上写的日期 / 用户填的日期，**可能为空**。阶段耗时用
      它来算（两列都有时才有资格参与"通知口径"的间隔），因为它代表业务上真实的
      时间点；``event_at`` 只能代表"什么时候粘贴的"。

    拒信也写事件：终态是时间线上真实发生过的一步，记录它**不会**抹掉之前到过的
    阶段——事件是追加的，状态字段的合并规则（:func:`resolve_status`）管不了这里。
    """

    __tablename__ = "application_track_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 进度记录被彻底删除时事件跟着删（CASCADE）：孤儿事件对指标毫无意义。
    track_id: Mapped[int] = mapped_column(
        ForeignKey("application_track.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    status_date: Mapped[str] = mapped_column(String(16), default="")
    source: Mapped[str] = mapped_column(String(16), default=EVENT_SOURCE_SYSTEM)
    user_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    from_status: Mapped[str] = mapped_column(String(24), default="")
    to_status: Mapped[str] = mapped_column(String(24), default="")


__all__ = [
    "ACTIVE_STATUSES",
    "ApplicationTrack",
    "ApplicationTrackEvent",
    "CHANNELS",
    "CHANNEL_HEADHUNTER",
    "CHANNEL_LABELS",
    "CHANNEL_OTHER",
    "CHANNEL_PLATFORM",
    "CHANNEL_REFERRAL",
    "CHANNEL_UNKNOWN",
    "CHANNEL_WEBSITE",
    "EVENT_SOURCES",
    "EVENT_SOURCE_LABELS",
    "EVENT_SOURCE_SYSTEM",
    "EVENT_SOURCE_USER",
    "MERGE_CREATED",
    "MERGE_LABELS",
    "MERGE_RESULTS",
    "MERGE_UNCHANGED",
    "MERGE_UPDATED",
    "SOURCE_APPLY",
    "SOURCE_LABELS",
    "SOURCE_MANUAL",
    "SOURCE_RECOGNIZED",
    "SOURCES",
    "STALLED_DAYS",
    "STATUSES",
    "STATUS_APPLIED",
    "STATUS_ASSESSMENT",
    "STATUS_INTERVIEW",
    "STATUS_LABELS",
    "STATUS_OFFER",
    "STATUS_RANK",
    "STATUS_REJECTED",
    "STATUS_SCREENING",
    "STATUS_UNKNOWN",
    "is_active",
    "is_stalled",
    "normalize_key",
    "resolve_status",
    "status_label",
]
