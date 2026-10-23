# SPDX-License-Identifier: Apache-2.0
"""资料域工具声明的聚合入口：``DATA_TOOLS``（21 条）。

按工具域拆到相邻模块（均为纯搬迁，声明体逐字未改）：

======================  ==============================================  ====
模块                    域                                              条数
======================  ==============================================  ====
``_tools_specs_data_materials``        资料箱（materials）              4
``_tools_specs_data_claims``           事实台账（claims）               4
``_tools_specs_data_candidate_jobs``   备选岗位（candidate jobs）       5
``_tools_specs_data_skills``           助手技能（skills）               4
``_tools_specs_data_formats``          版式（format templates）         3
``_tools_specs_data_user_files``       文件副本库（user files）         1
======================  ==============================================  ====

**拼接顺序即行为契约**：``_registry._TOOLS`` 按 ``CORE → DATA → RELAXED →
REPORT → SEARCH`` 拼接，工具声明顺序会进提示词。下面 ``DATA_TOOLS`` 的分组顺序
与拆分前那份单文件里的书写顺序完全一致，不得重排（``test_assistant_tool_specs``
钉着这一点）。放宽模式工具仍在 ``_tools_specs_relaxed.py``。
"""

from __future__ import annotations

from ._tools_specs_data_candidate_jobs import CANDIDATE_JOB_TOOLS
from ._tools_specs_data_claims import CLAIM_TOOLS
from ._tools_specs_data_formats import FORMAT_TEMPLATE_TOOLS
from ._tools_specs_data_materials import MATERIAL_TOOLS
from ._tools_specs_data_skills import SKILL_TOOLS
from ._tools_specs_data_user_files import USER_FILE_TOOLS
from ._types import Tool

DATA_TOOLS: tuple[Tool, ...] = (
    *MATERIAL_TOOLS,
    *CLAIM_TOOLS,
    *CANDIDATE_JOB_TOOLS,
    *SKILL_TOOLS,
    *FORMAT_TEMPLATE_TOOLS,
    *USER_FILE_TOOLS,
)
