# SPDX-License-Identifier: Apache-2.0
"""简历生成端点（域③④）：同步 SSE 生成 + 后台生成任务三端点。

从原 api/resumes.py 原样搬运。**patch 锚点契约**：测试通过
monkeypatch.setattr("app.api.resumes.create_provider" / "…get_llm_config", …) 在**包
命名空间**替换这两个符号，因此本模块对它们的读取必须是调用期的 _api.<name> 属性
访问（from app.api import resumes as _api），**禁止** from-import 具名绑定——绑定会把
patch 静默断开（部分用例靠真实配置兜底仍会绿，是最危险的假绿形态）。

**F3 快照冻结（F3 §1）**：两条链路都在**创建/开始生成时**冻结当前组消费快照
（resolve scope + load consumed），并把追溯元数据写进 profile_usage_snapshot：
- SSE：请求线程冻结后把 consumed 内存快照交给生成器，保存段把 resume_id 回写快照行；
- 后台任务：建任务前后同一事务写快照（task_id），worker 只消费冻结的 consumed，
  完成时与简历记录同事务回写 resume_id。
因此排队/运行期间切组、改参与清单、删组或改名都不会改变本次生成的来源（R-24/R-33），
组改名/删除后历史仍能从快照行读到"本次使用"的组名与参与清单。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api import resumes as _api  # patch 锚点：调用期从包命名空间读取

from ...database import get_db
from ...models.job import Job
from ...models.resume import GENERATE_ACTIVE_STATUSES, ResumeGenerateTask
from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetScopeError
from ...runtime.log_redact import log_exception_redacted
from ...schemas.job import JobOut
from ...schemas.resume import GenerateRequest, GenerateTaskOut, ResumeContent
from ...services import trash
from ...services.career_scenarios.resolve import CareerContextError, resolve_context
from ...services.claims import build_baseline
from ...services.llm.base import LLMError
from ...services.resume.generate_snapshot import (
    consumed_has_content,
    delete_generation_snapshot,
    freeze_generation_snapshot,
    persist_generation_snapshot,
    snapshot_entry_ids,
)
from ...services.resume.generation_postprocess import enforce_material_only_echo
from ...services.resume.resume_generate_runner import (
    ResumeGenerateRunnerError,
    get_resume_generate_runner,
)
from ...services.resume.resume_generator import ResumeGenerator
from ...services.resume.resume_record import save_record
from ...services.resume.scenario_context import build_scenario_prompt_block
from ._shared import _format_sse

logger = logging.getLogger(__name__)


def _log_frozen_context(snapshot, *, transport: str, task_id: int | None = None) -> None:
    """记录"本次生成用了哪一版上下文"——只记标识与哈希，不记场景正文/就业状态。

    计划 §15.3 要求日志能回答"这条任务用的是哪版场景"，同时禁止记录完整场景正文、
    就业状态等用户私有信息。context_sha256 是快照的规范化哈希：既能与后续问题单对上，
    又不能反推正文。
    """
    if snapshot is None:
        return
    logger.info(
        "简历生成上下文已冻结 transport=%s task_id=%s origin=%s scenario_id=%s "
        "preset_key=%s revision=%s catalog_version=%s context_sha256=%s",
        transport,
        task_id if task_id is not None else "-",
        snapshot.scenario_origin,
        snapshot.scenario_id if snapshot.scenario_id is not None else "-",
        snapshot.preset_key or "-",
        snapshot.scenario_revision if snapshot.scenario_revision is not None else "-",
        snapshot.catalog_version or "-",
        (snapshot.context_sha256 or "")[:16],
    )


def _log_frozen_profile(frozen, *, transport: str, task_id: int | None = None) -> None:
    """记录"本次生成用了哪个组/哪份快照"——只记标识与计数，不记任何资料内容。"""
    consumed = frozen.consumed
    logger.info(
        "简历生成资料快照已冻结 transport=%s task_id=%s group_id=%s is_default=%s "
        "sections=%s entries=%s definition_revision=%s data_revision=%s",
        transport,
        task_id if task_id is not None else "-",
        consumed.group_id,
        consumed.is_default,
        len(consumed.participating_keys),
        sum(len(section.entries) for section in consumed.sections.values()),
        frozen.definition_revision,
        frozen.data_revision,
    )


def _ensure_profile_not_empty(frozen) -> None:
    """资料是否为空必须按**本次快照**判断（不读旧资料表，R-46）。"""
    if not consumed_has_content(frozen.consumed):
        raise HTTPException(status_code=400, detail="个人资料为空，无法生成简历")


router = APIRouter()


@router.post("/generate")
async def generate_resume(payload: GenerateRequest, db: Session = Depends(get_db)):
    """流式生成简历（SSE）。

    job_id 为空表示生成**通用简历**（不针对任何岗位）。事件类型见
    services/resume/resume_generator.py 文档；生成结果成功落库后，依次发送携带记录 id 的
    saved 事件和最终 done 事件。

    租约时序（PR-03）：**先取租约，再做任何业务快照读取**——资料/岗位/事实基线
    与保存段因此同属一个数据集身份；此前"快照在先、建流才取租约"留有一个入口
    窗口（两次时刻之间切换数据集，快照与保存会分属两库）。切换持锁期间租约取
    不到，仍以 SSE error 事件报错（与既有行为一致，不抛 500）。

    F3：当前组消费快照在本请求内冻结（租约内），生成器与保存段都只消费这份内存快照；
    快照追溯行在本请求内写入，保存成功时同事务回写 resume_id。
    """
    try:
        lease = dataset_scope.acquire_lease("resume-generate-sse")
    except DatasetScopeError as exc:

        async def lease_error_stream(message: str):
            yield _format_sse({"type": "error", "message": message})

        return StreamingResponse(
            lease_error_stream(exc.public_message),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        job = db.get(Job, payload.job_id) if payload.job_id is not None else None
        if payload.job_id is not None and (job is None or trash.is_deleted(job)):
            raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

        # 经包命名空间调用期读取，保住 test_api_resume / test_resume_general 对
        # app.api.resumes.get_llm_config 的 patch 契约。
        config = _api.get_llm_config(db)
        if not config.base_url or not config.model:
            raise HTTPException(status_code=400, detail="尚未配置大模型 API")

        # A5：显式选用的职业场景在**取租约之后、流开始之前**解析并冻结。缺省/null
        # 不解析（旧请求零差异）；引用非法/归档/版本不符时明确失败，不创建流。
        try:
            snapshot = resolve_context(db, payload.options.career_context)
        except CareerContextError as exc:
            db.close()
            lease.release()
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "code": exc.code},
            )
        _log_frozen_context(snapshot, transport="sse")
        career_block = build_scenario_prompt_block(snapshot)
        context_snapshot = snapshot.model_dump() if snapshot is not None else None

        # F3 §1：冻结当前组消费快照（租约内、db 仍打开）；随后立即写追溯行，
        # 生成段不再读"当前组"。
        frozen = freeze_generation_snapshot(db)
        _ensure_profile_not_empty(frozen)
        _log_frozen_profile(frozen, transport="sse")
        snapshot_row = persist_generation_snapshot(db, frozen)
        db.commit()
        snapshot_pk = int(snapshot_row.id)

        # 经包命名空间调用期读取，保住 test_api_resume / test_resume_general 对
        # app.api.resumes.create_provider 的 patch 契约。
        generator = ResumeGenerator(_api.create_provider(config))
        job_out = JobOut.model_validate(job) if job is not None else None
        # 事实台账里已确认的条目作为事实基线交给模型；台账为空时它就是空基线。
        # F3 契约 §4：只带入能关联到本次快照条目的正向事实（组外/旧资料台账不自动带入）。
        baseline = build_baseline(db, source_entry_ids=snapshot_entry_ids(frozen.consumed))
        # 流式模型调用可能持续数分钟；快照完成后立即释放请求 Session，避免占满连接池。
        db.close()
    except Exception:
        # 快照阶段失败（404/400/内部错误）：先还租约再抛，否则切换会一直被这份
        # 泄漏的租约挡到超时。
        lease.release()
        raise

    # 冻结工厂从**租约身份**派生（PR-03）：不重读当前库，保存段绝不漂到
    # 切换后的新库——即便租约释放与保存之间有并发切换也不串写。
    factory = dataset_scope.frozen_session_factory(lease.identity)

    async def event_stream():
        raw_parts: list[str] = []
        parsed: dict | None = None
        warnings: list[str] = []
        done_event: dict | None = None
        try:
            async for event in generator.generate(
                None,
                job_out,
                payload.options,
                baseline=baseline,
                career_context_block=career_block,
                fact_sections=None,
                consumed=frozen.consumed,
            ):
                if event["type"] == "delta":
                    raw_parts.append(event["text"])
                if event["type"] == "done":
                    parsed = event["resume"]
                    warnings = event["warnings"]
                    done_event = event
                    continue
                yield _format_sse(event)
            if parsed is not None and done_event is not None:
                # C6/R-43：仅素材字段被抄进纸面正文 → error 事件，不写库。
                echo_error = enforce_material_only_echo(
                    ResumeContent.model_validate(parsed), frozen.consumed
                )
                if echo_error:
                    yield _format_sse({"type": "error", "message": echo_error})
                    return
                with factory() as save_db:
                    record = save_record(
                        save_db,
                        parsed,
                        warnings,
                        job_out,
                        "".join(raw_parts),
                        generator.provider.config.model,
                        payload.options.enhance,
                        payload.options.enhancement_level,
                        requested_title=payload.title,
                        template=payload.options.template,
                        format_name=payload.options.format_name,
                        page_limit=payload.options.page_limit,
                        font_scale=payload.options.font_scale,
                        format_config=payload.options.format_config,
                        custom_instruction=payload.options.custom_instruction,
                        coverage_notes=done_event.get("coverage_notes") or [],
                        rationale=done_event.get("rationale") or "",
                        fact_annotations=done_event.get("fact_annotations") or [],
                        document_mode=payload.options.document_mode,
                        context_snapshot=context_snapshot,
                        commit=False,
                    )
                    # F3 §1：简历记录与快照行同事务提交（resume_id 回写）。
                    from ...services.resume.generate_snapshot import (
                        attach_snapshot_resume,
                    )

                    attach_snapshot_resume(
                        save_db, snapshot_id=snapshot_pk, resume_id=record.id
                    )
                    save_db.commit()
                    save_db.refresh(record)
                # 只有持久化成功后才宣布完成；断流不会留下“成功但无历史记录”的状态。
                yield _format_sse({"type": "saved", "record_id": record.id})
                yield _format_sse(done_event)
        except LLMError:
            logger.warning("简历生成失败（模型错误，用户可见错误已固定脱敏）")
            yield _format_sse({"type": "error", "message": "模型服务暂时无法完成生成，请稍后重试"})
        except Exception:  # noqa: BLE001 - 流式接口必须兜底，异常转为事件而非中断连接
            log_exception_redacted(logger, "简历生成发生内部错误")
            yield _format_sse(
                {"type": "error", "message": "生成过程中发生内部错误，请查看后端日志"}
            )
        finally:
            lease.release()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===== 生成后台任务（轮询模型，替代弹窗里的同步 SSE 等待）=====
#
# 为什么保留上面的 POST /generate（SSE）又新增这套任务接口：SSE 是"请求期间持续
# 连接"的旧形态，无法满足"关掉弹窗后生成继续在后台跑"；而直接改掉 SSE 会破坏既有
# 流式语义与一批测试。所以新增一套任务接口，前端生成弹窗改走这里，SSE 路径保持不变。


@router.post("/generate/tasks", response_model=GenerateTaskOut, status_code=201)
def start_resume_generation(payload: GenerateRequest, db: Session = Depends(get_db)):
    """启动一次后台简历生成，返回可轮询的任务（task_id 即任务 id）。

    前置校验与 POST /generate 完全一致（岗位存在、资料非空、LLM 已配置），
    保证任务一旦建起来，后台线程就能拿到完整输入。

    F3 §1：创建任务时（入队前）冻结当前组消费快照，并在**同一事务**里写
    profile_usage_snapshot（task_id）——worker 不再读当前组；排队/运行中切组、删组
    不改变任务来源（R-24/R-33）。
    """
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

    # 经包命名空间调用期读取，与 generate_resume 的 get_llm_config patch 锚点同源。
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")

    # A5：任务创建时解析并**冻结**场景快照（计划 §6.4）：runner 只读 task.context_snapshot，
    # 运行中不再查询"当前场景"。失败明确返回，不创建任务。
    try:
        snapshot = resolve_context(db, payload.options.career_context)
    except CareerContextError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )

    # 防重复：已有进行中的任务就拒绝，绝不因用户连点两次而产生两条任务/两份简历。
    active = (
        db.query(ResumeGenerateTask)
        .filter(ResumeGenerateTask.status.in_(GENERATE_ACTIVE_STATUSES))
        .first()
    )
    if active is not None:
        raise HTTPException(status_code=409, detail="已有简历生成任务正在进行中")

    # F3 §1：冻结当前组消费快照（入队前），并随任务一起提交。
    frozen = freeze_generation_snapshot(db)
    _ensure_profile_not_empty(frozen)
    _log_frozen_profile(frozen, transport="task")

    task = ResumeGenerateTask(
        job_id=payload.job_id,
        title=payload.title,
        options=payload.options.model_dump(),
        context_snapshot=snapshot.model_dump() if snapshot is not None else None,
    )
    db.add(task)
    db.flush()
    snapshot_row = persist_generation_snapshot(db, frozen, task_id=task.id)
    db.commit()
    db.refresh(task)
    _log_frozen_context(snapshot, transport="task", task_id=task.id)

    runner = get_resume_generate_runner()
    try:
        runner.start(
            task.id,
            generation_snapshot=frozen,
            snapshot_id=int(snapshot_row.id),
        )
    except ResumeGenerateRunnerError as exc:
        # 启动失败（极端竞态：恰好有另一条任务刚被创建）：回滚这条空任务与空快照，
        # 不留孤儿。
        delete_generation_snapshot(db, int(snapshot_row.id))
        db.delete(task)
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return GenerateTaskOut.model_validate(task)


@router.get("/generate/tasks/{task_id}", response_model=GenerateTaskOut)
def get_resume_generate_task(task_id: int, db: Session = Depends(get_db)):
    """查询一次生成任务的状态（前端 1.5s 轮询）。"""
    task = db.get(ResumeGenerateTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="生成任务不存在或已被删除")
    return GenerateTaskOut.model_validate(task)


@router.post("/generate/tasks/{task_id}/cancel", response_model=GenerateTaskOut)
def cancel_resume_generate_task(task_id: int, db: Session = Depends(get_db)):
    """取消进行中的生成任务。取消后**不落库**任何简历，任务标为 cancelled。"""
    task = db.get(ResumeGenerateTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="生成任务不存在或已被删除")
    runner = get_resume_generate_runner()
    try:
        runner.cancel(task_id)
    except ResumeGenerateRunnerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.expire_all()
    refreshed = db.get(ResumeGenerateTask, task_id)
    return GenerateTaskOut.model_validate(refreshed)
