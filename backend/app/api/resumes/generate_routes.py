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

**T2 分层**：两条链路的业务编排已下沉到 services/resume/generation_entry.py 与
services/resume/generation_task_start.py；本模块只做 HTTP 错误映射、事务收尾、SSE 帧
格式化与响应装配。快照/基线函数（freeze_generation_snapshot / build_baseline）的测试
打桩点随之改到 generation_entry，见 tests/test_dataset_scope_stream.py。
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api import resumes as _api  # patch 锚点：调用期从包命名空间读取

from ...database import get_db
from ...models.resume import ResumeGenerateTask
from ...runtime import dataset_scope
from ...runtime.blocking import run_sync
from ...runtime.dataset_scope import DatasetScopeError
from ...schemas.resume import GenerateRequest, GenerateTaskOut
from ...services.career_scenarios.resolve import CareerContextError
from ...services.rag.rag_receipt import get_rag_receipt
from ...services.resume.generation_entry import (
    GenerationEntryError,
    complete_generation_entry,
    declare_generation_scope,
    log_frozen_context,
    prepare_generation_entry,
    stream_generation_events,
)
from ...services.resume.generation_task_start import (
    GenerationTaskStartError,
    discard_generation_task,
    prepare_generation_task,
)
from ...services.resume.resume_generate_manager import ResumeGenerateQueueFullError
from ...services.resume.resume_generate_runner import (
    ResumeGenerateRunnerError,
    get_resume_generate_runner,
)
from ._shared import _format_sse

router = APIRouter()


def _prepare_entry_and_commit(db: Session, payload: GenerateRequest):
    """冻结入口 + 提交快照行，作为**一个**同步工作单元在线程池里跑。

    两件事必须在同一个 worker 里连着做：``prepare_generation_entry`` 读岗位、冻结资料
    快照、写快照追溯行（都是同步 DB），紧接着的提交是这条事务的收尾；中间若回到事件
    循环，快照行就一直挂在未提交事务里，同进程的其它请求会等这把 SQLite 写锁。
    """
    entry = prepare_generation_entry(
        db,
        payload,
        # 经包命名空间调用期读取，保住 test_api_resume / test_resume_general 等对
        # app.api.resumes.get_llm_config / create_provider 的 patch 契约。
        load_llm_config=_api.get_llm_config,
        create_provider=_api.create_provider,
    )
    # 事务边界在本层：快照追溯行先提交，之后才允许生成流把它回写 resume_id。
    db.commit()
    return entry


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
        # 数据边界是 ContextVar：只能在事件循环上声明，worker 里写回不来（见
        # generation_entry.declare_generation_scope）。
        declare_generation_scope(payload)
        # 冻结 + 提交是这条事务的终态写：用 ``asyncio.shield`` 包住，客户端在这一刻断开
        # 也不能把事务撕成两半（快照行与租约必须成对，否则后面的切换会一直被挡住）。
        entry = await asyncio.shield(run_sync(_prepare_entry_and_commit, db, payload))
        # 冻结工厂从**租约身份**派生（PR-03）：旁路检索、事实基线与保存段都只读这一份
        # 身份，不重读当前库——即便释放租约与保存之间有并发切换也不串写。
        factory = dataset_scope.frozen_session_factory(lease.identity)
        await complete_generation_entry(
            entry,
            payload,
            dataset_id=lease.identity.dataset_id,
            session_factory=factory,
        )
        # 流式模型调用可能持续数分钟；快照完成后立即释放请求 Session，避免占满连接池。
        await run_sync(db.close)
    except CareerContextError as exc:
        await run_sync(db.close)
        lease.release()
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )
    except GenerationEntryError as exc:
        lease.release()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception:
        # 快照阶段失败（404/400/内部错误）：先还租约再抛，否则切换会一直被这份
        # 泄漏的租约挡到超时。
        lease.release()
        raise

    async def event_stream():
        try:
            async for item in stream_generation_events(entry, payload, save_factory=factory):
                # SSE 帧格式属于响应装配：业务事件由服务层产出，路由只负责编码与收尾。
                yield _format_sse(item)
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
    try:
        started = prepare_generation_task(
            db,
            payload,
            # 经包命名空间调用期读取，与 generate_resume 的 get_llm_config patch 锚点同源。
            load_llm_config=_api.get_llm_config,
        )
    except CareerContextError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )
    except GenerationTaskStartError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    # 事务边界在本层：任务行与快照行同一事务提交后，才允许后台 runner 接手。
    db.commit()
    db.refresh(started.task)
    log_frozen_context(started.snapshot, transport="task", task_id=started.task.id)

    runner = get_resume_generate_runner()
    try:
        runner.start(
            started.task.id,
            generation_snapshot=started.frozen,
            snapshot_id=int(started.snapshot_row.id),
        )
    except ResumeGenerateQueueFullError as exc:
        # 排队已满：提交被拒（429），回滚这条空任务与空快照，不留孤儿。
        discard_generation_task(db, started)
        db.commit()
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except ResumeGenerateRunnerError as exc:
        # 启动失败（极端竞态：另一条任务先占了最后槽位 / 数据集正在切换）：回滚空任务
        # 与空快照，不留孤儿。
        discard_generation_task(db, started)
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return GenerateTaskOut.model_validate(started.task)


@router.get("/generate/tasks/{task_id}", response_model=GenerateTaskOut)
def get_resume_generate_task(task_id: int, db: Session = Depends(get_db)):
    """查询一次生成任务的状态（前端 1.5s 轮询）。"""
    task = db.get(ResumeGenerateTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="生成任务不存在或已被删除")
    payload = GenerateTaskOut.model_validate(task)
    # #30：回执不在数据库（零迁移），由 runner 在检索完成后写进程内注册表。
    receipt = get_rag_receipt(task.id)
    if receipt is not None:
        payload.rag = receipt
    return payload


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
