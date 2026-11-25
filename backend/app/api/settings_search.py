# SPDX-License-Identifier: Apache-2.0
"""联网搜索 Key 的校验入口（CR-04）。

为什么单独成模块而不是塞进 ``api/settings.py``：那个文件已经贴着 500 行预算，而这条
路由要带自己的请求/响应模型与失败词表；拆出去也让"只做 DeepSeek"的边界一眼可见。

安全边界：

- **不接受调用方传 base_url**：校验只打到 ``api.deepseek.com`` 的固定地址。允许传地址
  等于把后端变成任意 GET 代理（SSRF）；
- **不跟随重定向**：跟随会把带 ``Authorization`` 的请求原样转给 ``Location`` 指向的主机；
- 不写日志里的 Key：失败只记状态码与分类。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.search_key_test import SearchKeyTestIn, SearchKeyTestResult
from ..services.search.key_probe import probe_deepseek_search_key
from ..services.web_search_settings import resolve_search_deepseek_key

router = APIRouter(prefix="/api/settings", tags=["settings"])
logger = logging.getLogger(__name__)

_MISSING_KEY_MESSAGE = (
    "还没有可测试的 DeepSeek Key。先填一把，或到「设置 → 联网搜索 → DeepSeek」保存后再测。"
)


@router.post("/search/test", response_model=SearchKeyTestResult)
async def test_search_key(
    payload: SearchKeyTestIn, db: Session = Depends(get_db)
) -> SearchKeyTestResult:
    """用待测 Key（留空则用已保存 / 正在复用的那把）发一次最小请求。

    失败一律以 ``ok=false`` 返回，不抛 5xx：校验失败是**正常结果**，前端据此提示
    "Key 无效"，而保存流程不受影响（验证失败不阻断保存）。
    """
    # 读 Key 是同步查询：放到线程池，别在事件循环上等 SQLite 的锁。
    key = payload.stripped_key() or await run_sync(resolve_search_deepseek_key, db)
    if not key:
        return SearchKeyTestResult(ok=False, reason="missing_key", message=_MISSING_KEY_MESSAGE)
    return await probe_deepseek_search_key(key)


__all__ = ["router"]
