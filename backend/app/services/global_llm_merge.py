# SPDX-License-Identifier: Apache-2.0
"""把备份包里的全局模型配置合并回本机（H-2）。

从 ``global_llm_profiles`` 拆出：合并规则（只补不覆盖、空壳补全、active 采纳）与
"记录怎么存/怎么切"是两件事，各自成文件才守得住 500 行预算，也让合并逻辑可以
单独测试而不必构造整个服务。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from ..schemas.setting import LLMConfig
from .global_settings import (
    MAX_PROFILES,
    active_profile_of,
    clean_name,
    find_profile_by_name,
    fresh_state,
    load_state,
    new_profile_id,
    profiles_of,
    write_lock,
    write_state_unlocked,
)

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _profile_is_empty(profile: dict[str, Any]) -> bool:
    raw = profile.get("config")
    if not isinstance(raw, dict):
        return True
    return not str(raw.get("base_url") or "").strip() and not str(raw.get("model") or "").strip()


def merge_exported_profiles(payload: Any) -> dict[str, Any]:
    """把备份包里的全部记录合并进本地，返回计数（**不覆盖同名且已有内容的记录**）。

    合并规则（与用户指南一致）：

    - 本地没有同名记录 → 新增（分配新的本地 id）；
    - 同名但本地那条是空壳（地址与模型都没填）→ 用包里的覆盖（真实用户数据里确实
      会留下这种"点开过但没填"的默认记录，不覆盖的话导入永远等于什么都没导入）；
    - 同名且本地已有内容 → 保留本地、计入 ``skipped``（避免用别的机器的配置覆盖
      你正在用的密钥与端点）；
    - 「使用中」：只有本地**没有**使用中或使用中的是空壳时，才把包里的 active
      指过来；否则不动本地选择。

    密钥按包内存储形态原样合并：同一台机器恢复能直接解密；换机器时
    ``decrypt_key`` 会按空串处理，配置本身仍然可用。
    """
    if not isinstance(payload, dict):
        raise ValueError("全局模型配置段结构不正确")
    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, list):
        raise ValueError("全局模型配置段缺少 profiles")

    active_source_id = str(payload.get("active_profile_id") or "")
    active_name = ""
    entries: list[tuple[str, LLMConfig, list[str]]] = []
    seen: set[str] = set()
    invalid = 0
    for raw in raw_profiles:
        if not isinstance(raw, dict):
            invalid += 1
            continue
        try:
            name = clean_name(str(raw.get("name") or ""))
            raw_config = raw.get("config")
            if not isinstance(raw_config, dict):
                raise ValueError("config 不是对象")
            config = LLMConfig.model_validate(
                {key: raw_config[key] for key in LLMConfig.model_fields if key in raw_config}
            )
        except (ValueError, ValidationError):
            invalid += 1
            continue
        if name in seen:
            invalid += 1
            continue
        seen.add(name)
        models = [item for item in raw.get("models") or [] if isinstance(item, str)]
        entries.append((name, config, models))
        if raw.get("id") == active_source_id:
            active_name = name

    imported = updated = skipped = 0
    active_set = False
    with write_lock:
        state = load_state() or fresh_state()
        block = state.setdefault("llm", {"enabled": True, "active_profile_id": "", "profiles": []})
        # 先记下"合并前"的 active 是否为空壳：循环里可能刚好把它补全，
        # 补全后再判断就永远看不出"这条原本不可用"。
        active_before = active_profile_of(state)
        active_was_empty = active_before is None or _profile_is_empty(active_before)
        for name, config, models in entries:
            existing = find_profile_by_name(state, name)
            if existing is None:
                if len(profiles_of(state)) >= MAX_PROFILES:
                    skipped += 1
                    continue
                profile = {
                    "id": new_profile_id(),
                    "name": name,
                    "config": config.model_dump(),
                    "models": models or ([config.model] if config.model else []),
                    "created_at": _now(),
                    "updated_at": _now(),
                }
                block.setdefault("profiles", []).append(profile)
                imported += 1
            elif _profile_is_empty(existing):
                # 包里的 api_key 已经是**存储形态**（密文或明文），不能再加密一次；
                # store_config 只用于"用户刚输入的明文 -> 落盘形态"。
                existing["config"] = config.model_dump()
                existing["models"] = models or existing.get("models") or []
                existing["updated_at"] = _now()
                updated += 1
            else:
                skipped += 1

        if active_name and active_was_empty:
            target = find_profile_by_name(state, active_name)
            if target is not None and not _profile_is_empty(target):
                block["active_profile_id"] = str(target.get("id") or "")
                active_set = True
        if imported or updated or active_set:
            block["enabled"] = True
            write_state_unlocked(state)
    if imported or updated or active_set:
        logger.info(
            "已导入全局模型配置 imported=%d updated=%d skipped=%d active=%s",
            imported,
            updated,
            skipped,
            active_set,
        )
    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "invalid": invalid,
        "active": active_set,
        "profiles": imported + updated,
    }
