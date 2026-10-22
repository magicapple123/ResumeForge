# SPDX-License-Identifier: Apache-2.0
"""运行时配置存取：用户在「设置」页填写的配置保存在本地 SQLite。

安全说明：API Key 在 Windows 上用系统 DPAPI 加密后落库（见 api_key_crypto），
其他平台保持明文。本项目定位为单用户本地部署的工具，不做多用户暴露；如需对外部署请自行加锁。
"""

import json
import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..schemas.setting import (
    NAVIGATION_CORE_KEYS,
    NAVIGATION_OPTIONAL_KEYS,
    AssistantOrbSetting,
    NavigationVisibility,
    SearchConfig,
)

# 对外兼容面：API_KEY_MASK 的取用点是 test_api_settings.py:8 / test_llm_session_key.py:12 /
# data_backup/api_keys.py:16，它们都从本模块 import；值本身由 llm_key_refs 定义。
from .llm_key_refs import API_KEY_MASK  # noqa: F401

# 对外兼容面：48 处调用方与测试按本模块取符号，逐个 ``as`` 同名重导出（走 llm_settings）。
from .llm_settings import _LLM_CONFIG_KEY as _LLM_CONFIG_KEY
from .llm_settings import _strip_session_key as _strip_session_key
from .llm_settings import delete_llm_config_record as delete_llm_config_record
from .llm_settings import get_dataset_llm_config as get_dataset_llm_config
from .llm_settings import get_llm_config as get_llm_config
from .llm_settings import list_llm_config_records as list_llm_config_records
from .llm_settings import mask_llm_config as mask_llm_config
from .llm_settings import resolve_llm_config_api_key as resolve_llm_config_api_key
from .llm_settings import save_llm_config as save_llm_config
from .llm_settings import save_llm_config_record as save_llm_config_record

logger = logging.getLogger(__name__)

_SEARCH_CONFIG_KEY = "search_config"
_REMINDER_POPUP_KEY = "reminder_popup_on_start"
_ASSISTANT_ORB_KEY = "assistant_orb_enabled"
_NAVIGATION_VISIBILITY_KEY = "navigation_visibility"
_WEBFORM_RELAXED_MODE_KEY = "webform_relaxed_mode"
_EXPORT_SAVE_LOCATION_KEY = "export_save_location"
# 自动备份间隔（天）的运行时设置：调度线程每次到期检查时读取，保存后下次检查生效。
_AUTO_BACKUP_INTERVAL_KEY = "auto_backup_interval_days"
# 求职助手放宽模式：开启后助手可读取完整资料（含姓名、电话等敏感字段）与
# 网申填写记录、历史对话。默认必须**关**——它扩大的是发往模型的个人信息面。
_ASSISTANT_RELAXED_MODE_KEY = "assistant_relaxed_mode"


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


# ===== 自动备份间隔 =====


def get_auto_backup_interval_days(db: Session) -> int:
    """读取自动备份间隔（天）；缺失或脏数据回退环境配置的默认值。

    与环境级 ``Settings.auto_backup_interval_days`` 的关系：后者是进程启动时的
    出厂默认（.env），这里存的是用户在设置页改过的运行时值。KV 里只存一个整数
    （``json.dumps(days)``），读取时按 1..365 夹紧，避免越界值拖垮调度判定。
    """
    from ..config import get_settings

    fallback = max(1, get_settings().auto_backup_interval_days)
    row = db.get(AppSetting, _AUTO_BACKUP_INTERVAL_KEY)
    if row is None:
        return fallback
    try:
        value = int(json.loads(row.value))
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("自动备份间隔设置数据损坏，已回退环境配置默认值")
        return fallback
    return max(1, min(365, value))


def save_auto_backup_interval_days(db: Session, days: int) -> int:
    """持久化自动备份间隔（天）。上限校验交给 Pydantic schema（1..365）。"""
    cleaned = max(1, min(365, int(days)))
    row = db.get(AppSetting, _AUTO_BACKUP_INTERVAL_KEY)
    serialized = json.dumps(cleaned)
    if row is None:
        db.add(AppSetting(key=_AUTO_BACKUP_INTERVAL_KEY, value=serialized))
    else:
        row.value = serialized
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
