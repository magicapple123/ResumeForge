# SPDX-License-Identifier: Apache-2.0
"""设置接口：大模型配置的读取、保存与连通性测试。"""

import ipaddress
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, session_engine
from ..schemas.backup_status import BackupStatusOut
from ..schemas.batch_operation import (
    BatchExportConfig,
    BatchExportConfigOut,
    BatchGenerationConfig,
    BatchGenerationConfigOut,
    BatchOperationConfigOut,
)
from ..schemas.setting import (
    AssistantLimitSetting,
    AssistantOrbSetting,
    AssistantRelaxedModeSetting,
    AutoBackupIntervalSetting,
    ExportSaveLocationIn,
    ExportSaveLocationOut,
    LLMModelsRequest,
    LLMModelsResult,
    LLMSessionKeyIn,
    LLMSessionKeyOut,
    LLMTestRequest,
    LLMTestResult,
    LLMThinkingRequest,
    LLMThinkingResult,
    NavigationVisibility,
    ReminderPopupSetting,
    SearchConfig,
    WebFormRelaxedModeSetting,
)
from ..services.api_key_crypto import ApiKeyEncryptionError
from ..services.api_key_session import clear_session_key, session_key_configured, set_session_key
from ..services.assistant_limits import (
    get_max_tool_rounds,
    get_stream_budget_seconds,
    save_max_tool_rounds,
    save_stream_budget_seconds,
)
from ..services.batch_operation import (
    read_batch_operation_config,
    save_batch_export_config,
    save_batch_generation_config,
)
from ..services.export_save_location import (
    FolderPickerUnavailable,
    pick_directory,
    validate_directory,
)
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.llm.connection_probe import connection_probe_config
from ..services.llm.model_catalog import list_available_models
from ..services.llm.responses import ResponsesProvider, responses_unsupported_hint
from ..services.llm.thinking import probe_thinking, thinking_support
from ..services.llm.usage_tasks import (
    DEFAULT_AUDIT_LANGUAGE,
    SETTINGS_PROBE_TOKEN_BUDGET,
    TASK_SETTINGS_PROBE,
    set_ambient_scope,
    set_ambient_task,
)
from ..services.settings_service import (
    get_agent_task_events_enabled,
    get_assistant_orb_setting,
    get_assistant_relaxed_mode,
    get_auto_backup_interval_days,
    get_export_save_location,
    get_navigation_visibility,
    get_reminder_popup_on_start,
    get_search_config,
    get_webform_relaxed_mode,
    resolve_llm_config_api_key,
    save_agent_task_events_enabled,
    save_assistant_orb_setting,
    save_assistant_relaxed_mode,
    save_auto_backup_interval_days,
    save_export_save_location,
    save_navigation_visibility,
    save_reminder_popup_on_start,
    save_search_config,
    save_webform_relaxed_mode,
)
from ..services.ui_locale import get_ui_locale
from .assistant_compaction_api import register_compaction_setting_routes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])
# 上下文压缩的三个设置项（#10）单独一层模块：本文件已贴 500 行硬预算，只留注册一行。
register_compaction_setting_routes(router)


class AgentTaskEventsSetting(BaseModel):
    """提醒到期自动生成任务卡开关（默认关；只建卡、不执行任何写操作）。"""

    enabled: bool = False


def _is_loopback_request(request: Request) -> bool:
    """密钥明文只能返回给直接连接本机后端的客户端。"""
    if request.client is None:
        return False
    try:
        address = ipaddress.ip_address(request.client.host.split("%", maxsplit=1)[0])
    except ValueError:
        return False
    if address.is_loopback:
        return True
    # ipv4_mapped 只存在于 IPv6 地址对象上：直接用属性访问会在"IPv4 且非回环"时
    # 抛 AttributeError，本该是 403 的请求变成 500。
    mapped = getattr(address, "ipv4_mapped", None)
    return mapped is not None and mapped.is_loopback


@router.get("/llm/session-key", response_model=LLMSessionKeyOut)
def read_llm_session_key() -> LLMSessionKeyOut:
    """「仅本会话使用」的临时密钥是否存在；密钥本体永不回传。"""
    return LLMSessionKeyOut(configured=session_key_configured())


@router.put("/llm/session-key", response_model=LLMSessionKeyOut)
def write_llm_session_key(payload: LLMSessionKeyIn) -> LLMSessionKeyOut:
    """记录仅本会话使用的密钥：只存进程内存，进程重启即失，不落 SQLite/日志/备份。"""
    set_session_key(payload.api_key)
    return LLMSessionKeyOut(configured=True)


@router.delete("/llm/session-key", status_code=204)
def delete_llm_session_key() -> None:
    clear_session_key()


@router.get("/search", response_model=SearchConfig)
def read_search_settings(db: Session = Depends(get_db)):
    """联网搜索设置（**全局一份**，所有数据集共用）：来源、SearXNG 地址、抓取与条数上限。

    升级后首次读取会把当前数据集的旧 ``search_config` / ``search_deepseek_api_key`
    一次性迁移到全局（见 ``services.web_search_settings`），旧行保留不删。
    """
    return get_search_config(db)


@router.put("/search", response_model=SearchConfig)
def write_search_settings(payload: SearchConfig, db: Session = Depends(get_db)):
    """保存全局搜索设置；DeepSeek key 加密失败时显式报错，不落明文。"""
    try:
        return save_search_config(db, payload)
    except ApiKeyEncryptionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/reminder-popup", response_model=ReminderPopupSetting)
def read_reminder_popup(db: Session = Depends(get_db)):
    """打开应用时是否弹出近期提醒（默认开）。"""
    return ReminderPopupSetting(enabled=get_reminder_popup_on_start(db))


@router.put("/reminder-popup", response_model=ReminderPopupSetting)
def write_reminder_popup(payload: ReminderPopupSetting, db: Session = Depends(get_db)):
    return ReminderPopupSetting(enabled=save_reminder_popup_on_start(db, payload.enabled))


@router.get("/assistant-orb", response_model=AssistantOrbSetting)
def read_assistant_orb(db: Session = Depends(get_db)):
    """读取全局「投投」求职助手悬浮球设置（入口与提示标语，默认均开）。"""
    return get_assistant_orb_setting(db)


@router.put("/assistant-orb", response_model=AssistantOrbSetting)
def write_assistant_orb(payload: AssistantOrbSetting, db: Session = Depends(get_db)):
    # **整模型透传**：这里若只取 `payload.enabled` 落库，新加的 `tips_enabled` 会被静默丢掉。
    return save_assistant_orb_setting(db, payload)


@router.get("/assistant-limits", response_model=AssistantLimitSetting)
def read_assistant_limits(db: Session = Depends(get_db)):
    """求职助手的两条运行上限（工具轮次 / 整链预算）：DB 优先，缺省回默认。"""
    return AssistantLimitSetting(
        max_tool_rounds=get_max_tool_rounds(db),
        stream_budget_seconds=get_stream_budget_seconds(db),
    )


@router.put("/assistant-limits", response_model=AssistantLimitSetting)
def write_assistant_limits(payload: AssistantLimitSetting, db: Session = Depends(get_db)):
    """保存上限：轮次下一轮生效、预算下一次请求生效；越界由模型校验直接拒绝。"""
    save_max_tool_rounds(db, payload.max_tool_rounds)
    save_stream_budget_seconds(db, payload.stream_budget_seconds)
    return payload


@router.get("/webform-relaxed-mode", response_model=WebFormRelaxedModeSetting)
def read_webform_relaxed_mode(db: Session = Depends(get_db)):
    """网申填表「放宽模式」（默认关）：代点下拉/弹层与逐条确认过的声明勾选。"""
    return WebFormRelaxedModeSetting(enabled=get_webform_relaxed_mode(db))


@router.put("/webform-relaxed-mode", response_model=WebFormRelaxedModeSetting)
def write_webform_relaxed_mode(payload: WebFormRelaxedModeSetting, db: Session = Depends(get_db)):
    return WebFormRelaxedModeSetting(enabled=save_webform_relaxed_mode(db, payload.enabled))


@router.get("/assistant-relaxed-mode", response_model=AssistantRelaxedModeSetting)
def read_assistant_relaxed_mode(db: Session = Depends(get_db)):
    """求职助手「放宽模式」（默认关）：助手可读取完整资料（含敏感信息）。

    开启前的前端卡片会写明解锁范围与始终不解锁的凭据边界。
    """
    return AssistantRelaxedModeSetting(enabled=get_assistant_relaxed_mode(db))


@router.put("/assistant-relaxed-mode", response_model=AssistantRelaxedModeSetting)
def write_assistant_relaxed_mode(
    payload: AssistantRelaxedModeSetting, db: Session = Depends(get_db)
):
    return AssistantRelaxedModeSetting(enabled=save_assistant_relaxed_mode(db, payload.enabled))


@router.get("/agent-task-events", response_model=AgentTaskEventsSetting)
def read_agent_task_events(db: Session = Depends(get_db)):
    """提醒到期自动生成任务卡（默认关）：只建卡、不执行任何写操作、不发消息、不弹窗。"""
    return AgentTaskEventsSetting(enabled=get_agent_task_events_enabled(db))


@router.put("/agent-task-events", response_model=AgentTaskEventsSetting)
def write_agent_task_events(payload: AgentTaskEventsSetting, db: Session = Depends(get_db)):
    """保存开关；打开时立即启动后台扫描并补扫一次最近 24h 内的到期提醒。"""
    enabled = save_agent_task_events_enabled(db, payload.enabled)
    # 函数级导入：避免设置路由模块加载期就拉起后台调度服务依赖。
    from ..services import agent_task_events

    agent_task_events.on_enabled_setting_changed(enabled)
    return AgentTaskEventsSetting(enabled=enabled)


@router.get("/export-save-location", response_model=ExportSaveLocationOut)
def read_export_save_location(request: Request, db: Session = Depends(get_db)):
    """生成内容保存位置：空串 = 仅浏览器下载（默认行为）。"""
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="保存位置只能在运行后端的本机查看")
    return ExportSaveLocationOut(path=get_export_save_location(db))


@router.put("/export-save-location", response_model=ExportSaveLocationOut)
def write_export_save_location(
    payload: ExportSaveLocationIn, request: Request, db: Session = Depends(get_db)
):
    """仅允许清除保存位置；设置目录必须走后端本机原生选择器。"""
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="保存位置只能在运行后端的本机设置")
    if not payload.clear:
        raise HTTPException(status_code=400, detail="保存位置只能由「选择文件夹」写入")
    return ExportSaveLocationOut(path=save_export_save_location(db, ""))


@router.post("/export-save-location/pick")
def pick_export_save_folder(request: Request, db: Session = Depends(get_db)) -> dict:
    """弹出本机原生「选择文件夹」对话框，返回所选绝对路径（取消返回 null）。

    后端就跑在用户本机，原生对话框是唯一能拿到**真实绝对路径**的方式（浏览器的
    File System Access API 拿不到完整路径）。环境不支持时返回 503，前端提示重试；不接受
    通过 HTTP 手工提交目录路径。

    与上方密钥查看同一套回环校验：接口会弹出原生系统对话框，若放任任意来源调用，
    恶意网页可以反复骚扰用户（对话框是模态的，还会挡住别的窗口），所以只允许
    直连本机的客户端触发。
    """
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="选择文件夹只能在运行后端的本机操作")
    try:
        picked = pick_directory()
    except FolderPickerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if picked:
        reason = validate_directory(picked)
        if reason is not None:
            raise HTTPException(status_code=400, detail=reason)
        picked = save_export_save_location(db, picked)
    return {"path": picked}


@router.get("/navigation", response_model=NavigationVisibility)
def read_navigation_visibility(db: Session = Depends(get_db)):
    return get_navigation_visibility(db)


@router.put("/navigation", response_model=NavigationVisibility)
def write_navigation_visibility(payload: NavigationVisibility, db: Session = Depends(get_db)):
    return save_navigation_visibility(db, payload)


@router.post("/llm/models", response_model=LLMModelsResult)
async def list_llm_models(payload: LLMModelsRequest, db: Session = Depends(get_db)):
    """获取服务商当前可用的模型列表；失败时用 message 说明原因，不抛 5xx。"""
    if not payload.base_url.strip():
        return LLMModelsResult(message="请先填写 Base URL")
    try:
        resolved = resolve_llm_config_api_key(db, payload)
    except ValueError as exc:
        return LLMModelsResult(message=str(exc))
    try:
        models = await list_available_models(resolved.base_url, resolved.api_key)
    except LLMError as exc:
        logger.warning("获取模型列表失败：%s", exc)
        return LLMModelsResult(message=str(exc))
    return LLMModelsResult(models=models, message=f"共获取到 {len(models)} 个模型")


@router.post("/llm/thinking/check", response_model=LLMThinkingResult)
async def check_llm_thinking(payload: LLMThinkingRequest, db: Session = Depends(get_db)):
    """查这个模型支持哪种思考形态、有哪些强度档位。

    上游**没有**"查询思考能力"的接口（``/v1/models`` 只给模型名），所以分两步：
    ``probe=False`` 只读内置能力表（零上游调用，用来出选项）；``probe=True`` 再实发一次
    最小请求——很多服务商对不认识的参数是**静默忽略**的，只有看响应里有没有思考内容
    才能分辨"真的生效"与"接受了但没效果"。失败一律用 message 说明，不抛 5xx。
    """
    if not payload.base_url.strip() or not payload.model.strip():
        return LLMThinkingResult(message="请先填写 Base URL 与模型名称")
    try:
        resolved = resolve_llm_config_api_key(db, payload)
    except ValueError as exc:
        return LLMThinkingResult(message=str(exc))
    support = thinking_support(resolved)
    result = LLMThinkingResult(
        style=support.style,
        efforts=list(support.efforts),
        supported=support.supported,
        note=support.note,
    )
    if not payload.probe:
        return result
    # 思考能力检测（probe=True）实发一次最小请求（R40）：按「设置自检」落一条用量账，
    # 与前端「计入你的模型用量」的说明保持一致；provider 调用结束时自动落账。
    set_ambient_task(TASK_SETTINGS_PROBE)
    # #35：设置自检只发最小请求（无业务数据）。
    # #35/A1：设置自检只发最小请求（无业务数据）；语言取界面语言、预算见常量。
    set_ambient_scope(
        input_scope="none",
        masked=True,
        language=get_ui_locale(db) or DEFAULT_AUDIT_LANGUAGE,
        budget=SETTINGS_PROBE_TOKEN_BUDGET,
    )
    probed = await probe_thinking(resolved)
    return result.model_copy(
        update={
            "probed": True,
            "accepted": probed.accepted,
            "reasoning_seen": probed.reasoning_seen,
            "message": probed.message,
        }
    )


@router.post("/llm/test", response_model=LLMTestResult)
async def test_llm(payload: LLMTestRequest, db: Session = Depends(get_db)):
    """测试连通性：用表单当前值发起一次最小对话，不要求先保存。"""
    if not payload.base_url or not payload.model:
        return LLMTestResult(ok=False, message="请先填写 Base URL 与模型名称")
    try:
        resolved_payload = resolve_llm_config_api_key(db, payload)
    except ValueError as exc:
        return LLMTestResult(ok=False, message=str(exc))
    # 不继承用户的思考参数；默认思考的已知模型由能力表显式关闭，未知服务商不加参数。
    probe_config = connection_probe_config(resolved_payload)
    # 「测试连接」真实发了一次模型请求（R40）：按「设置自检」（settings_probe）落一条
    # 用量账，让用户在「模型用量」里看得到这次消耗；失败调用也如实留痕（finish_reason）。
    set_ambient_task(TASK_SETTINGS_PROBE)
    # #35：设置自检只发最小请求（无业务数据）。
    # #35/A1：连接测试与思考检测同口径——只发最小请求，语言取界面语言、预算 64。
    set_ambient_scope(
        input_scope="none",
        masked=True,
        language=get_ui_locale(db) or DEFAULT_AUDIT_LANGUAGE,
        budget=SETTINGS_PROBE_TOKEN_BUDGET,
    )
    # Responses 的已知不支持名单（Claude / Gemini / 硅基流动）先拦一道：
    # 直接给出"切回 Chat Completions"的出路，而不是让用户看到一个裸 404。
    if (probe_config.api_style or "openai") == "responses":
        unsupported = responses_unsupported_hint(probe_config.base_url)
        if unsupported is not None:
            return LLMTestResult(ok=False, message=unsupported)
    started = time.perf_counter()
    try:
        provider = create_provider(probe_config)
        if isinstance(provider, ResponsesProvider):
            # 按协议分支发最小请求：Responses 用 input:"hi" + max_output_tokens:16
            # （任务书 §4 T09-7）；两条老链路的请求逐字节不变。
            reply = await provider.probe_chat()
            if not reply.strip():
                # 实测（DeepSeek Responses）：思考模型会把 16 token 的探针预算全用在
                # 思考上，正文为空但请求本身 200——配置是**可用**的，如实说明而非报失败。
                latency_ms = int((time.perf_counter() - started) * 1000)
                return LLMTestResult(
                    ok=True,
                    latency_ms=latency_ms,
                    message="连接成功：服务商已响应（思考模型用完了最小输出预算，未返回正文）",
                )
        else:
            reply = await provider.chat([{"role": "user", "content": "请只回复两个字：正常"}])
    except LLMError as exc:
        logger.warning("LLM 连接测试失败：%s", exc)
        return LLMTestResult(ok=False, message=str(exc))
    latency_ms = int((time.perf_counter() - started) * 1000)
    if not reply.strip():
        return LLMTestResult(
            ok=False,
            latency_ms=latency_ms,
            message="模型没有返回正文，当前配置暂不可用；请检查模型名称或思考设置后重试",
        )
    return LLMTestResult(
        ok=True,
        latency_ms=latency_ms,
        message=f"连接成功，模型回复「{reply.strip()[:30]}」",
    )


@router.get("/backup-status", response_model=BackupStatusOut)
def read_backup_status(db: Session = Depends(get_db)) -> dict:
    """当前数据集的自动备份保护摘要（RF-05 / A02）：是否被保护、最近成功、快照清单。

    响应契约见 schemas/backup_status.py：auto_backup_enabled 来自部署配置（无 UI 开关），
    disabled/state 让前端能把"自动备份被关掉"如实展示，而不是显示成"受保护"。
    """
    from ..services.data_backup.status import backup_status

    return backup_status(session_engine(db))


@router.get("/auto-backup-interval", response_model=AutoBackupIntervalSetting)
def read_auto_backup_interval(db: Session = Depends(get_db)):
    """自动备份间隔（天）：用户保存的运行时值，缺失时回退环境配置默认。"""
    return AutoBackupIntervalSetting(interval_days=get_auto_backup_interval_days(db))


@router.put("/auto-backup-interval", response_model=AutoBackupIntervalSetting)
def write_auto_backup_interval(payload: AutoBackupIntervalSetting, db: Session = Depends(get_db)):
    """保存自动备份间隔（1..365 天）。调度线程下次到期检查时读取，无需重启。"""
    return AutoBackupIntervalSetting(
        interval_days=save_auto_backup_interval_days(db, payload.interval_days)
    )


@router.get("/batch-operation", response_model=BatchOperationConfigOut)
def read_batch_operation(db: Session = Depends(get_db)):
    """批量操作的两套参数（生成 / 导出）；每节的 ``configured`` 独立判断。

    岗位广场的「批量 AI 生成简历」与简历中心的「批量导出简历」各读自己那节；批量导出
    的后端入口在未配置时直接拒绝，不把"必须配置"只做在前端提示上。
    """
    return read_batch_operation_config(db)


@router.put("/batch-operation/generation", response_model=BatchGenerationConfigOut)
def write_batch_generation(payload: BatchGenerationConfig, db: Session = Depends(get_db)):
    """只保存「批量生成简历」这一节，不影响导出参数。"""
    try:
        return save_batch_generation_config(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/batch-operation/export", response_model=BatchExportConfigOut)
def write_batch_export(payload: BatchExportConfig, db: Session = Depends(get_db)):
    """只保存「批量导出简历」这一节，不影响生成参数。"""
    try:
        return save_batch_export_config(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
