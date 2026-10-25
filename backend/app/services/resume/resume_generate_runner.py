# SPDX-License-Identifier: Apache-2.0
"""简历生成后台任务运行器：进程内单例线程 + 状态落库 + 前端轮询。

为什么自建而不用 Celery/RQ：与 ``services/apply/task_runner.py`` 同一条理由——本项目是
单用户本地应用，生成是"几秒到几分钟的阻塞工艺"，一个 ``threading.Thread`` 足够。但
**不复用** ``apply/task_runner.py`` 的 CDP 内核：那是给采集/投递的浏览器驱动、暂停/熔断/
限速用的；简历生成只有"跑一个 async 生成器 + 完成才落库 + 可取消"，两者没有共享的
执行骨架，硬复用反而要把无关的 CDP 依赖拉进来。

纪律（照抄 apply 运行器踩过的坑）：
- 工作线程自己建、自己关 ``SessionLocal()``，会话绝不跨线程共享；
- 流式循环里**每一块 chunk / 事件之后**检查停止信号（用户点取消要真的停得下来）；
- 异常**不许被吞**：兜底把任务置 failed 并写中文 error；
- **完成才落库**：取消/失败不写 ``resume_record``，只更新任务本身——因此中断不产生
  半成品，但结果整体丢失（与 SSE 时代的旧行为一致，进程重启丢进行中任务也接受）。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import sessionmaker

from ...config import get_settings
from ...database import SessionLocal
from ...models.job import Job
from ...models.profile import utcnow
from ...models.resume import (
    GENERATE_STATUS_CANCELLED,
    GENERATE_STATUS_FAILED,
    GENERATE_STATUS_RUNNING,
    ResumeGenerateTask,
)
from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetLease, DatasetScopeError
from ...runtime.log_context import run_with_bound_context
from ...runtime.operation_budget import OperationBudget, OperationCancelled
from ...schemas.job import JobOut
from ...schemas.resume import GenerateOptions
from ...services import trash
from ...services.claims import build_baseline
from ...services.llm import create_provider
from ...services.llm.base import LLMError
from ...services.llm.client_pool import aclose_clients_for_current_loop
from ...services.profile.fact_context import build_fact_sections, load_fact_context
from ...services.profile.profile_service import get_profile_detail, to_profile_out
from ...services.resume.resume_generator import ResumeGenerator
from ...services.resume.resume_task_state import (
    claim_completed,
    finalize_task,
    set_cancelled,
)
from ...services.resume.scenario_context import build_scenario_prompt_block
from ...services.settings_service import get_llm_config
from .resume_generate_support import log_generation_usage
from .resume_runner_loop import RunnerEventLoopHandle

logger = logging.getLogger(__name__)

# 已接收字数写库的粒度：没必要每个 chunk 都 commit 一次，但要让前端 1.5s 轮询能看到
# 进展，所以每累计 200 字符落一次。
_CHAR_COMMIT_STEP = 200


class ResumeGenerateRunnerError(Exception):
    """运行器控制类错误（任务未在运行等），message 为中文提示。"""


class ResumeGenerateRunner:
    """单例运行器：同一时刻只跑一个生成任务。"""

    def __init__(self, *, session_factory: Callable[[], Any] | None = None) -> None:
        # session_factory 默认 None：任务启动时**按值冻结**当前身份的 engine（RF-03），
        # rebind 后会话仍写旧库；显式传入（测试注入）时优先生效。
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._current_task_id: int | None = None
        self._lease: DatasetLease | None = None
        self._frozen_factory: Callable[[], Any] | None = None
        # 工作线程事件循环与主 task 句柄的管理委托给句柄对象（机制说明见
        # resume_runner_loop 模块 docstring）：cancel()/shutdown() 借它跨线程
        # 中止挂起的模型调用。
        self._loop_handle = RunnerEventLoopHandle(self._stop)

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def current_task_id(self) -> int | None:
        return self._current_task_id

    def start(self, task_id: int) -> None:
        """启动一个后台简历生成任务；已有任务在跑则抛 ResumeGenerateRunnerError。"""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise ResumeGenerateRunnerError("已有简历生成任务正在进行中")
            # 先取租约再起线程（RF-03 TOCTOU）：切换持锁期间直接失败，调用方回滚
            # 刚建的空任务；只要租约登记成功，切换的排空就一定会等到本任务结束。
            try:
                lease = dataset_scope.acquire_lease("resume-generate")
            except DatasetScopeError as exc:
                raise ResumeGenerateRunnerError(str(exc)) from exc
            self._lease = lease
            self._frozen_factory = (
                self._session_factory
                if self._session_factory is not None
                else sessionmaker(
                    bind=lease.identity.engine, autoflush=False, expire_on_commit=False
                )
            )
            self._stop.clear()
            self._current_task_id = task_id
            self._thread = threading.Thread(
                # RF-20：复制启动方 contextvars 并绑定 task_id/dataset_id（同 apply 运行器）。
                target=run_with_bound_context(
                    self._run_releasing_lease,
                    task_id,
                    lease,
                    task_id=task_id,
                    dataset_id=lease.identity.dataset_id,
                ),
                name=f"rf-generate-{task_id}",
                daemon=True,
            )
            self._thread.start()

    def _run_releasing_lease(self, task_id: int, lease: DatasetLease) -> None:
        """线程入口：保证无论任务怎么收尾，租约都会归还（切换不再被永久挡住）。"""
        try:
            self._run(task_id)
        finally:
            lease.release()

    def cancel(self, task_id: int) -> None:
        # 先落"取消"信号：若线程已跑完并提交终态，终态守卫会拒绝改写（apply 同款纪律）。
        self._require_current(task_id)
        self._stop.set()
        # 主动中止挂起的模型调用：_stop 的检查点轮询不到挂在 socket read 上的流，
        # 线程要等 read timeout（~5s）才退出、租约迟迟不归还，此窗口内切换数据集
        # 会撞 409。跨线程取消主 task 让线程亚秒级退出；join 保留作兜底。
        self._loop_handle.cancel_main_task()
        # 终态必须在线程归还租约**之后**才可见：否则"已取消"先出现在任务查询里，
        # 而租约要等线程退出才归还，紧随其后的切换在排空窗内撞 409（e2e 恢复用例
        # 的真实翻车路径）。join 2s 与取消可见收尾的预算一致；
        # 线程卡死（如模型连接不响应）时超时后照常写终态，此刻切换的排空等待会如实
        # 409，用户稍候重试即可，租约最终仍由线程退出归还。
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2.0)
        self._set_cancelled(task_id)

    def shutdown(self) -> None:
        self._stop.set()
        # 与 cancel 同一机制：进程收拢时也主动中止挂起的模型调用，别让 join(5)
        # 白等一个 read timeout。
        self._loop_handle.cancel_main_task()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)

    def _require_current(self, task_id: int) -> None:
        if self._current_task_id != task_id or not self.is_running():
            raise ResumeGenerateRunnerError("该任务当前未在运行，无法执行该操作")

    # ===== 工作线程 =====

    def _open_session(self) -> Any:
        """开一个任务会话：优先用启动时冻结的工厂（RF-03），退回测试注入，再退回全局。"""
        factory = self._frozen_factory or self._session_factory or SessionLocal
        return factory()

    def _run(self, task_id: int) -> None:
        session = self._open_session()
        try:
            task = session.get(ResumeGenerateTask, task_id)
            if task is None:
                return
            # 停止信号早于工作线程读取任务（刚 start 就取消）：与运行中取消同样收尾。
            if self._stop.is_set():
                self._finalize(session, task, GENERATE_STATUS_CANCELLED, error="已取消")
                return

            # 总预算（RF-02）：从任务开始到结果落库全程生效。取消事件与 ``_stop`` 是
            # **同一个** ``threading.Event``——用户取消与预算到期共用一条信号线，原因
            # 由 :class:`OperationCancelled` 的 message 区分（取消→cancelled，超时→failed）。
            budget = OperationBudget.start(
                get_settings().resume_generate_budget_seconds, cancel_event=self._stop
            )

            try:
                job_out, profile_out, baseline, provider, fact_sections = self._snapshot(session, task)
            except Exception as exc:  # noqa: BLE001 - 快照失败转为可读的失败状态
                logger.warning("简历生成任务快照失败 task_id=%s：%s", task_id, exc)
                self._finalize(
                    session,
                    task,
                    GENERATE_STATUS_FAILED,
                    error=str(exc) or "生成准备失败，请查看后端日志",
                )
                return

            task.status = GENERATE_STATUS_RUNNING
            task.started_at = utcnow()
            session.commit()

            options = GenerateOptions.model_validate(task.options or {})
            # A5：只读创建任务时冻结的快照；运行中不查当前场景（改名/归档/切窗口均不影响）。
            try:
                career_block = build_scenario_prompt_block(task.context_snapshot)
            except Exception:  # noqa: BLE001 - 历史/损坏快照不得让生成整体失败
                logger.warning("生成任务场景快照无法解释，按未使用场景继续 task_id=%s", task_id)
                career_block = ""
            generator = ResumeGenerator(provider)
            resume: dict | None = None
            warnings: list[str] = []
            coverage_notes: list[dict] = []
            rationale = ""
            fact_annotations: list[dict] = []
            raw_parts: list[str] = []
            received_chars_total = 0
            last_char_commit = 0
            estimated_prompt_tokens: int | None = None

            try:

                async def consume() -> None:
                    nonlocal resume, warnings, coverage_notes, rationale, fact_annotations
                    nonlocal last_char_commit, received_chars_total
                    nonlocal estimated_prompt_tokens
                    # aclosing 纪律（审计 PR-07-4）：取消/超时/异常路径也显式关闭生成
                    # 器——GeneratorExit 逐层展开，generator/provider 各层的 finally
                    # （段复位、usage 补记、response 关闭）才真正执行。
                    stream = generator.generate(
                        profile_out,
                        job_out,
                        options,
                        baseline=baseline,
                        budget=budget,
                        career_context_block=career_block,
                        fact_sections=fact_sections,
                    )
                    try:
                        async for event in stream:
                            # 每一块事件之后检查停止信号、总预算与数据集归属：取消/超时/
                            # 切换都在下一次模型输出前生效（raise_if_stopped 合并了 _stop
                            # 检查与预算检查；lease.check 是显式的写入前归属校验）。
                            budget.raise_if_stopped()
                            if self._lease is not None:
                                self._lease.check()
                            if event["type"] == "progress":
                                task.message = event["message"]
                                session.commit()
                            elif event["type"] == "delta":
                                raw_parts.append(event["text"])
                                # 累计计数代替 len("".join(...))：每 chunk 全量拼接是 O(n²)。
                                received_chars_total += len(event["text"])
                                task.received_chars = received_chars_total
                                # 按字符粒度节流写库：全量进度不需要每块都落一次。
                                if received_chars_total - last_char_commit >= _CHAR_COMMIT_STEP:
                                    last_char_commit = received_chars_total
                                    session.commit()
                            elif event["type"] == "done":
                                resume = event["resume"]
                                warnings = event["warnings"]
                                coverage_notes = event.get("coverage_notes") or []
                                rationale = event.get("rationale") or ""
                                # 事实来源标注（RF-13）：锚定的副产品，随记录一起落库。
                                fact_annotations = event.get("fact_annotations") or []
                                # token 估算遥测（RF-14 §2.5）：估算开启时由 generator 放进
                                # done 事件，与真实 tokens 一起进同一条用量日志。
                                estimated_prompt_tokens = event.get("estimated_prompt_tokens")
                    finally:
                        await stream.aclose()
                        # 事件循环即将关闭：先把共享池里属于本循环的客户端关掉
                        # （审计 PR-08——生成 runner 每任务新建事件循环）。
                        await aclose_clients_for_current_loop()

                self._loop_handle.drive(consume())
            except OperationCancelled as exc:
                # 用户取消（cancel_event 即 _stop）→ cancelled；预算到期 → failed。
                # 两者共用一条信号线，用 OperationCancelled 的 message 区分原因。
                if self._stop.is_set():
                    self._finalize(session, task, GENERATE_STATUS_CANCELLED, error="已取消")
                else:
                    logger.warning("简历生成任务超出总预算 task_id=%s", task_id)
                    self._finalize(session, task, GENERATE_STATUS_FAILED, error=str(exc))
                return
            except asyncio.CancelledError:
                # 防御性：外部取消 async 上下文时同样标 cancelled（照抄 assistant_stream 的中断范式）。
                self._finalize(session, task, GENERATE_STATUS_CANCELLED, error="已取消")
                return
            except DatasetScopeError as exc:
                # 数据集已切换（防御路径：租约正常时应挡住切换）：按 failed 收尾，
                # 结果绝不写到新库去。会话是冻结的，终态落在任务所在的旧库里。
                logger.warning("简历生成任务因数据集切换中止 task_id=%s：%s", task_id, exc)
                self._finalize(session, task, GENERATE_STATUS_FAILED, error=str(exc))
                return
            except LLMError as exc:
                logger.warning("简历生成任务模型调用失败 task_id=%s：%s", task_id, exc)
                self._finalize(session, task, GENERATE_STATUS_FAILED, error=str(exc))
                return
            except Exception:  # noqa: BLE001 - 工作线程异常必须兜底，绝不能静默丢失
                logger.exception("简历生成任务执行发生内部错误 task_id=%s", task_id)
                self._finalize(
                    session,
                    task,
                    GENERATE_STATUS_FAILED,
                    error="生成过程中发生内部错误，请查看后端日志",
                )
                return
            finally:
                # 用量汇总日志（审计 PR-07-6，RF-14 §2.2-5）：主生成+修复+重试+失败
                # 轮次合并为一条总口径；缺值保留 None（不伪造 0）。成功、取消、超时、
                # 失败各路径都经过这里，恰好记一次。prompt/response 内容与密钥绝不
                # 入日志（隐私边界）。
                self._log_generation_usage(
                    task_id, generator, estimated_prompt_tokens=estimated_prompt_tokens
                )

            # consume() 正常返回（已拿到 done + 解析出简历）后、写库之前**必须**再复查一次
            # 停止信号与预算：用户可能在 "done 已收到、completed 尚未提交" 这一窗口点取消，
            # 预算也可能恰好在这条缝隙里到期。不查这里，取消/超时会被下面无条件写简历的
            # 路径吞掉，造成"前端已取消/已超时、后端却悄悄落库"。
            try:
                budget.raise_if_stopped()
                if self._lease is not None:
                    self._lease.check()
            except OperationCancelled as exc:
                if self._stop.is_set():
                    self._finalize(session, task, GENERATE_STATUS_CANCELLED, error="已取消")
                else:
                    self._finalize(session, task, GENERATE_STATUS_FAILED, error=str(exc))
                return
            except DatasetScopeError as exc:
                logger.warning("简历生成任务因数据集切换中止 task_id=%s：%s", task_id, exc)
                self._finalize(session, task, GENERATE_STATUS_FAILED, error=str(exc))
                return

            if resume is None:
                self._finalize(
                    session, task, GENERATE_STATUS_FAILED, error="模型输出未能解析为有效 JSON"
                )
                return

            # 完成才落库：先原子认领 completed（与 cancel 的 running→cancelled 互斥仲裁），
            # 认领失败说明 cancel 已抢先，直接按 cancelled 收尾、不落简历。认领成功后，把
            # 结果整体写成一条 ResumeRecord，并与任务的 completed 终态在**同一个事务**里
            # 提交。旧实现把"认领 completed"单独 commit、之后再在另一个事务里回填
            # resume_id，中间会暴露"completed 已可见、resume_id 仍为空"的窗口（轮询恰好
            # 落进去就会读到空指针）。这里把仲裁 UPDATE 提前、且不提交：任何观察者要么
            # 看到"未完成"，要么看到"completed + resume_id"；cancel 抢先时更不会留下
            # 孤儿简历记录。仲裁先于 INSERT，也让取消路径不必等待简历写入持有的写锁。
            if not self._claim_completed(session, task.id):
                # cancel 已抢先（running→cancelled）：尚未建简历，按 cancelled 收尾即可。
                self._finalize(session, task, GENERATE_STATUS_CANCELLED, error="已取消")
                return

            try:
                # 迟导入避免 services -> api 的模块级循环依赖（api.resumes 会 import 本模块）。
                from .resume_record import save_record

                raw = "".join(raw_parts)
                # commit=False：只 flush 拿主键，不提交；记录与任务终态同事务落库。
                record = save_record(
                    session,
                    resume,
                    warnings,
                    job_out,
                    raw,
                    generator.provider.config.model,
                    options.enhance,
                    options.enhancement_level,
                    requested_title=task.title,
                    template=options.template,
                    format_name=options.format_name,
                    page_limit=options.page_limit,
                    font_scale=options.font_scale,
                    format_config=options.format_config,
                    custom_instruction=options.custom_instruction,
                    coverage_notes=coverage_notes,
                    rationale=rationale,
                    fact_annotations=fact_annotations,
                    document_mode=options.document_mode,
                    context_snapshot=task.context_snapshot,
                    commit=False,
                )
            except Exception:  # noqa: BLE001 - 落库失败不能让任务停在 running
                logger.exception("简历生成结果落库失败 task_id=%s", task_id)
                # 回滚丢弃已执行的认领 UPDATE（running→completed）与半成品记录，再按
                # failed 收尾，避免把"completed 却没有简历"的脏终态提交出去。
                session.rollback()
                self._finalize(
                    session, task, GENERATE_STATUS_FAILED, error="生成结果保存失败，请查看后端日志"
                )
                return

            # 终态字段写进任务对象（未提交）；下面这一次 commit 会把 resume_id 与
            # status=completed 一起提交。
            task.resume_id = record.id
            task.received_chars = len(raw)
            task.message = "简历已生成"
            task.finished_at = utcnow()

            # 原子提交：简历记录 + 任务的 completed 终态在同一事务内对观察者可见。
            session.commit()
        finally:
            session.close()
            with self._lock:
                self._current_task_id = None
                self._thread = None
                self._lease = None
                self._frozen_factory = None
            self._stop.clear()

    def _snapshot(
        self, session: Any, task: ResumeGenerateTask
    ) -> tuple[JobOut | None, Any, Any, Any, dict[str, Any]]:
        """在后台线程里重建生成所需的只读快照，返回 ``(job_out, profile_out, baseline, provider)``。

        快照在流开始前一次性取齐，随后立即释放请求会话——生成本身是纯计算 + 模型调用，
        不持有数据库连接（与 SSE 路径 ``db.close()`` 的做法一致）。
        """
        job = session.get(Job, task.job_id) if task.job_id is not None else None
        if task.job_id is not None and (job is None or trash.is_deleted(job)):
            raise ResumeGenerateRunnerError("岗位不存在或已被删除")
        job_out = JobOut.model_validate(job) if job is not None else None
        profile = get_profile_detail(session)
        profile_out = to_profile_out(profile)
        baseline = build_baseline(session)
        # A3/A4：补充事实只读快照（去私密、顺序稳定）；六类全空时等价于旧行为。
        fact_sections = build_fact_sections(load_fact_context(session))
        config = get_llm_config(session)
        if not config.base_url or not config.model:
            raise ResumeGenerateRunnerError("尚未配置大模型 API")
        provider = create_provider(config)
        return job_out, profile_out, baseline, provider, fact_sections

    # ===== 状态写入 =====
    # 终态仲裁三件套的实现拆在 resume_task_state.py（RF-02 纪律：条件 UPDATE +
    # 先到者赢）；这里保留薄方法委托，调用点与测试锚点（``runner._finalize`` 直接
    # 调用、``ResumeGenerateRunner._claim_completed`` monkeypatch）保持不变。

    def _log_generation_usage(
        self,
        task_id: int,
        generator: Any,
        *,
        estimated_prompt_tokens: int | None,
    ) -> None:
        """多段用量汇总日志；实现搬在 ``resume_generate_support.py``（薄委托保留锚点）。"""
        log_generation_usage(task_id, generator, estimated_prompt_tokens=estimated_prompt_tokens)

    def _finalize(
        self, session: Any, task: ResumeGenerateTask, status: str, error: str = ""
    ) -> None:
        finalize_task(session, task, status, error)

    def _claim_completed(self, session: Any, task_id: int) -> bool:
        return claim_completed(session, task_id)

    def _set_cancelled(self, task_id: int) -> None:
        set_cancelled(task_id, open_session=self._open_session)


_RUNNER: ResumeGenerateRunner | None = None
_RUNNER_LOCK = threading.Lock()


def get_resume_generate_runner() -> ResumeGenerateRunner:
    """进程内共享的生成运行器单例。"""
    global _RUNNER
    with _RUNNER_LOCK:
        if _RUNNER is None:
            _RUNNER = ResumeGenerateRunner()
        return _RUNNER


def reset_resume_generate_runner() -> None:
    """测试用：释放单例，避免用例之间共享线程状态。"""
    global _RUNNER
    with _RUNNER_LOCK:
        if _RUNNER is not None:
            _RUNNER.shutdown()
        _RUNNER = None


from .generate_recovery import fail_orphaned_generate_tasks  # noqa: E402, F401 - 兼容再导出

__all__ = [
    "ResumeGenerateRunner",
    "ResumeGenerateRunnerError",
    "get_resume_generate_runner",
    "reset_resume_generate_runner",
]
