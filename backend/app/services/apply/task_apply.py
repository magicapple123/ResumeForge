# SPDX-License-Identifier: Apache-2.0
"""投递批次执行：逐条投递、失败隔离、熔断与成功回写。"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from ...models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_NETWORK_TIMEOUT,
    FAILURE_PROFILE_INSUFFICIENT,
    FAILURE_SITE_UNSUPPORTED,
    FAILURE_UNCONFIRMED,
    FAILURE_UNKNOWN,
    ITEM_STATUS_FAILED,
    ITEM_STATUS_RUNNING,
    ITEM_STATUS_SKIPPED,
    ITEM_STATUS_SUCCESS,
    STEP_FILLING,
    STEP_GREETING,
    STEP_IDLE,
    STEP_OPENING,
    STEP_SUBMITTING,
    STEP_VERIFYING,
    STOP_REASON_BREAKER,
    STOP_REASON_DONE,
    STOP_REASON_ERROR,
    STOP_REASON_USER,
    TASK_STATUS_BREAKER_PAUSED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PAUSED,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.job import Job
from ...models.profile import utcnow
from ...schemas.apply import ApplyConfigIn
from .. import diagnostics, tracker
from ..browser.cdp_client import CdpClient, CdpError
from ..sites.base import SiteFailure
from ..sites.registry import get_registry
from .blocklist import skip_if_blocked
from .failure_taxonomy import classify_failure
from .greeting_templates import render_greeting_template
from .pacing import interruptible_sleep as interruptible_sleep

logger = logging.getLogger(__name__)


class ItemSkip(Exception):
    """单个条目的软跳过，不计失败且不触发熔断。

    ``category`` 可选：给出时写入条目的 ``failure_category``（状态仍是 ``skipped``），
    让"为什么跳过"有机器可读的分类（如 ``profile_insufficient``），而不是只有一句中文。
    """

    # #39：step / target 与 category 一样是可选的结构化线索；不给就由诊断文本推断。
    def __init__(
        self, detail: str, *, category: str = "", step: str = "", target: str = ""
    ) -> None:
        super().__init__(detail)
        self.category = category
        self.step = step
        self.target = target


def company_key(company: str) -> str:
    """公司名的归一化键：压掉空白、统一大小写。

    招聘网站上的公司名会带前后空格与不同写法（"字节跳动" / "字节跳动 "），不归一化就会
    把同一家公司当成两家，**「同公司只投一个岗位」于是形同虚设**。空名返回空串——
    没有公司名的条目不计入同公司判断（判断不了就不做判断）。
    """
    return " ".join((company or "").split()).casefold()


def same_company_skip_reason(
    config: ApplyConfigIn, item: ApplyTaskItem, attempted: set[str]
) -> str:
    """这条岗位是否该按「同公司只投一个岗位」跳过；不该跳过时返回空串。

    **记的是"尝试过"而不是"成功过"**：投递失败可能发生在确认环节——招呼语其实已经发出去
    了，只是没读到对方的回执。这时再给同一家公司发第二条，才是用户开这个开关要避免的事。
    所以只要动手了，这家公司就算数；方向始终是"宁可少发一条，不可重发一家"。
    """
    if not config.skip_same_company:
        return ""
    key = company_key(item.company)
    if not key or key not in attempted:
        return ""
    return f"按「同公司只投一个岗位」跳过：本批次已经投过「{' '.join(item.company.split())}」的岗位"


def mark_failed(
    session: Any,
    task: ApplyTask,
    item: ApplyTaskItem,
    category: str,
    detail: str,
    *,
    step: str = "",
    target: str = "",
    reason: str = "",
) -> None:
    """把任务项标记为失败并记录失败分类。"""
    # #39：三段稳定码（step/target/reason）。调用方已知的维度优先，其余从分类 +
    # 诊断文本推断（classify_failure）；界面靠子码筛选与给建议。
    codes = classify_failure(category, detail, step=step, target=target, reason=reason)
    item.status = ITEM_STATUS_FAILED
    item.failure_category = category
    item.failure_detail = detail
    item.failure_step = codes.step
    item.failure_target = codes.target
    item.failure_reason = codes.reason
    item.finished_at = utcnow()
    task.processed += 1
    task.failed += 1
    session.commit()


def record_step(
    task: ApplyTask,
    item: ApplyTaskItem,
    step: str,
    *,
    site_key: str,
    adapter_version: str,
    since: float,
) -> None:
    """记录投递链路的一步（``apply.step`` 诊断事件）。

    后台线程没有 request_id，事件靠 ``task_id`` / ``item_id`` 串联（RF-20 的请求级串联
    在这里以任务级字段缓解）。``elapsed_ms`` 是距上一步锚点的耗时。**绝不携带任何资料
    值 / payload**——招呼语、简历字段都不进诊断事件；``diagnostics`` 的键名脱敏只是
    兜底，这里主动不传。
    """
    diagnostics.record_event(
        "apply.step",
        task_id=task.id,
        item_id=item.id,
        step=step,
        site_key=site_key,
        adapter_version=adapter_version,
        elapsed_ms=int((time.monotonic() - since) * 1000),
    )


def adapter_snapshot(session: Any, items: list[ApplyTaskItem], registry: Any) -> dict[str, str]:
    """批次主站点适配器的 ``{key, version}`` 快照；解析不出返回空 dict。

    一个批次在结构上允许跨站点（当前只有 BOSS），这里取**第一条能解析出适配器**的岗位
    作为"主站点"。解析不出（岗位全被删 / 来源不支持）就不写——诊断里宁可缺一项，也不
    伪造一个站点名。版本号是适配器自报的 ``version`` 类属性（``0`` = 未标识）。
    """
    for item in items:
        job = session.get(Job, item.job_id) if item.job_id else None
        if job is None:
            continue
        adapter = registry.resolve_for_job(job)
        if adapter is not None:
            return {
                "key": str(adapter.key),
                "version": str(getattr(adapter, "version", "") or "0"),
            }
    return {}


def pause_with_message(runner: Any, session: Any, task: ApplyTask, message: str) -> None:
    runner._resume.clear()
    task.status = TASK_STATUS_PAUSED
    task.message = message
    session.commit()


def breaker_pause(runner: Any, session: Any, task: ApplyTask, count: int) -> None:
    runner._resume.clear()
    task.status = TASK_STATUS_BREAKER_PAUSED
    task.stop_reason = STOP_REASON_BREAKER
    task.message = f"已因连续 {count} 次失败自动暂停，请查看记录并处理后点击「继续」"
    session.commit()


def run_apply(
    runner: Any,
    session: Any,
    task: ApplyTask,
    *,
    stopped_error: type[Exception],
    wrap_client: Callable[[CdpClient], CdpClient],
    log: logging.Logger = logger,
) -> None:
    """执行一个投递批次；生命周期与控制信号由 ``runner`` 提供。"""
    from . import apply_service

    # "adapter" 是运行启动时写入的诊断快照（见下），不属于用户配置；load 时剔除，
    # 否则 extra="forbid" 的 ApplyConfigIn 会把它当成脏配置整体退回默认值。
    config = runner._load_config(task, ApplyConfigIn, ignore=("adapter",))
    items = (
        session.query(ApplyTaskItem)
        .filter(ApplyTaskItem.task_id == task.id)
        .order_by(ApplyTaskItem.sort_order, ApplyTaskItem.id)
        .all()
    )
    try:
        client = runner._make_client(config)
    except Exception as exc:  # noqa: BLE001 - 连不上浏览器是可直接展示的失败
        runner._finalize(
            session,
            task,
            TASK_STATUS_FAILED,
            STOP_REASON_ERROR,
            message=str(exc) or "无法连接投递专用浏览器，请先在投递台启动浏览器",
        )
        return

    # client 拿到之后的全部装配（wrap、适配器快照、config 提交）都必须在
    # try/finally 之内：装配段抛异常时任务由 ``_run`` 兜底置 failed，但
    # ``finally: client.close()`` 是这条路径上唯一关掉 CDP 连接的地方，
    # 漏进 try 外面就是一次连接泄漏。
    try:
        wrapped = wrap_client(client)
        registry = runner._registry or get_registry()
        # 主站点适配器快照写进 task.config：诊断事件、界面与事后排查都能对上"这批用的是
        # 哪个适配器的哪个版本"（采集链路写 site_key 是同一套做法）。
        adapter_meta = adapter_snapshot(session, items, registry)
        if adapter_meta:
            task.config = {**(task.config or {}), "adapter": adapter_meta}
            session.commit()
        consecutive = 0
        # 「同公司只投一个岗位」的作用域是**本批次**：这次投过的公司，后面同公司的岗位直接跳过。
        attempted_companies: set[str] = set()
        for index, item in enumerate(items):
            try:
                runner._checkpoint()
                if apply_service.daily_success_count(session) >= config.daily_limit:
                    runner._stop_remaining(
                        session,
                        task,
                        items,
                        index,
                        reason=STOP_REASON_DONE,
                        message=f"今日投递已达上限（{config.daily_limit}），剩余岗位已跳过",
                    )
                    return
                # 14E 闸门③：黑名单可能是入队之后才加的，投递前再兜底判一次
                # （命中就地把这一条记为「已跳过」并留下原因，见 services/apply/blocklist.py）。
                if skip_if_blocked(session, task, item):
                    continue
                skip_reason = same_company_skip_reason(config, item, attempted_companies)
                if skip_reason:
                    # 与 ItemSkip 同一形态：软跳过、不计失败、不触发熔断，但**留下原因**——
                    # 用户看到"已跳过"却不知道为什么，只会以为程序漏投了。
                    item.status = ITEM_STATUS_SKIPPED
                    item.failure_detail = skip_reason
                    item.finished_at = utcnow()
                    task.processed += 1
                    task.skipped += 1
                    session.commit()
                    continue
                item.status = ITEM_STATUS_RUNNING
                item.attempt += 1
                item.started_at = utcnow()
                item_started = time.monotonic()
                task.current_step = STEP_OPENING
                session.commit()
                record_step(
                    task,
                    item,
                    STEP_OPENING,
                    site_key=str(adapter_meta.get("key", "")),
                    adapter_version=str(adapter_meta.get("version", "")),
                    since=item_started,
                )
                # 动手之前就把公司记下来：失败的条目可能已经把招呼语发出去了。
                attempted_companies.add(company_key(item.company))
                runner._execute_item(session, task, item, config, wrapped, registry, apply_service)
            except stopped_error:
                item.status = ITEM_STATUS_SKIPPED
                item.failure_detail = "用户停止了任务，当前岗位未完成"
                item.finished_at = utcnow()
                task.skipped += 1
                session.commit()
                runner._stop_remaining(
                    session, task, items, index + 1, reason=STOP_REASON_USER, message=""
                )
                return
            except ItemSkip as exc:
                item.status = ITEM_STATUS_SKIPPED
                if getattr(exc, "category", ""):
                    item.failure_category = exc.category
                    # 软跳过也带分类时，三段码一样要写——否则按失败分类筛出来的记录
                    # 在详情里看不到"卡在哪一步"（#39）。
                    codes = classify_failure(
                        exc.category,
                        str(exc),
                        step=getattr(exc, "step", ""),
                        target=getattr(exc, "target", ""),
                    )
                    item.failure_step = codes.step
                    item.failure_target = codes.target
                    item.failure_reason = codes.reason
                item.failure_detail = str(exc)
                item.finished_at = utcnow()
                task.processed += 1
                task.skipped += 1
                session.commit()
            except SiteFailure as exc:
                runner._mark_failed(
                    session,
                    task,
                    item,
                    exc.category,
                    exc.detail,
                    step=getattr(exc, "stage", ""),
                )
                # 「无法确认」不是站点故障：页面可能已经投出去了，熔断重试反而会重复
                # 投递。它与软跳过同一方向——不计入连续失败，留给用户去浏览器核对。
                if exc.category != FAILURE_UNCONFIRMED:
                    consecutive += 1
            except CdpError as exc:
                runner._mark_failed(session, task, item, FAILURE_NETWORK_TIMEOUT, str(exc))
                consecutive += 1
            except Exception:  # noqa: BLE001 - 单岗位异常不能打死整个批次
                log.exception("投递单个岗位失败 task_id=%s item_id=%s", task.id, item.id)
                runner._mark_failed(
                    session, task, item, FAILURE_UNKNOWN, "投递时发生内部错误，请查看后端日志"
                )
                consecutive += 1
            else:
                item.status = ITEM_STATUS_SUCCESS
                item.finished_at = utcnow()
                task.processed += 1
                task.succeeded += 1
                session.commit()
                consecutive = 0
                apply_service.write_back_job_status(session, item.job_id)
                apply_service.mark_queue_done(session, item.job_id)
                tracker.record_applied(
                    session,
                    company=item.company,
                    title=item.job_title,
                    job_id=item.job_id,
                    resume_id=item.resume_id,
                    resume_title=item.resume_title,
                    # 幂等键（PR-09）：条目 ID 就是这次真实投递动作的天然 ID——
                    # 同一条目重放不重复记账；不同条目对同一家公司的第二次投递
                    # 是不同的动作，快照不会被合并吞掉。
                    attempt_key=f"apply_task_item:{item.id}",
                )
                session.commit()

            if item.status == ITEM_STATUS_FAILED:
                if item.failure_category == FAILURE_CAPTCHA_REQUIRED:
                    runner._pause_with_message(
                        session,
                        task,
                        "站点出现验证码或安全验证：请在浏览器窗口里完成验证后点击「继续」",
                    )
                    if not runner._wait_resume_or_stop():
                        raise stopped_error()
                    consecutive = 0
                elif consecutive >= config.breaker_threshold:
                    runner._breaker_pause(session, task, consecutive)
                    if not runner._wait_resume_or_stop():
                        raise stopped_error()
                    consecutive = 0

            if index < len(items) - 1 and not runner._interruptible_sleep(
                config.interval_seconds, config.interval_jitter_seconds
            ):
                raise stopped_error()

        task.current_step = STEP_IDLE
        task.status = TASK_STATUS_COMPLETED
        task.stop_reason = STOP_REASON_DONE
        task.finished_at = utcnow()
        task.message = task.message or "投递任务已完成"
        session.commit()
    except stopped_error:
        runner._stop_remaining(session, task, items, 0, reason=STOP_REASON_USER, message="")
    finally:
        client.close()


def execute_item(
    session: Any,
    task: ApplyTask,
    item: ApplyTaskItem,
    config: ApplyConfigIn,
    client: CdpClient,
    registry: Any,
    apply_service: Any,
) -> None:
    """执行单个岗位投递；保持站点适配器之外的流程站点无关。"""
    job = session.get(Job, item.job_id) if item.job_id else None
    if job is None:
        raise ItemSkip("岗位已被删除，跳过该条目")
    # 正常路径上，来源不支持的岗位在入队与开始投递两处就被拦住了；这里再判一次是**兜底**：
    # 真漏过来时，记录里要写清「来源不支持」而不是含糊的「未知失败」——后者让人以为是站点出问题。
    adapter = registry.resolve_for_job(job)
    if adapter is None:
        raise SiteFailure(FAILURE_SITE_UNSUPPORTED, apply_service.unsupported_site_message(job))
    resume = apply_service.resolve_resume(session, job.id, item.resume_id)
    if resume is None and adapter.requires_resume:
        # 资料不足是用户可解决的前置条件，按软跳过处理（不计失败、不触发熔断），
        # 但留下 profile_insufficient 分类，统计与界面才能把它和站点故障区分开。
        raise ItemSkip(
            "未找到可用简历：请先在简历中心为该岗位生成简历后再投递",
            category=FAILURE_PROFILE_INSUFFICIENT,
            step=STEP_FILLING,
            target="resume_upload",
        )
    data = apply_service.build_apply_data(session, resume)
    # 14D：招呼语里的 {company} / {job_title} / {name} 在**发送前**才替换成实际值——
    # 提前替换会让队列里的文案与用户看到的不一致；未知花括号原样保留（见渲染函数）。
    greeting = render_greeting_template(
        (item.greeting or "").strip() or config.default_greeting,
        company=item.company, job_title=item.job_title, name=str(data.get("name", "")),
    )

    step_started = time.monotonic()
    task.current_step = STEP_FILLING
    session.commit()
    record_step(
        task,
        item,
        STEP_FILLING,
        site_key=str(adapter.key),
        adapter_version=str(getattr(adapter, "version", "") or "0"),
        since=step_started,
    )
    step_started = time.monotonic()
    try:
        adapter.open_apply(client, job)
    except SiteFailure as exc:
        # 打上阶段标记：run_apply 的兜底分支据此写 failure_step，比从诊断文本猜更准。
        exc.stage = STEP_OPENING
        raise
    task.current_step = STEP_SUBMITTING
    session.commit()
    record_step(
        task,
        item,
        STEP_SUBMITTING,
        site_key=str(adapter.key),
        adapter_version=str(getattr(adapter, "version", "") or "0"),
        since=step_started,
    )
    step_started = time.monotonic()
    try:
        outcome = adapter.fill_and_submit(client, data, greeting)
    except SiteFailure as exc:
        # fill_and_submit 覆盖「填招呼语」与「发送」两段，按诊断里的控件名分辨。
        exc.stage = STEP_GREETING if "输入框" in exc.detail else STEP_SUBMITTING
        raise
    task.current_step = STEP_VERIFYING
    session.commit()
    record_step(
        task,
        item,
        STEP_VERIFYING,
        site_key=str(adapter.key),
        adapter_version=str(getattr(adapter, "version", "") or "0"),
        since=step_started,
    )
    if not outcome.success:
        # 未知状态永不记成功；但"没读到成功凭据"也可能是页面其实已经投出去了——
        # 落 unconfirmed 而不是 unknown，并且不计入熔断（见 run_apply 的 SiteFailure 分支）。
        raise SiteFailure(FAILURE_UNCONFIRMED, "未能确认投递成功，请在浏览器中核对")
    if outcome.greeting_sent:
        item.greeting = outcome.greeting_sent


__all__ = [
    "ItemSkip",
    "adapter_snapshot",
    "breaker_pause",
    "execute_item",
    "interruptible_sleep",
    "mark_failed",
    "pause_with_message",
    "record_step",
    "run_apply",
]
