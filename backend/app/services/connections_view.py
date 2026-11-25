# SPDX-License-Identifier: Apache-2.0
"""把「凭据 registry」+「系统来源清单」拼成「外部连接」页的一份快照（T11 / T12）。

这一层**只读**：不改任何存储，也不实现任何写入语义。就地改 Key 的动作仍然交给各域
既有端点（联网搜索 `PUT /api/settings/search`、大模型 `PUT /api/settings/llm`、
语音 `/api/settings/asr/profiles*`、会话密钥 `/api/settings/llm/session-key`），
C 组四项走 `services/system_sources.py` 的写入口。理由：五种存储形态各有一套写语义
（掩码=不改、空串=清除、`__clear__`=清除、按条判断、纯内存），在页面里另起一套必然漂移
（Q16 记录的就是四个页面表现不一样）。

分组口径（结论 #6）：

- **A 组 AI 服务**：大模型 / 语音转写 / 语义检索 / 仅本次会话；
- **B 组 搜索来源**：联网搜索与网页抓取的三把 Key；
- **C 组 系统来源**：更新源 / 字体源 / RAG 资产源 / 浏览器端口（可编辑，非密钥）。

A/B 来自 `CREDENTIAL_SOURCES`（新增凭据只改那张表，这里自动包含）；C 来自
`SYSTEM_SOURCES`。两支都保持声明顺序 = 展示顺序。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from . import system_sources
from .credentials import (
    CREDENTIAL_SOURCES,
    SOURCE_ASR_DEFAULT,
    SOURCE_EMBEDDING_DEFAULT,
    SOURCE_LLM_DEFAULT,
    SOURCE_LLM_SESSION,
    CredentialSource,
    CredentialState,
    credential_states,
    storage_protection,
)
from .credentials.registry import (
    GROUP_ASR,
    GROUP_EMBEDDING,
    GROUP_LLM,
    GROUP_NETWORK,
    GROUP_SESSION,
)

# CR-06：借用模型 Key 时 `detail` 用的固定前缀，界面要把这句话展示出来。
from .credentials.state import MODEL_KEY_FALLBACK_DETAIL

logger = logging.getLogger(__name__)

GROUP_AI = "ai"
GROUP_SEARCH = "search"
GROUP_PROXY = "proxy"
GROUP_SYSTEM = "system"

GROUP_LABELS: dict[str, str] = {
    GROUP_AI: "AI 服务",
    GROUP_SEARCH: "搜索来源",
    GROUP_PROXY: "网络代理",
    GROUP_SYSTEM: "系统来源与端口",
}

GROUP_HINTS: dict[str, str] = {
    GROUP_AI: "模型、语音转写与语义检索用的密钥；改完立刻生效，不必重启",
    GROUP_SEARCH: "助手联网搜索与网页正文抓取用的密钥；DeepSeek 的这把同时供 OCR 使用",
    GROUP_PROXY: "代理的认证口令；代理模式与地址在「网络代理」卡片里改",
    GROUP_SYSTEM: "下载源与浏览器端口。不是密钥，会随备份带走；改完下一次调用即生效",
}

# 存储方式的中文短标签。`StorageProtection.description` 是一整句解释（放 Tooltip），
# 页面上需要的是这两个字能读完的标注，所以在这里补一份短名——**只此一处**。
PROTECTION_LABELS: dict[str, str] = {
    "dpapi": "DPAPI 加密",
    "plaintext": "当前平台无系统加密",
    "memory_only": "仅内存，不落盘",
}

# A 组包含的 registry 分组（搜索单独成 B 组）。
AI_REGISTRY_GROUPS = (GROUP_LLM, GROUP_ASR, GROUP_EMBEDDING, GROUP_SESSION)

# 就地编辑的说明文案（后端给中文，前端仍按 id 走 i18n，找不到才回落到这里）。
WRITE_HINTS: dict[str, str] = {
    "web_search.deepseek": "改这里等于改「联网搜索」里的 DeepSeek Key（搜索、抓取、OCR 共用）；清空即移除",
    "web_search.tavily": "清空即移除 Tavily Key，助手搜索会少一条来源",
    "web_search.jina": "清空即移除 Jina Key，抓取网页正文时会少一条来源",
    "llm.default": "这里只改 Key；服务商与模型在「AI 模型」里改，换服务商时 Key 不会跟过去",
    "llm.session": "只存在后端内存，程序重启即失效；清空后立刻回到已保存的那把 Key",
    "asr.default": "改的是当前这条语音配置的 Key；地址或协议一变就要重填",
    "embedding.default": "语义检索的 Key 在「AI 模型 → 语义检索」里配置；这里只显示有没有，不回掩码",
    "network.proxy": "改的是代理的认证口令；代理模式与地址在「网络代理」卡片里改，清除后请求不再带认证",
}
# 需要在「别处先配好」才能在这里改的来源：原因写进 write_hint，界面照实说。
_NEEDS_PROVIDER_HINT = "先在「AI 模型」里选好服务商与模型，再回来填 Key"
_NEEDS_ASR_PROFILE_HINT = "先在「语音与面试 → 语音转写」里建一条配置，再回来填 Key"


def _protection_label(value: str) -> str:
    return PROTECTION_LABELS.get(value, value)


def _global_llm_target() -> str:
    """当前生效的全局模型记录 id（没有配置时为空串）。

    ``import`` 放在函数里：本模块被 API 层在每次请求时 import，顶层再拉 `global_llm_profiles`
    会把整条模型配置链路拖进"只看一眼设置页"的路径。
    """
    from .global_llm_profiles import read_global_llm

    record = read_global_llm()
    return str(record.profile_id) if record is not None else ""


def _asr_target() -> str:
    """当前生效的语音配置 id（没有迁移过 / 没有生效项时为空串）。"""
    from .asr_profiles import active_profile_id

    return str(active_profile_id() or "")


def is_editable(source: CredentialSource) -> bool:
    """这条凭据能不能在「外部连接」页就地改。

    规则：除语义检索外都可以；但"命名配置型"的（大模型 / 语音）必须先有那一条记录，
    否则前端没有可写回的目标（``PUT`` 会把 base_url / model 一起覆盖成空）。
    """
    if source.source_id == SOURCE_EMBEDDING_DEFAULT:
        return False
    if source.source_id == SOURCE_LLM_DEFAULT:
        return _global_llm_target() != ""
    if source.source_id == SOURCE_ASR_DEFAULT:
        return _asr_target() != ""
    return True


def _write_hint(source: CredentialSource, editable: bool) -> str:
    """就地编辑说明；这条凭据还不能改时换成"先去哪里配"。"""
    if editable:
        return WRITE_HINTS.get(source.source_id, "")
    if source.source_id == SOURCE_EMBEDDING_DEFAULT:
        return WRITE_HINTS.get(source.source_id, "")
    if source.source_id == SOURCE_LLM_DEFAULT:
        return _NEEDS_PROVIDER_HINT
    if source.source_id == SOURCE_ASR_DEFAULT:
        return _NEEDS_ASR_PROFILE_HINT
    return ""


def _target_id(source: CredentialSource) -> str:
    """命名配置型来源的"要改哪一条"（前端调用域端点时回传）。"""
    if source.source_id == SOURCE_LLM_DEFAULT:
        return _global_llm_target()
    if source.source_id == SOURCE_ASR_DEFAULT:
        return _asr_target()
    if source.source_id == SOURCE_LLM_SESSION:
        return SOURCE_LLM_SESSION
    return ""


def _credential_item(source: CredentialSource, state: CredentialState) -> dict[str, Any]:
    editable = is_editable(source)
    return {
        "id": source.source_id,
        "label": source.label,
        "kind": "credential",
        "status": str(state.status.value),
        "status_label": state.status_label,
        "detail": state.detail,
        "masked": state.masked,
        "hint": state.hint,
        "key_configured": state.key_configured,
        "protection": state.protection_value,
        "protection_label": _protection_label(state.protection_value),
        "protection_description": state.protection.description,
        "editable": editable,
        "write_hint": _write_hint(source, editable),
        # CR-06：这一行**没有单独配置**，生效的是「AI 模型」里的 DeepSeek Key。
        # 单独给布尔而不是让前端去匹配 detail 文案：前端有自己的译文，匹配中文一定会漂。
        "borrowed_key": state.detail.startswith(MODEL_KEY_FALLBACK_DETAIL),
        "target_id": _target_id(source),
        "location": source.location,
    }


def _system_item(source: system_sources.SystemSource) -> dict[str, Any]:
    value = system_sources.get_value(source.item_id)
    default = system_sources.default_value(source.item_id)
    overridden = system_sources.is_overridden(source.item_id)
    return {
        "id": source.item_id,
        "label": source.label,
        "kind": "system",
        "status": "modified" if overridden else "default",
        "status_label": "已改过" if overridden else "默认值",
        "detail": "改过之后可随时恢复默认" if overridden else "正在使用出厂默认值",
        "masked": "",
        "key_configured": False,
        # 这四项不是密钥、不落盘到数据库，也不经过加密后端；如实标注成"明文配置"，
        # 而不是借用 DPAPI 那一套（它们本来就没有秘密可加密）。
        "protection": "config_file",
        "protection_label": "明文配置文件",
        "protection_description": "保存在本机的 global_settings.json 里，不加密、不含密钥；会随备份带走",
        "editable": True,
        "write_hint": source.hint,
        "target_id": source.item_id,
        "value": value,
        "default_value": default,
        "is_default": not overridden,
    }


def _key_map_row(source: CredentialSource) -> dict[str, Any]:
    """密钥地图的一行：来源 / 在哪配 / 谁在用 / 空串含义（CR-12）。

    四列全部取自 registry 的声明，**不在这里另写一份清单**：地图与凭据行必须永远同长，
    否则"页面上有这一行、地图里没有"就会变成下一处隐性知识。
    """
    return {
        "id": source.source_id,
        "label": source.label,
        "group": source.group,
        "group_label": GROUP_LABELS.get(source.group, source.group),
        "configure_at": source.configure_at,
        "used_by": source.used_by,
        "empty_meaning": source.empty_meaning,
        "where": source.location,
    }


def build_connections(db: Session | None) -> dict[str, Any]:
    """一次性取齐三组；单条读失败不影响整页（registry 已经把这条兜住）。"""
    states = {state.source_id: state for state in credential_states(db=db)}
    ai_items: list[dict[str, Any]] = []
    search_items: list[dict[str, Any]] = []
    proxy_items: list[dict[str, Any]] = []
    for source in CREDENTIAL_SOURCES:
        state = states.get(source.source_id)
        if state is None:  # pragma: no cover - registry 保证一一对应
            continue
        item = _credential_item(source, state)
        if source.group in AI_REGISTRY_GROUPS:
            ai_items.append(item)
        elif source.group == GROUP_NETWORK:
            # CR-11：代理口令是独立的一组——它不属于搜索，也不是"这台机器怎么下载东西"。
            proxy_items.append(item)
        else:
            search_items.append(item)
    disk = storage_protection(None)
    groups = [
        {
            "id": GROUP_AI,
            "label": GROUP_LABELS[GROUP_AI],
            "kind": "credential",
            "hint": GROUP_HINTS[GROUP_AI],
            "items": ai_items,
        },
        {
            "id": GROUP_SEARCH,
            "label": GROUP_LABELS[GROUP_SEARCH],
            "kind": "credential",
            "hint": GROUP_HINTS[GROUP_SEARCH],
            "items": search_items,
        },
    ]
    if proxy_items:
        # 没配代理时不摆一个空组（口令一行都没有可看的），页面更干净；
        # 一旦有这一条来源就固定出现——用户要能知道"这里还藏着一份凭据"。
        groups.append(
            {
                "id": GROUP_PROXY,
                "label": GROUP_LABELS[GROUP_PROXY],
                "kind": "credential",
                "hint": GROUP_HINTS[GROUP_PROXY],
                "items": proxy_items,
            }
        )
    groups.append(
        {
            "id": GROUP_SYSTEM,
            "label": GROUP_LABELS[GROUP_SYSTEM],
            "kind": "system",
            "hint": GROUP_HINTS[GROUP_SYSTEM],
            "items": [_system_item(source) for source in system_sources.SYSTEM_SOURCES],
        }
    )
    return {
        "groups": groups,
        # CR-12：整页顶部那张「密钥地图」——由 registry 逐条投影，行数天然等于凭据条数。
        "key_map": [_key_map_row(source) for source in CREDENTIAL_SOURCES],
        "storage": {
            "kind": disk.value,
            "label": _protection_label(disk.value),
            "description": disk.description,
        },
        "retrieved": db is not None,
    }


__all__ = [
    "AI_REGISTRY_GROUPS",
    "GROUP_AI",
    "GROUP_HINTS",
    "GROUP_LABELS",
    "GROUP_PROXY",
    "GROUP_SEARCH",
    "GROUP_SYSTEM",
    "PROTECTION_LABELS",
    "WRITE_HINTS",
    "build_connections",
    "is_editable",
]
