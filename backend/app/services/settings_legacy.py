# SPDX-License-Identifier: Apache-2.0
"""旧配置路径（数据集 ``AppSetting`` → 全局 ``global_settings.json``）的标记与收口。

联网搜索与语音转写的配置曾经存在**当前数据集**的 ``AppSetting`` 行里：

    search_config / search_deepseek_api_key   →  global_settings.json → web_search
    asr_config / asr_api_key                  →  global_settings.json → asr_profiles

升级后旧行**保留不删**（回滚面包屑），但读取只允许在"全局段还不存在"时回落一次，
并且必须留下日志——否则用户永远不知道"设置页里改的没生效、程序还在用旧库里的值"。

本模块只做两件事，不搬任何业务逻辑：

1. :func:`scan_legacy_paths` —— 给诊断面板列出"本机还躺着哪几组旧行"，**不含任何值**；
2. :func:`note_legacy_fallback` —— 回落发生时记一条 ``legacy-config-path``
   warning；同一进程同一段只记一次（转写每调一次都会读运行时配置，不去重就是刷屏）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from .session_scope import fresh_session

logger = logging.getLogger(__name__)

#: 日志里用来检索"还在读旧路径"的固定前缀，诊断与排障都按它 grep。
LEGACY_LOG_PREFIX = "legacy-config-path"


@dataclass(frozen=True)
class LegacyPath:
    """一段旧配置：属于哪个新模块、哪些旧键、新位置在哪。"""

    section: str
    label: str
    keys: tuple[str, ...]
    replacement: str


LEGACY_PATHS: tuple[LegacyPath, ...] = (
    LegacyPath(
        section="web_search",
        label="联网搜索",
        keys=("search_config", "search_deepseek_api_key"),
        replacement="global_settings.json → web_search",
    ),
    LegacyPath(
        section="asr",
        label="语音转写",
        keys=("asr_config", "asr_api_key"),
        replacement="global_settings.json → asr_profiles",
    ),
)

_BY_SECTION = {path.section: path for path in LEGACY_PATHS}
_NOTIFIED: set[str] = set()


def _present_keys(db: Session, path: LegacyPath) -> list[str]:
    rows = db.execute(select(AppSetting.key).where(AppSetting.key.in_(path.keys))).scalars()
    found = set(rows)
    return [key for key in path.keys if key in found]


def scan_legacy_paths(db: Session) -> dict[str, Any]:
    """列出当前数据集里仍存在的旧配置行（只给键名与去向，**不含值**）。"""
    items: list[dict[str, Any]] = []
    for path in LEGACY_PATHS:
        keys = _present_keys(db, path)
        if not keys:
            continue
        items.append(
            {
                "section": path.section,
                "label": path.label,
                "keys": keys,
                "replacement": path.replacement,
            }
        )
    return {"count": len(items), "items": items}


def has_legacy_rows(db: Session, section: str) -> bool:
    """这一段是否还有旧行（回落分支据此决定"要不要记日志"）。"""
    path = _BY_SECTION.get(section)
    if path is None:
        return False
    return bool(_present_keys(db, path))


def legacy_config_snapshot() -> dict[str, Any]:
    """诊断用的旧配置清单：**自己开一条短会话**，供没有请求会话的调用方使用。

    为什么放在服务层而不是 ``api/system.py``：路由自己 ``SessionLocal()`` 会被
    ``test_import_direction`` 判红（规则 ``api-no-session-factory``）——"再来一条会话"
    的会话策略属于服务层（见 ``services/session_scope.py``）。``/diagnostics``、导出包
    预览、``system.json`` 三条路径共用这一份实现。
    """
    with fresh_session() as db:
        return scan_legacy_paths(db)


def note_legacy_fallback(section: str, *, key: str = "") -> None:
    """回落读取旧配置时记一条 warning（同段只记一次）。"""
    if section in _NOTIFIED:
        return
    _NOTIFIED.add(section)
    path = _BY_SECTION.get(section)
    label = path.label if path is not None else section
    replacement = path.replacement if path is not None else "global_settings.json"
    logger.warning(
        "%s：仍在回落读取旧配置（%s%s），数据来自数据集 %s；请在设置页重新保存一次，把值写入 %s",
        LEGACY_LOG_PREFIX,
        label,
        f"/{key}" if key else "",
        "app_setting",
        replacement,
    )


__all__ = [
    "LEGACY_LOG_PREFIX",
    "LEGACY_PATHS",
    "LegacyPath",
    "has_legacy_rows",
    "note_legacy_fallback",
    "scan_legacy_paths",
]
