# SPDX-License-Identifier: Apache-2.0
"""本轮接入统一任务地基的四个 AI 生成入口（``kind → handler``）。

与 ``ai_task_handlers.py`` 的分工：那个文件放**两种形态的范本**（自跑型 ``job_match``、
监管型 ``resume_generate``）+ 注册；本文件放本轮按范本接进来的四个入口，避免把范本
文件顶过 500 行预算。

四个 handler 全部是**自跑型**（模型调用在本任务线程里发起、可被 ``ctx.drive`` 跨线程
打断），因为它们背后都还没有自己的任务表——没有第二条链路需要"监管"。

## 逐个入口的任务化取舍

1. **岗位解读**（``job_analysis``）：10–60 秒，结果写回 ``job.analysis_cache``。走进来
   **一定**是"用户点了重新生成"或"没有新鲜缓存"——有新鲜缓存时前端根本不会建任务
   （handler 里再兜一次，重复建也不会白烧一次调用）。
2. **简历风险扫描**（``resume_risk``）：本地规则瞬时，模型增强最长 45 秒。扫描报告**不入库**
   （它是"只提示不改写"的即时诊断），所以报告本身跟着 ``result_ref`` 回去。
3. **岗位化修改建议**（``resume_rewrite``）：读整份简历 + 关联岗位 + 资料，生成建议列表，
   通常 10–40 秒，结果**不入库**（建议要用户逐条"采纳"才会改正文）。
   **同族的逐句润色/翻译/STAR 改写/字段改写不任务化**：它们 1–3 秒、结果必须当场回填到
   用户正在编辑的那一栏，后台化的开销（一次建任务 + 1.5 秒轮询 + 一次通知）大于收益，
   而且"离开页面继续跑"对它们的用户毫无意义——人走了，回填目标也就没了。那几个端点改为
   **保证可中途取消**（前端 abort + 后端 ``async def``，断开即取消）。
4. **网申字段识别**（``webform_fill``）：规则认不出的控件批量交给模型，一次调用最多 40 个
   控件，10–40 秒。结果**不入库**（预览是"待用户确认"的中间态）。
   **绝不在完成时写页面**：任务只产出"暂存的预览"，``POST /webform/fill`` 保持同步、
   保持"用户勾了才写"，所以不存在"用户回来时发现表单被 AI 改过"的覆盖风险。

## 一条纪律

四个 handler 都在阶段边界 ``ctx.check_canceled()``、把模型调用交给 ``ctx.drive(coro)``。
只改数据库状态不算取消——那样前端显示"已取消"而后端还在烧 token。
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from ..models.ai_task import (
    AI_TASK_KIND_JOB_ANALYSIS,
    AI_TASK_KIND_RESUME_REWRITE,
    AI_TASK_KIND_RESUME_RISK,
    AI_TASK_KIND_WEBFORM_FILL,
)
from ..models.claim import ClaimRecord
from ..models.job import Job
from ..models.resume import ResumeRecord
from ..schemas.job import JobOut
from ..schemas.job_analysis import JobAnalysisResult
from ..schemas.resume import ResumeContent
from ..schemas.resume_risk import RiskScanOut
from ..services import trash
from ..services.job.job_analysis import generate_job_analysis
from ..services.job_analysis_cache import read_cached_analysis, store_analysis
from ..services.llm import create_provider
from ..services.llm.client_pool import aclose_clients_for_current_loop
from ..services.profile.ai_profile import load_ai_profile
from ..services.resume.resume_risk import scan_resume_risks
from ..services.resume.resume_suggestions import generate_suggestions
from ..services.settings_service import get_llm_config, get_webform_relaxed_mode
from .ai_task_registry import (
    AiTaskHandlerError,
    handler_payload_field,
    register_ai_task_handler,
)

logger = logging.getLogger(__name__)


def _positive_int(value: Any) -> int | None:
    """把可能是 str/int 的标识收敛成正整数；其余（bool、负数、脏串）一律 ``None``。

    与 ``ai_task_handlers._positive_int`` 同一判据但各自一份：两个模块是并列的执行体
    集合，共享一个私有 helper 会把它们绑成一条导入链（本模块已由前者导入，反向导入即循环）。
    """
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


def _flag(payload: dict[str, Any] | None, key: str, *, default: bool) -> bool:
    """从一个可能是脏值的布尔开关收敛出确定值（缺省用 ``default``）。"""
    value = handler_payload_field(payload, key)
    if value is None:
        return default
    return bool(value)


def _text(payload: dict[str, Any] | None, key: str) -> str:
    value = handler_payload_field(payload, key)
    return str(value).strip() if value is not None else ""


def _llm_config(session: Any) -> Any:
    """取模型配置；没配好（``base_url`` 或 ``model`` 为空）就按可预期失败收尾。

    判据与仓库其它入口一致：本地部署的模型服务常常不需要 api_key，所以不查它。
    """
    config = get_llm_config(session)
    if not config.base_url.strip() or not config.model.strip():
        raise AiTaskHandlerError("尚未配置大模型 API")
    return config


# ===== 1. 岗位解读 =====


def handle_job_analysis(ctx: Any) -> None:
    """读岗位 → 调模型生成需求总结与建议 → 写回岗位缓存 → 交回 ``{"job_id": id}``。"""
    job_id = _positive_int(handler_payload_field(ctx.payload, "job_id"))
    if job_id is None:
        raise AiTaskHandlerError("缺少岗位标识")
    force = _flag(ctx.payload, "force", default=False)

    ctx.set_progress(5, "正在读取岗位信息")
    session = ctx.session
    job = session.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise AiTaskHandlerError("岗位不存在或已被删除")

    # 非 force 时先看缓存：前端"没有新鲜缓存才建任务"的分支之外再兜一道，
    # 避免重复点两次「生成」白烧一次调用（与同步端点的语义一致）。
    if not force:
        cached = read_cached_analysis(job)
        if cached is not None and not cached["stale"]:
            try:
                JobAnalysisResult.model_validate(cached["result"])
            except ValidationError:
                # 缓存结构已随模型演进失效：按没有缓存处理，走一次真实生成。
                logger.info("岗位解读缓存结构已失效，任务内转为重新生成 job=%s", job_id)
            else:
                ctx.set_progress(100, "已存在岗位解读")
                ctx.set_result({"job_id": job_id, "analysis": cached["result"]})
                return

    config = _llm_config(session)
    job_out = JobOut.model_validate(job)
    provider = create_provider(config)

    ctx.check_canceled()
    ctx.set_progress(20, "正在解读岗位要求")
    box: dict[str, Any] = {}

    async def run() -> None:
        try:
            box["result"] = await generate_job_analysis(provider, job_out)
        finally:
            # 本任务线程的事件循环即将关闭：先关掉属于它的 HTTP 客户端。
            await aclose_clients_for_current_loop()

    ctx.drive(run())
    result = box.get("result")
    if result is None:
        raise AiTaskHandlerError("模型没有返回岗位解读结果")

    ctx.check_canceled()
    ctx.set_progress(85, "正在保存岗位解读")
    payload = result.model_dump(mode="json")
    store_analysis(session, job, payload)
    # `job_id` 是落点标识（前端据此生成 /jobs?job_id=<id>，不在这里拼路由）；
    # `analysis` 是**交付负载**：用户可能已经离开弹窗（甚至刷新过页面），那时没有任何
    # 组件在等结果，只有 result_ref 能把这份结论交回它的槽——缓存仍然是一份（服务端
    # 唯一事实源），这里只是把它顺路带一次，省掉"完成后再读一次、读失败就报错"的往返。
    ctx.set_result({"job_id": job_id, "analysis": payload})


# ===== 2. 简历风险扫描 =====


def _resume_content(record: ResumeRecord) -> ResumeContent:
    """落库 JSON → 结构体；排除照片，与 ``api/resume_risk`` 的口径一致。"""
    content_data = dict(record.content or {})
    content_data["photo"] = ""
    return ResumeContent.model_validate(content_data)


def handle_resume_risk(ctx: Any) -> None:
    """本地规则 + 可选模型增强扫一遍简历 → 交回 ``{"resume_id", "risk_scan"}``。

    报告不入库（它是即时诊断），所以整份报告跟着 ``result_ref`` 回去——用户离开页面
    回来时，统一任务登记表能把它交给面板显示，不需要再烧一次模型。
    """
    resume_id = _positive_int(handler_payload_field(ctx.payload, "resume_id"))
    if resume_id is None:
        raise AiTaskHandlerError("缺少简历标识")
    # 显式 enhance=false 时连 provider 都不建：与端点的 RR-01 承诺同一条边界——
    # "不把遮罩后的简历发给模型"不依赖下游是否记得跳过。
    enhance = _flag(ctx.payload, "enhance", default=True)

    ctx.set_progress(5, "正在读取简历")
    session = ctx.session
    record = session.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise AiTaskHandlerError("简历记录不存在或已被删除")
    content = _resume_content(record)
    claims = session.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()

    config = get_llm_config(session)
    configured = bool(config.base_url.strip() and config.model.strip())
    provider = create_provider(config) if configured and enhance else None

    ctx.check_canceled()
    ctx.set_progress(25, "正在检查风险点")
    box: dict[str, Any] = {}

    async def run() -> None:
        try:
            box["result"] = await scan_resume_risks(
                content,
                claims,
                provider=provider,
                resume_id=resume_id,
                remote_available=configured,
            )
        finally:
            await aclose_clients_for_current_loop()

    ctx.drive(run())
    result = box.get("result")
    if not isinstance(result, RiskScanOut):
        raise AiTaskHandlerError("风险扫描没有返回结果")

    ctx.check_canceled()
    ctx.set_progress(95, "正在整理扫描结果")
    ctx.set_result({"resume_id": resume_id, "risk_scan": result.model_dump(mode="json")})


# ===== 3. 简历 AI 改写家族里唯一任务化的那一支：岗位化修改建议 =====


def handle_resume_rewrite(ctx: Any) -> None:
    """按关联岗位生成修改建议 → 交回 ``{"resume_id", "suggestions", …}``。

    **不改简历正文**：建议只是给用户逐条"采纳"的候选，采纳走 ``POST /resumes/{id}/revise``
    （带 ``base_revision`` 的乐观并发）。所以"用户不在场时结果写到哪里"这个问题在这里
    没有风险面——结果只到 ``result_ref``，正文一行都没动。
    """
    resume_id = _positive_int(handler_payload_field(ctx.payload, "resume_id"))
    if resume_id is None:
        raise AiTaskHandlerError("缺少简历标识")

    ctx.set_progress(5, "正在读取简历与关联岗位")
    session = ctx.session
    record = session.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise AiTaskHandlerError("简历记录不存在或已被删除")
    if record.job_id is None:
        raise AiTaskHandlerError("这份简历没有关联的岗位，无法生成岗位化建议")
    job = session.get(Job, record.job_id)
    if job is None or trash.is_deleted(job):
        raise AiTaskHandlerError("关联岗位已被删除，无法生成岗位化建议")

    config = _llm_config(session)
    resume = ResumeContent.model_validate(record.content or {})
    job_out = JobOut.model_validate(job)
    # 建议也是"读我的资料"的 AI 功能：当前组 + 去隐藏（与匹配/助手同一口径）。
    profile = load_ai_profile(session)
    provider = create_provider(config)

    ctx.check_canceled()
    ctx.set_progress(25, "正在对照岗位生成修改建议")
    box: dict[str, Any] = {}

    async def run() -> None:
        try:
            box["result"] = await generate_suggestions(provider, resume, job_out, profile)
        finally:
            await aclose_clients_for_current_loop()

    ctx.drive(run())
    suggestions = box.get("result")
    if suggestions is None:
        raise AiTaskHandlerError("模型没有返回修改建议")

    ctx.check_canceled()
    ctx.set_progress(95, "正在整理修改建议")
    ctx.set_result(
        {
            "resume_id": resume_id,
            "job_id": job.id,
            "job_title": job.title,
            "company": job.company,
            "suggestions": [item.model_dump(mode="json") for item in suggestions],
        }
    )


# ===== 4. 网申字段识别 =====


def handle_webform_fill(ctx: Any) -> None:
    """重建一次预览并把规则认不出的控件交给模型 → 交回**暂存**的预览。

    ``payload`` 形如 ``{"snapshot_id": "…", "relaxed": false}``。

    **为什么结果不写页面**：用户在等的时候可能已经关掉页面（甚至关掉受控浏览器）。
    完成任务只把"AI 补全后的预览"放进 ``result_ref`` 暂存，前端回到网申页时据此提示
    「AI 建议已就绪」并由用户逐条勾选；真正写页面仍走同步的 ``POST /webform/fill``
    （用户勾了才写、写完**不提交**）。于是"完成时用户不在场"不会造成任何覆盖。
    """
    snapshot_id = _text(ctx.payload, "snapshot_id")
    if not snapshot_id:
        raise AiTaskHandlerError("缺少页面快照标识")
    # 「放宽模式」是用户设置（默认关）。payload 里带了就按它（测试/重放要能指定），
    # 没带就**读设置**——与同步端点同一口径，绝不因为换了链路就悄悄改变填表行为。
    relaxed_payload = handler_payload_field(ctx.payload, "relaxed")

    # 迟导入：webform 会连带拉起浏览器控制、字段目录与匹配表，别拖慢任务表初始化。
    from ..services import webform as webform_service

    ctx.set_progress(5, "正在读取页面快照")
    session = ctx.session
    relaxed = (
        bool(relaxed_payload) if relaxed_payload is not None else get_webform_relaxed_mode(session)
    )
    try:
        snapshot = webform_service.get_snapshot_store().get(snapshot_id)
    except webform_service.WebFormError as exc:
        raise AiTaskHandlerError(str(exc)) from exc

    ctx.check_canceled()
    ctx.set_progress(15, "正在核对页面控件与你的资料")
    view = webform_service.build_webform_view(session)
    data = view.data
    custom_labels = view.custom_labels
    report = webform_service.build_preview(
        snapshot,
        data,
        relaxed=relaxed,
        custom_labels=custom_labels,
    )
    # 「要记下来吗」的提案要在关会话之前算：它要查库，而下面已经把连接让出去等模型了。
    learning = webform_service.extra_profile.learnable(session, report.items, data)

    provider = webform_service.ai.build_provider(session)
    if provider is None:
        raise AiTaskHandlerError("尚未配置大模型 API")

    ctx.check_canceled()
    ctx.set_progress(35, "正在让模型识别表单字段")
    box: dict[str, Any] = {}

    async def run() -> None:
        try:
            # **失败不抛**（服务层自己降级并记 warning）：AI 是兜底，挂了也要让用户
            # 拿到规则那份预览，而不是一个"任务失败"的空手而归。
            box["asked"] = await webform_service.enrich_preview_with_ai(
                snapshot, data, report, provider, relaxed=relaxed
            )
        finally:
            await aclose_clients_for_current_loop()

    ctx.drive(run())

    ctx.check_canceled()
    ctx.set_progress(95, "正在整理字段识别结果")
    ctx.set_result(
        {
            "webform": 1,
            "snapshot_id": snapshot_id,
            "asked": int(box.get("asked") or 0),
            # 形状与 `POST /webform/preview` 的响应体一致（多一个 snapshot_id 是必要的：
            # 前端 `PreviewCard` 填表时要拿它，而暂存结果没有别的地方能带这个标识）。
            "preview": {
                "snapshot_id": snapshot_id,
                "page": {
                    "url": snapshot.url,
                    "title": snapshot.title,
                    "control_count": len(snapshot.controls),
                },
                **report.as_dict(),
                "default_indexes": [
                    item.index for item in webform_service.default_selections(report)
                ],
                "learning": {"candidates": learning},
            },
        }
    )


# ===== 注册（导入即生效，见 ai_task_registry._ensure_handlers_loaded） =====

register_ai_task_handler(AI_TASK_KIND_JOB_ANALYSIS, handle_job_analysis)
register_ai_task_handler(AI_TASK_KIND_RESUME_RISK, handle_resume_risk)
register_ai_task_handler(AI_TASK_KIND_RESUME_REWRITE, handle_resume_rewrite)
register_ai_task_handler(AI_TASK_KIND_WEBFORM_FILL, handle_webform_fill)


__all__ = [
    "handle_job_analysis",
    "handle_resume_risk",
    "handle_resume_rewrite",
    "handle_webform_fill",
]
