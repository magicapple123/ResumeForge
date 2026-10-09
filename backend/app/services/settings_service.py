"""运行时配置存取：用户在「设置」页填写的配置保存在本地 SQLite。

安全说明：API Key 在 Windows 上用系统 DPAPI 加密后落库（见 api_key_crypto），
其他平台保持明文。本项目定位为单用户本地部署的工具，不做多用户暴露；如需对外部署请自行加锁。
"""
import json
import logging
from urllib.parse import urlsplit, urlunsplit

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting, LLMConfigRecord
from ..schemas.setting import (
    NAVIGATION_CORE_KEYS,
    NAVIGATION_OPTIONAL_KEYS,
    AssistantOrbSetting,
    LLMConfig,
    LLMConfigRecordCreate,
    LLMConfigRecordOut,
    NavigationVisibility,
    SearchConfig,
)
from .api_key_crypto import decrypt_key, encrypt_key

logger = logging.getLogger(__name__)

_LLM_CONFIG_KEY = "llm_config"
_SEARCH_CONFIG_KEY = "search_config"
_REMINDER_POPUP_KEY = "reminder_popup_on_start"
_ASSISTANT_ORB_KEY = "assistant_orb_enabled"
_NAVIGATION_VISIBILITY_KEY = "navigation_visibility"
_WEBFORM_RELAXED_MODE_KEY = "webform_relaxed_mode"
_EXPORT_SAVE_LOCATION_KEY = "export_save_location"
# 求职助手放宽模式：开启后助手可读取完整资料（含姓名、电话等敏感字段）与
# 网申填写记录、历史对话。默认必须**关**——它扩大的是发往模型的个人信息面。
_ASSISTANT_RELAXED_MODE_KEY = "assistant_relaxed_mode"
API_KEY_MASK = "********"
_RECORD_API_KEY_PREFIX = f"{API_KEY_MASK}:record:"


def _masked_api_key(api_key: str, record_id: int | None = None) -> str:
    """返回可安全发给前端、且能在后续写请求中解析的密钥引用。"""
    if not api_key:
        return ""
    if record_id is None:
        return API_KEY_MASK
    return f"{_RECORD_API_KEY_PREFIX}{record_id}"


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
    elif api_key.startswith(_RECORD_API_KEY_PREFIX):
        record_id_text = api_key.removeprefix(_RECORD_API_KEY_PREFIX)
        if not record_id_text.isdigit():
            raise ValueError("API Key 配置引用无效，请重新加载设置后再试")
        record = db.get(LLMConfigRecord, int(record_id_text))
        if record is None:
            raise ValueError("API Key 配置记录已不存在，请重新加载设置后再试")
        if _normalized_base_url(config.base_url) != _normalized_base_url(record.base_url):
            raise ValueError("Base URL 与配置记录不一致，请重新加载记录后再试")
        resolved_key = decrypt_key(record.api_key)
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
    return config.model_copy(update={"api_key": _masked_api_key(config.api_key, record_id)})


def _mask_llm_config_record(record: LLMConfigRecord) -> LLMConfigRecordOut:
    output = LLMConfigRecordOut.model_validate(record)
    return output.model_copy(update={"api_key": _masked_api_key(record.api_key, record.id)})


def get_llm_config(db: Session) -> LLMConfig:
    """读取 LLM 配置（解密 API Key）；缺失或脏数据退回默认。"""
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    if row is None:
        return LLMConfig()
    try:
        config = LLMConfig.model_validate(json.loads(row.value))
        return config.model_copy(update={"api_key": decrypt_key(config.api_key)})
    except (json.JSONDecodeError, ValidationError):
        # 脏数据降级为默认配置，不阻塞用户重新填写
        logger.warning("LLM 配置数据损坏，已重置为默认值")
        return LLMConfig()


def save_llm_config(db: Session, config: LLMConfig) -> LLMConfig:
    """保存 LLM 配置：先还原脱敏占位符，再加密 API Key 后落库。"""
    config = resolve_llm_config_api_key(db, config)
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    stored = config.model_copy(update={"api_key": encrypt_key(config.api_key)})
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
    values["api_key"] = encrypt_key(values["api_key"])
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


# ===== 联网搜索设置 =====


def get_search_config(db: Session) -> SearchConfig:
    """读取搜索设置；脏数据或缺失时退回默认（Bing + DuckDuckGo）。"""
    row = db.get(AppSetting, _SEARCH_CONFIG_KEY)
    if row is None:
        return SearchConfig()
    try:
        return SearchConfig.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, ValidationError):
        logger.warning("联网搜索设置数据损坏，已重置为默认值")
        return SearchConfig()


def save_search_config(db: Session, config: SearchConfig) -> SearchConfig:
    """保存联网搜索配置。"""
    row = db.get(AppSetting, _SEARCH_CONFIG_KEY)
    serialized = json.dumps(config.model_dump(), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=_SEARCH_CONFIG_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return config


# ===== 提醒弹窗设置 =====


def get_reminder_popup_on_start(db: Session) -> bool:
    """读取「打开应用时弹出提醒」设置；缺失或脏数据退回默认开。"""
    row = db.get(AppSetting, _REMINDER_POPUP_KEY)
    if row is None:
        return True
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("提醒弹窗设置数据损坏，已重置为默认值")
        return True
    return value if isinstance(value, bool) else True


def save_reminder_popup_on_start(db: Session, enabled: bool) -> bool:
    """持久化「打开应用时弹出提醒」开关。"""
    row = db.get(AppSetting, _REMINDER_POPUP_KEY)
    serialized = json.dumps(bool(enabled))
    if row is None:
        db.add(AppSetting(key=_REMINDER_POPUP_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)


# ===== 投投悬浮球设置 =====


def get_assistant_orb_setting(db: Session) -> AssistantOrbSetting:
    """读取「投投」悬浮球设置（整对象）；缺失或脏数据退回默认双开。

    **存量兼容**：这个 key 历史上存的是裸 bool（`json.dumps(enabled)`），升级后库里
    还躺着 `"true"` 这类旧值。读取分三种形态兜底——缺失/损坏回默认；裸 bool 视为
    只换过入口开关、标语保持默认开；对象按模型校验（校验不过也回默认）。这样老用户
    升级后看到的开关状态与升级前一致，不会被悄悄重置。
    """
    row = db.get(AppSetting, _ASSISTANT_ORB_KEY)
    if row is None:
        return AssistantOrbSetting()
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("投投悬浮球设置数据损坏，已重置为默认开启")
        return AssistantOrbSetting()
    if isinstance(value, bool):
        return AssistantOrbSetting(enabled=value, tips_enabled=True)
    if isinstance(value, dict):
        try:
            return AssistantOrbSetting.model_validate(value)
        except ValidationError:
            logger.warning("投投悬浮球设置数据损坏，已重置为默认开启")
    return AssistantOrbSetting()


def save_assistant_orb_setting(db: Session, setting: AssistantOrbSetting) -> AssistantOrbSetting:
    """持久化「投投」悬浮球设置。**整对象落库**：只写 `enabled` 会把标语开关静默丢掉。"""
    row = db.get(AppSetting, _ASSISTANT_ORB_KEY)
    serialized = json.dumps(setting.model_dump(), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=_ASSISTANT_ORB_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return setting


# ===== 网申填表放宽模式 =====


def get_webform_relaxed_mode(db: Session) -> bool:
    """读取「网申填表放宽模式」开关；缺失或脏数据退回默认**关**。

    放宽模式会把「只填不点」的一部分选择权交回用户：程序代点自定义下拉等弹层控件、
    代勾用户逐条确认过的声明项。它改变的是"程序替你做动作"的边界，所以默认必须
    保持现状（保守），由用户显式开启。
    """
    row = db.get(AppSetting, _WEBFORM_RELAXED_MODE_KEY)
    if row is None:
        return False
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("网申放宽模式设置数据损坏，已重置为默认关闭")
        return False
    return value if isinstance(value, bool) else False


def save_webform_relaxed_mode(db: Session, enabled: bool) -> bool:
    """持久化「网申填表放宽模式」开关。"""
    row = db.get(AppSetting, _WEBFORM_RELAXED_MODE_KEY)
    serialized = json.dumps(bool(enabled))
    if row is None:
        db.add(AppSetting(key=_WEBFORM_RELAXED_MODE_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)


# ===== 求职助手放宽模式 =====


def get_assistant_relaxed_mode(db: Session) -> bool:
    """读取「求职助手放宽模式」开关；缺失或脏数据退回默认**关**。

    放宽模式会把助手的可读范围从"岗位筛选需要的资料"扩大到**全部资料**：姓名、
    电话等敏感身份字段、网申填表的真实填写值、历史对话。它改变的是"发往模型的
    个人信息面"，与网申放宽模式一样默认保守，由用户在知情的前提下显式开启。
    API 密钥等凭据无论如何都不在解锁范围内。
    """
    row = db.get(AppSetting, _ASSISTANT_RELAXED_MODE_KEY)
    if row is None:
        return False
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("助手放宽模式设置数据损坏，已重置为默认关闭")
        return False
    return value if isinstance(value, bool) else False


def save_assistant_relaxed_mode(db: Session, enabled: bool) -> bool:
    """持久化「求职助手放宽模式」开关。"""
    row = db.get(AppSetting, _ASSISTANT_RELAXED_MODE_KEY)
    serialized = json.dumps(bool(enabled))
    if row is None:
        db.add(AppSetting(key=_ASSISTANT_RELAXED_MODE_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return bool(enabled)


# ===== 导出内容保存位置 =====


def get_export_save_location(db: Session) -> str:
    """读取「生成内容保存位置」；缺失退回空串（= 仅浏览器下载，默认行为）。

    存的就是原始路径字符串：路径里什么字符都可能出现，套一层 JSON 反而多一种坏法。
    """
    row = db.get(AppSetting, _EXPORT_SAVE_LOCATION_KEY)
    if row is None:
        return ""
    return str(row.value or "").strip()


def save_export_save_location(db: Session, path: str) -> str:
    """持久化「生成内容保存位置」。空串 = 恢复默认（不额外落盘）。"""
    cleaned = (path or "").strip()
    row = db.get(AppSetting, _EXPORT_SAVE_LOCATION_KEY)
    if row is None:
        db.add(AppSetting(key=_EXPORT_SAVE_LOCATION_KEY, value=cleaned))
    else:
        row.value = cleaned
    db.commit()
    return cleaned


# ===== 导航显示设置 =====


def get_navigation_visibility(db: Session) -> NavigationVisibility:
    row = db.get(AppSetting, _NAVIGATION_VISIBILITY_KEY)
    if row is None:
        return NavigationVisibility()
    try:
        parsed = NavigationVisibility.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, ValidationError, TypeError):
        logger.warning("导航显示设置数据损坏，已重置为默认显示")
        return NavigationVisibility()
    allowed = NAVIGATION_OPTIONAL_KEYS - NAVIGATION_CORE_KEYS
    return NavigationVisibility(hidden=[key for key in parsed.hidden if key in allowed])


def save_navigation_visibility(db: Session, config: NavigationVisibility) -> NavigationVisibility:
    allowed = NAVIGATION_OPTIONAL_KEYS - NAVIGATION_CORE_KEYS
    cleaned = NavigationVisibility(hidden=[key for key in config.hidden if key in allowed])
    serialized = json.dumps(cleaned.model_dump(), ensure_ascii=False)
    row = db.get(AppSetting, _NAVIGATION_VISIBILITY_KEY)
    if row is None:
        db.add(AppSetting(key=_NAVIGATION_VISIBILITY_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return cleaned
