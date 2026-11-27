# SPDX-License-Identifier: Apache-2.0
"""投递队列：准入、去重、排序，以及简历 / 招呼语解析。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, get_args

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.apply import (
    ADMISSION_BLOCK,
    HARD_GATES,
    QUEUE_STATUS_PENDING,
    ApplyQueueItem,
    JobMatchAnalysis,
)
from ...models.job import Job
from ...models.profile import utcnow
from ...models.resume import ResumeRecord, saved_only
from ...schemas.apply import ApplyConfigIn, ApplyQueueItemOut, ApplyQueueListOut, QueueStatus
from .. import trash
from ..profile.profile_service import project_legacy_profile
from ..sites.base import SiteAdapter
from ..sites.registry import get_registry
from ._base import ApplyConflict, ApplyNotFound, ApplyServiceError, _clip_greeting
from ._config import get_apply_config
from ._match import _admission_of_match, _blocking_gaps, _match_requires_confirm, latest_match
from .blocklist import load_blocklist
from .greeting_image import normalize_image_ids
from .lifecycle import job_history
from .resume_link import external_names, stored_link
from .signals import favorite_of, reference_score

# 队列列表的兜底上限（P2-2）：超过后前端按 total/truncated 如实提示。
MAX_QUEUE_LIST = 500

_QUEUE_STATUS_VALUES: tuple[QueueStatus, ...] = get_args(QueueStatus)


def _as_queue_status(value: str) -> QueueStatus:
    """模型层 ``status`` 是 ``str``，出口处收窄为 schema 的 ``Literal``。

    取值由入队 / 回写链路用常量写入，正常不会走到兜底；万一库里出现未知值，在这里
    大声失败（与 pydantic Literal 字段的校验语义一致），不悄悄把非法状态发给前端。
    """
    if value not in _QUEUE_STATUS_VALUES:
        raise ValueError(f"未知的队列状态：{value!r}")
    return value


def _resume_title(db: Session, resume_id: int | None) -> str:
    if resume_id is None:
        return ""
    resume = db.get(ResumeRecord, resume_id)
    return resume.title if resume is not None else ""


def _resume_titles(db: Session, resume_ids: Sequence[int | None]) -> dict[int, str]:
    """按 id **批量**取简历标题（一次查询覆盖整页），缺失（已删）的不在返回里。

    与 :func:`_resume_title` 同一口径，只是把"每行一次 ``db.get``"换成一次 ``in_``：
    队列列表整页 500 条时，逐行取标题就是 500 次主键查询。

    **刻意不过软删过滤**：``_resume_title`` 用的是 ``db.get``，它本来就不看软删，批量版
    必须逐字保持这个口径——否则"删除简历后队列标题从空变成旧标题"这种差异会悄悄出现。
    """
    ids = sorted({int(resume_id) for resume_id in resume_ids if resume_id})
    if not ids:
        return {}
    rows = db.query(ResumeRecord).filter(ResumeRecord.id.in_(ids)).all()
    return {row.id: row.title for row in rows}


def _matches_by_job_id(db: Session, job_ids: Sequence[int | None]) -> dict[int, JobMatchAnalysis]:
    """按岗位批量取最近一次匹配结论（一次查询覆盖整页），等价于逐条 :func:`latest_match`。

    ``job_match_analysis.job_id`` 有唯一约束（一个岗位只保留最近一次分析），所以
    "按 job_id 批量取"与"逐条 ``one_or_none()``"读到的是同一行，不存在窗口/排序语义问题。
    ``job_id`` 为空的行（岗位已删除、结论仍留快照）不参与——``latest_match(None)`` 也是 None。
    """
    ids = sorted({int(job_id) for job_id in job_ids if job_id})
    if not ids:
        return {}
    rows = db.query(JobMatchAnalysis).filter(JobMatchAnalysis.job_id.in_(ids)).all()
    return {int(row.job_id): row for row in rows if row.job_id is not None}


def job_apply_site(job: Job | None) -> SiteAdapter | None:
    """这个岗位能不能自动投递：能则返回对应站点适配器，不能则返回 ``None``。

    **唯一判据**：岗位的来源 / 投递链接必须能落到某个已注册站点上。纯手动录入、来源与链接
    都指不到站点的岗位，在投递时定位不到任何站点适配器，强行投只会得到一条「未知失败」的
    记录——所以"入队校验、开始投递前的拦截、列表上的能否投递标记"三处都走这一个函数，
    不各自判一遍。岗位已被删除（``None``）同样视为不可投递。
    """
    if job is None:
        return None
    return get_registry().resolve_for_job(job)


def unsupported_site_message(job: Job) -> str:
    """不可投递时的中文说明：入队被拒、开始投递被拦、单条失败诊断三处共用同一句。"""
    return (
        f"「{job.title or '该岗位'}」的来源不是投递台支持的招聘网站"
        f"（当前支持：{get_registry().supported_names()}），无法自动投递。"
        "请到对应的招聘网站里手动投递。"
    )


def _queue_out(
    db: Session,
    item: ApplyQueueItem,
    job: Job | None,
    *,
    cache: dict[str, Any] | None = None,
    resume_titles: dict[int, str] | None = None,
    external_titles: dict[int, str] | None = None,
    matches: dict[int, JobMatchAnalysis] | None = None,
) -> ApplyQueueItemOut:
    """队列条目的出口结构：准入摘要 + 能否投递 + 参考分/收藏（14B）+ 生命周期（15A/15B）。

    ``cache`` 只用于列表批量出口时复用"资料文本"（见 ``signals.reference_score``）与
    "采样序列"（见 ``lifecycle.job_history``）；单条出口（入队、改招呼语）不传，
    省一次字典分配也不影响正确性。

    ``resume_titles`` / ``matches`` 是**批量出口专用**的预取字典（见 :func:`_resume_titles`
    与 :func:`_matches_by_job_id`）：传了就只查字典，不传就按单条口径各查一次。
    两者都**不改变结果**——批量版与单条版读的是同一份数据、同一个唯一约束。
    """
    if matches is not None:
        match = matches.get(item.job_id) if item.job_id is not None else None
    else:
        match = latest_match(db, item.job_id)
    admission = _admission_of_match(match) if match is not None else None
    hard_gate = match.hard_gate if match is not None and match.hard_gate in HARD_GATES else None
    if resume_titles is not None:
        resume_title = resume_titles.get(item.resume_id, "") if item.resume_id is not None else ""
    else:
        resume_title = _resume_title(db, item.resume_id)
    # T30：条目改用外部简历原件时，``resume_title`` 回显那份外部简历的名字（队列行据此
    # 渲染「外部 · xxx.pdf」）。批量出口用预取字典，单条出口查一次——两者同一口径。
    if item.external_resume_id is not None:
        if external_titles is not None:
            resume_title = external_titles.get(int(item.external_resume_id), "")
        else:
            resume_title = external_names(db, [item.external_resume_id]).get(
                int(item.external_resume_id), ""
            )
    # 15A/15B：僵尸分与 JD 变更都来自同一份采集历史，一次读库（见 lifecycle.job_history）。
    history = job_history(db, job, cache=cache)
    return ApplyQueueItemOut(
        id=item.id,
        job_id=item.job_id,
        job_title=item.job_title,
        company=item.company,
        resume_id=item.resume_id,
        external_resume_id=item.external_resume_id,
        resume_title=resume_title,
        greeting=item.greeting,
        # T8：配图只回引用 id（列表接口绝不下发 data URL）。脏值在这里收敛一次，
        # 前端拿到的永远是"去重、正整数"的数组，不必各写一份判空逻辑。
        image_ids=normalize_image_ids(item.image_ids),
        sort_order=item.sort_order,
        status=_as_queue_status(item.status),
        admission=admission,
        hard_gate=hard_gate,
        requires_confirm=_match_requires_confirm(match) if match is not None else False,
        # 「能不能自动投」由来源决定，与匹配结论无关；界面上据此禁用勾选并说明原因。
        apply_supported=job_apply_site(job) is not None,
        match_score=reference_score(db, job, match, cache=cache),
        favorite=favorite_of(job),
        ghost_score=history["score"],
        ghost_evidence=history["evidence"],
        # 15A：忽略开关随行走（前端据此决定显示「忽略」还是「恢复」，以及徽标是否静音）。
        ghost_ignored=bool(getattr(job, "ghost_ignored", False)),
        jd_changed=history["jd_changed"],
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def list_queue(db: Session, limit: int = MAX_QUEUE_LIST) -> list[ApplyQueueItemOut]:
    """按排序列出投递队列，每行带准入结论与能否投递标记。

    **后导入的排最上**（用户实测反馈：海投场景新加入的岗位应该最先看到）。``sort_order``
    大的是新条目，所以倒序取；重排序（``reorder_queue``）写值时与此口径配对。

    列表默认按 :data:`MAX_QUEUE_LIST` 兜底上限（P2-2）：海投千级队列时 HTTP 响应不再
    全量下发；总数走 :func:`count_queue`，由端点拼上 ``truncated`` 如实告知前端。
    """
    items = (
        db.query(ApplyQueueItem)
        .order_by(ApplyQueueItem.sort_order.desc(), ApplyQueueItem.id.desc())
        .limit(max(1, limit))
        .all()
    )
    # 岗位一次性取回，避免每行一次查询（队列条数不多，但这属于该顺手做对的事）。
    jobs = _jobs_by_id(db, [item.job_id for item in items])
    # 简历标题与匹配结论同样整页一次取回（原先每行各一次 db.get / latest_match）：
    # 500 条队列 = 1000 次多余的主键/单行查询，而这两份数据在出口处只用于填充字段。
    resume_titles = _resume_titles(db, [item.resume_id for item in items])
    # T30：外部简历名同样整页一次取回（否则每行一次主键查询）。
    external_titles = external_names(db, [item.external_resume_id for item in items])
    matches = _matches_by_job_id(db, [item.job_id for item in items])
    # 参考分要现算：资料文本整页只读一次，简历文本逐岗位不同（见 signals.reference_score）。
    cache: dict[str, Any] = {}
    # job_id 在模型层可空（岗位删除后置空）；_jobs_by_id 只收非空 id，这里对 None 直接给 None。
    return [
        _queue_out(
            db,
            item,
            jobs.get(item.job_id) if item.job_id is not None else None,
            cache=cache,
            resume_titles=resume_titles,
            external_titles=external_titles,
            matches=matches,
        )
        for item in items
    ]


def count_queue(db: Session) -> int:
    """队列总条数：与 ``list_queue`` 的上限无关的全量口径。"""
    return int(db.query(func.count(ApplyQueueItem.id)).scalar() or 0)


def queue_overview(db: Session) -> ApplyQueueListOut:
    """队列列表的响应体：一页条目 + 全量总数 + 是否被上限截断。

    ``GET /api/apply/queue`` 与助手动作 ``list_apply_queue`` 都调这里：截断判据
    （``len(items) < total``）只有一处实现，不会出现"一侧如实标记、另一侧静默全量"的
    两种口径。
    """
    items = list_queue(db)
    total = count_queue(db)
    return ApplyQueueListOut(items=items, total=total, truncated=len(items) < total)


def _jobs_by_id(db: Session, job_ids: Sequence[int | None]) -> dict[int, Job]:
    """按 id 批量取岗位；缺失（已删除）的不在返回里。"""
    ids = sorted({job_id for job_id in job_ids if job_id})
    if not ids:
        return {}
    return {job.id: job for job in db.query(Job).filter(Job.id.in_(ids)).all()}


def add_to_queue(db: Session, request: Any) -> list[ApplyQueueItemOut]:
    """加入队列；命中"屏蔽清单 / 来源不支持 / 已在队列 / 真实缺口 / 未分析"时抛 409 并回传原因。

    整批要么全部成功、要么全部回滚：任一岗位不满足准入就中断，避免"加了一半"。
    """
    config = get_apply_config(db)
    # 14E 闸门②：屏蔽清单整批读一次（不再是每条一次查询）。
    blocklist = load_blocklist(db)
    next_order = db.query(func.coalesce(func.max(ApplyQueueItem.sort_order), 0)).scalar() or 0
    created: list[ApplyQueueItem] = []
    created_jobs: list[Job] = []
    try:
        for entry in request.items:
            job = db.get(Job, entry.job_id)
            if job is None:
                raise ApplyNotFound(f"岗位不存在或已被删除：{entry.job_id}")
            # 屏蔽清单**最先判**：它是用户的显式意愿（"这家/这类我不要"），排在其他任何
            # 准入判断之前——否则用户会先被"未分析，确认加入？"问一遍，确认完才被告知屏蔽。
            blocked_hit = blocklist.hit(job.company, job.title)
            if blocked_hit:
                raise ApplyConflict(
                    {
                        "message": (
                            f"「{job.title or '该岗位'}」命中屏蔽清单（{blocked_hit}），未加入队列。"
                            "要去掉这条限制，请到「投递设置 → 屏蔽清单」里删除它。"
                        ),
                        "job_id": job.id,
                        "blocked_by_blacklist": True,
                        "blocked_hit": blocked_hit,
                    }
                )
            # 来源闸门**放最前**：这是"这个岗位本来就走不到投递"的硬前提，不是用户确认一下
            # 就能放行的事（与下面的未分析 / 真实缺口不同，那两类可以由用户显式确认）。
            if job_apply_site(job) is None:
                raise ApplyConflict(
                    {
                        "message": unsupported_site_message(job),
                        "job_id": job.id,
                        "site_unsupported": True,
                    }
                )
            existing = (
                db.query(ApplyQueueItem).filter(ApplyQueueItem.job_id == job.id).one_or_none()
            )
            if existing is not None:
                raise ApplyConflict(
                    {"message": f"「{job.title or '该岗位'}」已在投递队列中", "job_id": job.id}
                )
            match = latest_match(db, job.id)
            if match is None:
                if not entry.confirm_unanalyzed:
                    raise ApplyConflict(
                        {
                            "message": f"「{job.title or '该岗位'}」尚未做过匹配分析，确认继续加入？",
                            "job_id": job.id,
                            "unanalyzed": True,
                        }
                    )
            else:
                admission = _admission_of_match(match)
                if admission == ADMISSION_BLOCK and not (
                    entry.confirm_real_gap or config.confirm_real_gap
                ):
                    raise ApplyConflict(
                        {
                            "message": f"「{job.title or '该岗位'}」存在真实缺口，需确认后再加入",
                            "job_id": job.id,
                            "gaps": _blocking_gaps(match.result),
                        }
                    )
                # 「需确认」（needs_confirm）与「读不出可用结论」（admission is None，即空结果 /
                # 未知取值 / hard_gate=unknown 且无标记）**同级处理**：都不阻断入队，但该条目被视为
                # 未获授权自动投递——`_match_requires_confirm` 会据此算出 requires_confirm=True，
                # 投递前仍要用户逐条确认。未知/空结论绝不默认放行。
            next_order += 1
            # T30：入队时就把"用哪份简历"收敛成三元组（内外互斥 + 外部简历必须还存在）。
            # 放在准入判断之后：先回答"这个岗位能不能投"，再回答"用哪份投"。
            linked_resume_id, linked_external_id, _title = stored_link(
                db, entry.resume_id, entry.external_resume_id
            )
            queue_item = ApplyQueueItem(
                job_id=job.id,
                job_title=job.title,
                company=job.company,
                resume_id=linked_resume_id,
                external_resume_id=linked_external_id,
                greeting=_clip_greeting(entry.greeting),
                sort_order=next_order,
                status=QUEUE_STATUS_PENDING,
            )
            db.add(queue_item)
            created.append(queue_item)
            created_jobs.append(job)
        db.commit()
    except ApplyServiceError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    # created 与 created_jobs 在同一循环里成对 append，长度恒等：strict=True 让
    # "两表错位"这种不可能的状态在发生时立刻炸出来，而不是悄悄产出错位队列。
    return [_queue_out(db, item, job) for item, job in zip(created, created_jobs, strict=True)]


def update_queue_item(db: Session, item_id: int, payload: Any) -> ApplyQueueItemOut:
    """更新队列条目的招呼语 / 简历 / 配图，并回填准入结论与能否投递标记。"""
    item = db.get(ApplyQueueItem, item_id)
    if item is None:
        raise ApplyNotFound("投递队列条目不存在或已被移除")
    if payload.greeting is not None:
        item.greeting = _clip_greeting(payload.greeting)
    # T30：简历这一侧的 PATCH 语义——**只提交一个键**也要能表达改选：
    # - 显式给 `external_resume_id` 非空 = 换成外部简历，内部 id 随之清空；
    # - 显式给 `resume_id` 非空 = 换成内部简历，外部 id 随之清空；
    # - 两键都给 null = 改回"按默认规则为该岗位找简历"，两个关联都清空。
    # "改选要清另一侧"只能在这里做：schema 看不到库里已存的那一侧（与 R14 提醒同一分层）。
    fields = getattr(payload, "model_fields_set", set())
    if "resume_id" in fields or "external_resume_id" in fields:
        wanted_resume = getattr(payload, "resume_id", None)
        wanted_external = getattr(payload, "external_resume_id", None)
        merged_resume = wanted_resume if "resume_id" in fields else item.resume_id
        merged_external = (
            wanted_external if "external_resume_id" in fields else item.external_resume_id
        )
        if wanted_external is not None:
            merged_resume = None
        if wanted_resume is not None:
            merged_external = None
        # stored_link 一次做完全部校验（互斥 / 外部简历还存在 / 内部简历还存在），
        # 不合格就 422 或 404，绝不留一个悬空 id 落到执行期。
        item.resume_id, item.external_resume_id, _title = stored_link(
            db, merged_resume, merged_external
        )
    image_ids = getattr(payload, "image_ids", None)
    if image_ids is not None:
        # 行内覆盖（T8）：**空列表是"这条不发图"**，不是"没改"——两者必须区分开，
        # 否则用户清空选择之后仍会退回全局默认图，等于没法关掉单条的配图。
        item.image_ids = normalize_image_ids(image_ids)
    item.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return _queue_out(db, item, db.get(Job, item.job_id) if item.job_id else None)


def remove_queue_item(db: Session, item_id: int) -> None:
    item = db.get(ApplyQueueItem, item_id)
    if item is None:
        raise ApplyNotFound("投递队列条目不存在或已被移除")
    db.delete(item)
    db.commit()


def reorder_queue(db: Session, order: list[int]) -> list[ApplyQueueItemOut]:
    """按给定 id 顺序重排队列。

    ``order`` 是**界面显示顺序**（从上到下）。与 ``list_queue`` 的倒序口径配对：
    显示在越前面的 ``sort_order`` 越大，这样后导入（``sort_order`` 取最大）的条目
    才会自然排到最上面。

    **条目一次批量取回**（原先逐条 ``db.get``：拖 50 行就是 50 条 SELECT，而这只为了在
    内存里写一个整数）。语义逐条保持：

    - 缺失的 id 跳过，但 ``total`` 仍是 ``len(order)``（含缺失项）——序号按界面给的槽位算；
    - 重复 id 由**靠后的那次**覆盖（与逐条 ``db.get`` 拿到同一对象、后写覆盖前写一致）；
    - ``updated_at`` 逐行刷新、单次 commit、出口仍是 :func:`list_queue`。
    """
    total = len(order)
    # ``order`` 为空时不发查询：``in_([])`` 会退化成恒假条件，白跑一次还多一条 SQL。
    by_id: dict[int, ApplyQueueItem] = {}
    if order:
        ids = sorted({int(item_id) for item_id in order})
        by_id = {
            row.id: row for row in db.query(ApplyQueueItem).filter(ApplyQueueItem.id.in_(ids)).all()
        }
    for index, item_id in enumerate(order):
        item = by_id.get(item_id)
        if item is None:
            continue
        item.sort_order = total - index
        item.updated_at = utcnow()
    db.commit()
    return list_queue(db)


# ===== 简历与招呼语解析 =====


def resolve_resume(db: Session, job_id: int | None, resume_id: int | None) -> ResumeRecord | None:
    """确定本岗位用哪份简历：显式指定优先，否则取该岗位最近一份岗位版简历。"""
    if resume_id is not None:
        return db.get(ResumeRecord, resume_id)
    if job_id is None:
        return None
    return (
        db.query(ResumeRecord)
        # 只挑**已保存**的简历：草稿里的内容用户还没认可，拿去投递是不可接受的（0051）。
        .filter(trash.live_only(ResumeRecord), saved_only(), ResumeRecord.job_id == job_id)
        .order_by(ResumeRecord.created_at.desc(), ResumeRecord.id.desc())
        .first()
    )


def resolve_greeting(item: ApplyQueueItem | None, config: ApplyConfigIn) -> str:
    """本岗位招呼语：条目值优先，为空则退回默认招呼语。"""
    if item is not None and item.greeting.strip():
        return item.greeting.strip()
    return config.default_greeting.strip()


def build_apply_data(db: Session, resume: ResumeRecord | None) -> dict[str, Any]:
    """构造供通用表单引擎映射的字段数据（只取投递必需的展示字段，不含完整资料）。"""
    profile = project_legacy_profile(db)
    data: dict[str, Any] = {
        "name": profile.name,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.target_city or profile.city,
        "job_intent": profile.job_intent,
        "summary": profile.summary,
    }
    if resume is not None and resume.title:
        data["job_intent"] = data.get("job_intent") or resume.job_title
    return {key: value for key, value in data.items() if value}
