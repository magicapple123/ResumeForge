# SPDX-License-Identifier: Apache-2.0
"""``OpenAICompatProvider`` 的内部工具方法（从 ``openai_compat.py`` 纯搬迁）。

为什么独立成模块：``openai_compat.py`` 贴着 500 行预算。这一组方法只做请求体/用量
边界的派生与响应解码，不参与流式编排；搬进 mixin 由 provider 继承后，方法名、签名
与实例上的 ``monkeypatch`` 落点都不变。``_MIN_STREAM_CHARS`` / ``_MAX_STREAM_CHARS``
随方法一起搬走，原模块按原路径再导出（``test_openai_compat`` 从原模块导入它们）。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from . import payload as payload_rules
from .base import LLMError

if TYPE_CHECKING:
    from ...schemas.setting import LLMConfig

logger = logging.getLogger(__name__)

_MIN_STREAM_CHARS = 64_000
_MAX_STREAM_CHARS = 2_000_000


class _InternalToolsMixin:
    if TYPE_CHECKING:
        # 实例状态由宿主 OpenAICompatProvider（openai_compat.py）持有，本 mixin 不持有；
        # 声明在这里是为了 pyright 能解析 self.config / self.request_overrides。
        config: LLMConfig
        request_overrides: dict[str, Any]

    # ===== 内部工具 =====

    def _stream_char_limit(self) -> int:
        # 不限制输出时 max_tokens 为 0，按乘法派生会落到下界，反而成为最严格的
        # 限制；这种情况直接用允许的最大值。
        if self.config.uses_unlimited_output:
            return _MAX_STREAM_CHARS
        return min(
            _MAX_STREAM_CHARS,
            max(_MIN_STREAM_CHARS, self.config.max_tokens * 8),
        )

    def _build_payload(
        self,
        messages: list[dict],
        stream: bool,
        tools: list[dict] | None = None,
        *,
        thinking: bool = True,
    ) -> dict:
        # 请求体构造（含覆盖参数白名单与 stream_options 守门）下沉到 payload 模块：
        # 本方法保留为调用点，测试与调用方仍按 `_build_payload` 访问。
        return payload_rules.build_payload(
            self.config, self.request_overrides, messages, stream, tools, thinking=thinking
        )

    def _apply_request_overrides(self, payload: dict, *, thinking: bool = True) -> None:
        """合并单次请求的覆盖参数；实现下沉到 payload 模块，本方法保留为调用点。"""
        payload_rules._apply_request_overrides(self.request_overrides, payload, thinking=thinking)

    @staticmethod
    def _extract_content(data: dict) -> str:
        if not isinstance(data, dict):
            raise LLMError("模型返回了无法解析的响应格式")
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("模型返回了无法解析的响应格式") from exc
        if content is None:
            return ""
        if not isinstance(content, str):
            raise LLMError("模型返回了无法解析的响应格式")
        return content

    @staticmethod
    def _http_error(response: httpx.Response) -> LLMError:
        status = response.status_code
        # 上游正文可能回显请求或敏感资料，只记录状态码。
        logger.warning("LLM 调用失败 status=%s", status)
        return payload_rules.status_error(status, response.headers.get("location"))


__all__ = ["_InternalToolsMixin"]
