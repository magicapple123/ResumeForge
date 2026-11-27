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

from .types import CredentialFeature, CredentialScope, CredentialSource, KeyDisplay

# ===== 来源标识（稳定契约；前端与测试都按它引用）=====

SOURCE_WEB_SEARCH_DEEPSEEK = "web_search.deepseek"
SOURCE_WEB_SEARCH_TAVILY = "web_search.tavily"
SOURCE_WEB_SEARCH_JINA = "web_search.jina"
SOURCE_LLM_DEFAULT = "llm.default"
SOURCE_LLM_SESSION = "llm.session"
SOURCE_ASR_DEFAULT = "asr.default"
SOURCE_EMBEDDING_DEFAULT = "embedding.default"
SOURCE_NETWORK_PROXY = "network.proxy"

# ===== 分组标识 =====

GROUP_WEB_SEARCH = "web_search"
GROUP_LLM = "llm"
GROUP_ASR = "asr"
GROUP_EMBEDDING = "embedding"
GROUP_SESSION = "session"
GROUP_NETWORK = "network"

GROUP_LABELS: dict[str, str] = {
    GROUP_WEB_SEARCH: "联网搜索与抓取",
    GROUP_LLM: "大模型",
    GROUP_ASR: "语音转写",
    GROUP_EMBEDDING: "语义检索",
    GROUP_SESSION: "仅本次会话",
    GROUP_NETWORK: "网络代理",
}

# ===== 功能域与功能（依赖矩阵的行，见 #9）=====

FEATURE_GROUP_CONTENT = "content"
FEATURE_GROUP_WEB = "web"
FEATURE_GROUP_INPUT = "input"
FEATURE_GROUP_SYSTEM = "system"

FEATURE_GROUP_LABELS: dict[str, str] = {
    FEATURE_GROUP_CONTENT: "内容生成",
    FEATURE_GROUP_WEB: "联网与抓取",
    FEATURE_GROUP_INPUT: "输入与检索",
    FEATURE_GROUP_SYSTEM: "系统",
}

#: 会拿密钥去发请求的功能。**声明顺序 = 矩阵行顺序**（不按字母排：每加一个功能就重排，
#: 用户记住的位置会变）。`used_by` 引用这里的 `feature_id`。
FEATURES: tuple[CredentialFeature, ...] = (
    CredentialFeature(
        feature_id="resume_generation",
        label="简历生成",
        group=FEATURE_GROUP_CONTENT,
    ),
    CredentialFeature(
        feature_id="assistant",
        label="求职助手",
        group=FEATURE_GROUP_CONTENT,
    ),
    CredentialFeature(
        feature_id="company_research",
        label="公司调研",
        group=FEATURE_GROUP_CONTENT,
    ),
    CredentialFeature(
        feature_id="structured_extraction",
        label="结构化抽取",
        group=FEATURE_GROUP_CONTENT,
    ),
    CredentialFeature(
        feature_id="web_search",
        label="联网搜索",
        group=FEATURE_GROUP_WEB,
    ),
    CredentialFeature(
        feature_id="web_fetch",
        label="网页正文抓取",
        group=FEATURE_GROUP_WEB,
    ),
    CredentialFeature(
        feature_id="ocr",
        label="扫描件 OCR",
        group=FEATURE_GROUP_WEB,
    ),
    CredentialFeature(
        feature_id="asr_transcribe",
        label="语音转写",
        group=FEATURE_GROUP_INPUT,
    ),
    CredentialFeature(
        feature_id="semantic_search",
        label="语义检索",
        group=FEATURE_GROUP_INPUT,
    ),
    # 只经过代理口令、不依赖任何一把 Key：矩阵里不画行（不摆一排空格子），
    # 由前端在闸门带下面合成一句说明。它仍然声明在这里，因为"更新检查"确实要出网。
    CredentialFeature(
        feature_id="update_check",
        label="更新检查",
        group=FEATURE_GROUP_SYSTEM,
    ),
)

#: 大模型相关的四个功能（`llm.default` 与 `llm.session` 都服务这四个）。
_LLM_FEATURES: tuple[str, ...] = (
    "resume_generation",
    "assistant",
    "company_research",
    "structured_extraction",
)

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
        configure_at="设置 → 联网搜索 → DeepSeek",
        used_by=("web_search", "web_fetch", "ocr"),
        section="assistant-behavior",
        anchor="conn-search-deepseek",
        empty_meaning="留空并保存 = 移除这把 Key（三把搜索 Key 都是这个口径）",
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
        configure_at="设置 → 联网搜索 → Tavily",
        used_by=("web_search",),
        section="assistant-behavior",
        anchor="conn-search-tavily",
        empty_meaning="留空并保存 = 移除这把 Key",
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
        configure_at="设置 → 联网搜索 → Jina",
        used_by=("web_fetch",),
        section="assistant-behavior",
        anchor="conn-search-jina",
        empty_meaning="留空并保存 = 移除这把 Key",
        note="数据集 AppSetting 的 search_jina_api_key 行是升级前的旧形态，仍需剥离。",
    ),
    CredentialSource(
        source_id=SOURCE_LLM_DEFAULT,
        group=GROUP_LLM,
        label="大模型 API Key",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → llm.profiles[].config.api_key，或 AppSetting llm_config",
        multi_profile=True,
        supports_clear_sentinel=True,
        configure_at="设置 → AI 模型 → 模型配置（每条记录各有一把 Key）",
        used_by=_LLM_FEATURES,
        section="model",
        anchor="conn-llm-api-key",
        empty_meaning="留空 = 保留原 Key；要清除请点「清除」（发 __clear__ 哨兵）",
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
        label="临时 Key（仅本次运行有效）",
        scope=CredentialScope.MEMORY,
        location="后端进程内存（api_key_session），不落盘、不进备份",
        configure_at="设置 → AI 模型 → 仅本次会话使用",
        used_by=_LLM_FEATURES,
        section="model",
        anchor="conn-llm-session-key",
        # 覆盖式：它优先于已保存的那把，所以矩阵里画空心环而不是实心点。
        edge_kind="override",
        empty_meaning="清空 = 立刻回到已保存的那把 Key",
        note=(
            "RF-24 的纯内存通道：进程重启即失效。它存在时生效值以它为准；"
            "保存链路（_strip_session_key）落库时写回**原记录里已有的那把**，"
            "所以临时 Key 生效期间改温度再保存不会清掉已保存的 Key（R15）。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_ASR_DEFAULT,
        group=GROUP_ASR,
        label="语音转写 API Key",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → asr_profiles.profiles[].api_key",
        multi_profile=True,
        supports_clear_sentinel=True,
        app_setting_key_prefixes=("asr_api_key",),
        configure_at="设置 → 语音与面试 → 语音转写（每条配置各有一把 Key）",
        used_by=("asr_transcribe",),
        section="voice",
        anchor="conn-asr-api-key",
        empty_meaning="留空 = 沿用这一条自己的旧 Key；地址或协议一变就清空",
        note=(
            "旧形态是数据集 AppSetting 的 asr_api_key 行（迁移前兼容路径仍会读它），"
            "前缀匹配同时覆盖未来的 asr_api_key:xxx 多条形态。"
            "Key 的写入口径按条判断：地址或协议变了就清空，绝不跨条继承。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_EMBEDDING_DEFAULT,
        group=GROUP_EMBEDDING,
        label="语义检索 API Key",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → embedding_profiles.profiles[].config.api_key",
        display=KeyDisplay.BOOLEAN,
        multi_profile=True,
        supports_clear_sentinel=True,
        configure_at="设置 → AI 模型 → 语义检索（每条配置各有一把 Key）",
        used_by=("semantic_search",),
        section="model",
        anchor="conn-embedding-api-key",
        empty_meaning="留空 = 沿用这一条自己的旧 Key；要清除请用配置卡上的「清除 Key」",
        note=(
            "配置卡只给 key_configured 布尔，连掩码都不回；本地模型配置没有 Key。"
            "密钥在 global_settings.json 里，不在数据库中，因此不进 LIKE 白名单。"
        ),
    ),
    CredentialSource(
        source_id=SOURCE_NETWORK_PROXY,
        group=GROUP_NETWORK,
        label="代理认证口令",
        scope=CredentialScope.GLOBAL_FILE,
        location="global_settings.json → network.proxy_password",
        storage_field="proxy_password",
        supports_clear_sentinel=True,
        configure_at="设置 → 网络代理（模式与地址）＋ 外部连接（只改口令）",
        # 闸门：所有出网请求都过它，它不属于某个功能，因此不在矩阵里占一列。
        used_by=("resume_generation", "web_search", "web_fetch", "update_check"),
        section="connections",
        anchor="conn-network-proxy",
        is_gate=True,
        empty_meaning="留空 = 保留原口令；要清除请点「清除」（发 __clear__ 哨兵）",
        note=(
            "写入口唯一：PUT /api/settings/network（本页只做就地改口令，模式与地址仍在"
            "「网络代理」卡片里改）。口令只存密文；清除用 __clear__ 哨兵，空串=保留。"
            "它随 global_services.json 进备份，include_api_keys=false 时被剥离。"
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


def feature_by_id(feature_id: str) -> CredentialFeature:
    """按 id 取功能声明；未知 id 抛 :class:`KeyError`（与 :func:`get_source` 同一口径）。"""
    for feature in FEATURES:
        if feature.feature_id == feature_id:
            return feature
    known = "、".join(feature.feature_id for feature in FEATURES)
    raise KeyError(f"未登记的功能：{feature_id}（已登记：{known}）")


def validate_matrix_references(
    sources: tuple[CredentialSource, ...] = CREDENTIAL_SOURCES,
    features: tuple[CredentialFeature, ...] = FEATURES,
) -> None:
    """校验依赖矩阵的**引用完整性**，不通过就抛 :class:`RuntimeError`。

    为什么要在启动时就报错（#9）：`used_by` 里写了一个不存在的 feature id 时，表格时代
    只是少一格文字，没人注意；矩阵时代的表现是"某功能从矩阵里整行消失"——而用户看到的
    只是"这里少了一行"，既不会报错也不会怀疑。所以宁可起不来。

    校验项：``used_by`` 非空且都能解析、``used_by`` 不重复、``feature.group`` 是已知域、
    ``feature_id`` 不重复、``section`` / ``anchor`` 都声明了、``edge_kind`` 只有两种取值、
    闸门最多一条。**不校验** anchor 对应的 DOM 是否存在（那是前端的事，且锚点可能因
    条件渲染而缺席——那种情况有"滚到分组顶部 + 一行提示"的兜底）。
    """
    problems: list[str] = []
    known_groups = set(FEATURE_GROUP_LABELS)
    known_features: set[str] = set()
    for feature in features:
        if not feature.feature_id:
            problems.append("存在空的 feature_id")
        if feature.feature_id in known_features:
            problems.append(f"feature_id 重复：{feature.feature_id}")
        known_features.add(feature.feature_id)
        if feature.group not in known_groups:
            problems.append(f"{feature.feature_id} 的分组未登记：{feature.group}")
        if not feature.label:
            problems.append(f"{feature.feature_id} 没有 label")

    gates = 0
    for source in sources:
        if source.is_gate:
            gates += 1
        if not source.used_by:
            problems.append(f"{source.source_id} 没有声明 used_by")
        if len(set(source.used_by)) != len(source.used_by):
            problems.append(f"{source.source_id} 的 used_by 有重复项")
        for feature_id in source.used_by:
            if feature_id not in known_features:
                problems.append(f"{source.source_id}.used_by 引用了未登记的功能：{feature_id}")
        if not source.section or not source.anchor:
            problems.append(f"{source.source_id} 缺少「去配置」落点（section/anchor）")
        if source.edge_kind not in ("direct", "override"):
            problems.append(f"{source.source_id} 的 edge_kind 非法：{source.edge_kind}")
    if gates > 1:
        problems.append(f"闸门型凭据只能有一条，实际 {gates} 条")

    if problems:
        raise RuntimeError("凭据 registry 的依赖矩阵声明不一致：" + "；".join(problems))


# 启动即校验（模块 import 时）：宁可起不来，也不要让"某功能从矩阵里静默消失"。
validate_matrix_references()


__all__ = [
    "CREDENTIAL_SOURCES",
    "FEATURES",
    "FEATURE_GROUP_CONTENT",
    "FEATURE_GROUP_INPUT",
    "FEATURE_GROUP_LABELS",
    "FEATURE_GROUP_SYSTEM",
    "FEATURE_GROUP_WEB",
    "GROUP_ASR",
    "GROUP_EMBEDDING",
    "GROUP_LABELS",
    "GROUP_LLM",
    "GROUP_NETWORK",
    "GROUP_SESSION",
    "GROUP_WEB_SEARCH",
    "SOURCE_ASR_DEFAULT",
    "SOURCE_EMBEDDING_DEFAULT",
    "SOURCE_LLM_DEFAULT",
    "SOURCE_LLM_SESSION",
    "SOURCE_NETWORK_PROXY",
    "SOURCE_WEB_SEARCH_DEEPSEEK",
    "SOURCE_WEB_SEARCH_JINA",
    "SOURCE_WEB_SEARCH_TAVILY",
    "feature_by_id",
    "get_source",
    "groups",
    "has_source",
    "persistent_sources",
    "source_ids",
    "sources_of_group",
    "validate_matrix_references",
]
