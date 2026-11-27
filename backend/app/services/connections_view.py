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
    FEATURES,
    GROUP_ASR,
    GROUP_EMBEDDING,
    GROUP_LLM,
    GROUP_NETWORK,
    GROUP_SESSION,
    feature_by_id,
    validate_matrix_references,
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


def _ai_identity(source_id: str, db: Session | None) -> tuple[str, str]:
    """AI 服务那一行"用的是哪个服务商 + 哪个模型"（R19）。

    只读**实际生效的配置**（与大模型 / 语音 / 语义检索各域同一个读取入口），读不到就给
    空串——界面据此不渲染模型 chip。宁可少一行字，也不要把注册表里的名字当成"正在用的
    模型"：那正是 R19 的另一半（标题里的「当前生效配置」既没说服务商也没说模型）。

    单条读失败按"不知道"处理（返回空串），不让整页 500：与 `credential_states` 同一条口径。
    """
    if db is None:
        return "", ""
    try:
        if source_id in (SOURCE_LLM_DEFAULT, SOURCE_LLM_SESSION):
            from .settings_service import get_llm_config

            config = get_llm_config(db)
            return str(config.provider or ""), str(config.model or "")
        if source_id == SOURCE_ASR_DEFAULT:
            from .asr_settings import get_asr_runtime_settings, provider_host

            settings = get_asr_runtime_settings(db)
            return provider_host(settings.base_url), str(settings.model or "")
        if source_id == SOURCE_EMBEDDING_DEFAULT:
            from .llm.embedding_settings import read_embedding_config

            config = read_embedding_config()
            if config is None:
                return "", ""
            return str(config.provider or ""), str(config.model or "")
    except Exception:  # noqa: BLE001 - 读不到就是"不知道"，不该让整页 500
        logger.warning("读取 %s 的服务商/模型失败", source_id, exc_info=True)
    return "", ""


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


def _credential_item(
    source: CredentialSource, state: CredentialState, db: Session | None = None
) -> dict[str, Any]:
    editable = is_editable(source)
    provider, model = _ai_identity(source.source_id, db)
    return {
        "id": source.source_id,
        "label": source.label,
        "kind": "credential",
        "status": str(state.status.value),
        "status_label": state.status_label,
        "detail": state.detail,
        # R19：AI 服务行要能说清"用的是谁家的哪个模型"。取不到就是空串（前端不渲染）。
        "provider": provider,
        "model": model,
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
        # #9：这一行的深链锚点（`/settings?tab=…#anchor` 的 `#` 部分）。
        "anchor": source.anchor,
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


def _key_map_row(source: CredentialSource, state: CredentialState | None) -> dict[str, Any]:
    """密钥地图的一行：来源 / 在哪配 / 谁在用 / 空串含义（CR-12）。

    四列全部取自 registry 的声明，**不在这里另写一份清单**：地图与凭据行必须永远同长，
    否则"页面上有这一行、地图里没有"就会变成下一处隐性知识。

    #9 的三处补充（都不需要新查询）：

    - ``status``：沿用 `build_connections` 里**已经算过**的 `states`，矩阵的状态灯与
      凭据行的状态 chip 因此不可能说两件事；
    - ``section`` / ``anchor``：「去配置」的落点（`/settings?tab=…#anchor`）；
    - ``used_by`` 变成**数组**（`used_by_text` 是拼回来的整句）：矩阵要切格子，
      详情卡与凭据行的「用于」要整句——两处都用同一份数据，不各自去猜。
    """
    used_by_features = [feature_by_id(feature_id) for feature_id in source.used_by]
    used_by_labels = [feature.label for feature in used_by_features]
    return {
        "id": source.source_id,
        "label": source.label,
        "group": source.group,
        "group_label": GROUP_LABELS.get(source.group, source.group),
        "configure_at": source.configure_at,
        # 数组给矩阵与「用于」逐项，`used_by_text` 是同一批标签拼回的整句（排障时直接读）。
        "used_by": used_by_labels,
        "used_by_text": "、".join(used_by_labels),
        "empty_meaning": source.empty_meaning,
        "where": source.location,
        "status": str(state.status.value) if state is not None else "",
        "section": source.section,
        "anchor": source.anchor,
    }


def build_matrix(states: dict[str, CredentialState]) -> dict[str, Any]:
    """密钥依赖矩阵（#9）：行=功能、列=密钥、格子=依赖。

    **前端零清单**：行列顺序、边的种类、闸门是谁，全部来自 registry 的声明顺序。

    - `keys`：非闸门凭据，声明顺序。`status` 复用 `states`（不新查一次）；
    - `features`：`FEATURES` 的声明顺序（不按字母排）；
    - `edges`：由每条来源的 `used_by` 展开，`kind` 取自来源声明（`direct` / `override`）；
    - `gate`：闸门型凭据（代理口令）。它不占矩阵列——所有出网请求都过它，它不属于
      某个功能；前端把它画成矩阵上方的一条带子。

    只在 `states` 里查状态，**不读任何密钥**（响应里不许出现明文，这条与整页一致）。
    """
    # 引用完整性再校验一次：`build_connections` 可能被测试用 monkeypatch 换掉 registry，
    # 那时的错误必须当场炸出来，而不是让某个功能从矩阵里静默消失。
    validate_matrix_references()

    keys: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    gate: dict[str, Any] | None = None
    for source in CREDENTIAL_SOURCES:
        if source.is_gate:
            gate = {"key": source.source_id, "label": source.label}
            continue
        state = states.get(source.source_id)
        keys.append(
            {
                "id": source.source_id,
                "label": source.label,
                "group": source.group,
                "status": str(state.status.value) if state is not None else "not_configured",
                "section": source.section,
                "anchor": source.anchor,
            }
        )
        for feature_id in source.used_by:
            edges.append({"key": source.source_id, "feature": feature_id, "kind": source.edge_kind})
    features = [
        {"id": feature.feature_id, "label": feature.label, "group": feature.group}
        for feature in FEATURES
    ]
    return {"keys": keys, "features": features, "edges": edges, "gate": gate}


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
        item = _credential_item(source, state, db)
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
        # #9：`used_by` 变数组（整句由 `used_by_text` 拼回），行里补 status/section/anchor。
        "key_map": [
            _key_map_row(source, states.get(source.source_id)) for source in CREDENTIAL_SOURCES
        ],
        # #9：依赖矩阵（行=功能 / 列=密钥 / 格子=依赖）。同一次请求内算完：不再多发一次
        # 请求，也不会与上面的 key_map 出现两套状态。
        "matrix": build_matrix(states),
        "storage": {
            "kind": disk.value,
            "label": _protection_label(disk.value),
            "description": disk.description,
        },
        "retrieved": db is not None,
    }


__all__ = [
    "AI_REGISTRY_GROUPS",
    "build_matrix",
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
