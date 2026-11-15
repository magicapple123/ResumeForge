# SPDX-License-Identifier: Apache-2.0
"""「外部连接」C 组：四项系统级来源的**可编辑覆盖**（不新增数据库迁移）。

这四项在改造前是写死在代码里的常量或 `.env` 里的字符串，界面上既看不到也改不了
（结论 #8：「C 组做成可编辑」）。它们**不是密钥**，所以既不进「剥离密钥」白名单，
也不能只留在代码里——用户换镜像、换自托管发行源、端口冲突时需要一个入口。

## 存放位置

`data/global_settings.json` 的顶层块 ``system_sources``（与 ``web_search`` / ``ocr`` 平级）：

```json
"system_sources": {
  "update_repo": "magicapple123/ResumeForge",
  "font_base_url": "https://mirrors.example.com/source-han-sans/",
  "rag_asset_base_url": "https://example.com/rag-assets-v1",
  "browser_port": "9400"
}
```

块里**只存用户改过的值**；没有键 = 用代码里的出厂默认。这样"恢复默认"就是删键，
读侧永远只是一次 ``dict.get``，不会出现"存着默认值"和"没存"两种等价状态。

为什么不用 AppSetting：这四项描述的是"这台机器怎么下载、怎么连浏览器"，与当前打开
哪份数据集无关。AppSetting 是数据集库内的行，切数据集就换一套值——`web_search` 已经
在这个坑里待过一轮（见 `services/web_search_settings` 的模块注释）。

为什么不需要迁移：`global_settings.json` 是 2.0 的既有文件，新增顶层键**不动**
`GLOBAL_SETTINGS_VERSION`（`load_state` 在版本不等于 2 时整体返回 None，升版本会让
主题与大模型配置一起读丢，理由同 `web_search_settings`）。

## 备份

这四项随备份包 `global_llm.json` 的 ``system_sources`` 字段走（见
`services/data_backup/global_config.py`）：导出时按**当前生效值**写，导入时逐项校验后
写回本机。不是密钥，所以 `include_api_keys` 的开关**不影响**它们。

## 依赖方向

本模块只 import `config` 与 `global_settings`，**不 import** 任何消费者（`update_check` /
`resume_font_builtin` / `rag_model_download` / `apply`）。四个消费者的默认值在
:func:`_defaults` 里**延迟 import**：这既避免了循环依赖，也让"默认值只有一份"成立——
默认值仍然写在各自的业务模块里，本模块不复制第二份。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from . import global_settings

logger = logging.getLogger(__name__)

# global_settings.json 里的顶层块名。与 `web_search` / `ocr` 平级。
SYSTEM_SOURCES_BLOCK = "system_sources"

# 四项的稳定 id（前端与测试都按它引用，**不要**按 label 匹配）。
ITEM_UPDATE_REPO = "system.update_repo"
ITEM_FONT_BASE_URL = "system.font_base_url"
ITEM_RAG_ASSET_BASE_URL = "system.rag_asset_base_url"
ITEM_BROWSER_PORT = "system.browser_port"

# 值类型：决定校验规则与输入框形态。
KIND_REPO = "repo"
KIND_URL = "url"
KIND_PORT = "port"

# GitHub 仓库 slug：`owner/repo`。只允许这两段字符，避免拼进 URL 时带出路径穿越
# （``../``）或查询串（``?``）——地址是由它拼出来的，校验必须发生在拼之前。
_REPO_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+$")
# 端口合法区间与 schemas/apply 里 `browser_port` 的 `ge/le` 保持一致，不另立一套。
PORT_MIN = 1024
PORT_MAX = 65535


class SystemSourceError(ValueError):
    """值非法。``str(exc)`` 可直接给用户看（含"怎么改"），由 API 层翻成 400。"""


@dataclass(frozen=True)
class SystemSource:
    """一项系统级来源的**声明**：id、存储键、显示名、值类型、一句话说明。"""

    item_id: str
    storage_key: str
    label: str
    kind: str
    hint: str

    @property
    def persistent(self) -> bool:
        """是否落盘（这四项都是；保留属性是为了与凭据 registry 的形态对齐）。"""
        return True


# 声明顺序 = 界面展示顺序（确定性，便于断言）。
SYSTEM_SOURCES: tuple[SystemSource, ...] = (
    SystemSource(
        item_id=ITEM_UPDATE_REPO,
        storage_key="update_repo",
        label="更新源（GitHub 仓库）",
        kind=KIND_REPO,
        hint="检查新版本时查询的仓库，形如 owner/repo；换自托管发行源时改这里",
    ),
    SystemSource(
        item_id=ITEM_FONT_BASE_URL,
        storage_key="font_base_url",
        label="字体下载源",
        kind=KIND_URL,
        hint="内置字体（思源黑体）的下载根地址，需 http/https 且以 / 结尾",
    ),
    SystemSource(
        item_id=ITEM_RAG_ASSET_BASE_URL,
        storage_key="rag_asset_base_url",
        label="RAG 资产下载源",
        kind=KIND_URL,
        hint="本地语义检索模型的整包下载根地址（GitHub Releases 形态），注意别填到具体文件",
    ),
    SystemSource(
        item_id=ITEM_BROWSER_PORT,
        storage_key="browser_port",
        label="浏览器调试端口",
        kind=KIND_PORT,
        hint=f"投递专用浏览器的 CDP 端口（{PORT_MIN}–{PORT_MAX}）；网申填表固定用 9334，请避开",
    ),
)

_BY_ID: dict[str, SystemSource] = {item.item_id: item for item in SYSTEM_SOURCES}
_BY_KEY: dict[str, SystemSource] = {item.storage_key: item for item in SYSTEM_SOURCES}


def get_source(item_id: str) -> SystemSource:
    """按 id 取声明；未知 id 抛 :class:`KeyError`（不要静默回默认值）。"""
    try:
        return _BY_ID[item_id]
    except KeyError as exc:
        known = "、".join(item.item_id for item in SYSTEM_SOURCES)
        raise KeyError(f"未登记的系统来源：{item_id}（已登记：{known}）") from exc


def has_source(item_id: str) -> bool:
    """``item_id`` 是否已登记（只读探测，不抛错）。"""
    return item_id in _BY_ID


def source_ids() -> tuple[str, ...]:
    """全部 id，保持声明顺序。"""
    return tuple(item.item_id for item in SYSTEM_SOURCES)


# ===== 出厂默认（唯一来源仍是各业务模块自己的常量）=====


def _defaults() -> dict[str, str]:
    """四项的出厂默认值。**延迟 import**：避免 consumer ↔ 本模块的循环依赖。

    默认值一律指向"业务模块里原本就有的那个常量"，本模块不复制第二份：
    改默认值仍然只改一处（`update_check.DEFAULT_REPOSITORY` /
    `resume_font_builtin_types.BASE_URL` / `Settings.rag_asset_base_url` /
    `config.DEFAULT_BROWSER_PORT`）。
    """
    from ..config import DEFAULT_BROWSER_PORT, get_settings
    from .resume_font_builtin_types import BASE_URL as font_base_url
    from .update_check import DEFAULT_REPOSITORY

    settings = get_settings()
    return {
        ITEM_UPDATE_REPO: str(DEFAULT_REPOSITORY),
        ITEM_FONT_BASE_URL: str(font_base_url),
        ITEM_RAG_ASSET_BASE_URL: str(getattr(settings, "rag_asset_base_url", "") or ""),
        ITEM_BROWSER_PORT: str(int(DEFAULT_BROWSER_PORT)),
    }


def default_value(item_id: str) -> str:
    """某一项的出厂默认值（字符串形态，端口也是字符串）。"""
    get_source(item_id)
    return _defaults()[item_id]


# ===== 校验 =====


def _validate_url(raw: str) -> str:
    """http/https 绝对地址；去空白、去尾部多余斜杠后补一个。"""
    value = raw.strip()
    if not value:
        raise SystemSourceError("地址不能为空；要恢复默认请点「恢复默认」")
    lowered = value.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        raise SystemSourceError("地址必须以 http:// 或 https:// 开头")
    # 只允许"协议 + 主机 + 路径"：出现空白、引号或控制字符说明粘贴错了。
    if any(char.isspace() for char in value):
        raise SystemSourceError("地址里不能有空格")
    return value.rstrip("/") + "/"


def _validate_repo(raw: str) -> str:
    """``owner/repo``；结尾的 ``.git`` 与 GitHub 网页地址的常见粘贴形态都顺手接受。"""
    value = raw.strip()
    if not value:
        raise SystemSourceError("仓库不能为空；要恢复默认请点「恢复默认」")
    # 用户从浏览器地址栏复制时是 `https://github.com/owner/repo`：只取后两段，
    # 而不是直接拒收——拒收会让人以为"从官网复制的地址不可用"。
    if "://" in value:
        parts = [item for item in value.split("://", 1)[1].split("/") if item]
        if parts and parts[0].lower() in {"github.com", "www.github.com"}:
            parts = parts[1:]
        value = "/".join(parts[:2])
    if value.endswith(".git"):
        value = value[: -len(".git")]
    if not _REPO_PATTERN.match(value) or value.count("/") != 1:
        raise SystemSourceError("仓库要写成 owner/repo（如 magicapple123/ResumeForge）")
    return value


def _validate_port(raw: str) -> str:
    """整数端口，区间与 `schemas/apply` 的 ``ge=1024, le=65535`` 一致。"""
    value = raw.strip()
    if not value:
        raise SystemSourceError("端口不能为空；要恢复默认请点「恢复默认」")
    if not value.isdigit():
        raise SystemSourceError("端口必须是整数")
    number = int(value)
    if not PORT_MIN <= number <= PORT_MAX:
        raise SystemSourceError(f"端口要在 {PORT_MIN}–{PORT_MAX} 之间")
    return str(number)


_VALIDATORS = {
    KIND_REPO: _validate_repo,
    KIND_URL: _validate_url,
    KIND_PORT: _validate_port,
}


def validate(item_id: str, raw: Any) -> str:
    """把输入校验成**可落盘的字符串**；非法值抛 :class:`SystemSourceError`。"""
    source = get_source(item_id)
    return _VALIDATORS[source.kind](str(raw if raw is not None else ""))


# ===== 读写 =====


def _block(state: dict[str, Any] | None) -> dict[str, Any]:
    block = (state or {}).get(SYSTEM_SOURCES_BLOCK)
    return block if isinstance(block, dict) else {}


def overrides() -> dict[str, str]:
    """已保存的覆盖值（**只含校验通过的项**）。

    坏值不参与生效：文件被手工改坏时按默认值继续跑，并在日志里说清楚是哪一项——
    让"配置坏了"表现成"回到默认"，而不是应用起不来。
    """
    stored = _block(global_settings.load_state())
    valid: dict[str, str] = {}
    for key, value in stored.items():
        source = _BY_KEY.get(key)
        if source is None:
            continue
        try:
            valid[source.item_id] = validate(source.item_id, value)
        except SystemSourceError:
            logger.warning(
                "全局设置里的系统来源 %s 非法（%r），本次按默认值处理；请在设置页重新保存",
                key,
                value,
            )
    return valid


def get_value(item_id: str) -> str:
    """当前生效值（覆盖优先，否则出厂默认）。端口也返回字符串。"""
    return overrides().get(item_id) or default_value(item_id)


def is_overridden(item_id: str) -> bool:
    """某一项是否被用户改过（= 界面上的"已改过，可恢复默认"）。"""
    return item_id in overrides()


def _write_block(mapping: dict[str, str]) -> None:
    """整块重写：调用方保证 ``mapping`` 是 storage_key → 校验过的值。"""

    def mutate(state: dict[str, Any]) -> None:
        if mapping:
            state[SYSTEM_SOURCES_BLOCK] = dict(mapping)
        else:
            # 四项全恢复默认时**删掉整个块**：文件里不留一个空对象，
            # 免得上层误判成"用户配置过系统来源"。
            state.pop(SYSTEM_SOURCES_BLOCK, None)

    global_settings.mutate_state(mutate)


def _stored_block() -> dict[str, str]:
    """文件里当前那一块，逐项校验归一化后按 storage_key 返回（坏项丢弃）。"""
    stored: dict[str, str] = {}
    for key, raw in _block(global_settings.load_state()).items():
        source = _BY_KEY.get(str(key))
        if source is None:
            continue
        try:
            stored[source.storage_key] = validate(source.item_id, raw)
        except SystemSourceError:
            continue
    return stored


def set_value(item_id: str, raw: Any) -> str:
    """写入一项覆盖值；返回校验归一化之后的值。"""
    source = get_source(item_id)
    value = validate(item_id, raw)
    stored = _stored_block()
    stored[source.storage_key] = value
    _write_block(stored)
    logger.info("系统来源 %s 已更新", item_id)
    return value


def reset_value(item_id: str) -> None:
    """恢复出厂默认（= 从文件里删掉这一项）。已经是默认值时是空操作。"""
    source = get_source(item_id)
    stored = _stored_block()
    stored.pop(source.storage_key, None)
    _write_block(stored)
    logger.info("系统来源 %s 已恢复默认", item_id)


# ===== 备份 =====


def export_overrides() -> dict[str, str]:
    """备份用：把已生效的覆盖值按 **storage_key** 导出（不含默认值，避免把默认值写进包）。"""
    return {_BY_ID[item_id].storage_key: value for item_id, value in overrides().items()}


def restore_overrides(mapping: Any) -> int:
    """备份导入用：逐项校验后写回；非法或未知的键**跳过**而不是整份失败。

    返回真正恢复的项数。空 / 非字典输入是 0（旧备份包里没有这个字段）。
    """
    if not isinstance(mapping, dict):
        return 0
    restored = 0
    for key, raw in mapping.items():
        source = _BY_KEY.get(str(key))
        if source is None:
            logger.warning("备份包里的系统来源 %s 不认识，已跳过", key)
            continue
        try:
            set_value(source.item_id, raw)
        except SystemSourceError as exc:
            logger.warning("备份包里的系统来源 %s 非法（%s），已跳过", key, exc)
            continue
        restored += 1
    return restored


# ===== 四个消费者用的取值函数（默认值由调用方传入或从业务模块取）=====


def update_repository() -> str:
    """检查更新时查询的 ``owner/repo``。"""
    return get_value(ITEM_UPDATE_REPO)


def font_base_url(fallback: str | None = None) -> str:
    """内置字体下载根地址。``fallback`` 让调用方自带兜底（便于测试 monkeypatch 旧常量）。"""
    return overrides().get(ITEM_FONT_BASE_URL) or _validate_url(
        fallback or default_value(ITEM_FONT_BASE_URL)
    )


def rag_asset_base_url(fallback: str | None = None) -> str:
    """RAG 资产整包下载根地址（**不带**结尾斜杠，下游自己拼 ``/文件名``）。"""
    value = overrides().get(ITEM_RAG_ASSET_BASE_URL) or str(fallback or "").strip()
    return value.rstrip("/")


def browser_port(fallback: int | None = None) -> int:
    """投递专用浏览器的 CDP 端口。``fallback`` 是网申配置里的同名值（见调用点注释）。"""
    stored = overrides().get(ITEM_BROWSER_PORT)
    if stored:
        return int(stored)
    return int(fallback or default_value(ITEM_BROWSER_PORT))


__all__ = [
    "ITEM_BROWSER_PORT",
    "ITEM_FONT_BASE_URL",
    "ITEM_RAG_ASSET_BASE_URL",
    "ITEM_UPDATE_REPO",
    "KIND_PORT",
    "KIND_REPO",
    "KIND_URL",
    "PORT_MAX",
    "PORT_MIN",
    "SYSTEM_SOURCES",
    "SYSTEM_SOURCES_BLOCK",
    "SystemSource",
    "SystemSourceError",
    "browser_port",
    "default_value",
    "export_overrides",
    "font_base_url",
    "get_source",
    "get_value",
    "has_source",
    "is_overridden",
    "overrides",
    "rag_asset_base_url",
    "reset_value",
    "restore_overrides",
    "set_value",
    "source_ids",
    "update_repository",
    "validate",
]
