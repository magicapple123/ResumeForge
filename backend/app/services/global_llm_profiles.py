"""全局大模型配置（C）：`global_settings.json` 的 `llm` 段语义。

目标形态只有**一个模块**：设置 → AI 模型 →「大模型 API 配置（所有数据集共用）」。
每条 profile 就是界面上一条"已保存配置记录"，`active_profile_id` 就是「使用中」。
没有"开启/关闭全局"开关——保存即全局生效（R21 那套独立开关已删除）。

与数据集旧配置的关系：

- 升级后首次打开设置页，`migrate_from_dataset_once` 把旧 `llm_config_record`
  逐条搬过来，并把当前生效配置转成「默认配置」设为使用中；
- 之后运行时 `get_llm_config` 仍然"全局优先，否则数据集"（`settings_service`），
  所以旧数据集里的那份配置可以继续当回退快照；
- 旧表不删除，保留回滚能力。

密钥只以加密形态落盘；读取接口返回 `********:profile:<id>` 这样的引用占位符
（见 `llm_key_refs.py`），真实密钥只在"查看/写回"时短暂出现在服务进程内。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..schemas.setting import LLMConfig
from .global_llm_merge import merge_exported_profiles
from .global_settings import (
    MAX_PROFILES,
    active_profile_of,
    clean_models,
    clean_name,
    decrypt_config,
    find_profile,
    find_profile_by_name,
    fresh_state,
    load_state,
    mutate_state,
    new_profile_id,
    profiles_of,
    store_config,
    write_lock,
    write_state_unlocked,
)
from .llm_key_refs import PROFILE_API_KEY_PREFIX

logger = logging.getLogger(__name__)

_DEFAULT_RECORD_NAME = "默认配置"


@dataclass(frozen=True)
class GlobalLLM:
    """全局模型配置的**已解密**形态。"""

    config: LLMConfig
    # 当前生效的 profile（对外表现为「使用中」的那条记录）。
    profile_id: str = ""
    name: str = ""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def read_global_llm() -> GlobalLLM | None:
    """读取当前生效的配置；没有 profile 或数据损坏时返回 None。

    **不再看 `enabled`**：v2 起"存在 profile"本身就是生效条件。老文件里可能有
    `enabled: false`（R21 的开关被关过），按新语义继续忽略它——用户保存过配置却
    因为一个已删除的开关不生效，是最难解释的一类问题。
    """
    state = load_state()
    if state is None:
        return None
    profile = active_profile_of(state)
    if profile is None:
        return None
    config = decrypt_config(profile)
    if config is None:
        return None
    return GlobalLLM(
        config=config,
        profile_id=str(profile.get("id") or ""),
        name=str(profile.get("name") or ""),
    )


def read_profile_config(profile_id: str) -> LLMConfig | None:
    """读某个 profile 的**已解密**配置（供端点合并"留空保留密钥"）。"""
    state = load_state()
    if state is None:
        return None
    profile = find_profile(state, profile_id)
    return decrypt_config(profile) if profile is not None else None


def read_record_config(name: str) -> LLMConfig | None:
    """按名称读一条记录的已解密配置（同名 upsert 时"留空保留原密钥"用）。"""
    state = load_state()
    if state is None:
        return None
    profile = _find_by_name(state, name)
    return decrypt_config(profile) if profile is not None else None


def _new_profile(
    config: LLMConfig, *, name: str, models: list[str] | None = None
) -> dict[str, Any]:
    now = _now()
    return {
        "id": new_profile_id(),
        "name": name,
        "config": store_config(config),
        "models": models or ([config.model] if config.model else []),
        "created_at": now,
        "updated_at": now,
    }


def write_global_llm(config: LLMConfig) -> GlobalLLM:
    """保存为**当前生效** profile；没有 profile 就新建「默认配置」。

    设置页的整表单保存走这里：用户改完端点/模型点保存，预期就是"这一套现在生效"，
    而不是"存成另一条记录但当前还用着旧的"。
    """

    def _apply(state: dict[str, Any]) -> None:
        block = state.setdefault("llm", {"enabled": True, "active_profile_id": "", "profiles": []})
        profiles = profiles_of(state)
        profile = active_profile_of(state)
        if profile is None:
            profile = _new_profile(config, name=_DEFAULT_RECORD_NAME)
            profiles.append(profile)
            block["profiles"] = profiles
            block["active_profile_id"] = profile["id"]
        else:
            profile["config"] = store_config(config)
            if config.model:
                profile["models"] = [config.model]
            profile["updated_at"] = _now()
        block["enabled"] = True

    state = mutate_state(_apply)
    active = active_profile_of(state)
    assert active is not None
    logger.info("已保存全局模型配置 id=%s model=%s", active.get("id"), config.model)
    return GlobalLLM(
        config=config,
        profile_id=str(active.get("id") or ""),
        name=str(active.get("name") or ""),
    )


def _record_payload(profile: dict[str, Any], active_id: str) -> dict[str, Any] | None:
    """profile → 前端记录对象；密钥永远是引用占位符。"""
    raw_config = profile.get("config")
    if not isinstance(raw_config, dict):
        return None
    try:
        # 先按"没有密钥"校验一遍，保证返回的字段形状与 LLMConfig 一致；
        # 密文本身绝不进响应。
        config = LLMConfig.model_validate({**raw_config, "api_key": ""})
    except ValidationError:
        logger.warning("全局模型配置记录字段非法，已跳过 id=%s", profile.get("id"))
        return None
    profile_id = str(profile.get("id") or "")
    payload = config.model_dump()
    payload["api_key"] = PROFILE_API_KEY_PREFIX + profile_id if raw_config.get("api_key") else ""
    models = profile.get("models")
    payload.update(
        {
            "id": profile_id,
            "name": str(profile.get("name") or ""),
            "models": [item for item in models if isinstance(item, str)]
            if isinstance(models, list)
            else [],
            "created_at": str(profile.get("created_at") or ""),
            "updated_at": str(profile.get("updated_at") or ""),
            "is_active": profile_id == active_id,
        }
    )
    return payload


def list_records() -> list[dict[str, Any]]:
    """全部已保存记录（最近更新的在前），带 `is_active`。"""
    state = load_state()
    if state is None:
        return []
    active = active_profile_of(state)
    active_id = str((active or {}).get("id") or "")
    records = [
        payload
        for payload in (_record_payload(item, active_id) for item in profiles_of(state))
        if payload is not None
    ]
    records.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    return records


def _find_by_name(state: dict[str, Any], name: str) -> dict[str, Any] | None:
    return find_profile_by_name(state, name)


def upsert_record(name: str, config: LLMConfig, models: list[str] | None = None) -> dict[str, Any]:
    """按名称新增/更新一条记录（沿用旧语义：同名即更新，不产生第二条）。

    新建记录**不会**抢占「使用中」——除了第一条（没有任何 active 时它自然是 active），
    否则"保存一套备用配置"会悄悄改掉所有数据集正在用的模型。
    """
    cleaned_name = clean_name(name)
    cleaned_models = clean_models(models)
    with write_lock:
        state = load_state() or fresh_state()
        block = state.setdefault("llm", {"enabled": True, "active_profile_id": "", "profiles": []})
        profiles = profiles_of(state)
        existing = _find_by_name(state, cleaned_name)
        if existing is None:
            if len(profiles) >= MAX_PROFILES:
                raise ValueError(f"最多保存 {MAX_PROFILES} 份模型配置")
            profile = _new_profile(config, name=cleaned_name, models=cleaned_models)
            profiles.append(profile)
            block["profiles"] = profiles
            if not block.get("active_profile_id"):
                block["active_profile_id"] = profile["id"]
        else:
            existing["config"] = store_config(config)
            existing["models"] = cleaned_models or (
                [config.model] if config.model else existing.get("models") or []
            )
            existing["updated_at"] = _now()
        block["enabled"] = True
        write_state_unlocked(state)
    logger.info("已保存全局模型记录 name=%s", cleaned_name)
    return _require_record(cleaned_name)


def _require_record(name: str) -> dict[str, Any]:
    state = load_state()
    active = active_profile_of(state) if state else None
    active_id = str((active or {}).get("id") or "")
    profile = _find_by_name(state, name) if state else None
    if profile is None or state is None:
        raise KeyError(name)
    payload = _record_payload(profile, active_id)
    if payload is None:
        raise KeyError(name)
    return payload


def delete_record(profile_id: str) -> None:
    """删除记录；删掉使用中的那条时切到剩下的第一条。"""
    with write_lock:
        state = load_state()
        profile = find_profile(state, profile_id) if state is not None else None
        if profile is None or state is None:
            raise KeyError(profile_id)
        block = state["llm"]
        remaining = [item for item in profiles_of(state) if item.get("id") != profile_id]
        block["profiles"] = remaining
        if not remaining:
            block["enabled"] = False
            block["active_profile_id"] = ""
        elif block.get("active_profile_id") == profile_id:
            block["active_profile_id"] = remaining[0]["id"]
        write_state_unlocked(state)
    logger.info("已删除全局模型记录 id=%s", profile_id)


def activate_profile(profile_id: str) -> dict[str, Any]:
    """把某条记录设为「使用中」；所有数据集立刻用它。"""
    with write_lock:
        state = load_state()
        profile = find_profile(state, profile_id) if state is not None else None
        if profile is None or state is None:
            raise KeyError(profile_id)
        state["llm"]["active_profile_id"] = profile_id
        state["llm"]["enabled"] = True
        write_state_unlocked(state)
    logger.info("已切换全局模型记录 id=%s", profile_id)
    return active_record_summary() or {}


def active_record_summary() -> dict[str, Any] | None:
    """当前生效记录的摘要（id/name/model）；没有则 None。"""
    state = load_state()
    profile = active_profile_of(state) if state else None
    if profile is None:
        return None
    raw_config = profile.get("config") if isinstance(profile.get("config"), dict) else {}
    return {
        "id": str(profile.get("id") or ""),
        "name": str(profile.get("name") or ""),
        "provider": str(raw_config.get("provider") or ""),
        "model": str(raw_config.get("model") or ""),
        "base_url": str(raw_config.get("base_url") or ""),
    }


def _config_from_dataset_record(row) -> LLMConfig | None:
    """ORM 记录 → LLMConfig（密钥解密；列集合按 LLMConfig 的字段取，忽略新增列）。"""
    from .api_key_crypto import decrypt_key

    data = {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name in LLMConfig.model_fields
    }
    try:
        return LLMConfig.model_validate(
            {**data, "api_key": decrypt_key(str(data.get("api_key") or ""))}
        )
    except ValidationError:
        logger.warning("数据集里的模型配置记录字段非法，已跳过 name=%s", getattr(row, "name", ""))
        return None


def migrate_from_dataset_once(db: Session) -> None:
    """把数据集里的旧配置一次性搬进全局（只做一次，之后永不自动导入）。

    触发点：`GET /api/settings/llm/records`。条件与动作见模块文档。写标记是关键——
    用户之后可以放心删光全局记录，不会下次打开设置页又被"复活"一遍。
    """
    from ..models.setting import LLMConfigRecord
    from .settings_service import get_dataset_llm_config

    state = load_state()
    block = (state or {}).get("llm")
    if isinstance(block, dict) and block.get("dataset_import_done"):
        return
    # 已经有全局记录（R21 的用户）：只补标记，绝不用数据集里的旧记录覆盖它们。
    if profiles_of(state or {}):
        mutate_state(lambda target: target["llm"].__setitem__("dataset_import_done", True))
        return

    rows = db.query(LLMConfigRecord).order_by(LLMConfigRecord.updated_at.desc()).all()
    imported: list[dict[str, Any]] = []
    for row in rows:
        config = _config_from_dataset_record(row)
        if config is None:
            continue
        imported.append(
            _new_profile(
                config, name=clean_name(row.name), models=[config.model] if config.model else []
            )
        )

    current = get_dataset_llm_config(db)
    active_id = ""
    if current.base_url and current.model:
        default = _new_profile(current, name=_DEFAULT_RECORD_NAME)
        imported.insert(0, default)
        active_id = default["id"]
    elif imported:
        active_id = imported[0]["id"]

    if not imported:
        # 真的一无所有：不写文件（没人希望升级后平白多一个 global_settings.json）。
        return

    def _apply(target: dict[str, Any]) -> None:
        target["llm"] = {
            "enabled": True,
            "active_profile_id": active_id or imported[0]["id"],
            "profiles": imported,
            "dataset_import_done": True,
        }

    mutate_state(_apply)
    logger.info("已从数据集迁移 %d 条模型配置到全局", len(imported))


__all__ = [
    "GlobalLLM",
    "activate_profile",
    "active_record_summary",
    "delete_record",
    "list_records",
    "merge_exported_profiles",
    "migrate_from_dataset_once",
    "read_global_llm",
    "read_profile_config",
    "read_record_config",
    "upsert_record",
    "write_global_llm",
]
