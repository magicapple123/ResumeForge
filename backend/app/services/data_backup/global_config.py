# SPDX-License-Identifier: Apache-2.0
"""全局模型配置在备份包里的载体（`global_llm.json`）。

为什么单独一个成员而不是塞进 `manifest.json`：清单是**校验元数据**（表行数、sha256、
版本），会被导入侧逐字段检查；把用户配置混进去会让"清单格式"变成两种语义。单独成员
还便于旧版本忽略它——不过我们仍然升级了格式号（5），让旧版本**明确拒收**而不是
静默丢掉用户以为已经备份的配置。

密钥策略与数据库一致：`include_api_keys=false` 时写空串，绝不新造明文；
`true` 时按本机存储形态原样带走（Windows 上是 DPAPI 密文，换机器解不开时
`decrypt_key` 会按空串处理，配置本身仍然恢复）。
"""

from __future__ import annotations

import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from ...config import get_settings
from ...schemas.setting import LLMConfig
from ..global_settings import active_profile_of, load_state, profiles_of

GLOBAL_LLM_MEMBER = "global_llm.json"
GLOBAL_LLM_PAYLOAD_VERSION = 1


def build_global_llm_payload(*, include_api_keys: bool) -> dict[str, Any] | None:
    """把全部已保存记录打包成可写入 zip 的字典；没有任何记录时返回 None。"""
    state = load_state()
    profiles = profiles_of(state or {})
    if not profiles:
        return None
    active = active_profile_of(state or {})
    active_id = str((active or {}).get("id") or "")
    exported: list[dict[str, Any]] = []
    for profile in profiles:
        raw_config = profile.get("config")
        if not isinstance(raw_config, dict):
            continue
        # 只带走 LLMConfig 认识的字段：文件被手工改过时，未知键不该跟着传播。
        config = {key: raw_config[key] for key in LLMConfig.model_fields if key in raw_config}
        config["api_key"] = str(raw_config.get("api_key") or "") if include_api_keys else ""
        models = profile.get("models")
        exported.append(
            {
                "id": str(profile.get("id") or ""),
                "name": str(profile.get("name") or ""),
                "config": config,
                "models": [item for item in models if isinstance(item, str)]
                if isinstance(models, list)
                else [],
                "created_at": str(profile.get("created_at") or ""),
                "updated_at": str(profile.get("updated_at") or ""),
            }
        )
    if not exported:
        return None
    settings = get_settings()
    return {
        "format": GLOBAL_LLM_PAYLOAD_VERSION,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "active_profile_id": active_id,
        "profiles": exported,
    }


def read_global_llm_payload(archive_path: Path) -> dict[str, Any] | None:
    """从备份包里读全局配置段；没有该成员（旧包）时返回 None。"""
    try:
        with zipfile.ZipFile(archive_path) as archive:
            raw = archive.read(GLOBAL_LLM_MEMBER)
    except KeyError:
        return None
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"备份包里的模型配置段不可读：{exc}") from exc
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("备份包里的模型配置段不是合法 JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("profiles"), list):
        raise ValueError("备份包里的模型配置段结构不正确")
    return payload


def payload_summary(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """给界面/清单用的摘要（不泄露任何配置内容）。"""
    if not payload:
        return None
    profiles = payload.get("profiles")
    return {"profiles": len(profiles) if isinstance(profiles, list) else 0}


def write_global_llm_member(archive: zipfile.ZipFile, payload: dict[str, Any] | None) -> int:
    """把配置段写进 zip，返回记录条数（0 = 没写）。"""
    if payload is None:
        return 0
    archive.writestr(GLOBAL_LLM_MEMBER, json.dumps(payload, ensure_ascii=False, indent=2))
    profiles = payload.get("profiles")
    return len(profiles) if isinstance(profiles, list) else 0


__all__ = [
    "GLOBAL_LLM_MEMBER",
    "GLOBAL_LLM_PAYLOAD_VERSION",
    "build_global_llm_payload",
    "payload_summary",
    "read_global_llm_payload",
    "write_global_llm_member",
]
