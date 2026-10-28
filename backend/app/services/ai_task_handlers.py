# SPDX-License-Identifier: Apache-2.0
"""内置 AI 任务执行体（``kind → handler``）。

两个 handler，代表两种形态：

- :func:`handle_job_match` —— **自跑**型：模型调用在本任务线程里发起、可被取消打断，
  结果写回业务表（``apply_service.persist_match``）。这是本轮把「单条岗位适配」从
  "请求-响应一体"（连接一断就白跑、且完全没有取消入口）改成任务化的落点。
- :func:`handle_resume_generate` —— **监管**型：简历生成已有成熟的
  ``resume_generate_task`` + ``ResumeGenerateRunner``（含终态原子仲裁、快照冻结、
  预算与用量日志），本 handler 不复制那条链路，只跟随既有任务并映射成统一状态。
  取消时**顺手取消底层任务**——否则前端显示"已取消"而后端还在烧 token，
  这正是"取消只是改状态"的典型症状。

下一轮接入岗位解读 / 风险扫描 / AI 改写 / 网申填写时，只需在本文件加一个 handler 并在
末尾 ``register_ai_task_handler`` 一行，**API 层与前端登记表都不用改**。

（本轮已按这条路线接完那四个入口，实现放在 ``ai_task_handlers_ai_entries.py``：
它们是同一种"自跑"形态，各占五六十行，与本文件里的两个范本放一起会顶过 500 行预算。）
"""

from __future__ import annotations

import logging
from typing import Any

from ..models.ai_task import AI_TASK_KIND_JOB_MATCH, AI_TASK_KIND_RESUME_GENERATE
from ..models.job import Job
from ..models.resume import (
    GENERATE_STATUS_CANCELLED,
    GENERATE_STATUS_COMPLETED,
    GENERATE_STATUS_FAILED,
    ResumeGenerateTask,
)
from ..services import trash
from ..services.apply import apply_service
from ..services.job.job_match import (
    analyze_match_with_retry,
    job_payload,
    local_match_result,
)
from ..services.job.job_match_context import match_source_texts, profile_is_empty
from ..services.llm import create_provider
from ..services.llm.client_pool import aclose_clients_for_current_loop
from ..services.settings_service import get_llm_config
from .ai_task_registry import (
    AiTaskCanceled,
    AiTaskHandlerError,
    handler_payload_field,
    register_ai_task_handler,
)

logger = logging.getLogger(__name__)

#: 监管型 handler 的轮询间隔（秒）。0.4s 与前端 1.5s 轮询叠加后仍足够跟手，
#: 又不至于把 SQLite 读炸。
_WATCH_INTERVAL_SECONDS = 0.4
#: 每接收多少字符推进一格进度。模型输出总长未知（**不是**百分比），
#: 这里只给出一个"在动"的渐近刻度，且封顶 95——真到 100 由终态落库时写。
_RESUME_CHARS_PER_PERCENT = 200
_RESUME_PROGRESS_CAP = 95


def _positive_int(value: Any) -> int | None:
    """把可能是 str/int 的标识收敛成正整数；其余（bool、负数、脏串）一律 ``None``。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            parsed = int(text)
            return parsed if parsed > 0 else None
    return None


# ===== 自跑型：单条岗位适配 =====


def handle_job_match(ctx: Any) -> None:
    """单条岗位匹配度分析：读岗位 + 资料 → 调模型 → 落库 → 交回 ``{"job_id": id}``。"""
    job_id = _positive_int(handler_payload_field(ctx.payload, "job_id"))
    if job_id is None:
        raise AiTaskHandlerError("缺少岗位标识")
    force = bool(handler_payload_field(ctx.payload, "force"))

    ctx.set_progress(5, "正在准备岗位匹配分析")
    session = ctx.session
    job = session.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise AiTaskHandlerError("岗位不存在或已被删除")

    if not force:
        # 已有结论就不重算：与 POST /jobs/{id}/match-analysis 的非 force 语义一致，
        # 避免用户重复点「分析」白烧一次模型调用。
        existing = apply_service.latest_match(session, job_id)
        if existing is not None and isinstance(existing.result, dict) and existing.result:
            ctx.set_progress(100, "已存在匹配分析结果")
            ctx.set_result({"job_id": job_id})
            return

    profile, profile_text, resume_text = match_source_texts(session, job)
    if profile_is_empty(profile) and not resume_text.strip():
        raise AiTaskHandlerError("个人资料为空，无法做匹配分析")
    job_data = job_payload(job)
    config = get_llm_config(session)
    configured = bool(config.base_url.strip() and config.model.strip())

    ctx.check_canceled()
    ctx.set_progress(15, "正在对照岗位要求与你的资料")

    if not configured:
        # 未配置大模型：本地规则降级（与既有同步端点同一行为），不阻断流程。
        result = local_match_result(job_data)
        model_name = ""
    else:
        provider = create_provider(config)
        ctx.set_progress(30, "正在调用模型分析匹配度")
        box: dict[str, Any] = {}

        async def run() -> None:
            try:
                box["result"] = await analyze_match_with_retry(
                    provider, job_data, profile_text, resume_text
                )
            finally:
                # 本任务线程的事件循环即将关闭：先关掉属于它的 HTTP 客户端。
                await aclose_clients_for_current_loop()

        # 经 RunnerEventLoopHandle 驱动：cancel() 才能跨线程打断挂起的模型调用。
        ctx.drive(run())
        result = box.get("result")
        if result is None:
            raise AiTaskHandlerError("模型没有返回匹配分析结果")
        model_name = config.model

    ctx.check_canceled()
    ctx.set_progress(85, "正在保存分析结果")
    stored_job = session.get(Job, job_id)
    if stored_job is None or trash.is_deleted(stored_job):
        raise AiTaskHandlerError("岗位不存在或已被删除")
    apply_service.persist_match(session, stored_job, result, model=model_name)
    session.commit()
    # 落点标识：前端据此生成 /jobs?job_id=<id>（不在这里拼路由）。
    ctx.set_result({"job_id": job_id})


# ===== 监管型：简历生成 =====


def _cancel_resume_task(resume_task_id: int) -> None:
    """取消底层简历生成（真的停：runner 的 _stop + 跨线程中止模型调用）。"""
    # 迟导入：resume_generate_runner 会 import 一批生成相关模块，别拖慢任务表初始化。
    from .resume.resume_generate_runner import (
        ResumeGenerateRunnerError,
        get_resume_generate_runner,
    )

    try:
        get_resume_generate_runner().cancel(resume_task_id)
    except ResumeGenerateRunnerError as exc:
        # 底层任务已不在运行（跑完了 / 后端重启过）：没有可停的东西，不视为错误。
        logger.info("取消底层简历生成任务时未找到运行中的执行体：%s", exc)


def _resume_progress(received_chars: int) -> int:
    """已接收字数 → 渐近刻度（**不是**百分比：总长未知，封顶 95）。"""
    estimate = 5 + max(0, received_chars) // _RESUME_CHARS_PER_PERCENT
    return min(_RESUME_PROGRESS_CAP, estimate)


def handle_resume_generate(ctx: Any) -> None:
    """跟随一个既有的简历生成任务，把它映射成统一任务状态。

    ``payload`` 形如 ``{"resume_task_id": 12}``——本 handler 不新建生成链路
    （那是 ``resume_generate_task`` + ``ResumeGenerateRunner`` 的职责），只做门面。
    """
    resume_task_id = _positive_int(handler_payload_field(ctx.payload, "resume_task_id"))
    if resume_task_id is None:
        raise AiTaskHandlerError("缺少简历生成任务标识")

    ctx.set_progress(1, "简历生成进行中")
    while True:
        if ctx.canceled:
            # **先真的停掉底层任务**再退出：只把自己标 canceled 会让后端继续烧 token。
            _cancel_resume_task(resume_task_id)
            raise AiTaskCanceled

        # 每轮另开会话读：底层 runner 在别的线程写同一个库，复用会话会读到陈旧对象。
        probe = ctx.open_session()
        try:
            task = probe.get(ResumeGenerateTask, resume_task_id)
            if task is None:
                raise AiTaskHandlerError("简历生成任务不存在或已被删除")
            status = task.status
            message = task.message or ""
            received_chars = task.received_chars or 0
            resume_id = task.resume_id
            error = task.error or ""
        finally:
            probe.close()

        if status == GENERATE_STATUS_COMPLETED:
            ctx.set_progress(100, message or "简历已生成")
            # 没有 resume_id 时交回空 dict：前端深链函数会返回 null，不渲染跳转按钮
            # （宁可少一颗按钮，也不要跳到一条不存在的简历）。
            ctx.set_result({"resume_id": resume_id} if resume_id else {})
            return
        if status == GENERATE_STATUS_FAILED:
            raise AiTaskHandlerError(error or "简历生成失败")
        if status == GENERATE_STATUS_CANCELLED:
            raise AiTaskCanceled

        ctx.set_progress(_resume_progress(received_chars), message or "正在生成简历")
        ctx.sleep(_WATCH_INTERVAL_SECONDS)


# ===== 注册（导入即生效，见 ai_task_registry._ensure_handlers_loaded） =====

register_ai_task_handler(AI_TASK_KIND_JOB_MATCH, handle_job_match)
register_ai_task_handler(AI_TASK_KIND_RESUME_GENERATE, handle_resume_generate)

# 本轮接入的另外四个入口（岗位解读 / 风险扫描 / 岗位化修改建议 / 网申字段识别）在
# 兄弟模块里——它们全是**自跑型**，按本文件的范本写，只是各占五六十行，放一起会把
# 承重的范本文件顶过 500 行预算。放在文件末尾导入：它只依赖注册表，导入即注册。
from . import ai_task_handlers_ai_entries as _ai_entries  # noqa: E402,F401

_ = _ai_entries  # 显式引用：导入的副作用（注册）才是本行存在的理由。

__all__ = ["handle_job_match", "handle_resume_generate"]
