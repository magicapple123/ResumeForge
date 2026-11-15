# SPDX-License-Identifier: Apache-2.0
"""服务端抓取兜底（DeepSeek ``/tools/fetch``）在 ``web_fetch`` 侧的唯一入口。

为什么单独一个文件：

- ``fetcher.py`` 是**同步**编排，而 ``services/search/deepseek.py`` 同时提供同步/异步
  两版 Fetch；"取密钥 → 判账号可用性 → 把正文交给编排层"这三步收在一处，避免抓取编排
  里出现第二套对外契约；
- **延迟导入**：``services.search`` 包的 ``__init__`` 会立刻拉起聚合层（六个来源的
  provider 模块），而导入 ``web_fetch`` 的助手工具链并不需要这些。放在函数里既避开
  潜在循环导入，也不把搜索栈的启动成本摊到每次导入岗位。

语义（与 ``search.deepseek`` 一致，不另立一套）：

- 没有密钥 → 空串，一次网络请求都不发；
- URL 不合法（非 http(s) / 带凭据）→ 空串，且**不交给第三方**去抓；
- 单页失败（4xx / 5xx / 非 JSON）→ 空串，由调用方按"这一档没兜住"处理；
- 账号级不可用（401 / 402 / 429）→ 抛 :class:`FallbackUnavailable`，调用方在本次抓取
  任务内**整段停用**这一档，而不是逐条重试（那只会多烧几次配额）。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: 兜底档的 ``engine`` 值：``FetchedPage.engine`` 里如实体现"这一页是谁抓的"。
DEEPSEEK_ENGINE = "deepseek"


class FallbackUnavailable(RuntimeError):
    """账号级不可用（无密钥 / 401 / 402 欠费 / 429 限流），本次任务别再试这一档。"""


def resolve_key(db: Any) -> str:
    """当前配置里的 DeepSeek 密钥（未配置返回空串）。

    读配置失败按"没有兜底"处理而不是抛错：抓取的主链路是本地两档，配置读不出来不该
    让整次导入失败。
    """
    if db is None:
        return ""
    from ..web_search_settings import resolve_search_deepseek_key

    try:
        return resolve_search_deepseek_key(db) or ""
    except Exception:  # noqa: BLE001 - 配置读取失败不影响本地抓取
        logger.warning("读取 DeepSeek 密钥失败，本次不做服务端兜底", exc_info=True)
        return ""


def fetch_text(url: str, api_key: str) -> str:
    """调一次 ``/tools/fetch`` 取 Markdown 正文（同步）。

    账号级不可用重新包成 :class:`FallbackUnavailable`，这样编排层不必导入
    ``services.search`` 的异常类型就能做"整段停用"的判断。
    """
    from ..search.deepseek import DeepSeekUnavailable, fetch_deepseek_text_sync

    try:
        return fetch_deepseek_text_sync(url, api_key)
    except DeepSeekUnavailable as exc:
        raise FallbackUnavailable(str(exc)) from exc


__all__ = ["DEEPSEEK_ENGINE", "FallbackUnavailable", "fetch_text", "resolve_key"]
