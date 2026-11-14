# SPDX-License-Identifier: Apache-2.0
"""从 400 响应体里只读一个布尔：这次失败是不是"上下文超长"。

为什么单独一个模块：有的 provider 把"超长"写在 400 的 body 里（``context length`` /
``maximum context``），但 body 可能带着用户 prompt 片段甚至密钥回显。这里的边界是
**最多读 4 KiB、只在内存里匹配、对外只带回一个 bool**——原始文本不落日志、不进异常
message、不返回给前端。
"""

import re

import httpx

from .base import LLMError

# 读满就停：够匹配关键字，也不给"用超长错误体撑内存"留口子。
MAX_ERROR_BODY_BYTES = 4096
_CONTEXT_LENGTH = re.compile(rb"context[ _]length|maximum context", re.IGNORECASE)


async def with_context_length_flag(response: httpx.Response, error: LLMError) -> LLMError:
    """Read at most 4 KiB of a 400 body without retaining or exposing its text."""
    if response.status_code != 400:
        return error
    body = bytearray()
    async for chunk in response.aiter_bytes(chunk_size=MAX_ERROR_BODY_BYTES):
        body.extend(chunk[: MAX_ERROR_BODY_BYTES - len(body)])
        if len(body) >= MAX_ERROR_BODY_BYTES:
            break
    if _CONTEXT_LENGTH.search(body):
        error.context_length_error = True
    return error
