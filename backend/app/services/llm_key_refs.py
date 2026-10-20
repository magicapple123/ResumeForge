# SPDX-License-Identifier: Apache-2.0
"""API Key 的**引用占位符**：读取接口发出去的密钥形态（真实密钥永不出现在响应里）。

单独成模块是为了让两个服务都能引用同一份常量而不互相 import：
`settings_service`（数据集配置）与 `global_llm_profiles`（全局记录）。

三种引用：

- ``********``：当前生效配置的密钥，写回时按"端点未变"还原；
- ``********:record:<id>``：**数据集**配置记录（升级前的旧形态，仍接受写回）；
- ``********:profile:<id>``：**全局**配置记录（当前形态）。

占位符只在本地 API 内流转；前端原样回传，由服务层还原成真实密钥再加密落盘。
"""

from __future__ import annotations

API_KEY_MASK = "********"
RECORD_API_KEY_PREFIX = f"{API_KEY_MASK}:record:"
PROFILE_API_KEY_PREFIX = f"{API_KEY_MASK}:profile:"


def masked_api_key(api_key: str, *, reference: str | None = None) -> str:
    """已配置密钥 → 引用占位符；未配置 → 空串。"""
    if not api_key:
        return ""
    return reference or API_KEY_MASK


def masked_record_key(api_key: str, record_id: int | None) -> str:
    """数据集旧记录（int id）的引用形态；record_id 为空时退回通用掩码。"""
    reference = f"{RECORD_API_KEY_PREFIX}{record_id}" if record_id is not None else None
    return masked_api_key(api_key, reference=reference)


__all__ = [
    "API_KEY_MASK",
    "PROFILE_API_KEY_PREFIX",
    "RECORD_API_KEY_PREFIX",
    "masked_api_key",
    "masked_record_key",
]
