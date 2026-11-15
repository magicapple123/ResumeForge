# SPDX-License-Identifier: Apache-2.0
"""外部凭据的**词表**：状态枚举、存储保护方式、来源声明与状态快照。

这一层只放枚举与不可变数据类，**不含任何 IO、不含任何业务判断**。依赖方向是单向的：

    types  ←  registry  ←  semantics / state / backup_whitelist

反向依赖一条都不许有（`registry` 不 import 任何业务模块、`semantics` 只 import
`llm_key_refs` 与 `api_key_crypto`），否则 `data_backup.api_keys` 一 import 白名单就会
把设置服务、全局配置文件、SQLAlchemy 会话全都拽进来，形成循环。

为什么要把"状态"和"存储方式"分成两个维度：用户的疑问其实是两句不同的话——
"这把 Key 现在有效吗"（状态）与"它存在哪、有没有被加密"（存储方式）。
把它们塞进一个枚举就会出现"已保存（明文）"这种既不是状态也不是方式的混合值。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class CredentialStatus(StrEnum):
    """凭据**当前生效值**的三种状态（对外展示口径，前端「外部连接」页直接用）。

    - :attr:`SAVED`：有一个已落盘（或已写进全局配置文件）的密钥；
    - :attr:`NOT_CONFIGURED`：哪里都没有，相关能力不可用；
    - :attr:`SESSION_ONLY`：只在后端进程内存里（``api_key_session``），重启即失效。

    刻意**没有** "掩码" 这个状态：掩码是展示形态（见 :class:`KeyDisplay`），
    不是存储事实。把两者混起来，前端就分不清"这把 Key 只是没回显"还是"根本没配"。
    """

    SAVED = "saved"
    NOT_CONFIGURED = "not_configured"
    SESSION_ONLY = "session_only"


# 中文显示名。**只在这里写一份**：前端 T11 直接消费，页面里不要再建第二份映射，
# 否则后端加了第四种状态时页面会静默回落成空白标签。
STATUS_LABELS: dict[str, str] = {
    CredentialStatus.SAVED.value: "已保存",
    CredentialStatus.NOT_CONFIGURED.value: "未配置",
    CredentialStatus.SESSION_ONLY.value: "仅本次会话",
}


def status_label(status: CredentialStatus | str) -> str:
    """状态 → 中文显示名；接受枚举或它的字面量。"""
    return STATUS_LABELS[CredentialStatus(status).value]


class CredentialScope(StrEnum):
    """密钥的**落点**（决定谁负责备份剥离、谁负责重启后还在）。"""

    GLOBAL_FILE = "global_file"
    DATABASE = "database"
    MEMORY = "memory"


class ProtectionKind(StrEnum):
    """落盘保护方式（机器可读值）。"""

    DPAPI = "dpapi"
    PLAINTEXT = "plaintext"
    MEMORY_ONLY = "memory_only"


@dataclass(frozen=True)
class StorageProtection:
    """一种存储保护方式：机器可读值 + 一句中文说明。

    ``value`` 供前端判分支（决定是否要提示"明文落盘"），``description`` 供直接显示
    ——口径来自 ``services/api_key_crypto.py`` 的设计注释，不要在页面里另写一份。
    """

    kind: ProtectionKind
    description: str

    @property
    def value(self) -> str:
        """机器可读值：``dpapi`` / ``plaintext`` / ``memory_only``。"""
        return self.kind.value


class KeyDisplay(StrEnum):
    """密钥对外的展示形态。

    - :attr:`MASK`：可以回一个掩码占位符（``********``），写入时按掩码语义还原；
    - :attr:`BOOLEAN`：连掩码都不给，只说"有没有"（语义检索配置卡的既有口径，
      ``key_configured`` 布尔；它的 Key 从不以任何形态进响应）。
    """

    MASK = "mask"
    BOOLEAN = "boolean"


@dataclass(frozen=True)
class CredentialSource:
    """一份外部凭据的**声明**：在哪、怎么显示、备份要不要剥。

    这是 registry 的唯一元素类型。它刻意**不持有读写函数**：声明与 IO 混在一起，
    备份白名单的派生就得 import 一整套业务模块（见模块头的依赖方向说明）。
    读取实现按 ``source_id`` 在 ``state.py`` 里查表。
    """

    source_id: str
    """稳定标识，形如 ``<分组>.<角色>``；前端与测试都按它引用，不要按 label 匹配。"""

    group: str
    """所属能力分组（``web_search`` / ``llm`` / ``asr`` / ``embedding`` / ``session``）。"""

    label: str
    """中文显示名（设置页/外部连接页用；前端仍应经 i18n 包一层再做多语言）。"""

    scope: CredentialScope
    location: str
    """人类可读的存放位置，用于排障提示（形如 ``global_settings.json → web_search.x``）。"""

    display: KeyDisplay = KeyDisplay.MASK
    storage_field: str = ""
    """在同一份配置块里的字段名（只有同块多密钥的来源才需要，例如联网搜索三把 Key）。"""

    multi_profile: bool = False
    """是否随"命名配置"存在多份（语音 / 语义检索 / 大模型配置文件）。"""

    supports_clear_sentinel: bool = False
    """写入口径里是否接受 ``__clear__`` 哨兵（与"空串=清除"的来源区分开）。"""

    app_setting_key_prefixes: tuple[str, ...] = ()
    """以**独立 AppSetting 行**存放密钥时的键前缀。

    备份剥离白名单只从这里派生（``backup_whitelist.secret_app_setting_where``）。
    密钥藏在 JSON 块里（``llm_config`` / ``global_settings.json``）的来源**必须留空**：
    按 LIKE 删整行会把非密钥字段一起删掉，那是另一条剥离路径的事。
    """

    note: str = ""
    """补充说明（兼容路径、已知缺口），只给人看。"""

    @property
    def persistent(self) -> bool:
        """是否会活过进程重启。"""
        return self.scope is not CredentialScope.MEMORY


@dataclass(frozen=True)
class CredentialState:
    """一份凭据的**对外快照**：状态 + 掩码 + 存储方式。真实密钥不在这里。

    ``read_credential`` 才返回真实值，且明确只允许后端运行时使用。
    """

    source_id: str
    status: CredentialStatus
    masked: str
    key_configured: bool
    protection: StorageProtection
    detail: str = ""

    @property
    def status_label(self) -> str:
        """中文状态名（``已保存`` / ``未配置`` / ``仅本次会话``）。"""
        return status_label(self.status)

    @property
    def protection_value(self) -> str:
        """存储保护机器可读值（``dpapi`` / ``plaintext`` / ``memory_only``）。"""
        return self.protection.value


__all__ = [
    "STATUS_LABELS",
    "CredentialScope",
    "CredentialSource",
    "CredentialState",
    "CredentialStatus",
    "KeyDisplay",
    "ProtectionKind",
    "StorageProtection",
    "status_label",
]
