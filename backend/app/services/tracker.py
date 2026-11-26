# SPDX-License-Identifier: Apache-2.0
"""求职进度的服务层：写入编排与全量门面（增删改查、漏斗统计、导出、投递台接合点）。

模块分工（PR-18 豁免拆分批，纯搬迁无行为变化）：

- 写路径在本文件：``create_track`` / ``update_track``（单事务）/ ``delete_track`` /
  ``record_applied`` / ``_freeze_linked_resume``——测试在 ``tracker`` 命名空间上
  monkeypatch ``freeze_delivery`` / ``record_status_change``，落点必须留在本模块；
- 查询/过滤/统计口径在 ``tracker_query.py``（list/page/summarize/iter/count）；
- CSV/JSON 导出在 ``tracker_csv.py``；
- 合并（识别通知 → 计划 → 预览/确认）与 track 字段写入的单一实现在
  ``tracker_merge.py``：``plan_merges`` 算出"每条会新增还是更新、为什么"，预览接口
  原样返回，确认接口执行同一份计划（"预览=执行"契约）。

本文件是对外门面：以下 re-export 保证既有消费方（``api/tracker.py``、
``assistant_tools/tracker_tools.py``）与测试的 import 路径与 ``__all__`` 契约不变。
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume
from ..models.resume import ResumeRecord
from ..models.tracker import SOURCE_APPLY, SOURCE_MANUAL, STATUS_APPLIED, ApplicationTrack
from ..schemas.tracker import (
    TRACK_EVIDENCE_PREVIEW_CHARS,
    TRACK_NOTE_PREVIEW_CHARS,
    TrackCreate,
    TrackOut,
    TrackRecordIn,
    TrackUpdate,
)
from . import trash
from .resume.resume_delivery import freeze_delivery, list_track_deliveries
from .track_events import record_status_change, write_source
from .tracker_csv import export_rows, iter_csv_chunks, to_csv, to_json
from .tracker_merge import (
    _apply_payload,
    _find_by_key,
    apply_merges,
    plan_merges,
    preview_merges,
)
from .tracker_query import (
    MAX_LIST_LIMIT,
    count_tracks,
    iter_tracks,
    job_ids_for_tracks,
    latest_contacted_at,
    list_tracks,
    list_tracks_page,
    summarize,
    track_or_none,
)

__all__ = [
    "MAX_LIST_LIMIT",
    "apply_merges",
    "count_tracks",
    "create_track",
    "delete_track",
    "export_rows",
    "iter_csv_chunks",
    "iter_tracks",
    "job_ids_for_tracks",
    "latest_contacted_at",
    "list_track_deliveries",
    "list_tracks",
    "list_tracks_page",
    "plan_merges",
    "preview_merges",
    "record_applied",
    "save_track_record",
    "set_track_status",
    "summarize",
    "to_csv",
    "to_json",
    "track_brief",
    "track_or_none",
    "track_out",
    "update_track",
]


# ===== 写入 =====


def _freeze_linked_resume(db: Session, record: ApplicationTrack, *, source: str) -> None:
    """进度显式关联到一份简历时冻结投递快照（RF-17 / T6）。

    只在"这份快照还不存在"的意义上不做去重：表单每次把 ``resume_id`` **从无到有**地
    关联上来才算一次投递血缘，同一份记录反复保存（改备注、推进状态）不产生新快照。
    "从无到有 / 换 id"的判定在调用方（:func:`create_track` / :func:`update_track`）：
    它们在 ``_apply_payload`` 之前抓旧 id，id 变了才进来——所以清空关联不会走到这里，
    ``resume_title`` 标题快照因此**不会被清空**（"当时投的是哪一版"是既成事实）。

    两个分支的差别（T6）：

    - **内部简历**（``resume_id``）：取 ``resume_record.title`` 冻结标题，并冻结一份
      投递快照（``freeze_delivery``：正文内容 + 版式 + 目的地，回答"投出去那一刻长什么样"）；
    - **外部简历**（``external_resume_id``）：只取 ``external_resume.name`` 冻结标题，
      **不调用** ``freeze_delivery``。原因：外部简历没有结构化 ``content``，投递快照的
      语义（"那一版正文 + 版式"）无处可存；而它的原件本身就登记在 ``user_file`` 里
      （sha256 去重、进备份资产类别、软删与彻底删除都不删物理文件）——**原件即证据**。
      再造一份"快照"只会复制同一个文件引用，却让人误以为正文也被冻结过。

    简历已删除/不存在时静默跳过内部分支（进度记录本身照常保存）；外部分支同理。

    目的地快照（PR-09）：公司/岗位取**进度记录本身**（用户填写的实际投递目标），
    不从原简历反推——通用简历（无公司）投给 A 公司时，快照目的地就是 A 公司。
    """
    if record.external_resume_id is not None:
        external = db.get(ExternalResume, record.external_resume_id)
        if external is None:
            return
        # 只冻结标题：原件即证据（见 docstring），这里刻意没有 freeze_delivery。
        record.resume_title = external.name or ""
        return
    if record.resume_id is None:
        return
    resume = db.get(ResumeRecord, record.resume_id)
    if resume is None:
        return
    # 标题快照与外键一起落：简历被删后仍能回答"当时投的是哪一版"。
    record.resume_title = resume.title or ""
    freeze_delivery(
        db,
        record=resume,
        track_id=record.id,
        source=source,
        company=record.company or "",
        job_title=record.title or "",
    )


def create_track(
    db: Session, payload: TrackCreate, *, source: str = SOURCE_MANUAL
) -> ApplicationTrack:
    """新增一条求职进度记录（PR-10 原子事务）。

    record + 首个状态事件 + 投递快照在**同一个事务**里：先 flush 拿到 ``record.id``
    （事件与快照的外键都要用它），最后一个 commit 一次性发布。任一步失败整体
    rollback——数据库里不会留下"有记录没事件"或"有记录没快照"的半成品，用户重试
    也不会撞唯一约束。
    """
    record = ApplicationTrack(source=source)
    _apply_payload(record, payload)
    db.add(record)
    try:
        # flush 只写事务缓冲、不提交：record.id 就绪，后面任何一步炸了都能整体回滚。
        db.flush()
        # 首个状态事件（RF-18）：新建本身就是一次状态变化（"" → 初始状态）。
        # 手动添加由用户亲手写入（confirmed），其他来源（助手等）走系统口径。
        record_status_change(
            db,
            record,
            from_status="",
            to_status=payload.status,
            status_date=payload.status_date,
            source=write_source(manual=source == SOURCE_MANUAL),
            user_confirmed=True,
        )
        if payload.resume_id is not None or payload.external_resume_id is not None:
            _freeze_linked_resume(db, record, source="track")
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record


def update_track(db: Session, record: ApplicationTrack, payload: TrackUpdate) -> ApplicationTrack:
    """更新一条求职进度记录（PR-10 对称项：单事务）。

    字段保存 + 状态事件 + 投递快照在**同一个事务**里发布：旧实现三段各自
    commit，中途失败会留下"已更新字段但缺事件/快照"的半成品。现在先 flush
    把字段改动压进事务缓冲，事件与快照任一步失败整体 rollback；最后一个
    commit 一次性发布。对外 API 与返回值契约不变。
    """
    previous_resume_id = record.resume_id
    previous_external_resume_id = record.external_resume_id
    previous_status = record.status
    _apply_payload(record, payload)
    try:
        # flush 只写事务缓冲、不提交（与 create_track 同一模式）。
        db.flush()
        if previous_status != record.status:
            # 状态被用户亲手改了（含改成拒信）：追加一条事件。事件不参与合并取舍，
            # 所以拒信也会留痕——之前的阶段不会因为终态被抹掉。
            record_status_change(
                db,
                record,
                from_status=previous_status,
                to_status=record.status,
                status_date=payload.status_date,
                source=write_source(manual=True),
                user_confirmed=True,
            )
        # 关联"从无到有 / 换 id"才冻结快照（内/外两个字段各自判，同一节奏）：
        # 同一份记录反复保存（改备注、推进状态）不刷快照；清空关联不清标题快照。
        if payload.resume_id is not None and payload.resume_id != previous_resume_id:
            _freeze_linked_resume(db, record, source="track")
        if (
            payload.external_resume_id is not None
            and payload.external_resume_id != previous_external_resume_id
        ):
            _freeze_linked_resume(db, record, source="track")
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record


def delete_track(db: Session, track_id: int) -> bool:
    """移入回收站（软删除）。

    **不再真删**：投递记录是用户一条条维护起来的（进度、下次动作、备注），误删的代价远大于
    多留一行。彻底删除在「回收站」里单独提供，且必须二次确认。
    """
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return False
    trash.soft_delete(db, "track", record)
    db.commit()
    return True


# ===== 与投递台的接合点 =====


def record_applied(
    db: Session,
    *,
    company: str,
    title: str,
    applied_on: str = "",
    job_id: int | None = None,
    resume_id: int | None = None,
    resume_title: str = "",
    attempt_key: str | None = None,
    user_confirmed: bool = False,
) -> None:
    """投递成功后落一条「已投递」。

    刻意**不**覆盖已有记录的更靠后状态：用户可能已经手动把这家推到「面试」了，
    而投递台的批量任务又跑了一次同一个岗位——那时把状态打回「已投递」是错的。

    ``resume_id`` / ``resume_title``（RF-17）：投递条目上记录了这次用的是哪份简历
    （``ApplyTaskItem.resume_id``）。新建进度记录时落关联与标题快照，并冻结一份
    ``source="apply"`` 的投递快照；已有记录仅在缺关联时补上（与 ``job_id`` 同一
    口径），**补上也冻结一份快照**（PR-09：补投同样是真实发生的投递动作，
    不能因为记录先存在就丢证据）。

    ``attempt_key``（PR-09 幂等键）：这次投递动作的天然 ID（如
    ``apply_task_item:{id}``）。同键重放不重复冻结快照；不同条目对同一家公司的
    真实第二次投递拿到不同的键——**不会被 company+title 合并吞掉**。

    目的地快照（PR-09）：公司/岗位取实参（实际投递目标），不从原简历反推。

    ``user_confirmed``（期一「我已提交」）：用户在界面上亲手确认"我已经投出去了"时传
    True，只影响**新建记录**时首个状态事件的 ``user_confirmed`` 标记。既有调用方
    （投递台自动回写、识别合并）不传，默认 False，行为与之前逐字一致。
    """
    if not company.strip() or not title.strip():
        # 快照字段为空时无从合并，宁可不记也不要造一条"(空) · (空)"。
        return
    payload = TrackRecordIn(
        company=company,
        title=title,
        status=STATUS_APPLIED,
        applied_at=applied_on or date.today().isoformat(),
    )
    existing = _find_by_key(db, payload)
    if existing is None:
        record = ApplicationTrack(source=SOURCE_APPLY, resume_title=resume_title)
        _apply_payload(
            record, TrackCreate(**payload.model_dump(), job_id=job_id, resume_id=resume_id)
        )
        db.add(record)
        db.flush()
        # 投递台自动写入也留痕（RF-18）：confirmed=False——这是程序自动记的，
        # 用户没有逐条确认过。乱序通知不会把这条记录拉回去（resolve_status 管合并），
        # 但"曾被记为已投递"是真实发生过的动作。
        record_status_change(
            db,
            record,
            from_status="",
            to_status=STATUS_APPLIED,
            status_date=payload.applied_at,
            source=write_source(manual=False),
            user_confirmed=user_confirmed,
        )
        if resume_id is not None:
            resume = db.get(ResumeRecord, resume_id)
            if resume is not None:
                freeze_delivery(
                    db,
                    record=resume,
                    track_id=record.id,
                    source="apply",
                    company=company,
                    job_title=title,
                    idempotency_key=attempt_key,
                )
        return
    if not existing.applied_at:
        existing.applied_at = payload.applied_at
    if existing.job_id is None and job_id is not None:
        existing.job_id = job_id
    linked_now = False
    if existing.resume_id is None and resume_id is not None:
        existing.resume_id = resume_id
        existing.resume_title = resume_title or existing.resume_title
        linked_now = True
    # 状态交给 resolve_status：已经在面试的不会被这一次投递拉回「已投递」。
    # 快照条件（PR-09）：补投（关联从无到有）是真实动作；带了 attempt_key 的调用
    # （投递台条目）每条都是一次真实投递——同一键重放由 freeze_delivery 去重，
    # 不同键的真实第二次投递不被 company+title 合并吞掉。都没带（旧的重复通知
    # 路径）保持旧行为：不重复冻结。
    if resume_id is not None and (linked_now or attempt_key is not None):
        resume = db.get(ResumeRecord, resume_id)
        if resume is not None:
            freeze_delivery(
                db,
                record=resume,
                track_id=existing.id,
                source="apply",
                company=company,
                job_title=title,
                idempotency_key=attempt_key,
            )


def track_out(record: ApplicationTrack) -> TrackOut:
    return TrackOut.model_validate(record)


def track_brief(
    record: ApplicationTrack,
    latest_followup: datetime | None = None,
    job_link_id: int | None = None,
) -> TrackOut:
    """列表行只带 note / evidence 的**预览**：超长截断加省略号。

    求职看板的主读路径一次拖几十条，note 上限 4000 字（evidence 500），全文随列表
    下发等于白拖几百 KB。卡片上显示预览足够；编辑表单打开时前端会调
    ``GET /{track_id}`` 拿全文回填（TrackFormModal），PUT 的整体替换也是以全文为准，
    不会把截断文本写回库。导出与助手工具走服务层 ``list_tracks``，不经这里，全文不受影响。

    ``latest_followup``（CR-19）：最近一次「已联系」跟进决策的时刻，由调用方**批查询**
    后逐行传入（列表最多 100 行，不在这里逐行查库）；缺省 None = 没联系过/调用方不关心。

    ``job_link_id``（整改 #7）：这一行"岗位名能点去哪"的岗位 id，同样由调用方批查询
    （``services/tracker_job_link.resolve_job_links``）后逐行传入。只读派生，不写库。
    """
    item = track_out(record)
    item.latest_followup = latest_followup
    item.job_link_id = job_link_id
    if len(item.note) > TRACK_NOTE_PREVIEW_CHARS:
        item.note = item.note[:TRACK_NOTE_PREVIEW_CHARS] + "…"
    if len(item.evidence) > TRACK_EVIDENCE_PREVIEW_CHARS:
        item.evidence = item.evidence[:TRACK_EVIDENCE_PREVIEW_CHARS] + "…"
    return item


def save_track_record(db: Session, track_id: int, payload: TrackUpdate) -> TrackOut | None:
    """整份替换一条进度记录；``None`` 表示记录不存在，由调用方各自映射 404。

    路由与助手动作共用这一份（原先动作直接调路由 handler ``save_track``，
    服务层因此反向依赖 api）。判据只有"存在与否"一条，不需要额外异常类型。
    """
    record = track_or_none(db, track_id)
    if record is None:
        return None
    return track_out(update_track(db, record, payload))


def set_track_status(
    db: Session, record: ApplicationTrack, status: str, status_date: str = ""
) -> ApplicationTrack:
    """就地改一条进度记录的状态（整改 #15），单事务。

    与 ``update_track``（PUT 整份替换）的分工：这个函数**只碰两个字段**，
    因此不需要 ``TrackCreate`` 那一整套互斥/URL 校验，也不会用前端手里的旧快照
    覆盖别人刚改的备注、简历关联。

    三条口径：

    1. **同状态是幂等的**：直接返回、不写库、不发事件。理由是时间线记录的是"真实发生
       过的变化"——用户连点两次同一个状态不是一次变化，把它记进时间线等于污染历史；
       顺带也不会把 ``updated_at`` 往前推（"停滞提醒"读的是它）。
    2. **事件复用 ``record_status_change``**：``from/to`` 正确、``source=user``、
       ``user_confirmed=True``，与手动编辑走同一条留痕路径（``track_events`` 是唯一写入点）。
    3. **撤销 = 再调一次改回去**（前端做的），所以这里不需要"删除上一条事件"。
       「改过去」与「改回来」都是真实发生过的事，时间线里就该有两条。
    """
    if record.status == status:
        return record
    previous = record.status
    record.status = status
    if status_date:
        record.status_date = status_date
    try:
        # flush 只写事务缓冲（与 create_track / update_track 同一模式）：事件失败整体回滚，
        # 不会留下"状态变了但时间线没有这一步"的半成品。
        db.flush()
        record_status_change(
            db,
            record,
            from_status=previous,
            to_status=status,
            status_date=status_date,
            source=write_source(manual=True),
            user_confirmed=True,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record
