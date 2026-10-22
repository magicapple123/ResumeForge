# SPDX-License-Identifier: Apache-2.0
"""LLM 配置存取（数据集那一份）：解析密钥引用、脱敏回传、加密落库。

2026-10 行数预算拆分时从 ``settings_service`` 原样搬出（函数体逐字符未动）。这一族回答的
是同一个问题——「密钥从哪来、往哪去」：占位符还原、密钥绑定 base_url、会话密钥不落库；
与 8 个布尔/路径开关不是同一件事。``settings_service`` 仍对本模块的符号逐条重导出，
48 处调用方与测试因此无需改动。
"""

import json
import logging
from urllib.parse import urlsplit, urlunsplit

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting, LLMConfigRecord
from ..schemas.setting import LLMConfig, LLMConfigRecordCreate, LLMConfigRecordOut
from .api_key_crypto import decrypt_key, encrypt_key
from .api_key_session import get_session_key, session_key_configured
from .global_llm_profiles import read_global_llm
from .llm_key_refs import (
    API_KEY_MASK,
    PROFILE_API_KEY_PREFIX,
    RECORD_API_KEY_PREFIX,
    masked_record_key,
)

logger = logging.getLogger(__name__)

_LLM_CONFIG_KEY = "llm_config"


def resolve_llm_config_api_key(db: Session, config: LLMConfig) -> LLMConfig:
    """把前端回传的脱敏占位符还原为本地保存的密钥。

    配置记录必须携带记录 ID，否则两个仅密钥不同的记录会在切换时混淆。
    该引用只在本地 API 内流转，真实密钥始终不会进入读取接口响应。
    """
    api_key = config.api_key
    if api_key == API_KEY_MASK:
        current = get_llm_config(db)
        if _normalized_base_url(config.base_url) != _normalized_base_url(current.base_url):
            raise ValueError("Base URL 已修改，请重新填写 API Key 后再保存或测试")
        resolved_key = current.api_key
    elif api_key.startswith(RECORD_API_KEY_PREFIX):
        record_id_text = api_key.removeprefix(RECORD_API_KEY_PREFIX)
        if not record_id_text.isdigit():
            raise ValueError("API Key 配置引用无效，请刷新设置后再试")
        record = db.get(LLMConfigRecord, int(record_id_text))
        if record is None:
            raise ValueError("API Key 配置记录已不存在，请刷新设置后再试")
        if _normalized_base_url(config.base_url) != _normalized_base_url(record.base_url):
            raise ValueError("Base URL 与配置记录不一致，请刷新记录后再试")
        resolved_key = decrypt_key(record.api_key)
    elif api_key.startswith(PROFILE_API_KEY_PREFIX):
        # 全局配置记录（C）：密钥存在 global_settings.json，引用的 id 是字符串 profile id。
        from .global_llm_profiles import read_profile_config

        profile_id = api_key.removeprefix(PROFILE_API_KEY_PREFIX)
        profile_config = read_profile_config(profile_id)
        if profile_config is None:
            raise ValueError("API Key 配置记录已不存在，请刷新设置后再试")
        if _normalized_base_url(config.base_url) != _normalized_base_url(profile_config.base_url):
            raise ValueError("Base URL 与配置记录不一致，请重新填写 API Key 后再试")
        resolved_key = profile_config.api_key
    else:
        resolved_key = api_key
    return config.model_copy(update={"api_key": resolved_key})


def _normalized_base_url(value: str) -> str:
    """绑定密钥引用与服务地址，避免占位符把密钥转发到其他主机。"""
    stripped = value.strip().rstrip("/")
    try:
        parsed = urlsplit(stripped)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return stripped
    if not parsed.scheme or not hostname or parsed.username or parsed.password:
        return stripped
    normalized_host = hostname.casefold()
    if ":" in normalized_host:
        normalized_host = f"[{normalized_host}]"
    netloc = f"{normalized_host}:{port}" if port is not None else normalized_host
    return urlunsplit(
        (
            parsed.scheme.casefold(),
            netloc,
            parsed.path.rstrip("/"),
            parsed.query,
            parsed.fragment,
        )
    )


def mask_llm_config(db: Session, config: LLMConfig) -> LLMConfig:
    """脱敏当前配置；若它来自配置记录，则保留可安全回传的记录引用。

    匹配元组只收**连接身份**（端点、密钥、模型与几个基础参数），**刻意不含** top_p / seed /
    api_style / thinking_budget / 思考模式这些可选生成参数：用户从记录加载后改一个开关再保存，
    仍然认得回原记录，不会因为"只差一个可选参数"就丢掉记录绑定与密钥引用。选错密钥的风险由
    `api_key` 本身参与比对挡住（两条记录仅密钥不同时不会互相匹配）。
    """
    record_id = None
    if config.api_key:
        fields = (
            "provider",
            "base_url",
            "api_key",
            "model",
            "temperature",
            "timeout_seconds",
            "max_tokens",
        )
        records = db.query(LLMConfigRecord).order_by(LLMConfigRecord.updated_at.desc()).all()
        matching = next(
            (
                row
                for row in records
                if all(
                    (decrypt_key(row.api_key) if field == "api_key" else getattr(row, field))
                    == getattr(config, field)
                    for field in fields
                )
            ),
            None,
        )
        record_id = matching.id if matching is not None else None
    return config.model_copy(update={"api_key": masked_record_key(config.api_key, record_id)})


def _mask_llm_config_record(record: LLMConfigRecord) -> LLMConfigRecordOut:
    output = LLMConfigRecordOut.model_validate(record)
    return output.model_copy(update={"api_key": masked_record_key(record.api_key, record.id)})


def get_dataset_llm_config(db: Session) -> LLMConfig:
    """读取**本数据集**的 LLM 配置（解密 API Key）；缺失或脏数据退回默认。

    设置页编辑的就是这一份：全局配置是另一份（`data/global_settings.json`），
    两者不能混——否则"在 A 数据集里改配置"会悄悄改掉所有数据集。
    """
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    if row is None:
        config = LLMConfig()
    else:
        try:
            config = LLMConfig.model_validate(json.loads(row.value))
            config = config.model_copy(update={"api_key": decrypt_key(config.api_key)})
        except (json.JSONDecodeError, ValidationError):
            # 脏数据降级为默认配置，不阻塞用户重新填写
            logger.warning("LLM 配置数据损坏，已重置为默认值")
            config = LLMConfig()
    session_key = get_session_key()
    if session_key:
        config = config.model_copy(update={"api_key": session_key})
    return config


def get_llm_config(db: Session) -> LLMConfig:
    """**实际生效**的 LLM 配置（R21/C）：全局优先，否则用本数据集那一份。

    全局有 profile 且填了 base_url + model 时接管所有调用（C 起不再有"开启"开关：
    保存即生效，见 ``global_llm_profiles``）；没有全局或字段不全时行为与升级前完全
    一致。这一层只做"选哪一份"，不改变各调用点——27 处调用点因此无需逐个修改，
    也不会出现"某条链路忘了支持全局配置"。
    """
    global_llm = read_global_llm()
    if global_llm is not None and global_llm.config.base_url and global_llm.config.model:
        config = global_llm.config
        session_key = get_session_key()
        if session_key:
            config = config.model_copy(update={"api_key": session_key})
        return config
    return get_dataset_llm_config(db)


def _strip_session_key(config: LLMConfig) -> LLMConfig:
    """会话密钥绝不落库：解析结果若是临时密钥，落库为空串（清掉已保存的密钥）。"""
    if session_key_configured() and config.api_key == get_session_key():
        return config.model_copy(update={"api_key": ""})
    return config


def save_llm_config(db: Session, config: LLMConfig) -> LLMConfig:
    """保存 LLM 配置：先还原脱敏占位符，再加密 API Key 后落库。"""
    config = resolve_llm_config_api_key(db, config)
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    stored = config.model_copy(update={"api_key": encrypt_key(_strip_session_key(config).api_key)})
    serialized = json.dumps(stored.model_dump(), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=_LLM_CONFIG_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return config


def list_llm_config_records(db: Session) -> list[LLMConfigRecordOut]:
    rows = db.query(LLMConfigRecord).order_by(LLMConfigRecord.updated_at.desc()).all()
    return [_mask_llm_config_record(row) for row in rows]


def save_llm_config_record(db: Session, payload: LLMConfigRecordCreate) -> LLMConfigRecordOut:
    """保存一条命名配置记录（API Key 加密落库）。"""
    payload = resolve_llm_config_api_key(db, payload)
    row = db.query(LLMConfigRecord).filter(LLMConfigRecord.name == payload.name).one_or_none()
    values = payload.model_dump(exclude={"name"})
    values["api_key"] = encrypt_key(_strip_session_key(payload).api_key)
    if row is None:
        row = LLMConfigRecord(name=payload.name, **values)
        db.add(row)
    else:
        for field, value in values.items():
            setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return _mask_llm_config_record(row)


def delete_llm_config_record(db: Session, record_id: int) -> None:
    row = db.get(LLMConfigRecord, record_id)
    if row is not None:
        db.delete(row)
        db.commit()
