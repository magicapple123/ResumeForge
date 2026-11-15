# SPDX-License-Identifier: Apache-2.0
"""读真实值、算状态、标注存储保护方式。

三件事分开，因为它们的可信边界完全不同：

1. :func:`read_credential` —— 返回**真实密钥**，只允许后端运行时使用
   （``asr_client`` / ``aggregate_search`` / 模型调用）。**任何回前端的路径都不许调它**；
2. :func:`credential_state` —— 对外快照：状态 + 掩码 + 存储方式，不含真实值；
3. :func:`storage_protection` —— 这把 Key 在本机**是怎么存的**（DPAPI / 明文 / 仅内存）。

存储保护方式的唯一真相是 :mod:`app.services.api_key_crypto`：``encrypt_key()`` 只在
``sys.platform == "win32"`` 上做 DPAPI，其它平台按设计原样返回明文（RF-24 的评估结论）。
所以"密钥已加密"不是一个跨平台恒真的说法（Q19），本模块把它如实标出来，供「外部连接」页
在 macOS / Linux 上显示"明文落盘"而不是继续沿用"已加密"的口径。

**依赖全部延迟到函数内**：``state`` 会 import 设置服务、全局配置文件与 SQLAlchemy 会话，
而 ``data_backup.api_keys`` 只需要白名单（``backup_whitelist``）。模块级 import 会让
"导出一次备份"顺带把整套设置服务拉起来，也是循环 import 的高发点。
"""

from __future__ import annotations

import sys
from collections.abc import Callable

from sqlalchemy.orm import Session

from .registry import (
    CREDENTIAL_SOURCES,
    SOURCE_ASR_DEFAULT,
    SOURCE_EMBEDDING_DEFAULT,
    SOURCE_LLM_DEFAULT,
    SOURCE_LLM_SESSION,
    SOURCE_WEB_SEARCH_DEEPSEEK,
    SOURCE_WEB_SEARCH_JINA,
    SOURCE_WEB_SEARCH_TAVILY,
    CredentialSource,
    get_source,
)
from .semantics import mask_value
from .types import (
    CredentialScope,
    CredentialState,
    CredentialStatus,
    KeyDisplay,
    ProtectionKind,
    StorageProtection,
)

# 会做 DPAPI 加密的平台。与 ``api_key_crypto.encrypt_key`` 里的判断**必须一致**：
# 那里是 `sys.platform != "win32"` 就返回明文，判据只有一处实现，这里只是把它命名出来。
ENCRYPTING_PLATFORMS = frozenset({"win32"})

_DPAPI_PROTECTION = StorageProtection(
    kind=ProtectionKind.DPAPI,
    description="密钥由 Windows DPAPI 加密后落盘，只有当前系统用户能在这台机器上解密。",
)
_PLAINTEXT_PROTECTION = StorageProtection(
    kind=ProtectionKind.PLAINTEXT,
    description="当前系统没有可用的加密后端，密钥以明文落盘；导出备份时会自动剥离。",
)
_MEMORY_PROTECTION = StorageProtection(
    kind=ProtectionKind.MEMORY_ONLY,
    description="只存在于后端进程内存里，进程重启即失效，不落盘、不进备份。",
)


# ===== 存储保护方式 =====


def disk_protection(platform: str | None = None) -> StorageProtection:
    """落盘密钥在本平台上的保护方式（``platform`` 缺省取真实平台）。

    Args:
        platform: ``sys.platform`` 风格的值（``"win32"`` / ``"linux"`` / ``"darwin"``）；
            显式传入可以验另一条分支，不需要真的装在那个系统上。
    """
    current = sys.platform if platform is None else platform
    return _DPAPI_PROTECTION if current in ENCRYPTING_PLATFORMS else _PLAINTEXT_PROTECTION


def storage_protection(
    source: CredentialSource | str | None = None, *, platform: str | None = None
) -> StorageProtection:
    """某个来源（或整台机器）的存储保护方式。

    纯内存来源永远是 ``memory_only``——它连落盘都没有，"明文还是密文"这个问法对它
    不成立。传 ``None`` 时返回**落盘密钥**的保护方式（「外部连接」页的全局说明用它）。
    """
    if source is not None:
        resolved = get_source(source) if isinstance(source, str) else source
        if resolved.scope is CredentialScope.MEMORY:
            return _MEMORY_PROTECTION
    return disk_protection(platform)


# ===== 真实值读取（仅后端运行时）=====


def _require_db(db: Session | None, what: str) -> Session:
    if db is None:
        raise ValueError(f"读取{what}的凭据需要数据库会话（db=None 只适用于纯内存来源）")
    return db


def _search_key(db: Session | None, field: str) -> str:
    """联网搜索三把 Key 之一（走既有的全局块 + 一次性迁移解析顺序）。"""
    db = _require_db(db, "联网搜索")
    from ..web_search_settings import get_search_config_with_secrets

    return str(getattr(get_search_config_with_secrets(db), field) or "")


def _llm_key(db: Session | None) -> str:
    """大模型**实际生效**的 Key（全局优先、会话密钥覆盖，解析顺序原样复用）。"""
    db = _require_db(db, "大模型")
    from ..settings_service import get_llm_config

    return str(get_llm_config(db).api_key or "")


def _asr_key(db: Session | None) -> str:
    """语音转写生效配置的 Key（profiles 优先、迁移前回退旧行）。"""
    db = _require_db(db, "语音转写")
    from ..asr_settings import resolve_asr_api_key

    return str(resolve_asr_api_key(db) or "")


def _embedding_key(_db: Session | None) -> str:
    """语义检索生效配置的 Key；没有生效项或配置已被删时返回空串。"""
    from ..llm.embedding_profiles import ProfileNotFoundError, active_meta, profile_key

    profile_id = str(active_meta().get("active_profile_id") or "")
    if not profile_id:
        return ""
    try:
        return str(profile_key(profile_id) or "")
    except ProfileNotFoundError:
        return ""


def _session_key(_db: Session | None) -> str:
    """纯内存会话密钥（``db`` 参数只为与其它读取实现同形）。"""
    from ..api_key_session import get_session_key

    return str(get_session_key() or "")


_READERS: dict[str, Callable[[Session | None], str]] = {
    SOURCE_WEB_SEARCH_DEEPSEEK: lambda db: _search_key(db, "deepseek_api_key"),
    SOURCE_WEB_SEARCH_TAVILY: lambda db: _search_key(db, "tavily_api_key"),
    SOURCE_WEB_SEARCH_JINA: lambda db: _search_key(db, "jina_api_key"),
    SOURCE_LLM_DEFAULT: _llm_key,
    SOURCE_LLM_SESSION: _session_key,
    SOURCE_ASR_DEFAULT: _asr_key,
    SOURCE_EMBEDDING_DEFAULT: _embedding_key,
}


def read_credential(source_id: str, *, db: Session | None = None) -> str:
    """取**真实密钥**（未配置返回空串）。

    **仅供后端运行时使用**：日志、诊断、HTTP 响应、导出文件都不许出现这个返回值。
    对外展示一律走 :func:`credential_state`（掩码）或 :func:`mask_value`。
    """
    get_source(source_id)  # 未登记的 id 立刻抛错，而不是安静返回空串
    reader = _READERS.get(source_id)
    if reader is None:  # pragma: no cover - 新增来源忘了登记读取实现时才会走到
        raise KeyError(f"凭据来源缺少读取实现：{source_id}")
    return reader(db)


# ===== 对外状态快照 =====


def _session_configured() -> bool:
    from ..api_key_session import session_key_configured

    return session_key_configured()


def _status_of(source: CredentialSource, real: str) -> tuple[CredentialStatus, str]:
    """状态 + 一句话说明。``real`` 是该来源**当前生效**的真实密钥。"""
    if source.scope is CredentialScope.MEMORY:
        if real:
            return CredentialStatus.SESSION_ONLY, "只在本次会话有效，关闭程序后需要重新填写"
        return CredentialStatus.NOT_CONFIGURED, "尚未填入仅本次会话使用的密钥"
    if not real:
        return CredentialStatus.NOT_CONFIGURED, "还没有配置，相关功能不可用"
    if source.source_id == SOURCE_LLM_DEFAULT and _session_configured():
        # 会话密钥会覆盖已保存的那一把（get_llm_config 的既有行为）：生效的其实是
        # 内存里这一份，如实说"仅本次会话"，不要谎报"已保存"。
        return CredentialStatus.SESSION_ONLY, "本次会话的临时密钥覆盖了已保存的那一把"
    return CredentialStatus.SAVED, "已保存到本机，重启后仍然可用"


def credential_state(source_id: str, *, db: Session | None = None) -> CredentialState:
    """一份凭据的对外快照：状态、掩码、有没有 Key、存储保护方式、说明。

    ``masked`` 的口径由来源声明的 :class:`KeyDisplay` 决定：``BOOLEAN`` 的来源
    （语义检索）**连掩码都不给**，只靠 ``key_configured`` 回答"有没有"。
    """
    source = get_source(source_id)
    real = read_credential(source_id, db=db)
    status, detail = _status_of(source, real)
    configured = bool(real)
    masked = ""
    if configured and source.display is KeyDisplay.MASK:
        masked = mask_value(real)
    return CredentialState(
        source_id=source.source_id,
        status=status,
        masked=masked,
        key_configured=configured,
        protection=storage_protection(source),
        detail=detail,
    )


def credential_states(*, db: Session | None = None) -> tuple[CredentialState, ...]:
    """全部来源的快照（声明顺序），供「外部连接」页一次取齐。

    单条来源读失败不该让整页 500：``db`` 缺失时持久化来源统一按"未配置"呈现，
    并把说明改成"需要数据库会话"，而不是抛异常。
    """
    snapshots: list[CredentialState] = []
    for source in CREDENTIAL_SOURCES:
        try:
            snapshots.append(credential_state(source.source_id, db=db))
        except ValueError:
            snapshots.append(
                CredentialState(
                    source_id=source.source_id,
                    status=CredentialStatus.NOT_CONFIGURED,
                    masked="",
                    key_configured=False,
                    protection=storage_protection(source),
                    detail="本次读取没有数据库会话，无法判断这条凭据的状态",
                )
            )
    return tuple(snapshots)


__all__ = [
    "ENCRYPTING_PLATFORMS",
    "credential_state",
    "credential_states",
    "disk_protection",
    "read_credential",
    "storage_protection",
]
