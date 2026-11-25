# SPDX-License-Identifier: Apache-2.0
"""服务配置在备份包里的载体（`global_services.json`）。

换机恢复后语音转写、语义检索、三把搜索 Key、代理**全丢**——它们都在
``global_settings.json`` 里，而那个文件此前整体被 ``coverage.py`` 列为"已知不覆盖"
（只有大模型配置经 ``global_llm.json`` 单独带走）。本模块补上另外四块：

    asr_profiles        语音转写的命名配置
    embedding_profiles  语义检索的命名配置
    web_search          联网搜索的来源 / 地址 / 三把 Key
    network             代理模式 / 地址 / 用户名 / 口令密文

**密钥策略与 ``global_llm.json`` 逐字一致**：``include_api_keys=false`` 时把密钥字段写成
空串（结构保留——地址、模型、端口必须回来），``true`` 时按本机存储形态原样带走（Windows
上是 DPAPI 密文；换机解不开时读取侧按空串处理，用户重填即可）。密钥字段的名单只在本
模块的 :data:`SECRET_FIELDS` 里出现一次——导出剥离、恢复判定"包里有没有带密钥"都读它，
不允许第二份手写名单（漏一处的后果是明文进备份包）。

**为什么要升外层格式号**：新成员自带 ``version``，但旧版本读到它只会忽略，于是"用户以为
服务配置跟着备份了、恢复时却没有"。升到 7 让旧版本明确拒收（"请先升级应用"），与本仓库
对格式 5（模型配置）/ 6（字体）的处置一致。
"""

from __future__ import annotations

import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from ...config import get_settings
from .. import global_settings
from ..llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

GLOBAL_SERVICES_MEMBER = "global_services.json"
GLOBAL_SERVICES_VERSION = 1

SECTION_ASR = "asr_profiles"
SECTION_EMBEDDING = "embedding_profiles"
SECTION_WEB_SEARCH = "web_search"
SECTION_NETWORK = "network"
SECTIONS: tuple[str, ...] = (SECTION_ASR, SECTION_EMBEDDING, SECTION_WEB_SEARCH, SECTION_NETWORK)

# **唯一**一份密钥字段名单。``<块名>.<字段>`` 形式；profile 类的密钥在
# ``profiles[].api_key`` / ``profiles[].config.api_key``，单列在这里说明白。
SECRET_FIELDS: dict[str, tuple[str, ...]] = {
    SECTION_WEB_SEARCH: (
        "deepseek_api_key",
        "tavily_api_key",
        "jina_api_key",
        # CR-09：自定义搜索源的那把 Key 与其它三把同口径（include_api_keys=false 时写空串）。
        # 漏了它不会报错，只会让"带上密钥的备份"缺一把 Key、而剥离开关看起来仍然生效。
        "custom_api_key",
    ),
    SECTION_NETWORK: ("proxy_password",),
    SECTION_ASR: ("api_key",),
    SECTION_EMBEDDING: ("api_key",),
}

# 各段允许进包的非密钥字段：白名单而不是"整块照抄"，文件被手工改过时未知键不该传播。
_ASR_PROFILE_FIELDS = (
    "id",
    "name",
    "preset_id",
    "base_url",
    "model",
    "protocol",
    "updated_at",
)
_EMBEDDING_PROFILE_FIELDS = ("id", "name", "created_at", "updated_at")
_WEB_SEARCH_FIELDS = (
    "sources",
    "searxng_url",
    "depth",
    "max_results",
    # CR-09：自定义源的模板与端点是**非密钥**字段，必须跟着备份走。否则恢复后 `sources`
    # 里仍有 "custom"、却找不到根地址，自定义源会静默失效（用户以为"备份没恢复"）。
    "custom_template",
    "custom_name",
    "custom_base_url",
    "custom_search_path",
    "custom_fetch_path",
    "custom_results_field",
    "custom_include_content",
)
_NETWORK_FIELDS = ("proxy_mode", "proxy_url", "proxy_username", "trust_system_certs")

#: 恢复报告里给用户看的密钥说明（``include_api_keys=false`` 时必定出现在报告里）。
KEY_NOTICE_STRIPPED = "备份未包含 API Key：语音转写、语义检索与联网搜索的 Key 需要在本机重填"
#: 包内带了密钥时的说明：Windows 上是 DPAPI 密文，绑定原电脑与原用户，换机解不开。
#: 不能说成"Key 已恢复"——用户要的是"能用"，而换机后大概率不能用。
KEY_NOTICE_MAY_NOT_DECRYPT = (
    "备份包含 API Key，但换机后可能无法解密（Windows 密文绑定原电脑与原用户）："
    "语音转写、语义检索与联网搜索的 Key 请在设置页核对，显示为空时重填"
)


def _block(state: dict[str, Any] | None, key: str) -> dict[str, Any] | None:
    block = (state or {}).get(key)
    return block if isinstance(block, dict) else None


def _profiles_of(block: dict[str, Any] | None) -> list[dict[str, Any]]:
    items = (block or {}).get("profiles")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id")]


def _secret(value: Any, include_api_keys: bool) -> str:
    """密钥字段的导出值：不留 ``********`` 掩码（它只在本机有意义），只要空串或原值。"""
    stored = str(value or "")
    if not include_api_keys or stored == API_KEY_MASK:
        return ""
    return stored


def _export_asr(block: dict[str, Any], include_api_keys: bool) -> dict[str, Any]:
    profiles: list[dict[str, Any]] = []
    for item in _profiles_of(block):
        exported = {key: item.get(key) for key in _ASR_PROFILE_FIELDS if key in item}
        exported["api_key"] = _secret(item.get("api_key"), include_api_keys)
        profiles.append(exported)
    return {
        "version": block.get("version", 1),
        "active_profile_id": str(block.get("active_profile_id") or ""),
        "profiles": profiles,
    }


def _export_embedding(block: dict[str, Any], include_api_keys: bool) -> dict[str, Any]:
    profiles: list[dict[str, Any]] = []
    for item in _profiles_of(block):
        config = item.get("config") if isinstance(item.get("config"), dict) else {}
        sanitized = {key: value for key, value in config.items() if key != "api_key"}
        sanitized["api_key"] = _secret(config.get("api_key"), include_api_keys)
        exported = {key: item.get(key) for key in _EMBEDDING_PROFILE_FIELDS if key in item}
        exported["config"] = sanitized
        profiles.append(exported)
    return {
        "section_version": block.get("section_version", 1),
        "active_profile_id": str(block.get("active_profile_id") or ""),
        "profiles": profiles,
    }


def _export_flat(
    block: dict[str, Any],
    section: str,
    fields: tuple[str, ...],
    include_api_keys: bool,
) -> dict[str, Any]:
    """扁平段：非密钥白名单字段原样带，密钥字段按开关写空串或原值。"""
    exported: dict[str, Any] = {key: block[key] for key in fields if key in block}
    for field in SECRET_FIELDS[section]:
        exported[field] = _secret(block.get(field), include_api_keys)
    return exported


def build_global_services_payload(*, include_api_keys: bool) -> dict[str, Any] | None:
    """把四块服务配置打包成可写入 zip 的字典；四块都空时返回 None。"""
    state = global_settings.load_state()
    services: dict[str, Any] = {}
    asr = _block(state, SECTION_ASR)
    if asr is not None and _profiles_of(asr):
        services[SECTION_ASR] = _export_asr(asr, include_api_keys)
    embedding = _block(state, SECTION_EMBEDDING)
    if embedding is not None and _profiles_of(embedding):
        services[SECTION_EMBEDDING] = _export_embedding(embedding, include_api_keys)
    web = _block(state, SECTION_WEB_SEARCH)
    if web is not None:
        services[SECTION_WEB_SEARCH] = _export_flat(
            web, SECTION_WEB_SEARCH, _WEB_SEARCH_FIELDS, include_api_keys
        )
    network = _block(state, SECTION_NETWORK)
    if network is not None:
        services[SECTION_NETWORK] = _export_flat(
            network, SECTION_NETWORK, _NETWORK_FIELDS, include_api_keys
        )
    if not services:
        return None
    settings = get_settings()
    return {
        "format": GLOBAL_SERVICES_VERSION,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "services": services,
    }


def read_global_services_payload(archive_path: Path) -> dict[str, Any] | None:
    """从备份包里读服务配置段；没有该成员（旧包）时返回 None。"""
    try:
        with zipfile.ZipFile(archive_path) as archive:
            raw = archive.read(GLOBAL_SERVICES_MEMBER)
    except KeyError:
        return None
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"备份包里的服务配置段不可读：{exc}") from exc
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("备份包里的服务配置段不是合法 JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("services"), dict):
        raise ValueError("备份包里的服务配置段结构不正确")
    return payload


def payload_summary(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """清单/界面用的摘要：只报**有内容的段名**，不含任何配置值。"""
    if not payload:
        return None
    services = payload.get("services")
    if not isinstance(services, dict):
        return None
    return {"version": payload.get("format"), "sections": len(services)}


def write_global_services_member(archive: zipfile.ZipFile, payload: dict | None) -> int:
    """把服务配置段写进 zip，返回段数（0 = 没写）。"""
    if payload is None:
        return 0
    archive.writestr(GLOBAL_SERVICES_MEMBER, json.dumps(payload, ensure_ascii=False, indent=2))
    services = payload.get("services")
    return len(services) if isinstance(services, dict) else 0


def _keys_included(payload: dict[str, Any]) -> bool:
    """包内是否带了密钥（任一密钥字段非空即算）。供恢复报告决定要不要提示重填。"""
    services = payload.get("services")
    if not isinstance(services, dict):
        return False
    for section, block in services.items():
        if not isinstance(block, dict):
            continue
        for field in SECRET_FIELDS.get(section, ()):
            if section in (SECTION_ASR, SECTION_EMBEDDING):
                continue  # profile 类的密钥在 profiles[].*，下面单独查
            if str(block.get(field) or ""):
                return True
        for profile in _profiles_of(block):
            config = profile.get("config") if isinstance(profile.get("config"), dict) else profile
            if str(config.get("api_key") or ""):
                return True
    return False


def _merge_profiles(
    state: dict[str, Any],
    block_key: str,
    incoming: dict[str, Any],
    *,
    body_key: str | None,
    fields: tuple[str, ...],
) -> tuple[int, int]:
    """按名称把包里的 profile 合并进本地块，返回 ``(imported, skipped)``。

    与 ``global_llm_merge`` 同一口径：同名且本地已有内容 → 保留本地（别人机器的配置不该
    覆盖你正在用的 Key 与端点）；本地没有 → 新增并分配新 id。

    ``body_key`` 是 profile 的正文键名（语义检索是 ``config``）；语音配置的正文**内联**
    在 profile 自己的键上，此时传 ``None``，正文按 ``fields`` 白名单摘出来。
    """
    block = state.get(block_key)
    if not isinstance(block, dict):
        block = {"profiles": []}
        state[block_key] = block
    local = block.get("profiles") if isinstance(block.get("profiles"), list) else []
    block["profiles"] = local
    by_name = {str(item.get("name") or ""): item for item in local if isinstance(item, dict)}
    imported = skipped = 0
    for source in _profiles_of(incoming):
        name = str(source.get("name") or "").strip()
        if not name:
            continue
        body = _profile_body(source, body_key, fields)
        if not body:
            continue
        existing = by_name.get(name)
        if existing is not None and _profile_has_content(existing, body_key, fields):
            skipped += 1
            continue
        if existing is not None:
            existing.update(body)
            existing["name"] = name
            imported += 1
            continue
        created: dict[str, Any] = {"id": _new_profile_id(), "name": name}
        created.update(body)
        local.append(created)
        by_name[name] = created
        imported += 1
    if not str(block.get("active_profile_id") or "") and imported:
        chosen = by_name.get(_active_name(incoming))
        if chosen is not None:
            block["active_profile_id"] = str(chosen.get("id") or "")
    return imported, skipped


def _new_profile_id() -> str:
    """本地 id 由本机分配（包里的 id 只用于对齐 active，不直接落库）。"""
    return global_settings.new_profile_id()


def _profile_body(
    source: dict[str, Any], body_key: str | None, fields: tuple[str, ...]
) -> dict[str, Any]:
    """取一条 profile 的正文；``body_key=None`` 表示正文内联在 profile 自己的键上。"""
    if body_key is not None:
        body = source.get(body_key)
        return dict(body) if isinstance(body, dict) else {}
    return {key: source[key] for key in fields if key in source and key not in ("id", "name")}


def _active_name(incoming: dict[str, Any]) -> str:
    active_id = str(incoming.get("active_profile_id") or "")
    for item in _profiles_of(incoming):
        if str(item.get("id") or "") == active_id:
            return str(item.get("name") or "")
    return ""


def _profile_has_content(
    profile: dict[str, Any], body_key: str | None, fields: tuple[str, ...]
) -> bool:
    body = _profile_body(profile, body_key, fields)
    return any(
        bool(value)
        for key, value in body.items()
        if key not in ("api_key", "updated_at", "id", "name")
    )


def _merge_flat(state: dict[str, Any], section: str, incoming: dict[str, Any]) -> bool:
    """扁平段（web_search / network）：只补本地空着的项，不动已有值。返回是否有改动。"""
    block = state.get(section)
    if not isinstance(block, dict):
        state[section] = dict(incoming)
        return True
    changed = False
    for key, value in incoming.items():
        if key in SECRET_FIELDS.get(section, ()) and not str(value or ""):
            continue  # 包里没带密钥（已被剥离）：不能把本地 Key 抹掉
        if not block.get(key) and value not in (None, "", [], {}):
            block[key] = value
            changed = True
    return changed


def restore_global_services(payload: dict[str, Any] | None) -> dict[str, Any]:
    """把服务配置段合并回本机，返回逐段计数（可直接进导入报告）。

    单段非法只跳过那一段，不让一份过期备份把整次导入判成失败——与字体/模型配置同样的
    "边上信息"口径。
    """
    result: dict[str, Any] = {
        SECTION_ASR: {"imported": 0, "skipped": 0},
        SECTION_EMBEDDING: {"imported": 0, "skipped": 0},
        SECTION_WEB_SEARCH: False,
        SECTION_NETWORK: False,
        "keys_included": False,
        "key_notice": "",
    }
    if not payload:
        return result
    services = payload.get("services")
    if not isinstance(services, dict):
        return result
    result["keys_included"] = _keys_included(payload)

    def _apply(state: dict[str, Any]) -> None:
        asr = services.get(SECTION_ASR)
        if isinstance(asr, dict):
            imported, skipped = _merge_profiles(
                state,
                SECTION_ASR,
                asr,
                body_key=None,
                fields=_ASR_PROFILE_FIELDS + SECRET_FIELDS[SECTION_ASR],
            )
            result[SECTION_ASR] = {"imported": imported, "skipped": skipped}
        embedding = services.get(SECTION_EMBEDDING)
        if isinstance(embedding, dict):
            imported, skipped = _merge_profiles(
                state,
                SECTION_EMBEDDING,
                embedding,
                body_key="config",
                fields=_EMBEDDING_PROFILE_FIELDS,
            )
            result[SECTION_EMBEDDING] = {"imported": imported, "skipped": skipped}
        web = services.get(SECTION_WEB_SEARCH)
        if isinstance(web, dict):
            result[SECTION_WEB_SEARCH] = _merge_flat(state, SECTION_WEB_SEARCH, web)
        network = services.get(SECTION_NETWORK)
        if isinstance(network, dict):
            result[SECTION_NETWORK] = _merge_flat(state, SECTION_NETWORK, network)

    try:
        global_settings.mutate_state(_apply)
    except OSError as exc:
        logger.warning("服务配置未能写回全局设置：%s", exc)
        result["error"] = "服务配置未能写回，详情见服务端日志"
        return result
    if not result["keys_included"]:
        result["key_notice"] = KEY_NOTICE_STRIPPED
    else:
        # 带了密钥不等于"换机后能用"：DPAPI 密文跨机器/跨用户解不开。报告必须说清。
        result["key_notice"] = KEY_NOTICE_MAY_NOT_DECRYPT
    _invalidate_caches()
    return result


def _invalidate_caches() -> None:
    """代理设置与搜索配置都有进程内快照，写完必须立刻失效。"""
    try:
        from .. import net_settings

        net_settings.invalidate()
    except Exception:  # noqa: BLE001 - 缓存失效失败不该让导入失败
        logger.debug("网络设置缓存失效失败", exc_info=True)


__all__ = [
    "GLOBAL_SERVICES_MEMBER",
    "GLOBAL_SERVICES_VERSION",
    "KEY_NOTICE_MAY_NOT_DECRYPT",
    "KEY_NOTICE_STRIPPED",
    "SECTIONS",
    "SECRET_FIELDS",
    "SECTION_ASR",
    "SECTION_EMBEDDING",
    "SECTION_NETWORK",
    "SECTION_WEB_SEARCH",
    "build_global_services_payload",
    "payload_summary",
    "read_global_services_payload",
    "restore_global_services",
    "write_global_services_member",
]
