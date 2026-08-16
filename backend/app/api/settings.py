"""设置接口：大模型配置的读取、保存与连通性测试。"""
import logging
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.setting import LLMConfig, LLMTestRequest, LLMTestResult
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config, save_llm_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/llm", response_model=LLMConfig)
def read_llm_config(db: Session = Depends(get_db)):
    return get_llm_config(db)


@router.put("/llm", response_model=LLMConfig)
def write_llm_config(payload: LLMConfig, db: Session = Depends(get_db)):
    save_llm_config(db, payload)
    return payload


@router.post("/llm/test", response_model=LLMTestResult)
async def test_llm(payload: LLMTestRequest):
    """测试连通性：用表单当前值发起一次最小对话，不要求先保存。"""
    if not payload.base_url or not payload.model:
        return LLMTestResult(ok=False, message="请先填写 Base URL 与模型名称")
    provider = create_provider(payload)
    started = time.perf_counter()
    try:
        reply = await provider.chat([{"role": "user", "content": "请只回复两个字：正常"}])
    except LLMError as exc:
        logger.warning("LLM 连接测试失败：%s", exc)
        return LLMTestResult(ok=False, message=str(exc))
    latency_ms = int((time.perf_counter() - started) * 1000)
    return LLMTestResult(ok=True, latency_ms=latency_ms, message=f"连接成功，模型回复「{reply.strip()[:30]}」")
