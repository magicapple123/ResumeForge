# SPDX-License-Identifier: Apache-2.0
"""I-10 默认值注册表的**常量与类型**（从 ``settings_defaults`` 拆出）。

为什么拆：注册表本体的数据表就占了 190 行，加上类型与执行层会顶过单文件 500 行的硬预算。
拆法是"按变化频率"——类型/常量几乎不变（这里），登记表按版本增删（``settings_registry_data``），
执行层（读库、写库、快照）留在 ``settings_defaults`` 并原样再导出本文件的符号，
因此**调用方的 import 路径不用改**。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Literal

#: 存储编码：``json`` 走 ``json.dumps/loads``；``text`` 原样存字符串（路径与 URL 里
#: 什么字符都可能有，套一层 JSON 只会多一种坏法）。
Storage = Literal["json", "text"]
#: ``value`` = 整个键就是一个值；``fields`` = 一个 JSON 对象里只重置部分字段。
Kind = Literal["value", "fields"]

#: 出现这些片段的键**永远不可重置**（导入期硬校验，见 :func:`_freeze`）。
SECRET_KEY_MARKERS: tuple[str, ...] = (
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "cookie",
    "credential",
)

#: 快照 ``global`` 段收录的联网搜索公开字段（密钥列一律不在其中）。
WEB_SEARCH_PUBLIC_FIELDS: tuple[str, ...] = (
    "sources",
    "searxng_url",
    "depth",
    "max_results",
)
#: 名字里带 token 但**不是凭据**的字段（是预算/上限）。密钥扫描先放行这几个，
#: 否则 ``max_tokens`` 会被当成密钥键，快照导出直接 500。
SAFE_FIELD_NAMES: frozenset[str] = frozenset(
    {"max_tokens", "min_tokens", "context_window_tokens", "thinking_budget"}
)
_THEME_MODES = ("light", "dark", "system")


class _Missing:
    """哨兵：行不存在 / 值不可解析。与 ``None`` 区分（``None`` 是合法值）。"""

    def __repr__(self) -> str:  # pragma: no cover - 只为调试时好看
        return "<missing>"


MISSING = _Missing()


class SettingsSnapshotError(ValueError):
    """快照不合法（版本过新 / 键不在白名单 / 类型不对）。**抛出时一定还没有写库**。"""


@dataclass(frozen=True)
class SettingDefault:
    """一个可重置设置项的登记项。

    Attributes:
        key: ``AppSetting.key``（不是字段名——那张表是 KV）。
        scope: 卡片/分组名，前端「卡片级恢复默认」按它取键。
        default: 出厂值；``kind="fields"`` 时是「字段名 → 出厂值」的字典；
            也可以是**无参可调用**（延迟求值），用于跟随部署配置的默认值。
        storage: 存储编码，见 :data:`Storage`。
        kind: 整值重置 还是 只重置部分字段。
        resettable: 是否允许重置。密钥类必须为 ``False``。
        note: 给维护者看的说明（为什么这个默认值是它）。
    """

    key: str
    scope: str
    default: Any
    storage: Storage = "json"
    kind: Kind = "value"
    resettable: bool = True
    note: str = ""

    def resolved_default(self) -> Any:
        """出厂值。"""
        value = self.default() if callable(self.default) else self.default
        return copy.deepcopy(value)

    @property
    def secret(self) -> bool:
        return is_secret_key(self.key)


def is_secret_key(key: str) -> bool:
    """键名是否属于「里面装密钥」的那一类（只看名字，不看值）。

    ``SAFE_FIELD_NAMES`` 里的名字先放行：``max_tokens`` / ``context_window_tokens``
    是**预算**不是凭据，把它们算成密钥会让快照导出永远失败。
    """
    lowered = (key or "").lower()
    if lowered in SAFE_FIELD_NAMES:
        return False
    return any(marker in lowered for marker in SECRET_KEY_MARKERS)


# ===== 注册表 =====
# 顺序 = 设置页里的阅读顺序（模型 → 语音 → 助手 → 网申 → 界面 → 投递台 → 跟踪 → 备份）。
# 每加一个可重置键，必须在 tests/test_settings_defaults.py 的 ``_READERS`` 里登记它的
# 真实读取口——守卫会逐键遍历，没登记就红。
