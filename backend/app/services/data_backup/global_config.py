# SPDX-License-Identifier: Apache-2.0
"""全局模型配置在备份包里的载体（`global_llm.json`）。

为什么单独一个成员而不是塞进 `manifest.json`：清单是**校验元数据**（表行数、sha256、
版本），会被导入侧逐字段检查；把用户配置混进去会让"清单格式"变成两种语义。单独成员
还便于旧版本忽略它——不过我们仍然升级了格式号（5），让旧版本**明确拒收**而不是
静默丢掉用户以为已经备份的配置。

密钥策略与数据库一致：`include_api_keys=false` 时写空串，绝不新造明文；
`true` 时按本机存储形态原样带走（Windows 上是 DPAPI 密文，换机器解不开时
`decrypt_key` 会按空串处理，配置本身仍然恢复）。

## 载荷版本 2：加上 `system_sources`

「外部连接」C 组的四项（更新源 / 字体源 / RAG 资产源 / 浏览器端口）不是密钥，
`include_api_keys` 的开关**不影响**它们，但它们同样是"数据集之外的一台机器的配置"，
换机器时应当跟着回来——验收口径要求"对应值进备份路径"。所以放在同一成员里加一个
`system_sources` 字段，并**只**升成员自己的载荷版本（1 → 2）；外层归档格式号不动：
加的是既有成员里的字段，不是新成员，旧版本读到它只会忽略那个键，不会少恢复任何东西。
"""

from __future__ import annotations

import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from ...config import get_settings
from ...schemas.setting import LLMConfig
from .. import system_sources
from ..global_settings import active_profile_of, load_state, profiles_of

GLOBAL_LLM_MEMBER = "global_llm.json"
# 2 = 成员里多了 `system_sources`（见模块头）。导入侧对 1/2 都接受：字段缺失即跳过。
GLOBAL_LLM_PAYLOAD_VERSION = 2


def build_global_llm_payload(*, include_api_keys: bool) -> dict[str, Any] | None:
    """把全部已保存记录打包成可写入 zip 的字典；两份内容都空时返回 None。"""
    state = load_state()
    profiles = profiles_of(state or {})
    sources = system_sources.export_overrides()
    if not profiles and not sources:
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
    if not exported and not sources:
        return None
    settings = get_settings()
    return {
        "format": GLOBAL_LLM_PAYLOAD_VERSION,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "active_profile_id": active_id,
        "profiles": exported,
        # 「外部连接」C 组：只写用户改过的项（默认值由代码自带，不必进包）。
        "system_sources": sources,
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
    summary: dict[str, Any] = {"profiles": len(profiles) if isinstance(profiles, list) else 0}
    sources = payload.get("system_sources")
    if isinstance(sources, dict):
        # 「外部连接」C 组：只报条数，值本身是下载源与端口，不需要进界面摘要。
        summary["system_sources"] = len(sources)
    return summary


def restore_global_system_sources(payload: dict[str, Any] | None) -> int:
    """从载荷里恢复「外部连接」C 组四项，返回真正恢复的条数。

    旧包（载荷版本 1）没有这个字段 → 返回 0，不报错。单条非法值只跳过那一条，
    不让一份过期备份把整次导入判成失败（与字体/模型配置同样的"边上信息"口径）。
    """
    if not payload:
        return 0
    return system_sources.restore_overrides(payload.get("system_sources"))


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
    "restore_global_system_sources",
    "write_global_llm_member",
]
