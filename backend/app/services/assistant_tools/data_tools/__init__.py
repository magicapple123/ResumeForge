"""资料箱 / 事实台账 / 面试深挖 / 备选岗位 / 助手技能 / 格式模板的工具。

本包由六个互不重叠的业务域文件组成（materials / claims / drill / candidate_jobs /
skills / format_templates），此 ``__init__`` 作为原 ``data_tools`` 模块路径的兼容门面：
``_registry`` 等调用方继续从 ``.data_tools`` 导入全部符号，导入路径零改动。
"""
from __future__ import annotations

import logging

from .candidate_jobs import (
    _candidate_or_error as _candidate_or_error,
    _tool_create_candidate_job as _tool_create_candidate_job,
    _tool_get_candidate_job as _tool_get_candidate_job,
    _tool_import_candidate_job as _tool_import_candidate_job,
    _tool_list_candidate_jobs as _tool_list_candidate_jobs,
    _tool_update_candidate_job as _tool_update_candidate_job,
)
from .claims import (
    _claim_or_error as _claim_or_error,
    _tool_create_claim as _tool_create_claim,
    _tool_get_claim as _tool_get_claim,
    _tool_list_claims as _tool_list_claims,
    _tool_update_claim as _tool_update_claim,
)
from .drill import (
    _tool_get_drill_report as _tool_get_drill_report,
    _tool_list_drill_sessions as _tool_list_drill_sessions,
)
from .format_templates import (
    _FORMAT_FIELD_LABELS as _FORMAT_FIELD_LABELS,
    _format_config_from_arguments as _format_config_from_arguments,
    _format_template_or_error as _format_template_or_error,
    _format_tool_properties as _format_tool_properties,
    _tool_create_format_template as _tool_create_format_template,
    _tool_list_format_templates as _tool_list_format_templates,
    _tool_update_format_template as _tool_update_format_template,
)
from .materials import (
    _material_or_error as _material_or_error,
    _tool_create_material as _tool_create_material,
    _tool_get_material as _tool_get_material,
    _tool_list_materials as _tool_list_materials,
    _tool_update_material as _tool_update_material,
)
from .skills import (
    _skill_files_from_arguments as _skill_files_from_arguments,
    _tool_create_skill as _tool_create_skill,
    _tool_get_skill as _tool_get_skill,
    _tool_list_skills as _tool_list_skills,
    _tool_update_skill as _tool_update_skill,
)

logger = logging.getLogger(__name__)
