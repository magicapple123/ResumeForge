# SPDX-License-Identifier: Apache-2.0
"""语音转写的**命名配置**：`global_settings.json` 顶层 `asr_profiles` 段的读写与语义。

为什么放全局而不是数据集：语音服务地址与 Key 描述的是"这台机器怎么听写"，与当前打开
哪份数据集无关。旧版把 `asr_config` / `asr_api_key` 存在每个数据集自己的 AppSetting 里，
切数据集就换一套服务商。

为什么是独立顶层键、不塞进 `asr_config`：`asr_settings` 保存单配置时会整体重建那份
JSON，profiles 塞进去会被静默抹掉。也**不提升** `GLOBAL_SETTINGS_VERSION`——
`load_state()` 在版本不等于 2 时返回 None，升版本会让主题与大模型配置一起读丢。

存储形态（`version` 留作结构演进的余地；新增顶层键不需要动全局版本号）：

    "asr_profiles": {
      "version": 1,
      "active_profile_id": "a_ab12cd34ef56",
      "profiles": [{"id": "a_ab12cd34ef56", "name": "公司 OpenAI", "preset_id": "openai",
                    "base_url": "...", "model": "whisper-1", "protocol": "openai",
                    "api_key": "<encrypted>", "updated_at": "2026-11-09T11:00:00+00:00"}]
    }

Key 的写入口径（**按条判断，绝不跨条继承**）：新字符串 → 加密写进这一条；掩码或空串 →
仅当这一条的 `base_url` 与 `protocol` 都没变时保留它自己的旧 Key，任一变了就清空（把旧
服务商的 Key 发到新主机是越权外发）；`__clear__` → 显式清空这一条。

旧数据的解析与迁移（`migrate_legacy_asr_once`）在 `asr_settings`：那里同时保留"迁移前
读旧 AppSetting 行"的兼容路径，两者必须共用同一段旧行读取代码。
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from ..schemas.asr import (
    DEFAULT_ASR_PROTOCOL,
    AsrProfileIn,
    AsrProfileOut,
    AsrProfilesOut,
    AsrProfileTestRequest,
    AsrProtocol,
    AsrSettings,
)
from .api_key_crypto import decrypt_key, encrypt_key
from .global_settings import load_state, mutate_state
from .llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

_ASR_PROFILES_KEY = "asr_profiles"
_ASR_PROFILES_VERSION = 1

# 上限与名称长度对齐界面（前端输入框也限 64 字）；10 条够覆盖"公司 / 家里 / 备用"。
MAX_ASR_PROFILES = 10
MAX_ASR_PROFILE_NAME_LENGTH = 64
# 新建记录时的默认名（与大模型配置卡的「默认配置」同一口径）。
DEFAULT_PROFILE_NAME = "默认配置"

# 前端「清除 Key」显式发送的哨兵值：空串的语义是"沿用旧 Key"，两者必须分得开。
CLEAR_API_KEY = "__clear__"
# 「测试连接」允许在**新建**弹窗里调用——此时还没有 id。真实 id 都带 `a_` 前缀，不会撞。
NEW_PROFILE_SENTINEL = "new"


class AsrProfileError(ValueError):
    """可直接翻成 400 的配置错误（名称非法、条数超限、生效项不完整）。"""


class AsrProfileNameConflict(AsrProfileError):
    """名称在本地唯一；重名返回 409，前端就地报错。"""


class AsrProfileLimitError(AsrProfileError):
    """超过 :data:`MAX_ASR_PROFILES`。"""


class AsrProfileIncomplete(AsrProfileError):
    """缺地址/模型/Key 的配置不允许设为「使用中」。"""


class AsrProfileNotFound(KeyError):
    """指定的配置 id 不存在。"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def new_profile_id() -> str:
    """配置 id：`a_` 前缀让"这是语音配置"在日志里一眼可辨，也避开测试占位 `new`。"""
    return f"a_{secrets.token_hex(6)}"


def _normalize_protocol(raw: Any) -> AsrProtocol:
    """落盘值可能被旧版本写坏：不认识的协议按默认值读，不让整页 500。"""
    return raw if raw in ("openai", "dashscope") else DEFAULT_ASR_PROTOCOL


def _block_of(state: dict[str, Any] | None) -> dict[str, Any] | None:
    """取 `asr_profiles` 段；None = **没有这个键**（= 还没迁移），空 profiles 不算。"""
    if not isinstance(state, dict):
        return None
    block = state.get(_ASR_PROFILES_KEY)
    return block if isinstance(block, dict) else None


def _profiles_of(block: dict[str, Any] | None) -> list[dict[str, Any]]:
    items = (block or {}).get("profiles")
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id")]


def _find_profile(block: dict[str, Any] | None, profile_id: str) -> dict[str, Any] | None:
    for item in _profiles_of(block):
        if str(item.get("id") or "") == profile_id:
            return item
    return None


def _active_profile(block: dict[str, Any] | None) -> dict[str, Any] | None:
    """生效项。**不像大模型那样回落到第一条**：生效必须是显式选择（迁移/删除时另行写入）。"""
    active_id = str((block or {}).get("active_profile_id") or "")
    return _find_profile(block, active_id) if active_id else None


def _decrypted_key(profile: dict[str, Any] | None) -> str:
    return decrypt_key(str((profile or {}).get("api_key") or ""))


def _is_configured(profile: dict[str, Any] | None) -> bool:
    """三要素齐全才算可用：只有 Key 没有地址/模型，发不出一次合法请求。"""
    return bool(
        str((profile or {}).get("base_url") or "")
        and str((profile or {}).get("model") or "")
        and _decrypted_key(profile)
    )


def _settings_of(profile: dict[str, Any]) -> AsrSettings:
    """profile → 运行时配置（含解密后的 Key，仅供后端调上游用）。"""
    return AsrSettings(
        base_url=str(profile.get("base_url") or ""),
        api_key=_decrypted_key(profile),
        model=str(profile.get("model") or ""),
        protocol=_normalize_protocol(profile.get("protocol")),
    )


def _profile_out(profile: dict[str, Any]) -> AsrProfileOut:
    """脱敏形态：**密钥本体绝不进响应**，`has_key` 只说明有没有已保存的 Key。"""
    key = _decrypted_key(profile)
    base_url = str(profile.get("base_url") or "")
    model = str(profile.get("model") or "")
    return AsrProfileOut(
        id=str(profile.get("id") or ""),
        name=str(profile.get("name") or ""),
        preset_id=str(profile.get("preset_id") or ""),
        base_url=base_url,
        model=model,
        protocol=_normalize_protocol(profile.get("protocol")),
        has_key=bool(key),
        configured=bool(base_url and model and key),
        updated_at=str(profile.get("updated_at") or ""),
    )


def _snapshot(state: dict[str, Any] | None) -> AsrProfilesOut:
    block = _block_of(state)
    if block is None:
        return AsrProfilesOut()
    return AsrProfilesOut(
        active_profile_id=str(block.get("active_profile_id") or ""),
        profiles=[_profile_out(item) for item in _profiles_of(block)],
    )


def _ensure_block(state: dict[str, Any]) -> dict[str, Any]:
    """取写操作要用的段；没有就建一个空段（写操作本身即"已迁移"标记）。"""
    block = _block_of(state)
    if block is None:
        block = {"version": _ASR_PROFILES_VERSION, "active_profile_id": "", "profiles": []}
        state[_ASR_PROFILES_KEY] = block
    block.setdefault("version", _ASR_PROFILES_VERSION)
    block.setdefault("active_profile_id", "")
    if not isinstance(block.get("profiles"), list):
        block["profiles"] = []
    return block


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise AsrProfileError("配置名称不能为空")
    if len(cleaned) > MAX_ASR_PROFILE_NAME_LENGTH:
        raise AsrProfileError(f"配置名称最多 {MAX_ASR_PROFILE_NAME_LENGTH} 个字符")
    return cleaned


def _binding_changed(profile: dict[str, Any], base_url: str, protocol: AsrProtocol) -> bool:
    """地址或协议变了 = 这一条已保存的 Key 不再适用（与单配置同一判据）。"""
    return (
        str(profile.get("base_url") or "") != base_url
        or _normalize_protocol(profile.get("protocol")) != protocol
    )


def _resolve_key(
    profile: dict[str, Any] | None, raw_api_key: str, base_url: str, protocol: AsrProtocol
) -> str | None:
    """把请求里的 `api_key` 解析成"这一条要落盘的值"。

    返回 `None` = 保持这一条原有的加密值不动；`""` = 清空；其它字符串 = 已加密的新 Key。
    """
    raw = raw_api_key or ""
    changed = profile is None or _binding_changed(profile, base_url, protocol)
    if raw == CLEAR_API_KEY:
        return ""
    if not raw or raw.startswith(API_KEY_MASK):
        return "" if changed else None
    return encrypt_key(raw)


def profiles_defined() -> bool:
    """`asr_profiles` 键是否存在（空 profiles 也算"已迁移"）。"""
    return _block_of(load_state()) is not None


def active_profile_id() -> str:
    """当前生效项的 id；没有生效项返回空串（不回落第一条）。"""
    block = _block_of(load_state())
    return str((block or {}).get("active_profile_id") or "")


def list_asr_profiles() -> AsrProfilesOut:
    """全部配置（脱敏）+ `active_profile_id`；没有迁移过时返回空列表。"""
    return _snapshot(load_state())


def active_profile_settings() -> AsrSettings | None:
    """生效配置（含解密后的 Key）；没有生效项返回 None。"""
    profile = _active_profile(_block_of(load_state()))
    return _settings_of(profile) if profile is not None else None


def profile_settings(profile_id: str) -> AsrSettings | None:
    """按 id 取一条配置（含解密后的 Key），供「测试连接」等只读场景。"""
    profile = _find_profile(_block_of(load_state()), profile_id)
    return _settings_of(profile) if profile is not None else None


def _validate_save(block: dict[str, Any], name: str, profile_id: str) -> dict[str, Any] | None:
    """保存前的校验：存在性、条数上限、名称唯一。返回要更新的那条（新建时 None）。"""
    profiles = _profiles_of(block)
    existing = _find_profile(block, profile_id) if profile_id else None
    if profile_id and existing is None:
        raise AsrProfileNotFound(profile_id)
    if existing is None and len(profiles) >= MAX_ASR_PROFILES:
        raise AsrProfileLimitError(f"最多保存 {MAX_ASR_PROFILES} 份语音配置")
    for item in profiles:
        if item is not existing and str(item.get("name") or "") == name:
            raise AsrProfileNameConflict(f"已有同名配置「{name}」，请换一个名称")
    return existing


def save_asr_profile(payload: AsrProfileIn, *, activate: bool = False) -> AsrProfilesOut:
    """新建/按 id 更新一条配置；名称去空格、≤64、全局唯一。

    **新建默认不自动设为生效**：用户回列表点「使用」才切换，避免"保存一套备用配置"
    悄悄改掉正在用的服务商。更新生效项则立即生效（运行时每次请求都读配置）。
    `activate=True` 只给旧 `PUT /settings/asr` 兼容入口用（它的语义是"保存即生效"）。
    """
    name = _clean_name(payload.name)
    profile_id = (payload.id or "").strip()

    def _apply(state: dict[str, Any]) -> None:
        block = _ensure_block(state)
        existing = _validate_save(block, name, profile_id)
        if existing is None:
            profile: dict[str, Any] = {
                "id": new_profile_id(),
                "name": name,
                "preset_id": payload.preset_id,
                "base_url": payload.base_url,
                "model": payload.model,
                "protocol": payload.protocol,
                "api_key": _resolve_key(None, payload.api_key, payload.base_url, payload.protocol)
                or "",
                "updated_at": _now(),
            }
            block["profiles"] = [*_profiles_of(block), profile]
            if activate:
                block["active_profile_id"] = profile["id"]
            logger.info("已新建语音配置 id=%s", profile["id"])
            return
        resolved = _resolve_key(existing, payload.api_key, payload.base_url, payload.protocol)
        if resolved is not None:
            existing["api_key"] = resolved
        existing.update(
            {
                "name": name,
                "preset_id": payload.preset_id or str(existing.get("preset_id") or ""),
                "base_url": payload.base_url,
                "model": payload.model,
                "protocol": payload.protocol,
                "updated_at": _now(),
            }
        )
        if activate:
            block["active_profile_id"] = profile_id
        logger.info("已更新语音配置 id=%s", profile_id)

    mutate_state(_apply)
    return list_asr_profiles()


def delete_asr_profile(profile_id: str) -> AsrProfilesOut:
    """删除一条；删的是生效项时自动切到剩下的第一条，删光则 `active_profile_id=""`。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _ensure_block(state)
        if _find_profile(block, profile_id) is None:
            raise AsrProfileNotFound(profile_id)
        remaining = [item for item in _profiles_of(block) if item.get("id") != profile_id]
        block["profiles"] = remaining
        if str(block.get("active_profile_id") or "") == profile_id:
            block["active_profile_id"] = str(remaining[0].get("id") or "") if remaining else ""
        logger.info("已删除语音配置 id=%s", profile_id)

    mutate_state(_apply)
    return list_asr_profiles()


def activate_asr_profile(profile_id: str) -> AsrProfilesOut:
    """把一条配置设为「使用中」：**只校验三要素齐全，不探测网络**。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _ensure_block(state)
        profile = _find_profile(block, profile_id)
        if profile is None:
            raise AsrProfileNotFound(profile_id)
        if not _is_configured(profile):
            raise AsrProfileIncomplete("这条配置缺少服务地址、模型或 Key，补齐后才能设为使用中")
        block["active_profile_id"] = profile_id
        logger.info("已切换语音配置 id=%s", profile_id)

    mutate_state(_apply)
    return list_asr_profiles()


def clear_asr_profile_key(profile_id: str) -> AsrProfilesOut:
    """只清这一条的 Key（其它配置不受影响）；生效项会因此变成"未配置"。"""

    def _apply(state: dict[str, Any]) -> None:
        block = _ensure_block(state)
        profile = _find_profile(block, profile_id)
        if profile is None:
            raise AsrProfileNotFound(profile_id)
        profile["api_key"] = ""
        profile["updated_at"] = _now()
        logger.info("已清除语音配置的 Key id=%s", profile_id)

    mutate_state(_apply)
    return list_asr_profiles()


def resolve_probe_target(profile_id: str, draft: AsrProfileTestRequest) -> AsrSettings | None:
    """解析「已存 Key + 草稿覆盖」后的探测参数；缺三要素返回 None（调用方提示先填写）。

    **不落盘**；`profile_id == "new"` 表示新建弹窗（没有已存 Key，不跨条继承）。
    """
    profile: dict[str, Any] | None = None
    if profile_id != NEW_PROFILE_SENTINEL:
        profile = _find_profile(_block_of(load_state()), profile_id)
        if profile is None:
            raise AsrProfileNotFound(profile_id)
    stored = profile or {}
    base_url = draft.base_url if draft.base_url is not None else str(stored.get("base_url") or "")
    model = draft.model if draft.model is not None else str(stored.get("model") or "")
    protocol = (
        draft.protocol
        if draft.protocol is not None
        else _normalize_protocol(stored.get("protocol"))
    )
    changed = profile is None or _binding_changed(profile, base_url, protocol)
    raw = draft.api_key
    if raw == CLEAR_API_KEY:
        api_key = ""
    elif raw is None or not raw or raw.startswith(API_KEY_MASK):
        api_key = "" if changed else _decrypted_key(profile)
    else:
        api_key = raw
    if not (base_url and model and api_key):
        return None
    return AsrSettings(base_url=base_url, api_key=api_key, model=model, protocol=protocol)


def import_legacy_profile(
    *,
    name: str,
    preset_id: str,
    base_url: str,
    model: str,
    protocol: AsrProtocol,
    api_key: str,
) -> None:
    """迁移专用：把旧数据集的单条配置写成「默认配置」并设为生效；已迁移过则什么都不做。

    只在 `asr_settings.migrate_legacy_asr_once` 里调用：读旧 AppSetting 行需要 DB 会话，
    那部分留在 `asr_settings`；这里只负责"首次写入整段 asr_profiles"这个存储动作。
    没有旧配置时也写入空 profiles 的"已迁移"标记——否则以后永远会再尝试回退旧段。
    """

    def _apply(state: dict[str, Any]) -> None:
        # 抢锁后复查：并发两个读取同时进来时，第二个不能再写一遍。
        if _block_of(state) is not None:
            return
        profiles: list[dict[str, Any]] = []
        active_id = ""
        if base_url or model:
            profile = {
                "id": new_profile_id(),
                "name": name,
                "preset_id": preset_id,
                "base_url": base_url,
                "model": model,
                "protocol": protocol,
                # Key 在内存里是明文，这里重新加密落盘（删除该条即删除它的 Key，无孤儿行）。
                "api_key": encrypt_key(api_key),
                "updated_at": _now(),
            }
            profiles.append(profile)
            active_id = str(profile["id"])
        state[_ASR_PROFILES_KEY] = {
            "version": _ASR_PROFILES_VERSION,
            "active_profile_id": active_id,
            "profiles": profiles,
        }

    mutate_state(_apply)


__all__ = [
    "CLEAR_API_KEY",
    "DEFAULT_PROFILE_NAME",
    "MAX_ASR_PROFILES",
    "MAX_ASR_PROFILE_NAME_LENGTH",
    "NEW_PROFILE_SENTINEL",
    "AsrProfileError",
    "AsrProfileIncomplete",
    "AsrProfileLimitError",
    "AsrProfileNameConflict",
    "AsrProfileNotFound",
    "activate_asr_profile",
    "active_profile_id",
    "active_profile_settings",
    "clear_asr_profile_key",
    "delete_asr_profile",
    "import_legacy_profile",
    "list_asr_profiles",
    "new_profile_id",
    "profile_settings",
    "profiles_defined",
    "resolve_probe_target",
    "save_asr_profile",
]
