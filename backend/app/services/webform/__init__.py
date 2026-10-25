# SPDX-License-Identifier: Apache-2.0
"""网申填表：把本地资料填进公司自建网申系统的表单。

**只填不交**：这个包里的任何代码都不会点击提交类控件，填完由用户自己在页面上核对并提交。
详见 ``engine.py`` 的模块说明，守卫见 ``tests/test_webform_no_submit.py``。
"""

# 把这些子模块挂成包属性（``webform.browser`` 等）：api 层路由经 ``webform_service.*``
# 属性访问它们以保证 patch 契约（``app.api.webform.webform_service.*``）继续生效，
# 这里显式 re-export 让类型检查器认识这批属性（运行时它们本就随导入被挂上）。
from . import (
    ai as ai,
)
from . import (
    browser as browser,
)
from . import (
    extra_profile_text as extra_profile_text,
)
from . import (
    live_targets as live_targets,
)
from . import (
    repeated_profile as repeated_profile,
)
from . import (
    url_history as url_history,
)
from ._base import WebFormBadRequest, WebFormConflict, WebFormError, WebFormNotFound
from .data import (
    build_catalog,
    build_form_data,
    build_live_form_data,
    catalog_from_profile,
    pick_top_education,
    profile_to_form_data,
)
from .engine import ApplyOutcome, Control, FieldMapping, FormEngine, MatchResult, SkipNote
from .extra_profile import EXTRA_FIELD_KEYS, list_entries, save_entries
from .facts import (
    fact_catalog_entries as fact_catalog_entries,
)
from .facts import (
    fact_custom_labels as fact_custom_labels,
)
from .facts import (
    merge_fact_data as merge_fact_data,
)
from .fields import (
    FIELD_KEYS,
    FIELD_LABELS,
    FORM_FIELDS,
    SENSITIVE_FIELD_KEYS,
    FormField,
)
from .history import create_record, delete_record, list_records, record_or_none
from .live import (
    LiveSession,
    is_live_running,
    live_status,
    remember_live_choice,
    set_live_enabled,
    start_live,
    stop_live,
)
from .matching import (
    DateResolution,
    SelectOption,
    SelectResolution,
    date_component,
    format_date,
    resolve_choice,
    resolve_select_option,
)
from .profile_targets import build_memory_targets, remember_target
from .service import (
    SETTLE_RECHECK_SECONDS,
    SOURCE_AI,
    SOURCE_RULE,
    STATUS_CONFLICT,
    STATUS_LOW_CONFIDENCE,
    STATUS_READY,
    FillSelection,
    PendingItem,
    PreviewItem,
    PreviewReport,
    apply_fill,
    build_preview,
    default_selections,
    enrich_preview_with_ai,
    is_apply_running,
    is_filling,
    list_extra_fields,
    list_fields,
    read_snapshot,
    recognize_field,
)
from .session import Snapshot, SnapshotStore, get_snapshot_store

__all__ = [
    "FIELD_KEYS",
    "FIELD_LABELS",
    "FORM_FIELDS",
    "SENSITIVE_FIELD_KEYS",
    "SETTLE_RECHECK_SECONDS",
    "SOURCE_AI",
    "SOURCE_RULE",
    "STATUS_CONFLICT",
    "STATUS_LOW_CONFIDENCE",
    "STATUS_READY",
    "ApplyOutcome",
    "Control",
    "DateResolution",
    "FieldMapping",
    "FillSelection",
    "FormEngine",
    "FormField",
    "LiveSession",
    "MatchResult",
    "PendingItem",
    "PreviewItem",
    "PreviewReport",
    "SelectOption",
    "SelectResolution",
    "date_component",
    "SkipNote",
    "Snapshot",
    "SnapshotStore",
    "WebFormBadRequest",
    "WebFormConflict",
    "WebFormError",
    "WebFormNotFound",
    "apply_fill",
    "build_catalog",
    "build_form_data",
    "build_live_form_data",
    "build_memory_targets",
    "catalog_from_profile",
    "build_preview",
    "create_record",
    "default_selections",
    "delete_record",
    "EXTRA_FIELD_KEYS",
    "enrich_preview_with_ai",
    "fact_catalog_entries",
    "fact_custom_labels",
    "merge_fact_data",
    "format_date",
    "get_snapshot_store",
    "is_apply_running",
    "is_filling",
    "is_live_running",
    "live_status",
    "remember_live_choice",
    "set_live_enabled",
    "remember_target",
    "list_extra_fields",
    "list_fields",
    "list_records",
    "list_entries",
    "pick_top_education",
    "profile_to_form_data",
    "read_snapshot",
    "recognize_field",
    "record_or_none",
    "resolve_choice",
    "save_entries",
    "resolve_select_option",
    "start_live",
    "stop_live",
]
