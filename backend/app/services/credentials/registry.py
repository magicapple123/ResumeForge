# SPDX-License-Identifier: Apache-2.0
"""外部凭据 registry：**"这台机器上有哪些对外凭据、存在哪、怎么读、怎么盖"的唯一清单**。

为什么要有这一层（结论 #6）：改造前这些事实散在五处（联网搜索 / 大模型 / 语音 /
语义检索 / 会话密钥），四套掩码与清除语义，靠"记得去改"维系。后果是可验证的两条：

1. 备份剥离白名单是手写 LIKE 串（``data_backup/api_keys.py``），注释自认"新增来源忘了
   登记就会漏"——而漏了的后果是明文 Key 直接进备份包（Q17）；
2. 「外部连接」页要显示三种状态与存储方式，但没有任何一处能回答"这把 Key 存在哪"
   （Q16/Q19）。

**本层只做适配，不做迁移**：五种存储形态原样保留，旧数据照旧读得出来，`global_settings.json`
的块结构与 AppSetting 的键名一个字节都不改。registry 描述现状，不重排现状。

模块职责边界：

- :mod:`types`：词表（枚举 + 不可变数据类）；
- 本模块：声明式清单（纯数据，不 import 任何业务模块）；
- :mod:`semantics`：统一的读写语义（空串/掩码/哨兵）；
- :mod:`state`：按 `source_id` 查表读真实值与状态；
- :mod:`backup_whitelist`：从本清单派生备份剥离白名单。

新增一种外部凭据时**只改这一个文件**（外加 `state.py` 里对应的读取实现），
备份白名单与「外部连接」页会自动包含它。
"""

from __future__ import annotations

from .types import CredentialScope, CredentialSource, KeyDisplay

# ===== 来源标识（稳定契约；前端与测试都按它引用）=====

SOURCE_WEB_SEARCH_DEEPSEEK = "web_search.deepseek"
SOURCE_WEB_SEARCH_TAVILY = "web_search.tavily"
SOURCE_WEB_SEARCH_JINA = "web_search.jina"
SOURCE_LLM_DEFAULT = "llm.default"
SOURCE_LLM_SESSION = "llm.session"
SOURCE_ASR_DEFAULT = "asr.default"
SOURCE_EMBEDDING_DEFAULT = "embedding.default"

# ===== 分组标识 =====

GROUP_WEB_SEARCH = "web_search"
GROUP_LLM = "llm"
GROUP_ASR = "asr"
GROUP_EMBEDDING = "embedding"
GROUP_SESSION = "session"

GROUP_LABELS: dict[str, str] = {
    GROUP_WEB_SEARCH: "联网搜索与抓取",
    GROUP_LLM: "大模型",
    GROUP_ASR: "语音转写",
    GROUP_EMBEDDING: "语义检索",
    GROUP_SESSION: "仅本次会话",
}

# 声明顺序 = 展示顺序 = 备份 LIKE 串的拼接顺序（确定性，便于断言）。
CREDENTIAL_SOURCES: tuple[CredentialSource, ...] = (
    CredentialSource(
        source_id=SOURCE_WEB_SEARCH_DEEPSEEK,
        group=GROUP_WEB_SEARCH,
        label="DeepSeek（联网搜索 / 抓取 / OCR 共用）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → web_search.deepseek_api_key",
        storage_field="deepseek_api_key",
        app_setting_key_prefixes=("search_deepseek_api_key",),
        note=(
            "同一把 Key 供联网搜索、URL 抓取与 OCR 使用。升级前的旧形态是数据集 "
            "AppSetting 的 search_deepseek_api_key 行（仍会一次性迁移到全局），"
            "该前缀因此必须留在备份剥离白名单里。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_WEB_SEARCH_TAVILY,
        group=GROUP_WEB_SEARCH,
        label="Tavily（联网搜索来源）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → web_search.tavily_api_key",
        storage_field="tavily_api_key",
        app_setting_key_prefixes=("search_tavily_api_key",),
        note="数据集 AppSetting 的 search_tavily_api_key 行是升级前的旧形态，仍需剥离。",
    ),
    CredentialSource(
        source_id=SOURCE_WEB_SEARCH_JINA,
        group=GROUP_WEB_SEARCH,
        label="Jina（网页正文抓取来源）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → web_search.jina_api_key",
        storage_field="jina_api_key",
        app_setting_key_prefixes=("search_jina_api_key",),
        note="数据集 AppSetting 的 search_jina_api_key 行是升级前的旧形态，仍需剥离。",
    ),
    CredentialSource(
        source_id=SOURCE_LLM_DEFAULT,
        group=GROUP_LLM,
        label="大模型 API Key（当前生效配置）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → llm.profiles[].config.api_key，或 AppSetting llm_config",
        multi_profile=True,
        supports_clear_sentinel=True,
        # 密钥藏在 JSON 块 / 独立表里，**不能**用 LIKE 删整行（会把 base_url、
        # model 等非密钥字段一起删掉）。它由 api_keys.py 里既有的两条专门路径处理：
        # `llm_config` 的 JSON 剥 api_key 字段、`llm_config_record` 表整列置空。
        note=(
            "引用形态是掩码占位符：`********` / `********:profile:<id>` / "
            "`********:record:<id>`（见 llm_key_refs）。写回时按"
            "「端点未变才还原」的既有规则处理，本层不改这条判据。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_LLM_SESSION,
        group=GROUP_SESSION,
        label="仅本次会话使用的大模型 Key",
        scope=CredentialScope.MEMORY,
        location="后端进程内存（api_key_session），不落盘、不进备份",
        note=(
            "RF-24 的纯内存通道：进程重启即失效。它存在时生效值以它为准，"
            "保存链路会把落库值清成空串（_strip_session_key）。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_ASR_DEFAULT,
        group=GROUP_ASR,
        label="语音转写 API Key（当前生效配置）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → asr_profiles.profiles[].api_key",
        multi_profile=True,
        supports_clear_sentinel=True,
        app_setting_key_prefixes=("asr_api_key",),
        note=(
            "旧形态是数据集 AppSetting 的 asr_api_key 行（迁移前兼容路径仍会读它），"
            "前缀匹配同时覆盖未来的 asr_api_key:xxx 多条形态。"
            "Key 的写入口径按条判断：地址或协议变了就清空，绝不跨条继承。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_EMBEDDING_DEFAULT,
        group=GROUP_EMBEDDING,
        label="语义检索 API Key（当前生效配置）",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → embedding_profiles.profiles[].config.api_key",
        display=KeyDisplay.BOOLEAN,
        multi_profile=True,
        supports_clear_sentinel=True,
        note=(
            "配置卡只给 key_configured 布尔，连掩码都不回；本地模型配置没有 Key。"
            "密钥在 global_settings.json 里，不在数据库中，因此不进 LIKE 白名单。"
        ),
    ),
)


def get_source(source_id: str) -> CredentialSource:
    """按 ``source_id`` 取声明；未知 id 抛 :class:`KeyError`（不要静默返回默认值）。

    **每次调用都遍历清单**（不做导入期快照）：清单只有个位数条，而"快照 vs 实时"
    的差别决定了测试能否用 monkeypatch 验证白名单派生是真的派生而不是写死两份。
    """
    for source in CREDENTIAL_SOURCES:
        if source.source_id == source_id:
            return source
    known = "、".join(source.source_id for source in CREDENTIAL_SOURCES)
    raise KeyError(f"未登记的凭据来源：{source_id}（已登记：{known}）")


def has_source(source_id: str) -> bool:
    """``source_id`` 是否已登记（只读探测，不抛错）。"""
    return any(source.source_id == source_id for source in CREDENTIAL_SOURCES)


def source_ids() -> tuple[str, ...]:
    """全部来源 id，保持声明顺序。"""
    return tuple(source.source_id for source in CREDENTIAL_SOURCES)


def sources_of_group(group: str) -> tuple[CredentialSource, ...]:
    """某个分组下的全部来源（分组不存返回空元组）。"""
    return tuple(source for source in CREDENTIAL_SOURCES if source.group == group)


def groups() -> tuple[str, ...]:
    """出现过的分组，保持声明顺序且去重。"""
    seen: list[str] = []
    for source in CREDENTIAL_SOURCES:
        if source.group not in seen:
            seen.append(source.group)
    return tuple(seen)


def persistent_sources() -> tuple[CredentialSource, ...]:
    """会活过进程重启的来源（``scope != memory``）。"""
    return tuple(source for source in CREDENTIAL_SOURCES if source.persistent)


__all__ = [
    "CREDENTIAL_SOURCES",
    "GROUP_ASR",
    "GROUP_EMBEDDING",
    "GROUP_LABELS",
    "GROUP_LLM",
    "GROUP_SESSION",
    "GROUP_WEB_SEARCH",
    "SOURCE_ASR_DEFAULT",
    "SOURCE_EMBEDDING_DEFAULT",
    "SOURCE_LLM_DEFAULT",
    "SOURCE_LLM_SESSION",
    "SOURCE_WEB_SEARCH_DEEPSEEK",
    "SOURCE_WEB_SEARCH_JINA",
    "SOURCE_WEB_SEARCH_TAVILY",
    "get_source",
    "groups",
    "has_source",
    "persistent_sources",
    "source_ids",
    "sources_of_group",
]
