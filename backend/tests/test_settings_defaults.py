# SPDX-License-Identifier: Apache-2.0
"""默认值注册表的守卫（I-10 阶段 1）。

三条断言口径：

1. **全表遍历**：清空 ``AppSetting`` 后，每个可重置键的**真实 getter** 返回值必须等于
   注册表里的出厂值。不许抽样——漏登记一个键等于"这张卡改错了回不去"，而抽样正好会
   漏掉它。
2. **每个可重置键都被真实读取**：:data:`_READERS` 与注册表的键集合必须双向相等。新增
   一个可重置键却不登记读取口，这里直接红。
3. **反证**：改写注册表里的出厂值，``settings_service`` 那几个 getter 的返回值必须跟着
   变——证明它们的 fallback 真的走 ``default_for(key)``，而不是内联字面量（内联了就会
   "注册表说 30、实际回 30"这种假绿）。
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Callable
from typing import Any

import pytest
from app.models.setting import AppSetting
from app.schemas.setting import NAVIGATION_CORE_KEYS, NAVIGATION_OPTIONAL_KEYS
from app.services import settings_defaults, settings_service
from app.services.analytics_goal import get_weekly_goal
from app.services.asr_settings import legacy_asr_settings
from app.services.assistant.assistant_compaction_settings import get_compaction_settings
from app.services.assistant.memory import auto_extract_enabled, memory_injection_enabled
from app.services.assistant_limits import (
    get_max_tool_rounds,
    get_stream_budget_seconds,
    get_tool_result_max_chars,
)
from app.services.assistant_permission import (
    get_assistant_permission,
    get_assistant_relaxed_mode,
)
from app.services.batch_operation import read_batch_operation_config
from app.services.llm_settings import get_dataset_llm_config
from app.services.track_probe_settings import read_settings as read_probe_settings
from sqlalchemy.orm import Session

_LLM_FIELDS = tuple(settings_defaults.SETTINGS_REGISTRY["llm_config"].resolved_default())


def _read_llm_config(db: Session) -> dict[str, Any]:
    """只比「可重置字段」；api_key / base_url / model 属于配置身份，不在比较范围内。"""
    dumped = get_dataset_llm_config(db).model_dump()
    return {name: dumped[name] for name in _LLM_FIELDS}


def _read_asr_config(db: Session) -> dict[str, Any]:
    config = legacy_asr_settings(db)
    return {
        "base_url": config.base_url,
        "model": config.model,
        "protocol": config.protocol,
    }


def _read_orbs(db: Session) -> dict[str, Any]:
    return settings_service.get_assistant_orb_setting(db).model_dump()


def _read_navigation(db: Session) -> dict[str, Any]:
    return settings_service.get_navigation_visibility(db).model_dump()


def _read_weekly_goal(db: Session) -> dict[str, Any]:
    return {"target": get_weekly_goal(db)}


def _read_batch_config(db: Session) -> dict[str, Any]:
    config = read_batch_operation_config(db)
    if not (config.generation.configured or config.export.configured):
        return {}
    return {
        "generation": config.generation.model_dump(),
        "export": config.export.model_dump(),
    }


#: 键 → 真实读取口。**每个可重置键都必须在这里**（守卫逐键比对集合）。
_READERS: dict[str, Callable[[Session], Any]] = {
    "llm_config": _read_llm_config,
    "assistant_compaction_model": lambda db: get_compaction_settings(db).model,
    "assistant_compaction_mask_percent": lambda db: get_compaction_settings(db).mask_percent,
    "assistant_compaction_summary_percent": lambda db: get_compaction_settings(db).summary_percent,
    "asr_config": _read_asr_config,
    "assistant_permission": get_assistant_permission,
    "assistant_relaxed_mode": get_assistant_relaxed_mode,
    "assistant_max_tool_rounds": get_max_tool_rounds,
    "assistant_stream_budget_seconds": get_stream_budget_seconds,
    "assistant_tool_result_max_chars": get_tool_result_max_chars,
    "assistant_memory_auto_extract": auto_extract_enabled,
    "assistant_memory_inject": memory_injection_enabled,
    "agent_task_events_enabled": settings_service.get_agent_task_events_enabled,
    "webform_relaxed_mode": settings_service.get_webform_relaxed_mode,
    "reminder_popup_on_start": settings_service.get_reminder_popup_on_start,
    "editor_inline_format_preview": settings_service.get_editor_inline_format_preview,
    "tray_icon_follow_system": settings_service.get_tray_icon_follow_system,
    "assistant_orb_enabled": _read_orbs,
    "navigation_visibility": _read_navigation,
    "apply_blocklist": settings_service.get_apply_blocklist,
    "apply_greeting_templates": settings_service.get_apply_greeting_templates,
    "analytics_weekly_goal": _read_weekly_goal,
    "tracker.probe.enabled": lambda db: read_probe_settings(db).enabled,
    "tracker.probe.page_url": lambda db: read_probe_settings(db).page_url,
    "export_save_location": settings_service.get_export_save_location,
    "auto_backup_interval_days": settings_service.get_auto_backup_interval_days,
    "batch_operation_config": _read_batch_config,
}


def _clear_settings(db: Session) -> None:
    db.query(AppSetting).delete()
    db.commit()


def test_every_resettable_key_has_a_reader():
    registered = {entry.key for entry in settings_defaults.resettable_entries()}
    assert registered == set(_READERS), "可重置键与读取口必须双向一一对应"


def test_every_scope_has_at_least_one_key():
    scopes = settings_defaults.scope_names()
    assert scopes, "至少要有一个可重置的 scope"
    for scope in scopes:
        assert settings_defaults.resettable_entries(scope), f"scope {scope} 没有可重置键"


def test_secret_keys_are_never_resettable():
    """密钥键一律不可重置：这是"点一下丢 Key"事故的唯一结构性防线。"""
    secrets_in_registry = [e.key for e in settings_defaults.SETTINGS_REGISTRY.values() if e.secret]
    assert "asr_api_key" in secrets_in_registry
    assert "tracker.probe.cookie" in secrets_in_registry
    assert "search_deepseek_api_key" in secrets_in_registry
    for entry in settings_defaults.SETTINGS_REGISTRY.values():
        if settings_defaults.is_secret_key(entry.key):
            assert entry.resettable is False, f"{entry.key} 是密钥类，必须 resettable=False"


def test_import_time_guard_rejects_resettable_secret():
    """反证：注册表里出现"可重置的密钥键"时，_freeze 必须在导入期就炸。"""
    bad = settings_defaults.SettingDefault(key="some_api_key", scope="model", default="")
    with pytest.raises(RuntimeError, match="密钥类设置不得可重置"):
        settings_defaults._freeze((bad,))  # noqa: SLF001 - 就是要测这条私有闸门


def test_duplicate_keys_are_rejected():
    entry = settings_defaults.SettingDefault(
        key="webform_relaxed_mode", scope="webform", default=False
    )
    with pytest.raises(RuntimeError, match="键重复"):
        settings_defaults._freeze((entry, entry))  # noqa: SLF001


def test_registry_defaults_match_getters_on_empty_database(db_session: Session):
    """全表遍历：清空设置表后，每个 getter 的返回值 == 注册表出厂值。"""
    _clear_settings(db_session)
    mismatched: list[str] = []
    for key, reader in _READERS.items():
        expected = settings_defaults.default_for(key)
        actual = reader(db_session)
        if json.dumps(actual, sort_keys=True, ensure_ascii=False) != (
            json.dumps(expected, sort_keys=True, ensure_ascii=False)
        ):
            mismatched.append(f"{key}: getter={actual!r} registry={expected!r}")
    assert not mismatched, "getter 的 fallback 与注册表不一致：\n" + "\n".join(mismatched)


def test_reset_then_read_returns_default_for_every_key(db_session: Session):
    """重置（删行）之后，每个 getter 也必须回到注册表出厂值。"""
    _clear_settings(db_session)
    for key in _READERS:
        entry = settings_defaults.SETTINGS_REGISTRY[key]
        db_session.add(
            AppSetting(key=key, value=json.dumps(_non_default(entry), ensure_ascii=False))
        )
    db_session.commit()
    settings_defaults.reset_keys(db_session, list(_READERS))
    for key, reader in _READERS.items():
        expected = settings_defaults.default_for(key)
        assert json.dumps(reader(db_session), sort_keys=True, ensure_ascii=False) == (
            json.dumps(expected, sort_keys=True, ensure_ascii=False)
        ), f"{key} 重置后没有回到出厂值"


def _non_default(entry: settings_defaults.SettingDefault) -> Any:
    """构造一个"明显不是出厂值"的存量值（只用于重置测试的输入）。"""
    default = entry.resolved_default()
    if entry.kind == "fields":
        return {name: _non_default_scalar(value) for name, value in default.items()}
    return _non_default_scalar(default)


def _non_default_scalar(default: Any) -> Any:
    if isinstance(default, bool):
        return not default
    if isinstance(default, int):
        return default + 1
    if isinstance(default, float):
        return default + 1.0
    if isinstance(default, str):
        return "changed"
    if isinstance(default, list):
        return [{"id": "x"}]
    if isinstance(default, dict):
        return {**default, "_touched": True} if default else {"_touched": True}
    return "changed"


#: 反证用的替代出厂值：改注册表 → 走 ``default_for`` 的 getter 必须跟着变。
_FALSIFICATION: dict[str, Any] = {
    "reminder_popup_on_start": False,
    "webform_relaxed_mode": True,
    "agent_task_events_enabled": True,
    "export_save_location": "/tmp/marker",
    "auto_backup_interval_days": 42,
    "apply_blocklist": {"companies": ["某公司"], "keywords": ["外包"]},
    "apply_greeting_templates": [{"id": "t1", "name": "n", "body": "b"}],
    "assistant_orb_enabled": {
        "enabled": False,
        "tips_enabled": False,
        "selection_enabled": False,
    },
    "navigation_visibility": {
        "hidden": sorted(NAVIGATION_OPTIONAL_KEYS - NAVIGATION_CORE_KEYS)[:1]
    },
}


@pytest.mark.parametrize("key", sorted(_FALSIFICATION))
def test_fallback_really_reads_the_registry(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, key: str
):
    """反证：把注册表里的出厂值改掉，getter 必须跟着改（内联字面量会当场变红）。"""
    _clear_settings(db_session)
    entry = settings_defaults.SETTINGS_REGISTRY[key]
    patched = dataclasses.replace(entry, default=_FALSIFICATION[key])
    monkeypatch.setitem(settings_defaults.SETTINGS_REGISTRY, key, patched)
    assert _READERS[key](db_session) == _FALSIFICATION[key]


def test_field_reset_preserves_api_key_and_identity(db_session: Session):
    """``llm_config`` 只重置调参：密钥、Base URL、模型名原样保留。"""
    row = AppSetting(
        key="llm_config",
        value=json.dumps(
            {
                "api_key": "enc-placeholder",
                "base_url": "https://example.test/v1",
                "model": "kept-model",
                "temperature": 1.5,
                "timeout_seconds": 30,
                "thinking_enabled": True,
            }
        ),
    )
    db_session.add(row)
    db_session.commit()

    result = settings_defaults.reset_keys(db_session, ["llm_config"])
    assert [item["key"] for item in result["reset"]] == ["llm_config"]
    assert result["reset"][0]["before"]["temperature"] == 1.5

    stored = json.loads(db_session.get(AppSetting, "llm_config").value)
    assert stored["api_key"] == "enc-placeholder"
    assert stored["base_url"] == "https://example.test/v1"
    assert stored["model"] == "kept-model"
    assert stored["temperature"] == 0.1
    assert stored["timeout_seconds"] == 120
    assert stored["thinking_enabled"] is False


def test_reset_is_idempotent(db_session: Session):
    _clear_settings(db_session)
    first = settings_defaults.reset_keys(db_session, ["webform_relaxed_mode"])
    assert first["reset"] == [] and first["skipped"] == ["webform_relaxed_mode"]


def test_snapshot_never_contains_secrets(db_session: Session, monkeypatch):
    """快照导出物里不得出现任何密钥形态（api_key 字段名与值都不许有）。"""
    db_session.add_all(
        [
            AppSetting(
                key="llm_config",
                value=json.dumps({"api_key": "sk-live-SECRET-VALUE", "temperature": 1.2}),
            ),
            AppSetting(key="asr_api_key", value="sk-asr-SECRET-VALUE"),
            AppSetting(key="tracker.probe.cookie", value="sessionid=SECRET-COOKIE"),
        ]
    )
    db_session.commit()

    payload = settings_defaults.build_snapshot(db_session)
    text = json.dumps(payload, ensure_ascii=False)
    assert "SECRET-VALUE" not in text
    assert "SECRET-COOKIE" not in text
    assert "api_key" not in text
    assert "cookie" not in text
    assert "asr_api_key" not in text
    # 公开字段仍然在（否则"导出成功但什么都没带走"同样是缺陷）
    assert payload["settings"]["llm_config"]["temperature"] == 1.2


def test_apply_snapshot_rejects_unknown_keys_without_writing(db_session: Session):
    _clear_settings(db_session)
    with pytest.raises(settings_defaults.SettingsSnapshotError, match="不可恢复"):
        settings_defaults.apply_snapshot(
            db_session,
            {"format_version": 1, "settings": {"webform_relaxed_mode": True, "nope": 1}},
        )
    assert db_session.get(AppSetting, "webform_relaxed_mode") is None


def test_apply_snapshot_rejects_newer_format_version(db_session: Session):
    with pytest.raises(settings_defaults.SettingsSnapshotError, match="更新的版本"):
        settings_defaults.apply_snapshot(db_session, {"format_version": 99, "settings": {}})


def test_apply_snapshot_rejects_wrong_type(db_session: Session):
    with pytest.raises(settings_defaults.SettingsSnapshotError, match="布尔值"):
        settings_defaults.apply_snapshot(
            db_session,
            {"format_version": 1, "settings": {"webform_relaxed_mode": "yes"}},
        )


def test_apply_snapshot_round_trip(db_session: Session):
    _clear_settings(db_session)
    settings_service.save_webform_relaxed_mode(db_session, True)
    payload = settings_defaults.build_snapshot(db_session)
    settings_service.save_webform_relaxed_mode(db_session, False)

    applied = settings_defaults.apply_snapshot(db_session, payload)
    assert "webform_relaxed_mode" in [item["key"] for item in applied["applied"]]
    assert settings_service.get_webform_relaxed_mode(db_session) is True
