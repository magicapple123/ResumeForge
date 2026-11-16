# SPDX-License-Identifier: Apache-2.0
"""设置默认值注册表 + 「恢复默认」与快照的执行层（问题清单 I-10）。

为什么需要这个模块：默认值此前散在三处——部署配置（`.env` / `config.Settings`）、
各 getter 的内联 fallback、前端常量。后果是有二十多张设置卡「改错了没有回到出厂值的
路径」，而「出厂值到底是多少」只能靠 grep。这里把它收成**唯一真源**：

- :class:`SettingDefault` 描述一个键：默认值、所属卡片（``scope``）、存储编码、
  以及**是否可重置**；
- 各 getter 的 fallback 一律写成 ``default_for(key)``——注册表与读取端同源；
- 重置 = 删掉那一行（「缺失即默认」），所以「重置后读回来等于默认」是结构上成立的，
  而不是靠人肉对齐两份常量。

## 两条硬约束

1. **密钥键一律 ``resettable=False``**。用户点一下「恢复默认」就丢 Key 是不可接受的
   事故，所以 :func:`_freeze` 在导入期硬校验：把 api_key / token / secret / cookie
   这类键登记成可重置，应用直接起不来。
2. **快照导出物不得包含密钥**。导出只走白名单投影（可重置键 + 全局文件里的主题与
   搜索公开字段），并在返回前用 :func:`assert_no_secret_fields` 再扫一遍字段名。

## 作用域

``AppSetting`` 是**按数据集**存的（一份数据集一个 SQLite 文件），因此重置只影响当前
数据集；全局文件（``data/global_settings.json``）里的主题与联网搜索是跨数据集的，
只有快照的 ``global`` 段会碰它们，且只碰白名单内的公开字段。

## 字段级（kind="fields"）

``llm_config`` / ``asr_config`` / ``analytics_weekly_goal`` 这些是「一个 JSON 里放多项」
的键，其中还混着密钥列。这类条目只声明**可重置的字段**（默认值字典的键）：重置时把
这些字段改回默认，其余字段（含 API Key、Base URL、模型名）原样保留。
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from ..models.profile import utcnow
from ..models.setting import AppSetting
from . import global_settings
from .settings_default_types import (  # noqa: F401  (再导出，调用方 import 路径不变)
    _THEME_MODES,
    MISSING,
    SAFE_FIELD_NAMES,
    SECRET_KEY_MARKERS,
    WEB_SEARCH_PUBLIC_FIELDS,
    Kind,
    SettingDefault,
    SettingsSnapshotError,
    Storage,
    _Missing,
    is_secret_key,
)
from .settings_registry_data import REGISTRY_ENTRIES

_REGISTRY = REGISTRY_ENTRIES

logger = logging.getLogger(__name__)

#: 快照格式版本。**只拒绝更新的版本**：旧版应用读新版快照会静默丢字段，那比报错更糟；
#: 反过来（新版读旧版）只要字段在白名单内就仍然安全。
SNAPSHOT_FORMAT_VERSION = 1


def _freeze(entries: tuple[SettingDefault, ...]) -> dict[str, SettingDefault]:
    """建索引，并在**导入期**挡住三类致命错误：重复键、密钥被登记成可重置、字段表不是字典。"""
    index: dict[str, SettingDefault] = {}
    for entry in entries:
        if entry.key in index:
            raise RuntimeError(f"设置默认值注册表里键重复：{entry.key}")
        if entry.secret and entry.resettable:
            raise RuntimeError(f"密钥类设置不得可重置：{entry.key}（用户点一下就会丢 Key）")
        if entry.kind == "fields" and not isinstance(entry.default, dict):
            raise RuntimeError(f"kind=fields 的默认值必须是字典：{entry.key}")
        index[entry.key] = entry
    return index


SETTINGS_REGISTRY: dict[str, SettingDefault] = _freeze(_REGISTRY)


# ===== 读取注册表 =====


def entry_for(key: str) -> SettingDefault | None:
    return SETTINGS_REGISTRY.get(key)


def default_for(key: str) -> Any:
    """某键的出厂值。键未登记属编程错误——``KeyError`` 故意不兜底。"""
    return SETTINGS_REGISTRY[key].resolved_default()


def resettable_entries(scope: str | None = None) -> list[SettingDefault]:
    """可重置的登记项（可按 scope 过滤），顺序即注册顺序。"""
    return [
        entry
        for entry in SETTINGS_REGISTRY.values()
        if entry.resettable and (scope is None or entry.scope == scope)
    ]


def scope_names() -> list[str]:
    """有可重置键的 scope（去重保序）——前端据此渲染「卡片级恢复默认」。"""
    names: list[str] = []
    for entry in resettable_entries():
        if entry.scope not in names:
            names.append(entry.scope)
    return names


def split_resettable(keys: list[str]) -> tuple[list[str], list[str]]:
    """把请求里的键分成「可重置」和「被拒绝」两组（**不做任何写入**）。"""
    allowed: list[str] = []
    rejected: list[str] = []
    for key in keys:
        entry = SETTINGS_REGISTRY.get(key)
        if entry is None or not entry.resettable:
            rejected.append(key)
        elif key not in allowed:
            allowed.append(key)
    return allowed, rejected


# ===== 值编解码 =====


def _normalize(value: Any) -> str:
    """比较用的规范形（键排序 + 中文不转义）；无法序列化时退回 ``repr``。"""
    try:
        return json.dumps(value, sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):  # pragma: no cover - 注册表里没有这种值
        return repr(value)


def _decode(entry: SettingDefault, raw: str) -> Any:
    """把库里的一行解成公开值；解不出来返回 :data:`MISSING`。"""
    if entry.storage == "text":
        return raw if raw is not None else ""
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("设置 %s 数据损坏，按未配置（= 默认值）处理", entry.key)
        return MISSING
    if entry.kind == "fields" and not isinstance(value, dict):
        logger.warning("设置 %s 的存量值不是对象，按未配置（= 默认值）处理", entry.key)
        return MISSING
    return value


def _stored_value(db: Session, entry: SettingDefault) -> Any:
    """库里当前值（公开形态）；行不存在或损坏返回 :data:`MISSING`。"""
    row = db.get(AppSetting, entry.key)
    if row is None:
        return MISSING
    return _decode(entry, row.value)


def read_current(db: Session, entry: SettingDefault) -> Any:
    """当前生效值（用于确认弹层里的「当前值」与「是否已是默认」）。"""
    value = _stored_value(db, entry)
    defaults = entry.resolved_default()
    if entry.kind == "fields":
        if not isinstance(value, dict):
            return defaults
        return {name: copy.deepcopy(value.get(name, defaults[name])) for name in defaults}
    return copy.deepcopy(defaults) if value is MISSING else copy.deepcopy(value)


def is_default(db: Session, entry: SettingDefault) -> bool:
    """是否已经是出厂值（前端据此决定要不要渲染 ``↺``）。"""
    return _normalize(read_current(db, entry)) == _normalize(entry.resolved_default())


def _encode(entry: SettingDefault, value: Any) -> str:
    return str(value) if entry.storage == "text" else json.dumps(value, ensure_ascii=False)


def _write_row(db: Session, entry: SettingDefault, value: Any) -> None:
    serialized = _encode(entry, value)
    row = db.get(AppSetting, entry.key)
    if row is None:
        db.add(AppSetting(key=entry.key, value=serialized))
    else:
        row.value = serialized


# ===== 恢复默认 =====


def _reset_one(db: Session, entry: SettingDefault) -> bool:
    """重置一个键；返回库是否真的被改动。

    ``kind="fields"`` 只把「已存在且不等于默认」的字段改回默认，其余字段（含密钥）原样
    保留；其它条目直接删行——「缺失即默认」让读取端与重置端天然同源。
    """
    row = db.get(AppSetting, entry.key)
    if row is None:
        # 行不存在 = 已经是默认值，不必写一行默认值进去。
        return False
    if entry.kind == "fields":
        stored = _decode(entry, row.value)
        merged = dict(stored) if isinstance(stored, dict) else {}
        changed = False
        for name, value in entry.resolved_default().items():
            if name in merged and _normalize(merged[name]) != _normalize(value):
                merged[name] = copy.deepcopy(value)
                changed = True
        if not changed:
            return False
        row.value = _encode(entry, merged)
        return True
    db.delete(row)
    return True


def reset_keys(db: Session, keys: list[str]) -> dict[str, Any]:
    """把若干键恢复默认；**调用方必须先用 :func:`split_resettable` 挡掉非法键**。

    单事务：全部改动在同一个 ``db`` 上完成，末尾只提交一次（任何一步抛错都不会留下
    半套结果）。返回值供接口原样回给前端：

    ``{"reset": [{"key", "scope", "before", "after"}], "skipped": [key, ...]}``

    ``skipped`` = 本来就已经是默认值（或行不存在），不需要写入。
    """
    reset: list[dict[str, Any]] = []
    skipped: list[str] = []
    for key in keys:
        entry = SETTINGS_REGISTRY.get(key)
        if entry is None or not entry.resettable:
            # 正常路径不会走到这里（接口层已 422）；保底跳过而不是写入。
            skipped.append(key)
            continue
        before = read_current(db, entry)
        if not _reset_one(db, entry):
            skipped.append(key)
            continue
        reset.append(
            {
                "key": key,
                "scope": entry.scope,
                "before": before,
                "after": entry.resolved_default(),
            }
        )
    db.commit()
    return {"reset": reset, "skipped": skipped}


def reset_scope(db: Session, scope: str) -> dict[str, Any]:
    """按卡片（scope）恢复默认。未知 scope 由接口层转成 422。"""
    return reset_keys(db, [entry.key for entry in resettable_entries(scope)])


def reset_targets(db: Session, scope: str | None = None) -> list[dict[str, Any]]:
    """列出可重置项及其当前值/默认值（**密钥键不在其中**）。"""
    targets: list[dict[str, Any]] = []
    for entry in resettable_entries(scope):
        targets.append(
            {
                "key": entry.key,
                "scope": entry.scope,
                "kind": entry.kind,
                "storage": entry.storage,
                "default": entry.resolved_default(),
                "current": read_current(db, entry),
                "is_default": is_default(db, entry),
            }
        )
    return targets


# ===== 快照（导出 / 导入） =====


def assert_no_secret_fields(payload: Any, *, path: str = "") -> None:
    """扫一遍字段名：发现密钥形态的键就直接抛错（导出物的最后一道闸）。"""
    if isinstance(payload, dict):
        for key, value in payload.items():
            child = f"{path}.{key}" if path else str(key)
            if is_secret_key(str(key)):
                raise SettingsSnapshotError(f"快照里出现了密钥字段：{child}")
            assert_no_secret_fields(value, path=child)
    elif isinstance(payload, list):
        for index, item in enumerate(payload):
            assert_no_secret_fields(item, path=f"{path}[{index}]")


def _global_public_state() -> dict[str, Any]:
    """全局文件里「值得带走」的公开字段：主题 + 联网搜索的非密钥字段。"""
    state = global_settings.load_state() or {}
    public: dict[str, Any] = {}
    theme = state.get("theme")
    if theme in _THEME_MODES:
        public["theme"] = theme
    block = state.get("web_search")
    if isinstance(block, dict):
        web = {
            name: copy.deepcopy(block[name]) for name in WEB_SEARCH_PUBLIC_FIELDS if name in block
        }
        if web:
            public["web_search"] = web
    return public


def build_snapshot(db: Session) -> dict[str, Any]:
    """导出当前数据集的设置快照（**不含任何密钥**）。

    只导出注册表里可重置的键，且一律取**公开形态**：``kind="fields"`` 的条目只剩被管理
    的那几个字段，所以 ``llm_config`` 里的 api_key、``asr_config`` 旁的密钥列都不会出现
    在导出物里。
    """
    settings: dict[str, Any] = {
        entry.key: read_current(db, entry) for entry in resettable_entries()
    }
    payload: dict[str, Any] = {
        "format_version": SNAPSHOT_FORMAT_VERSION,
        "exported_at": utcnow().isoformat(),
        "dataset_scoped": True,
        "settings": settings,
        "global": _global_public_state(),
    }
    assert_no_secret_fields(payload)
    return payload


def _coerce_scalar(label: str, default: Any, raw: Any) -> Any:
    """按出厂值的类型校验一个标量/容器（bool 与 int 严格区分）。"""
    if default is None:
        return raw
    if isinstance(default, bool):
        if not isinstance(raw, bool):
            raise SettingsSnapshotError(f"{label} 需要布尔值")
        return raw
    if isinstance(default, int):
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise SettingsSnapshotError(f"{label} 需要整数")
        return raw
    if isinstance(default, float):
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise SettingsSnapshotError(f"{label} 需要数字")
        return float(raw)
    if isinstance(default, str):
        if not isinstance(raw, str):
            raise SettingsSnapshotError(f"{label} 需要字符串")
        return raw
    if isinstance(default, list):
        if not isinstance(raw, list):
            raise SettingsSnapshotError(f"{label} 需要数组")
        return copy.deepcopy(raw)
    if isinstance(default, dict):
        if not isinstance(raw, dict):
            raise SettingsSnapshotError(f"{label} 需要对象")
        return copy.deepcopy(raw)
    raise SettingsSnapshotError(f"{label} 的类型不受支持：{type(default).__name__}")


def _coerce(entry: SettingDefault, raw: Any) -> Any:
    """白名单内的值做类型校验（先校验后写入）；不合法抛 :class:`SettingsSnapshotError`。"""
    defaults = entry.resolved_default()
    if entry.kind != "fields":
        return _coerce_scalar(entry.key, defaults, raw)
    if not isinstance(raw, dict):
        raise SettingsSnapshotError(f"{entry.key} 需要对象")
    unknown = [name for name in raw if name not in defaults]
    if unknown:
        raise SettingsSnapshotError(f"{entry.key} 含未知字段：{', '.join(sorted(unknown))}")
    return {
        name: _coerce_scalar(f"{entry.key}.{name}", defaults[name], value)
        for name, value in raw.items()
    }


def _merge_fields(db: Session, entry: SettingDefault, fields: dict[str, Any]) -> dict[str, Any]:
    """把字段值并进存量 JSON 对象（其余字段原样保留）。"""
    row = db.get(AppSetting, entry.key)
    stored = _decode(entry, row.value) if row is not None else MISSING
    merged = dict(stored) if isinstance(stored, dict) else {}
    merged.update(fields)
    return merged


def apply_snapshot(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """从快照恢复：**先整份校验、再一处写入**（ADR-0005）。

    任何非法输入（版本过新、键不在白名单、类型不对）都抛 :class:`SettingsSnapshotError`，
    且抛出时库里一行都没动过。
    """
    if not isinstance(payload, dict):
        raise SettingsSnapshotError("快照内容必须是对象")
    version = payload.get("format_version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise SettingsSnapshotError("快照缺少有效的 format_version")
    if version > SNAPSHOT_FORMAT_VERSION:
        raise SettingsSnapshotError(
            f"快照来自更新的版本（{version} > {SNAPSHOT_FORMAT_VERSION}），请先升级应用"
        )
    settings = payload.get("settings")
    if settings is None:
        settings = {}
    if not isinstance(settings, dict):
        raise SettingsSnapshotError("settings 必须是对象")
    allowed, rejected = split_resettable(list(settings.keys()))
    if rejected:
        raise SettingsSnapshotError(f"快照含不可恢复的设置项：{', '.join(sorted(rejected))}")
    prepared = {key: _coerce(SETTINGS_REGISTRY[key], settings[key]) for key in allowed}
    global_block = payload.get("global")
    if global_block is not None and not isinstance(global_block, dict):
        raise SettingsSnapshotError("global 必须是对象")
    theme = (global_block or {}).get("theme")
    if theme is not None and theme not in _THEME_MODES:
        raise SettingsSnapshotError("global.theme 只能是 light/dark/system")

    # —— 校验全部通过，以下才开始写入 ——
    applied: list[dict[str, Any]] = []
    skipped: list[str] = []
    for key, value in prepared.items():
        entry = SETTINGS_REGISTRY[key]
        if entry.kind == "fields":
            row = db.get(AppSetting, entry.key)
            stored = _decode(entry, row.value) if row is not None else MISSING
            if isinstance(stored, dict) and all(
                _normalize(dict(stored).get(name, MISSING)) == _normalize(field_value)
                for name, field_value in value.items()
            ):
                skipped.append(key)
                continue
            _write_row(db, entry, _merge_fields(db, entry, value))
        else:
            stored = _stored_value(db, entry)
            if stored is not MISSING and _normalize(stored) == _normalize(value):
                skipped.append(key)
                continue
            _write_row(db, entry, value)
        applied.append({"key": key, "value": value})
    db.commit()
    if theme is not None:
        global_settings.write_theme(str(theme))
    return {"applied": applied, "skipped": skipped, "theme": theme}


__all__ = [
    "MISSING",
    "SECRET_KEY_MARKERS",
    "SETTINGS_REGISTRY",
    "SNAPSHOT_FORMAT_VERSION",
    "SettingDefault",
    "SettingsSnapshotError",
    "apply_snapshot",
    "assert_no_secret_fields",
    "build_snapshot",
    "default_for",
    "entry_for",
    "is_default",
    "is_secret_key",
    "read_current",
    "reset_keys",
    "reset_scope",
    "reset_targets",
    "resettable_entries",
    "scope_names",
    "split_resettable",
]
