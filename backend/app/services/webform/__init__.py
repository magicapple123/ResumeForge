# SPDX-License-Identifier: Apache-2.0
"""网申填表：把本地资料填进公司自建网申系统的表单。

**只填不交**：这个包里的任何代码都不会点击提交类控件，填完由用户自己在页面上核对并提交。
详见 engine.py 的模块说明，守卫见 tests/test_webform_no_submit.py。

F5 起取数链路是 build_webform_view（一份快照 → data/catalog/custom_labels）；
补充事实（facts）已退出生产取数，但模块文件保留（旧表继续进备份），只是不再被引用。
"""

# 把这些子模块挂成包属性（webform.browser 等）：api 层路由经 webform_service.* 属性访问
# 它们以保证 patch 契约（app.api.webform.webform_service.*）继续生效，这里显式 re-export
# 让类型检查器认识这批属性（运行时它们本就随导入被挂上）。
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
    WebformDataView,
    build_catalog,
    build_form_data,
    build_live_form_data,
    build_webform_view,
)
from .engine import ApplyOutcome, Control, FieldMapping, FormEngine, MatchResult, SkipNote
from .extra_profile import EXTRA_FIELD_KEYS, list_entries, save_entries
from .fields import FIELD_KEYS, FIELD_LABELS, FORM_FIELDS, SENSITIVE_FIELD_KEYS, FormField
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
from .matching import format_date, resolve_choice, resolve_select_option
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
    "FIELD_KEYS", "FIELD_LABELS", "FORM_FIELDS", "SENSITIVE_FIELD_KEYS",
    "SETTLE_RECHECK_SECONDS", "SOURCE_AI", "SOURCE_RULE", "STATUS_CONFLICT",
    "STATUS_LOW_CONFIDENCE", "STATUS_READY", "ApplyOutcome", "Control",
    "FieldMapping", "FillSelection", "FormEngine", "FormField", "LiveSession",
    "MatchResult", "PendingItem", "PreviewItem", "PreviewReport", "SkipNote",
    "Snapshot", "SnapshotStore", "WebFormBadRequest", "WebFormConflict",
    "WebFormError", "WebFormNotFound", "WebformDataView", "apply_fill",
    "build_catalog", "build_form_data", "build_live_form_data", "build_memory_targets",
    "build_preview", "build_webform_view", "create_record", "default_selections",
    "delete_record", "EXTRA_FIELD_KEYS", "enrich_preview_with_ai", "format_date",
    "get_snapshot_store", "is_apply_running", "is_filling", "is_live_running",
    "list_entries", "list_extra_fields", "list_fields", "list_records",
    "live_status", "read_snapshot", "recognize_field", "record_or_none",
    "remember_live_choice", "remember_target", "resolve_choice",
    "resolve_select_option", "save_entries", "set_live_enabled", "start_live",
    "stop_live",
]
