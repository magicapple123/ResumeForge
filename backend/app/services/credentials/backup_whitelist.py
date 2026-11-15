# SPDX-License-Identifier: Apache-2.0
"""备份剥离白名单：**从 registry 派生**，不再手写第二份 LIKE 串（Q17）。

改造前 ``data_backup/api_keys.py`` 里是一段手写的

    "key LIKE 'asr_api_key%' OR key LIKE 'search_deepseek_api_key%' OR …"

同一份文件里的注释自己写着"新增来源的 Key 忘了登记，它就会以明文留在包里"——
一份靠记忆维护的安全清单，等于一份迟早会漏的安全清单。

现在唯一的输入是 :attr:`registry.CREDENTIAL_SOURCES` 里每个来源的
``app_setting_key_prefixes``：登记过凭据的来源自动进白名单，新增来源不需要再记得来这里
改一次。派生结果与手写版**逐条等价**（原有四条前缀全部保留），由
``tests/test_credentials_registry.py`` 的正反两向用例钉住：

- 正向：registry 里声明的每个前缀都出现在 WHERE 串里；
- 反向：往清单里塞一个假来源，派生结果立刻包含它的前缀，且备份层真的会剥掉那一行。

前缀匹配（而不是等值）是既有语义，保留原因写在原处：将来的多条语音配置
（``asr_api_key:xxx``）也落在同一道闸门里。``key`` 与 ``value`` 是 ``app_setting``
表里唯一可能藏裸密钥的两列中的一列，这里只拼 ``key LIKE`` 条件，不碰值。
"""

from __future__ import annotations

from . import registry

# SQL 里不许出现裸引号：前缀是代码常量，出现引号只可能是写错了（或有人在拼注入）。
_FORBIDDEN_PREFIX_CHARS = ("'", "%", '"')


def secret_app_setting_prefixes() -> tuple[str, ...]:
    """所有把密钥以**独立 AppSetting 行**存放的来源键前缀（声明顺序、去重）。

    密钥藏在 JSON 块里的来源（``llm_config`` 的 ``api_key`` 字段、
    ``global_settings.json`` 里的 ``web_search`` / ``*_profiles``）前缀留空：
    按 LIKE 删整行会把非密钥字段一起删掉，它们走各自的剥离路径。
    """
    collected: list[str] = []
    for source in registry.CREDENTIAL_SOURCES:
        for prefix in source.app_setting_key_prefixes:
            if any(char in prefix for char in _FORBIDDEN_PREFIX_CHARS):
                raise ValueError(f"凭据来源 {source.source_id} 的键前缀含非法字符：{prefix!r}")
            if prefix not in collected:
                collected.append(prefix)
    return tuple(collected)


def secret_app_setting_where(prefixes: tuple[str, ...] | None = None) -> str:
    """拼出 ``app_setting`` 的 WHERE 片段（不含 ``WHERE`` 关键字）。

    Args:
        prefixes: 显式覆盖前缀列表（测试与迁移脚本用）；``None`` 时从 registry 派生。

    Returns:
        ``key LIKE 'a%' OR key LIKE 'b%'``；一条都没有时返回 ``1 = 0``——
        **恒假**而不是空串，空串拼进 SQL 会变成语法错，而"匹配不到任何行"才是正确语义。
    """
    items = secret_app_setting_prefixes() if prefixes is None else tuple(prefixes)
    if not items:
        return "1 = 0"
    return " OR ".join(f"key LIKE '{prefix}%'" for prefix in items)


def protected_source_ids() -> tuple[str, ...]:
    """会进备份剥离白名单的来源 id（即声明了 AppSetting 键前缀的那些）。"""
    return tuple(
        source.source_id
        for source in registry.CREDENTIAL_SOURCES
        if source.app_setting_key_prefixes
    )


__all__ = [
    "protected_source_ids",
    "secret_app_setting_prefixes",
    "secret_app_setting_where",
]
