# SPDX-License-Identifier: Apache-2.0
"""外部凭据 registry 适配层（结论 #6）：**只做适配、不做迁移**。

对外只暴露一处入口。后端各处（备份剥离、设置页、「外部连接」页）都从这里取符号，
不再各自维护"密钥存在哪 / 怎么掩码 / 备份要不要剥"这三件事。

公开面分四组：

1. **清单**（:mod:`credentials.registry`）：``CREDENTIAL_SOURCES`` / ``get_source`` /
   ``source_ids`` / ``groups`` / ``sources_of_group`` / ``GROUP_LABELS``；
2. **读写语义**（:mod:`credentials.semantics`）：``resolve_stored_key`` /
   ``apply_stored_key`` / ``mask_value`` / ``is_mask`` / ``CLEAR_SENTINEL``；
3. **状态与存储**（:mod:`credentials.state`）：``read_credential``（真实值，仅后端运行时）/
   ``credential_state`` / ``credential_states`` / ``storage_protection`` /
   ``disk_protection``；
4. **备份派生**（:mod:`credentials.backup_whitelist`）：``secret_app_setting_where`` /
   ``secret_app_setting_prefixes`` / ``protected_source_ids``。

典型用法::

    from app.services.credentials import credential_state

    state = credential_state("web_search.deepseek", db=db)
    state.status_label       # 已保存 / 未配置 / 仅本次会话
    state.masked             # ******** 或空串（语义检索永远是空串 + key_configured）
    state.protection_value   # dpapi / plaintext / memory_only

    # 备份剥离白名单（唯一一份，从清单派生）
    from app.services.credentials import secret_app_setting_where

    connection.execute(f"DELETE FROM app_setting WHERE {secret_app_setting_where()}")
"""

from __future__ import annotations

from .backup_whitelist import (
    protected_source_ids as protected_source_ids,
)
from .backup_whitelist import (
    secret_app_setting_prefixes as secret_app_setting_prefixes,
)
from .backup_whitelist import (
    secret_app_setting_where as secret_app_setting_where,
)
from .registry import (
    CREDENTIAL_SOURCES as CREDENTIAL_SOURCES,
)
from .registry import (
    GROUP_LABELS as GROUP_LABELS,
)
from .registry import (
    SOURCE_ASR_DEFAULT as SOURCE_ASR_DEFAULT,
)
from .registry import (
    SOURCE_EMBEDDING_DEFAULT as SOURCE_EMBEDDING_DEFAULT,
)
from .registry import (
    SOURCE_LLM_DEFAULT as SOURCE_LLM_DEFAULT,
)
from .registry import (
    SOURCE_LLM_SESSION as SOURCE_LLM_SESSION,
)
from .registry import (
    SOURCE_WEB_SEARCH_DEEPSEEK as SOURCE_WEB_SEARCH_DEEPSEEK,
)
from .registry import (
    SOURCE_WEB_SEARCH_JINA as SOURCE_WEB_SEARCH_JINA,
)
from .registry import (
    SOURCE_WEB_SEARCH_TAVILY as SOURCE_WEB_SEARCH_TAVILY,
)
from .registry import (
    get_source as get_source,
)
from .registry import (
    groups as groups,
)
from .registry import (
    has_source as has_source,
)
from .registry import (
    persistent_sources as persistent_sources,
)
from .registry import (
    source_ids as source_ids,
)
from .registry import (
    sources_of_group as sources_of_group,
)
from .semantics import (
    CLEAR_SENTINEL as CLEAR_SENTINEL,
)
from .semantics import (
    apply_stored_key as apply_stored_key,
)
from .semantics import (
    is_clear_sentinel as is_clear_sentinel,
)
from .semantics import (
    is_mask as is_mask,
)
from .semantics import (
    mask_value as mask_value,
)
from .semantics import (
    resolve_stored_key as resolve_stored_key,
)
from .state import (
    ENCRYPTING_PLATFORMS as ENCRYPTING_PLATFORMS,
)
from .state import (
    credential_state as credential_state,
)
from .state import (
    credential_states as credential_states,
)
from .state import (
    disk_protection as disk_protection,
)
from .state import (
    read_credential as read_credential,
)
from .state import (
    storage_protection as storage_protection,
)
from .types import (
    STATUS_LABELS as STATUS_LABELS,
)
from .types import (
    CredentialScope as CredentialScope,
)
from .types import (
    CredentialSource as CredentialSource,
)
from .types import (
    CredentialState as CredentialState,
)
from .types import (
    CredentialStatus as CredentialStatus,
)
from .types import (
    KeyDisplay as KeyDisplay,
)
from .types import (
    ProtectionKind as ProtectionKind,
)
from .types import (
    StorageProtection as StorageProtection,
)
from .types import (
    status_label as status_label,
)

__all__ = [
    "CLEAR_SENTINEL",
    "CREDENTIAL_SOURCES",
    "ENCRYPTING_PLATFORMS",
    "GROUP_LABELS",
    "SOURCE_ASR_DEFAULT",
    "SOURCE_EMBEDDING_DEFAULT",
    "SOURCE_LLM_DEFAULT",
    "SOURCE_LLM_SESSION",
    "SOURCE_WEB_SEARCH_DEEPSEEK",
    "SOURCE_WEB_SEARCH_JINA",
    "SOURCE_WEB_SEARCH_TAVILY",
    "STATUS_LABELS",
    "CredentialScope",
    "CredentialSource",
    "CredentialState",
    "CredentialStatus",
    "KeyDisplay",
    "ProtectionKind",
    "StorageProtection",
    "apply_stored_key",
    "credential_state",
    "credential_states",
    "disk_protection",
    "get_source",
    "groups",
    "has_source",
    "is_clear_sentinel",
    "is_mask",
    "mask_value",
    "persistent_sources",
    "protected_source_ids",
    "read_credential",
    "resolve_stored_key",
    "secret_app_setting_prefixes",
    "secret_app_setting_where",
    "source_ids",
    "sources_of_group",
    "status_label",
    "storage_protection",
]
