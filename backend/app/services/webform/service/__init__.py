"""网申填表的编排：读表单 → 预览 → 填充。

三段彼此独立，中间靠 ``session.SnapshotStore`` 串起来：

1. ``read_snapshot`` 读当前标签页的控件清单并存档；
2. ``build_preview`` 只做计算、**不碰页面**，产出"哪些能填、哪些需要你补、哪些永不自动填"；
3. ``apply_fill`` 严格按用户确认过的那份选择写入，并逐条回读校验。

**不覆盖用户已填的值**：预览里把这种标成 ``conflict`` 且默认不勾选。页面上的值可能是
用户上一轮填了一半的草稿，在"点提交之前"覆盖它是用户看不见的破坏。

本包由 models / suggest / preview / fill 组成，此 ``__init__`` 作为原 ``service``
模块路径的兼容门面：``__all__`` 与契约私有符号（``_adopt_ai_match`` / ``_fill_lock``，
后者与 ``apply_fill`` 是**同一把**锁对象）保持原命名空间全集，外部导入路径零改动。
"""
from __future__ import annotations

import logging

# 原单文件 service.py 顶部的 from-import 名字（ApplyOutcome / FormEngine / Snapshot 等）
# 属于旧命名空间的一部分——测试与调用方会以 ``service.X`` 属性访问（含 monkeypatch），
# 门面必须原样再导出，缺一个都是行为变化。
from ...browser.cdp_client import CdpClient
from .._base import WebFormBadRequest, WebFormConflict
from ..engine import (
    ApplyOutcome,
    Control,
    FieldMapping,
    FormEngine,
    MatchResult,
    evidence_key,
)
from ..extra_profile import custom_fields_of
from ..fields import (
    FIELD_EXCLUDE_HINTS,
    FIELD_LABELS,
    FIELD_SYNONYMS,
    FORM_FIELDS,
    RELATIVE_HINTS,
    SOURCE_EXTRA,
)
from ..matching import (
    format_date,
    is_placeholder,
    meaningful_options,
    normalize_option_text,
    resolve_select_option,
)
from ..repeated_fields import (
    compatible_block,
    field_key_for_block,
    field_label_for_key,
    split_repeated_key,
)
from ..session import Snapshot, SnapshotStore, get_snapshot_store
from .fill import (
    _fill_lock,
    apply_fill,
    is_apply_running,
    is_filling,
    list_extra_fields,
    list_fields,
    resolve_value_for,
)
from .models import (
    AI_NOTE,
    SOURCE_AI,
    SOURCE_RULE,
    STATUS_CONFLICT,
    STATUS_LOW_CONFIDENCE,
    STATUS_READY,
    FillSelection,
    PendingItem,
    PreviewItem,
    PreviewReport,
    default_selections,
)
from .preview import (
    _PAGE_INFO_SCRIPT,
    _adopt_ai_match,
    _mapping_note,
    _same_value,
    build_preview,
    enrich_preview_with_ai,
    read_snapshot,
)
from .suggest import (
    RELATED_LIMIT,
    Suggestion,
    _DIAL_CODE_RE,
    _describe,
    recognize_field,
    related_entries,
    suggest_for,
)

logger = logging.getLogger(__name__)

__all__ = [
    "AI_NOTE",
    "SOURCE_AI",
    "list_extra_fields",
    "SOURCE_RULE",
    "STATUS_CONFLICT",
    "STATUS_LOW_CONFIDENCE",
    "STATUS_READY",
    "FillSelection",
    "PendingItem",
    "PreviewItem",
    "PreviewReport",
    "Suggestion",
    "apply_fill",
    "build_preview",
    "default_selections",
    "enrich_preview_with_ai",
    "is_apply_running",
    "is_filling",
    "list_fields",
    "read_snapshot",
    "recognize_field",
    "resolve_value_for",
    "suggest_for",
]
