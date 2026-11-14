# SPDX-License-Identifier: Apache-2.0
"""每次渲染生成的 CSP nonce（只授权模板里的固定 A4 探针脚本）。

单独成模块的原因：`document_html.py` 贴 500 行预算，本函数与 HTML 拼装无关。
`document_html` 仍导出该名字，既有 `from .document_html import new_csp_nonce` 的调用点不变。
"""

from __future__ import annotations

import secrets


def new_csp_nonce() -> str:
    """每次渲染一份 nonce（只授权模板里的固定 A4 探针脚本）。"""
    return secrets.token_hex(16)
