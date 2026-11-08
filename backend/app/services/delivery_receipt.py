# SPDX-License-Identifier: Apache-2.0
"""投递交付单读视图（T08）：把已有投递快照组装成「停在手交线前、一眼能验收」的单据。

**只读聚合，不造证据**：数据全部来自既有 ``resume_delivery_record``（ADR-0002 的
revision / artifact / attempt 三组列），不新写快照、不补造历史（历史行没有快照是事实，
如实判 ``snapshot_missing``）、不 live 导出（``pages`` 等只读快照既有值，§6.2.5）。
唯一的写操作是 ``ack_receipt`` 写 ``apply_task_item.receipt_acked_at``，绝不碰
``application_track`` / ``status``——验收单据不等于推进流程。

**三态**（优先级 ``waiting_human > has_doubts > ready``，只在 ``judge_receipt`` 一处实现）：
卡在人手上 = 无快照 / 快照缺必需产物 / 还有待人工步骤（失败分类与三段稳定码映射成
``captcha_required`` 等码）；有疑点 = 事实台账疑点 > 0 或页数超目标页数；其余可验收。
"缺必需产物"按 source 区分：ADR-0002 §1 明确只有 ``source="export"`` 的快照才有
``artifact_sha256``，apply/track 路径按定义没有产物——若对它们也要求 artifact，所有投递台
单据会永远卡在人手上，与「给已有快照做可验收读视图」矛盾（已与 Lead 确认，见交付报告）。
还有人工步骤没做完时，用户的下一步动作是去把它做完，不该被"有疑点"盖住。

**指纹不同只展示、不参与三态**：投完再改简历是常态，算疑点会让单子常年黄灯（§6.2.3）。

**填充记录与疑点**：填充记录按 URL 精确匹配（``job.source_url``），匹配不上如实标
``fill.unknown=True``（可能是一键投递），不判缺件（计划 §12 决策 2）；疑点数复用
``resume_risk`` 本地确定性规则、只数能回指台账条目的深挖疑点（不调模型）。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy.orm import Session

from ..models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_FILE_UPLOAD_FAILED,
    FAILURE_GREETING_MISSING,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_PROFILE_INSUFFICIENT,
    FAILURE_UNCONFIRMED,
    STEP_FILLING,
    STEP_VERIFYING,
    ApplyTaskItem,
)
from ..models.claim import ClaimRecord
from ..models.job import Job
from ..models.profile import utcnow
from ..models.reminder import REMINDER_KIND_HR_REPLY, REMINDER_STATUS_PENDING, Reminder
from ..models.resume import ResumeRecord
from ..models.resume_delivery import DELIVERY_SOURCE_EXPORT, ResumeDeliveryRecord
from ..models.web_form_record import WebFormFillRecord
from ..schemas.delivery_receipt import (
    DeliveryReceiptOut,
    ReceiptDeliveryOut,
    ReceiptDoubtsOut,
    ReceiptFillOut,
    ReceiptFollowupOut,
    ReceiptState,
)
from ..schemas.resume_generation import UNLIMITED_PAGE_LIMIT
from . import trash
from .apply.failure_taxonomy import (
    REASON_CAPTCHA_REQUIRED,
    REASON_GREETING_MISSING,
    REASON_LOGIN_REQUIRED,
    REASON_PROFILE_INSUFFICIENT,
    REASON_UNCONFIRMED,
    REASON_UPLOAD_FAILED,
    TARGET_RESUME_UPLOAD,
)
from .resume.resume_delivery import canonical_content_sha256
from .resume.resume_risk_rules import scan_local

# ===== 三态与原因码（稳定码，展示名走前端语言包）=====
STATE_WAITING_HUMAN: Final[ReceiptState] = "waiting_human"
STATE_HAS_DOUBTS: Final[ReceiptState] = "has_doubts"
STATE_READY: Final[ReceiptState] = "ready"
RECEIPT_STATES = (STATE_WAITING_HUMAN, STATE_HAS_DOUBTS, STATE_READY)

REASON_SNAPSHOT_MISSING = "snapshot_missing"
REASON_ARTIFACT_MISSING = "artifact_missing"
REASON_DOUBTS_PRESENT = "doubts_present"
REASON_PAGE_LIMIT = "page_limit"
RECEIPT_STATE_REASONS = (
    REASON_SNAPSHOT_MISSING,
    REASON_ARTIFACT_MISSING,
    REASON_DOUBTS_PRESENT,
    REASON_PAGE_LIMIT,
)

# ===== 待人工步骤的稳定码（词表来自计划 §6.2.3；展示名走前端语言包）=====
HUMAN_STEP_CAPTCHA_REQUIRED = "captcha_required"
HUMAN_STEP_LOGIN_REQUIRED = "login_required"
HUMAN_STEP_REUPLOAD_RESUME = "reupload_resume"
HUMAN_STEP_ANSWER_SCREENING_QUESTIONS = "answer_screening_questions"
HUMAN_STEP_FILL_REQUIRED_FIELD = "fill_required_field"
HUMAN_STEP_CONFIRM_IN_BROWSER = "confirm_in_browser"
# 固定顺序：同一份数据永远得到同一个列表（前端渲染与断言都稳定）。
HUMAN_STEP_ORDER = (
    HUMAN_STEP_CAPTCHA_REQUIRED,
    HUMAN_STEP_LOGIN_REQUIRED,
    HUMAN_STEP_REUPLOAD_RESUME,
    HUMAN_STEP_ANSWER_SCREENING_QUESTIONS,
    HUMAN_STEP_FILL_REQUIRED_FIELD,
    HUMAN_STEP_CONFIRM_IN_BROWSER,
)

# 失败分类 / 三段稳定码 → 待人工步骤。
# 只认稳定码，不猜诊断自由文本：猜文案既不可测，也会随一次文案改动静默失效。
_HUMAN_STEP_BY_FAILURE_CATEGORY = {
    FAILURE_CAPTCHA_REQUIRED: HUMAN_STEP_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED: HUMAN_STEP_LOGIN_REQUIRED,
    FAILURE_FILE_UPLOAD_FAILED: HUMAN_STEP_REUPLOAD_RESUME,
    # 资料不足 / 招呼语缺失：用户得自己去把页面上的必填内容补齐。
    FAILURE_GREETING_MISSING: HUMAN_STEP_FILL_REQUIRED_FIELD,
    FAILURE_PROFILE_INSUFFICIENT: HUMAN_STEP_FILL_REQUIRED_FIELD,
    # 「无法确认」= 页面可能已经投出去了：只能请用户到浏览器核对，绝不自动重试。
    FAILURE_UNCONFIRMED: HUMAN_STEP_CONFIRM_IN_BROWSER,
}
_HUMAN_STEP_BY_FAILURE_REASON = {
    REASON_CAPTCHA_REQUIRED: HUMAN_STEP_CAPTCHA_REQUIRED,
    REASON_LOGIN_REQUIRED: HUMAN_STEP_LOGIN_REQUIRED,
    REASON_UPLOAD_FAILED: HUMAN_STEP_REUPLOAD_RESUME,
    REASON_GREETING_MISSING: HUMAN_STEP_FILL_REQUIRED_FIELD,
    REASON_PROFILE_INSUFFICIENT: HUMAN_STEP_FILL_REQUIRED_FIELD,
    REASON_UNCONFIRMED: HUMAN_STEP_CONFIRM_IN_BROWSER,
}
# 失败发生在这些步骤时，即便分类没细分，也能确定"有东西需要人工补/核对"。
_HUMAN_STEP_BY_FAILURE_STEP = {
    STEP_FILLING: HUMAN_STEP_FILL_REQUIRED_FIELD,
    STEP_VERIFYING: HUMAN_STEP_CONFIRM_IN_BROWSER,
}
_HUMAN_STEP_BY_FAILURE_TARGET = {
    TARGET_RESUME_UPLOAD: HUMAN_STEP_REUPLOAD_RESUME,
}

# 交付单读视图挂在 ``apply_task_item`` 上；幂等键就是这次真实投递动作的天然 ID
# （ADR-0002 §3：apply 路径 = ``apply_task_item:{id}``），不按公司/岗位反查。
_ITEM_ATTEMPT_KEY = "apply_task_item:{record_id}"


class ReceiptNotFound(Exception):
    """投递记录不存在或已进回收站（软删）——由路由映射成 404。

    失败/跳过记录**不在**此列：它们也可读可 ack，三态会如实给"卡在人手上"。
    """


@dataclass(frozen=True)
class ReceiptJudgement:
    """三态判定结果：状态 + 稳定原因码（有序、去重）。"""

    state: ReceiptState
    state_reasons: list[str]


def _pages_exceed(pages: int | None, page_limit: int | None) -> bool:
    """页数是否超目标页数。

    ``page_limit`` 的语义值 ``0`` = 不限篇幅（不是"1 页"），永远不判超限；
    两者任一未知（旧快照没有该键 / 没有导出产物）就**不猜**——不因为读不到就亮黄灯。
    """
    if pages is None or page_limit is None or page_limit <= UNLIMITED_PAGE_LIMIT:
        return False
    return pages > page_limit


def judge_receipt(
    *,
    snapshot_present: bool,
    artifact_sha256: str | None,
    artifact_required: bool = True,
    pages: int | None = None,
    page_limit: int | None = None,
    human_steps: Sequence[str] = (),
    doubts_count: int = 0,
) -> ReceiptJudgement:
    """三态判定（纯函数）：``waiting_human > has_doubts > ready``。

    ``artifact_required`` 按 source 区分（见模块 docstring）：只有 export 快照才有产物。
    与历史/文案无关：同一组事实永远得到同一个结论。
    """
    waiting: list[str] = []
    if not snapshot_present:
        waiting.append(REASON_SNAPSHOT_MISSING)
    elif artifact_required and not (artifact_sha256 or "").strip():
        waiting.append(REASON_ARTIFACT_MISSING)
    for code in human_steps:
        if code and code not in waiting:
            waiting.append(code)
    if waiting:
        return ReceiptJudgement(STATE_WAITING_HUMAN, waiting)

    doubts: list[str] = []
    if doubts_count > 0:
        doubts.append(REASON_DOUBTS_PRESENT)
    if _pages_exceed(pages, page_limit):
        doubts.append(REASON_PAGE_LIMIT)
    if doubts:
        return ReceiptJudgement(STATE_HAS_DOUBTS, doubts)
    return ReceiptJudgement(STATE_READY, [])


def human_steps(
    *,
    failure_category: str = "",
    failure_step: str = "",
    failure_target: str = "",
    failure_reason: str = "",
    fill_failed: int = 0,
    fill_unverified: int = 0,
) -> list[str]:
    """从**稳定码**推出待人工步骤（纯函数，表驱动）。

    输入全部是机器可读码：失败分类（10 类）、三段稳定码（step/target/reason）、
    以及填充记录里"填失败 / 填了没核对上"的计数。``answer_screening_questions``
    当前**没有稳定来源**（failure taxonomy 里没有筛选题子码、填充记录也不记录
    筛选题），保留在词表里等未来有稳定信号再加一行映射；不靠诊断自由文本关键词猜。
    """
    candidates = (
        _HUMAN_STEP_BY_FAILURE_CATEGORY.get(failure_category or ""),
        _HUMAN_STEP_BY_FAILURE_REASON.get(failure_reason or ""),
        _HUMAN_STEP_BY_FAILURE_STEP.get(failure_step or ""),
        _HUMAN_STEP_BY_FAILURE_TARGET.get(failure_target or ""),
        HUMAN_STEP_FILL_REQUIRED_FIELD if fill_failed > 0 else None,
        HUMAN_STEP_CONFIRM_IN_BROWSER if fill_unverified > 0 else None,
    )
    found = {code for code in candidates if code}
    return [code for code in HUMAN_STEP_ORDER if code in found]


def _page_limit_of(render_context: dict | None) -> int | None:
    """快照渲染上下文里的**语义**页数上限（``0`` = 不限）；缺失/脏值 → None（不猜）。"""
    if not isinstance(render_context, dict):
        return None
    raw = render_context.get("page_limit")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _artifact_required(delivery: ResumeDeliveryRecord | None) -> bool:
    """只有 ``source="export"`` 的快照才有 artifact（ADR-0002 §1）。

    apply/track 路径的 ``artifact_sha256`` 按定义恒为 NULL，对它们要求产物会把
    **每一条**投递台单据判成卡在人手上——与"给已有快照做可验收读视图"矛盾。
    这是计划 §6.2.3 字面与 ADR-0002 事实之间的取舍，已与 Lead 确认（记录在交付报告）。
    """
    return delivery is not None and delivery.source == DELIVERY_SOURCE_EXPORT


def _load_item(db: Session, record_id: int) -> ApplyTaskItem:
    item = trash.get_live(db, ApplyTaskItem, record_id)
    if item is None:
        raise ReceiptNotFound(f"投递记录不存在或已被删除：{record_id}")
    return item


def _delivery_for(db: Session, item: ApplyTaskItem) -> ResumeDeliveryRecord | None:
    """这次投递动作对应的快照（幂等键 ``apply_task_item:{id}``）。

    历史行（PR-09 之前没有幂等键 / 当时没关联简历）查不到 → 返回 None，如实判
    ``snapshot_missing``；不按公司/岗位反查一条旧快照来"补造关联"。
    """
    key = _ITEM_ATTEMPT_KEY.format(record_id=item.id)
    return (
        db.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.idempotency_key == key)
        .order_by(ResumeDeliveryRecord.created_at.desc(), ResumeDeliveryRecord.id.desc())
        .first()
    )


def _job_url(db: Session, item: ApplyTaskItem) -> str:
    """投递记录对应岗位的投递链接（匹配填充记录的键）；岗位不存在/无链接 → 空串。"""
    if item.job_id is None:
        return ""
    job = db.get(Job, item.job_id)
    if job is None:
        return ""
    return (job.source_url or "").strip()


def _fill_record_for(db: Session, item: ApplyTaskItem) -> tuple[WebFormFillRecord | None, str]:
    """按 URL 精确匹配最近一条未软删的填充记录；返回 (记录, 岗位投递链接)。"""
    url = _job_url(db, item)
    if not url:
        return None, ""
    record = (
        db.query(WebFormFillRecord)
        .filter(WebFormFillRecord.url == url, trash.live_only(WebFormFillRecord))
        .order_by(WebFormFillRecord.created_at.desc(), WebFormFillRecord.id.desc())
        .first()
    )
    return record, url


def _fill_total(record: WebFormFillRecord) -> int:
    """这次填充涉及多少个字段：``items`` 是唯一真源，旧行没有明细时退回三个计数。"""
    items = record.items or []
    if items:
        return len(items)
    return int(record.filled or 0) + int(record.unverified or 0) + int(record.failed or 0)


def _fill_out(record: WebFormFillRecord | None, url: str) -> ReceiptFillOut:
    if record is None:
        # 匹配不上 = 未知（可能是一键投递/岗位已删/没走网申填表），不是缺件。
        return ReceiptFillOut(matched=False, unknown=True, url=url)
    return ReceiptFillOut(
        matched=True,
        unknown=False,
        url=record.url or url,
        filled_count=int(record.filled or 0),
        total_count=_fill_total(record),
        failed_count=int(record.failed or 0),
    )


def _doubts_count(db: Session, delivery: ResumeDeliveryRecord | None) -> int:
    """事实台账疑点数：复用 ``resume_risk`` 的本地规则，只数能回指台账条目的点。

    用**快照内容**（当初投出去的那一版）而不是当前简历——单据验收的是那次投递。
    没有快照时无从体检，返回 0（此时三态已经是 ``waiting_human``）。
    """
    if delivery is None:
        return 0
    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    if not claims:
        return 0
    points = scan_local(delivery.content or {}, claims)
    return sum(1 for point in points if point.claim_id is not None)


def _resume_changed_since_delivery(db: Session, delivery: ResumeDeliveryRecord) -> bool:
    """快照内容指纹 ≠ 当前简历内容指纹（投出后又改过）。只展示，不参与三态。"""
    if delivery.resume_id is None:
        return False
    resume = db.get(ResumeRecord, delivery.resume_id)
    if resume is None or trash.is_deleted(resume):
        return False
    # 优先 source_content_sha256（"存档里是哪份内容"），旧行回退 content_sha256。
    frozen = (delivery.source_content_sha256 or delivery.content_sha256 or "").strip()
    if not frozen:
        return False
    return frozen != canonical_content_sha256(resume.content or {})


def _delivery_out(db: Session, delivery: ResumeDeliveryRecord | None) -> ReceiptDeliveryOut | None:
    if delivery is None:
        return None
    return ReceiptDeliveryOut(
        track_id=delivery.track_id,
        resume_title=delivery.resume_title or "",
        company=delivery.company or "",
        job_title=delivery.job_title or "",
        pages=delivery.pages,
        page_limit=_page_limit_of(delivery.render_context),
        export_format=delivery.export_format or "",
        request_params=delivery.request_params,
        content_sha256=delivery.content_sha256 or "",
        artifact_sha256=delivery.artifact_sha256,
        created_at=delivery.created_at,
        resume_changed_since_delivery=_resume_changed_since_delivery(db, delivery),
    )


def _followup_out(db: Session, delivery: ResumeDeliveryRecord | None) -> ReceiptFollowupOut | None:
    """跟进计划 = 该进度记录上最近一条待办 ``hr_reply`` 提醒（T05 挂的那条）。"""
    if delivery is None or delivery.track_id is None:
        return None
    reminder = (
        db.query(Reminder)
        .filter(
            Reminder.track_id == delivery.track_id,
            Reminder.kind == REMINDER_KIND_HR_REPLY,
            Reminder.status == REMINDER_STATUS_PENDING,
            trash.live_only(Reminder),
        )
        .order_by(Reminder.remind_at.asc(), Reminder.id.asc())
        .first()
    )
    if reminder is None:
        return None
    return ReceiptFollowupOut(reminder_id=reminder.id, due_at=reminder.remind_at)


def build_receipt(db: Session, record_id: int) -> DeliveryReceiptOut:
    """组装一张交付单（只读）。记录不存在/已软删 → ``ReceiptNotFound``。

    失败/跳过记录同样可读：没有快照时交付区块为 ``None`` + ``snapshot_missing``，
    不 500、不补造。
    """
    item = _load_item(db, record_id)
    delivery = _delivery_for(db, item)
    fill_record, fill_url = _fill_record_for(db, item)
    steps = human_steps(
        failure_category=item.failure_category or "",
        failure_step=item.failure_step or "",
        failure_target=item.failure_target or "",
        failure_reason=item.failure_reason or "",
        fill_failed=int(fill_record.failed or 0) if fill_record is not None else 0,
        fill_unverified=int(fill_record.unverified or 0) if fill_record is not None else 0,
    )
    doubts = _doubts_count(db, delivery)
    judgement = judge_receipt(
        snapshot_present=delivery is not None,
        artifact_sha256=delivery.artifact_sha256 if delivery is not None else None,
        artifact_required=_artifact_required(delivery),
        pages=delivery.pages if delivery is not None else None,
        page_limit=_page_limit_of(delivery.render_context) if delivery is not None else None,
        human_steps=steps,
        doubts_count=doubts,
    )
    return DeliveryReceiptOut(
        record_id=item.id,
        state=judgement.state,
        state_reasons=judgement.state_reasons,
        delivery=_delivery_out(db, delivery),
        fill=_fill_out(fill_record, fill_url),
        doubts=ReceiptDoubtsOut(count=doubts),
        human_steps=steps,
        followup=_followup_out(db, delivery),
        receipt_acked_at=item.receipt_acked_at,
    )


def ack_receipt(db: Session, record_id: int) -> DeliveryReceiptOut:
    """验收这张单据：只写 ``receipt_acked_at``（已有值不覆盖 = 幂等），返回最新只读视图。

    **不碰** ``application_track`` / ``status``：验收不等于推进流程（计划 §6.2.4）。
    失败/跳过记录也可 ack（用户可以对"卡在人手上"的单据点头）。
    """
    item = _load_item(db, record_id)
    if item.receipt_acked_at is None:
        item.receipt_acked_at = utcnow()
        db.commit()
    return build_receipt(db, record_id)


__all__ = [
    "HUMAN_STEP_ANSWER_SCREENING_QUESTIONS",
    "HUMAN_STEP_CAPTCHA_REQUIRED",
    "HUMAN_STEP_CONFIRM_IN_BROWSER",
    "HUMAN_STEP_FILL_REQUIRED_FIELD",
    "HUMAN_STEP_LOGIN_REQUIRED",
    "HUMAN_STEP_ORDER",
    "HUMAN_STEP_REUPLOAD_RESUME",
    "RECEIPT_STATES",
    "RECEIPT_STATE_REASONS",
    "REASON_ARTIFACT_MISSING",
    "REASON_DOUBTS_PRESENT",
    "REASON_PAGE_LIMIT",
    "REASON_SNAPSHOT_MISSING",
    "ReceiptJudgement",
    "ReceiptNotFound",
    "STATE_HAS_DOUBTS",
    "STATE_READY",
    "STATE_WAITING_HUMAN",
    "ack_receipt",
    "build_receipt",
    "human_steps",
    "judge_receipt",
]
