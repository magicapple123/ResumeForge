# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的三个**全局**设置项（模型名 / 掩码阈值 / 摘要阈值）的读写。

为什么强调"全局"：这三个值是用户对整个助手定的默认口径，**请求级覆盖（某次对话临时
调低阈值）不写回这里**——否则一次临时调整会悄悄改掉所有对话的行为。

读取一律"坏数据回默认"：缺失、JSON 损坏、bool（``true`` 会被 int 当成 1%）、越界都
回落到已验证的默认值，并记一条 warning。保存则相反：越界直接报错（接口层 422），
不做静默夹取——避免"我明明填了 90，存进去却成了 99"。
"""

import json
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.setting import AppSetting
from . import assistant_compaction as core
from .assistant_compaction_plan import CompactionLimits

logger = logging.getLogger(__name__)
COMPACTION_MODEL_KEY = "assistant_compaction_model"
MASK_PERCENT_KEY = "assistant_compaction_mask_percent"
SUMMARY_PERCENT_KEY = "assistant_compaction_summary_percent"


@dataclass(frozen=True)
class CompactionSettings:
    """三个设置项的运行时值。"""

    model: str = ""
    mask_percent: int = core.DEFAULT_MASK_PERCENT
    summary_percent: int = core.DEFAULT_SUMMARY_PERCENT

    @property
    def limits(self) -> CompactionLimits:
        return CompactionLimits(
            mask_percent=self.mask_percent, summary_percent=self.summary_percent
        )


# ===== 设置读写 =====


def _read_int(db: Session, key: str, default: int) -> int:
    row = db.get(AppSetting, key)
    if row is None:
        return default
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        logger.warning("上下文压缩设置 %s 数据损坏，已按默认值处理", key)
        return default
    # bool 是 int 的子类：`true` 若被当成 1%，每次请求都会压缩。
    if isinstance(value, bool) or not isinstance(value, int):
        logger.warning("上下文压缩设置 %s 类型不对，已按默认值处理", key)
        return default
    if not core.MIN_THRESHOLD_PERCENT <= value <= core.MAX_THRESHOLD_PERCENT:
        logger.warning("上下文压缩设置 %s 越界（%s），已按默认值处理", key, value)
        return default
    return value


def _read_str(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    if row is None:
        return ""
    try:
        value = json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return ""
    return value.strip() if isinstance(value, str) else ""


def _write(db: Session, key: str, value: Any) -> None:
    serialized = json.dumps(value, ensure_ascii=False)
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized
    db.commit()


def get_compaction_settings(db: Session) -> CompactionSettings:
    """读三个设置项；缺失 / 损坏 / 越界一律回默认（宁可回到已验证的默认值）。"""
    return CompactionSettings(
        model=_read_str(db, COMPACTION_MODEL_KEY),
        mask_percent=_read_int(db, MASK_PERCENT_KEY, core.DEFAULT_MASK_PERCENT),
        summary_percent=_read_int(db, SUMMARY_PERCENT_KEY, core.DEFAULT_SUMMARY_PERCENT),
    )


def save_compaction_settings(db: Session, settings: CompactionSettings) -> CompactionSettings:
    """保存三个设置项；越界由请求模型拒绝（422），这里不做静默夹取。"""
    for value in (settings.mask_percent, settings.summary_percent):
        if not core.MIN_THRESHOLD_PERCENT <= value <= core.MAX_THRESHOLD_PERCENT:
            raise ValueError("压缩阈值必须在 1 到 99 之间")
    _write(db, COMPACTION_MODEL_KEY, settings.model.strip())
    _write(db, MASK_PERCENT_KEY, int(settings.mask_percent))
    _write(db, SUMMARY_PERCENT_KEY, int(settings.summary_percent))
    return settings
