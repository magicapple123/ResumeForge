# SPDX-License-Identifier: Apache-2.0
"""3xx 的可操作文案（T04）。

provider 不跟随重定向（跟随会把鉴权头带去另一个主机）。所以 301/302 的唯一正确处理
是把"最终地址"告诉用户，让他改 Base URL——退回"模型调用失败"等于什么也没说。
"""

from __future__ import annotations

import httpx
from app.services.llm.openai_compat_helpers import _InternalToolsMixin
from app.services.llm.payload import http_error_message, status_error


def test_3xx_with_location_names_the_final_address():
    message = http_error_message(301, "https://api.example.com/v1/chat/completions")
    assert "重定向到 https://api.example.com/v1/chat/completions" in message
    assert "Base URL" in message


def test_3xx_without_location_still_says_what_to_do():
    message = http_error_message(302)
    assert "重定向" in message
    assert "Base URL" in message


def test_status_error_keeps_the_status_code():
    error = status_error(301, "https://api.example.com/v1")
    assert "HTTP 301" in str(error)
    assert "重定向" in str(error)


def test_provider_http_error_passes_the_location_header():
    response = httpx.Response(
        301,
        headers={"location": "https://api.example.com/v1"},
        request=httpx.Request("POST", "https://api.example.com/chat"),
    )
    error = _InternalToolsMixin._http_error(response)
    assert "https://api.example.com/v1" in str(error)
