"""设置接口：大模型配置的读取、保存与连通性测试。"""
import ipaddress
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.setting import LLMConfigRecord
from ..schemas.setting import (
    AssistantOrbSetting,
    LLMApiKeyRevealResult,
    LLMConfig,
    LLMConfigRecordCreate,
    LLMConfigRecordOut,
    LLMModelsRequest,
    LLMModelsResult,
    LLMTestRequest,
    LLMTestResult,
    LLMThinkingRequest,
    LLMThinkingResult,
    NavigationVisibility,
    ReminderPopupSetting,
    SearchConfig,
    WebFormRelaxedModeSetting,
)
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.llm.model_catalog import list_available_models
from ..services.llm.thinking import probe_thinking, thinking_support
from ..services.settings_service import (
    delete_llm_config_record,
    get_assistant_orb_setting,
    get_llm_config,
    get_navigation_visibility,
    get_reminder_popup_on_start,
    get_search_config,
    get_webform_relaxed_mode,
    list_llm_config_records,
    mask_llm_config,
    resolve_llm_config_api_key,
    save_assistant_orb_setting,
    save_llm_config,
    save_llm_config_record,
    save_navigation_visibility,
    save_reminder_popup_on_start,
    save_search_config,
    save_webform_relaxed_mode,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


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


@router.get("/llm/records", response_model=list[LLMConfigRecordOut])
def read_llm_config_records(db: Session = Depends(get_db)):
    return list_llm_config_records(db)


@router.post("/llm/records", response_model=LLMConfigRecordOut)
def write_llm_config_record(payload: LLMConfigRecordCreate, db: Session = Depends(get_db)):
    try:
        return save_llm_config_record(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/llm/records/{record_id}", status_code=204)
def remove_llm_config_record(record_id: int, db: Session = Depends(get_db)):
    record = db.get(LLMConfigRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="配置记录不存在或已被删除")
    delete_llm_config_record(db, record_id)


@router.get("/llm", response_model=LLMConfig)
def read_llm_config(db: Session = Depends(get_db)):
    return mask_llm_config(db, get_llm_config(db))


@router.post("/llm/api-key/reveal", response_model=LLMApiKeyRevealResult)
def reveal_llm_api_key(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """仅在用户点击显示时临时返回当前密钥，且禁止浏览器和代理缓存。"""
    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="API Key 只能在运行后端的本机查看")
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return LLMApiKeyRevealResult(api_key=get_llm_config(db).api_key)


@router.put("/llm", response_model=LLMConfig)
def write_llm_config(payload: LLMConfig, db: Session = Depends(get_db)):
    try:
        saved = save_llm_config(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return mask_llm_config(db, saved)


@router.get("/search", response_model=SearchConfig)
def read_search_settings(db: Session = Depends(get_db)):
    """联网搜索设置：来源、自建 SearXNG 地址、正文抓取条数与结果上限。"""
    return get_search_config(db)


@router.put("/search", response_model=SearchConfig)
def write_search_settings(payload: SearchConfig, db: Session = Depends(get_db)):
    return save_search_config(db, payload)


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


@router.get("/webform-relaxed-mode", response_model=WebFormRelaxedModeSetting)
def read_webform_relaxed_mode(db: Session = Depends(get_db)):
    """网申填表「放宽模式」（默认关）：代点下拉/弹层与逐条确认过的声明勾选。"""
    return WebFormRelaxedModeSetting(enabled=get_webform_relaxed_mode(db))


@router.put("/webform-relaxed-mode", response_model=WebFormRelaxedModeSetting)
def write_webform_relaxed_mode(payload: WebFormRelaxedModeSetting, db: Session = Depends(get_db)):
    return WebFormRelaxedModeSetting(
        enabled=save_webform_relaxed_mode(db, payload.enabled)
    )


@router.get("/navigation", response_model=NavigationVisibility)
def read_navigation_visibility(db: Session = Depends(get_db)):
    return get_navigation_visibility(db)


@router.put("/navigation", response_model=NavigationVisibility)
def write_navigation_visibility(
    payload: NavigationVisibility, db: Session = Depends(get_db)
):
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
    # 只测连通性：连思考参数一起测的话，"参数写错"会表现成"连不上"，用户会去查网络。
    provider = create_provider(resolved_payload.without_thinking())
    started = time.perf_counter()
    try:
        reply = await provider.chat([{"role": "user", "content": "请只回复两个字：正常"}])
    except LLMError as exc:
        logger.warning("LLM 连接测试失败：%s", exc)
        return LLMTestResult(ok=False, message=str(exc))
    latency_ms = int((time.perf_counter() - started) * 1000)
    return LLMTestResult(
        ok=True,
        latency_ms=latency_ms,
        message=f"连接成功，模型回复「{reply.strip()[:30]}」",
    )
