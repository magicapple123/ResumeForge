# SPDX-License-Identifier: Apache-2.0
"""语音转写（ASR）配置的读写：独立几个键，Key 加密落库、读取只回掩码。

为什么单独成模块、不塞进 ``settings_service.py``：任务卡计划把那个文件划给输入区
（T11）的写入者，语音线只动自己的文件，避免两个写入者改同一份 500 行预算文件。

存储形态（与联网搜索的 DeepSeek Key 同一套做法）：

- ``asr_config``：JSON，只存 ``base_url`` / ``model`` / ``protocol``（都是可回显的非敏感值）；
- ``asr_api_key``：单独一行，Windows 上 DPAPI 加密后落库，**绝不进那份会被整体回传
  前端的 JSON**。

Key 的写入口径（与前端设置卡的交互对齐）：

- 新字符串：加密落库；
- 掩码（``********``）或空串：**地址与协议都没变时保留旧 Key**；任一变了就清空——把旧
  服务商的 Key 发到新地址（或换成另一套协议）是越权外发 / 必然失败；
- ``__clear__``：显式清空（用户点「清除 Key」）。

⚠️ ``_write_config`` 必须把 ``protocol`` 一起序列化：它整体重建那份 JSON，漏掉一个字段
就等于"保存后协议变回 openai"。这条由 ``tests/test_asr_protocol.py`` 专门钉住。
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..schemas.asr import AsrProtocol, AsrSettings, AsrSettingsOut
from .api_key_crypto import decrypt_key, encrypt_key
from .llm_key_refs import API_KEY_MASK

logger = logging.getLogger(__name__)

_ASR_CONFIG_KEY = "asr_config"
_ASR_API_KEY_KEY = "asr_api_key"
# 前端「清除 Key」显式发送的哨兵值：空串的语义是"沿用旧 Key"，两者必须分得开。
CLEAR_API_KEY = "__clear__"


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


def _load_stored_config(db: Session) -> AsrSettings:
    """读取落库的地址/模型/协议；脏数据或缺失退回空配置（不把 Key 放进这个 JSON）。

    旧数据没有 ``protocol`` 时由 schema 默认值兜住（``openai``），所以不需要迁移。
    """
    row = db.get(AppSetting, _ASR_CONFIG_KEY)
    if row is None:
        return AsrSettings()
    try:
        return AsrSettings.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, ValueError):
        logger.warning("语音服务配置数据损坏，已重置为未配置")
        return AsrSettings()


def resolve_asr_api_key(db: Session) -> str:
    """取真实 Key（仅供运行时调用与测试，**不得**回传前端）。未配置返回空串。"""
    row = db.get(AppSetting, _ASR_API_KEY_KEY)
    if row is None or not row.value:
        return ""
    return decrypt_key(str(row.value))


def get_asr_runtime_settings(db: Session) -> AsrSettings:
    """运行时读取：把真实 Key 解出来，供 ``asr_client`` 调上游用。"""
    stored = _load_stored_config(db)
    return stored.model_copy(update={"api_key": resolve_asr_api_key(db)})


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


def _write_config(
    db: Session, base_url: str, model: str, protocol: AsrProtocol
) -> None:
    """整体重建 ``asr_config`` 那份 JSON。

    **三个字段都要传**：这里是"用一份新配置覆盖整行"，漏一个就等于把它清成默认值
    （protocol 漏掉时表现为"保存后变回 openai"）。
    """
    persisted = AsrSettings(base_url=base_url, model=model, protocol=protocol)
    row = db.get(AppSetting, _ASR_CONFIG_KEY)
    serialized = json.dumps(persisted.model_dump(), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=_ASR_CONFIG_KEY, value=serialized))
    else:
        row.value = serialized


def _delete_api_key(db: Session) -> None:
    row = db.get(AppSetting, _ASR_API_KEY_KEY)
    if row is not None:
        db.delete(row)


def _store_api_key(db: Session, plaintext: str) -> None:
    encrypted = encrypt_key(plaintext)
    row = db.get(AppSetting, _ASR_API_KEY_KEY)
    if row is None:
        db.add(AppSetting(key=_ASR_API_KEY_KEY, value=encrypted))
    else:
        row.value = encrypted


def save_asr_settings(db: Session, incoming: AsrSettings) -> AsrSettingsOut:
    """保存配置；Key 的三种写入口径见模块注释。

    先完成加密再改库：DPAPI 失败时抛 ``ApiKeyEncryptionError``，此时还没有任何行被
    修改，也不会 commit，不会留下"地址变了、Key 没存"的半成品。
    """
    stored = _load_stored_config(db)
    changed = binding_changed(stored, incoming.base_url, incoming.protocol)
    raw_key = incoming.api_key

    if raw_key == CLEAR_API_KEY:
        clear_key = True
        new_key = ""
    elif raw_key.startswith(API_KEY_MASK) or not raw_key:
        # 掩码/空串 = 前端回显值。地址与协议都没变才沿用旧 Key；否则清掉（不向新主机外发）。
        clear_key = changed
        new_key = ""
    else:
        clear_key = False
        new_key = raw_key

    if new_key:
        _store_api_key(db, new_key)
    elif clear_key:
        _delete_api_key(db)

    _write_config(db, incoming.base_url, incoming.model, incoming.protocol)
    db.commit()
    return get_asr_settings(db)
