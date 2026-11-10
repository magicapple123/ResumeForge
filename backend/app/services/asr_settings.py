# SPDX-License-Identifier: Apache-2.0
"""语音转写（ASR）配置的解析顺序：全局命名配置优先，迁移前才回退数据集的旧键。

历史形态（每个数据集一份）：

- ``app_setting.asr_config``：JSON，只存 ``base_url`` / ``model`` / ``protocol``；
- ``app_setting.asr_api_key``：单独一行，Windows 上 DPAPI 加密后落库。

现在（全局一份，见 ``asr_profiles``）：``global_settings.json`` 顶层 ``asr_profiles``
存命名配置列表 + ``active_profile_id``。旧行**不删除**，作为回滚面包屑；但
``asr_profiles`` 键一出现就不再读它们。

解析顺序（``get_asr_runtime_settings`` / ``resolve_asr_api_key`` 共用）：

1. 有 ``asr_profiles`` 键 → 只认 ``active_profile_id`` 指向的那条（没有生效项 = 未配置，
   **不**回退旧段，否则"删光配置"会被旧值悄悄复活）；
2. 没有该键 → 回退旧 ``asr_config`` + ``asr_api_key``（迁移前的兼容路径）。

旧 `PUT /settings/asr` 保留为兼容入口：``save_asr_settings`` 把值写进生效 profile
（没有生效项就新建「默认配置」并设为生效），**不再写 ``asr_config``**，避免第二份真相。
迁移 ``migrate_legacy_asr_once`` 放在本模块：它同时是"读旧 AppSetting 行"的兼容路径，
读取逻辑与迁移必须共用同一段代码（profiles 侧的首次写入在
``asr_profiles.import_legacy_profile``）。
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..schemas.asr import (
    AsrProfileIn,
    AsrProtocol,
    AsrSettings,
    AsrSettingsOut,
)
from .api_key_crypto import ApiKeyEncryptionError, decrypt_key
from .asr_profiles import (
    CLEAR_API_KEY,
    DEFAULT_PROFILE_NAME,
    active_profile_id,
    active_profile_settings,
    import_legacy_profile,
    list_asr_profiles,
    profiles_defined,
    save_asr_profile,
)
from .llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

_ASR_CONFIG_KEY = "asr_config"
_ASR_API_KEY_KEY = "asr_api_key"

# 迁移时按"主机 + 协议"猜 preset_id：只用于旧配置导入，前端预设表才是显示口径。
_PRESET_BY_ENDPOINT = {
    ("api.openai.com", "openai"): "openai",
    ("api.groq.com", "openai"): "groq",
    ("api.siliconflow.cn", "openai"): "siliconflow",
    ("dashscope.aliyuncs.com", "dashscope"): "dashscope",
}


def _guess_preset_id(base_url: str, protocol: AsrProtocol) -> str:
    host = urlparse(base_url or "").netloc.lower()
    return _PRESET_BY_ENDPOINT.get((host, protocol), "custom")


def provider_host(base_url: str) -> str:
    """从 Base URL 取出主机名，供隐私提示与日志使用（只要 host，不带路径/Key）。

    取不到（空地址、非法 URL）时返回空串：调用方据此决定"不显示隐私提示"。
    """
    cleaned = (base_url or "").strip()
    if not cleaned:
        return ""
    try:
        return urlparse(cleaned).netloc
    except ValueError:
        return ""


# ===== 迁移前的兼容读路径（旧数据集键） =====


def _load_stored_config(db: Session) -> AsrSettings:
    """读取旧 ``asr_config`` 里的地址/模型/协议；脏数据或缺失退回空配置。"""
    row = db.get(AppSetting, _ASR_CONFIG_KEY)
    if row is None:
        return AsrSettings()
    try:
        return AsrSettings.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, ValueError):
        logger.warning("语音服务配置数据损坏，已重置为未配置")
        return AsrSettings()


def _legacy_api_key(db: Session) -> str:
    """旧 ``asr_api_key`` 行的明文 Key（未配置返回空串）；**不得**回传前端。"""
    row = db.get(AppSetting, _ASR_API_KEY_KEY)
    if row is None or not row.value:
        return ""
    return decrypt_key(str(row.value))


def legacy_asr_settings(db: Session) -> AsrSettings:
    """旧数据集配置（含解密后的 Key）：迁移输入，也是迁移前的运行时来源。"""
    return _load_stored_config(db).model_copy(update={"api_key": _legacy_api_key(db)})


# ===== 新解析顺序 =====


def resolve_asr_api_key(db: Session) -> str:
    """取真实 Key（仅供运行时调用与测试，**不得**回传前端）。未配置返回空串。

    解析顺序与 :func:`get_asr_runtime_settings` 逐字一致：有 profiles 段就只认生效项。
    """
    if profiles_defined():
        active = active_profile_settings()
        return active.api_key if active is not None else ""
    return _legacy_api_key(db)


def get_asr_runtime_settings(db: Session) -> AsrSettings:
    """运行时读取：把真实 Key 解出来，供 ``asr_client`` 调上游用。

    ``asr_profiles`` 段存在但没有生效项 / Key 解不出 → 返回空配置（configured=false）。
    **不**回退旧 ``asr_config``：迁移后再"删光所有配置"不该被旧值复活。
    """
    if profiles_defined():
        return active_profile_settings() or AsrSettings()
    return legacy_asr_settings(db)


def is_asr_configured(settings: AsrSettings) -> bool:
    """三要素齐全才算可用：只有 Key 没有地址/模型，发不出一次合法请求。"""
    return bool(settings.base_url and settings.model and settings.api_key)


def binding_changed(stored: AsrSettings, base_url: str, protocol: AsrProtocol) -> bool:
    """地址或协议变了 = 已保存的 Key 不再适用。

    协议也要比：同一台主机上换协议意味着换了一条调用路径，旧 Key 就算能通过鉴权，
    也说明用户想连的是另一个服务。判据只写一处，保存/测试连接/拉模型三处共用。
    """
    return base_url != stored.base_url or protocol != stored.protocol


def get_asr_settings(db: Session) -> AsrSettingsOut:
    """对外（设置页）读取：``api_key`` 只会是掩码或空串。"""
    runtime = get_asr_runtime_settings(db)
    return AsrSettingsOut(
        base_url=runtime.base_url,
        api_key=API_KEY_MASK if runtime.api_key else "",
        model=runtime.model,
        protocol=runtime.protocol,
        configured=is_asr_configured(runtime),
    )


def save_asr_settings(db: Session, incoming: AsrSettings) -> AsrSettingsOut:
    """旧 ``PUT /settings/asr`` 的兼容入口：把值写进**生效** profile。

    - 有生效项 → 更新它（Key 的三种口径沿用旧语义：掩码/空串同地址同协议保留、
      换地址或协议清空、``__clear__`` 清空）；
    - 没有生效项 → 新建「默认配置」并设为生效；
    - **不再写 ``asr_config``**：否则旧键会重新变成第二份真相。
    """
    migrate_legacy_asr_once(db)
    active_id = active_profile_id()
    existing = next((item for item in list_asr_profiles().profiles if item.id == active_id), None)
    if existing is not None:
        preset_id = existing.preset_id
        if existing.base_url != incoming.base_url or existing.protocol != incoming.protocol:
            preset_id = _guess_preset_id(incoming.base_url, incoming.protocol)
        payload = AsrProfileIn(
            id=existing.id,
            name=existing.name,
            preset_id=preset_id,
            base_url=incoming.base_url,
            model=incoming.model,
            protocol=incoming.protocol,
            api_key=incoming.api_key,
        )
    else:
        payload = AsrProfileIn(
            name=DEFAULT_PROFILE_NAME,
            preset_id=_guess_preset_id(incoming.base_url, incoming.protocol),
            base_url=incoming.base_url,
            model=incoming.model,
            protocol=incoming.protocol,
            api_key=incoming.api_key,
        )
    save_asr_profile(payload, activate=True)
    return get_asr_settings(db)


def migrate_legacy_asr_once(db: Session) -> None:
    """把**当前数据集**的旧配置导入全局，只做一次（幂等）。

    触发点：`GET /settings/asr`、`GET /settings/asr/profiles` 以及所有写入口——
"没迁移就新建"会让旧配置永远进不来。规则见 ``asr_profiles.import_legacy_profile``：
旧配置有地址或模型就生成「默认配置」并设为生效（缺 Key 时卡片显示未配置，与升级前
实际可用状态一致）；没有旧配置则只写"已迁移"标记。

    写失败不删旧行、不抛错：这里是读取路径，不能把设置页打 500，下次读取时重试。
    """
    if profiles_defined():
        return
    try:
        legacy = legacy_asr_settings(db)
        import_legacy_profile(
            name=DEFAULT_PROFILE_NAME,
            preset_id=_guess_preset_id(legacy.base_url, legacy.protocol),
            base_url=legacy.base_url,
            model=legacy.model,
            protocol=legacy.protocol,
            api_key=legacy.api_key,
        )
    except (OSError, ApiKeyEncryptionError):
        logger.warning("语音转写旧配置迁移失败，下次读取设置时重试", exc_info=True)
        return
    logger.info("已迁移语音转写旧配置：%s", "1 条" if (legacy.base_url or legacy.model) else "空")


__all__ = [
    "CLEAR_API_KEY",
    "binding_changed",
    "get_asr_runtime_settings",
    "get_asr_settings",
    "is_asr_configured",
    "legacy_asr_settings",
    "migrate_legacy_asr_once",
    "provider_host",
    "resolve_asr_api_key",
    "save_asr_settings",
]
