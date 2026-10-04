"""简历生成端点（域③④）：同步 SSE 生成 + 后台生成任务三端点。

从原 ``api/resumes.py`` 原样搬运。**patch 锚点契约**：测试通过
``monkeypatch.setattr("app.api.resumes.create_provider" / "…get_llm_config", …)`` 在**包
命名空间**替换这两个符号，因此本模块对它们的读取必须是调用期的 ``_api.<name>`` 属性
访问（``from app.api import resumes as _api``），**禁止** from-import 具名绑定——绑定会把
patch 静默断开（部分用例靠真实配置兜底仍会绿，是最危险的假绿形态）。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api import resumes as _api  # patch 锚点：调用期从包命名空间读取

from ...database import SessionLocal, get_db
from ...models.job import Job
from ...models.resume import GENERATE_ACTIVE_STATUSES, ResumeGenerateTask
from ...schemas.job import JobOut
from ...schemas.resume import GenerateRequest, GenerateTaskOut
from ...services import trash
from ...services.claims import build_baseline
from ...services.llm.base import LLMError
from ...services.profile.profile_service import get_profile_detail, to_profile_out
from ...services.resume.resume_generate_runner import (
    ResumeGenerateRunnerError,
    get_resume_generate_runner,
)
from ...services.resume.resume_generator import ResumeGenerator
from ...services.resume.resume_record import save_record
from ._shared import _format_sse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/generate")
async def generate_resume(payload: GenerateRequest, db: Session = Depends(get_db)):
    """流式生成简历（SSE）。

    ``job_id`` 为空表示生成**通用简历**（不针对任何岗位）。事件类型见
    services/resume/resume_generator.py 文档；生成结果成功落库后，依次发送携带记录 id 的
    saved 事件和最终 done 事件。
    """
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

    profile = get_profile_detail(db)
    if (
        not profile.name
        and not profile.projects
        and not profile.experiences
        and not profile.campus_experiences
    ):
        raise HTTPException(status_code=400, detail="请先在「我的资料」页完善个人信息")

    # 经包命名空间调用期读取，保住 test_api_resume / test_resume_general 对
    # app.api.resumes.get_llm_config 的 patch 契约。
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")

    # 经包命名空间调用期读取，保住 test_api_resume / test_resume_general 对
    # app.api.resumes.create_provider 的 patch 契约。
    generator = ResumeGenerator(_api.create_provider(config))
    job_out = JobOut.model_validate(job) if job is not None else None
    profile_out = to_profile_out(profile)
    # 事实台账里已确认的条目作为事实基线交给模型；台账为空时它就是空基线，
    # 生成行为与没有这个功能时完全一致。
    baseline = build_baseline(db)
    # 流式模型调用可能持续数分钟；快照完成后立即释放请求 Session，避免占满连接池。
    db.close()

    async def event_stream():
        raw_parts: list[str] = []
        parsed: dict | None = None
        warnings: list[str] = []
        done_event: dict | None = None
        try:
            async for event in generator.generate(
                profile_out, job_out, payload.options, baseline=baseline
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
                with SessionLocal() as save_db:
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
                        custom_instruction=payload.options.custom_instruction,
                        coverage_notes=done_event.get("coverage_notes") or [],
                        rationale=done_event.get("rationale") or "",
                    )
                # 只有持久化成功后才宣布完成；断流不会留下“成功但无历史记录”的状态。
                yield _format_sse({"type": "saved", "record_id": record.id})
                yield _format_sse(done_event)
        except LLMError as exc:
            logger.warning("简历生成失败（模型错误）：%s", exc)
            yield _format_sse({"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001 - 流式接口必须兜底，异常转为事件而非中断连接
            logger.exception("简历生成发生内部错误")
            yield _format_sse({"type": "error", "message": "生成过程中发生内部错误，请查看后端日志"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ===== 生成后台任务（轮询模型，替代弹窗里的同步 SSE 等待）=====
#
# 为什么保留上面的 ``POST /generate``（SSE）又新增这套任务接口：SSE 是"请求期间持续
# 连接"的旧形态，无法满足"关掉弹窗后生成继续在后台跑"；而直接改掉 SSE 会破坏既有
# 流式语义与一批测试。所以新增一套任务接口，前端生成弹窗改走这里，SSE 路径保持不变。


@router.post("/generate/tasks", response_model=GenerateTaskOut, status_code=201)
def start_resume_generation(payload: GenerateRequest, db: Session = Depends(get_db)):
    """启动一次后台简历生成，返回可轮询的任务（``task_id`` 即任务 id）。

    前置校验与 ``POST /generate`` 完全一致（岗位存在、资料非空、LLM 已配置），
    保证任务一旦建起来，后台线程就能拿到完整输入。
    """
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

    profile = get_profile_detail(db)
    if (
        not profile.name
        and not profile.projects
        and not profile.experiences
        and not profile.campus_experiences
    ):
        raise HTTPException(status_code=400, detail="请先在「我的资料」页完善个人信息")

    # 经包命名空间调用期读取，与 generate_resume 的 get_llm_config patch 锚点同源。
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")

    # 防重复：已有进行中的任务就拒绝，绝不因用户连点两次而产生两条任务/两份简历。
    active = (
        db.query(ResumeGenerateTask)
        .filter(ResumeGenerateTask.status.in_(GENERATE_ACTIVE_STATUSES))
        .first()
    )
    if active is not None:
        raise HTTPException(status_code=409, detail="已有简历生成任务正在进行中，请等待其完成")

    task = ResumeGenerateTask(
        job_id=payload.job_id,
        title=payload.title,
        options=payload.options.model_dump(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    runner = get_resume_generate_runner()
    try:
        runner.start(task.id)
    except ResumeGenerateRunnerError as exc:
        # 启动失败（极端竞态：恰好有另一条任务刚被创建）：回滚这条空任务，不留孤儿。
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
