# SPDX-License-Identifier: Apache-2.0
"""把资料整理成"可以直接往表单里填"的三份输出：data / catalog / custom_labels。

F5 起，三份输出都从**同一份快照**派生（profile_snapshot：当前组 scope + 消费视图 +
网申专用来源 + R-75 重叠值），并由 defined_fields 的同一次遍历产生；这里只保留稳定的
导入出口，不再导出旧的 UserProfile 映射函数（profile_to_form_data / pick_* 已退役）。
"""
from .catalog import (
    build_catalog as build_catalog,
)
from .source import (
    WebformDataView as WebformDataView,
)
from .source import (
    build_form_data as build_form_data,
)
from .source import (
    build_live_form_data as build_live_form_data,
)
from .source import (
    build_webform_view as build_webform_view,
)

__all__ = [
    "WebformDataView",
    "build_catalog",
    "build_form_data",
    "build_live_form_data",
    "build_webform_view",
]
