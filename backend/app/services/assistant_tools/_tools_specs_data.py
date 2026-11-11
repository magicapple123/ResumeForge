# SPDX-License-Identifier: Apache-2.0
"""资料域工具声明的聚合入口：DATA_TOOLS（24 条）。

按工具域拆到相邻模块（均为纯搬迁，声明体逐字未改）：

======================  ==============================================  ====
模块                    域                                              条数
======================  ==============================================  ====
_tools_specs_data_materials        资料箱（materials）              4
_tools_specs_data_claims           事实台账（claims）               4
_tools_specs_data_candidate_jobs   备选岗位（candidate jobs）       5
_tools_specs_data_skills           助手技能（skills）               4
_tools_specs_data_formats          版式（format templates）         3
_tools_specs_data_user_files       文件副本库（user files）         1
======================  ==============================================  ====

**拼接顺序即行为契约**：_registry._TOOLS 按 CORE → DATA → RELAXED →
REPORT → SEARCH 拼接，工具声明顺序会进提示词。下面 DATA_TOOLS 的分组顺序
与拆分前那份单文件里的书写顺序完全一致，不得重排（test_assistant_tool_specs
钉着这一点）。放宽模式工具仍在 _tools_specs_relaxed.py。

期二（T12）追加的 JOB_PREFERENCE_TOOLS 由 actions 契约层 as_tool 生成，**必须留在
DATA_TOOLS 末尾**（顺序是行为契约，不得插到既有分组之间）。

#15F 追加的 APPLY_QUEUE_TOOLS（投递队列：查看 / 调优先级 / 开始投递）同样由契约层
生成，追加在 JOB_PREFERENCE_TOOLS 之后——同样不得插到既有分组之间。
"""

from __future__ import annotations

from ..actions.domains.job_preferences import job_preference_actions
from ..actions.tool_adapter import as_tool
from ._tools_specs_data_apply_queue import APPLY_QUEUE_TOOLS
from ._tools_specs_data_candidate_jobs import CANDIDATE_JOB_TOOLS
from ._tools_specs_data_claims import CLAIM_TOOLS
from ._tools_specs_data_formats import FORMAT_TEMPLATE_TOOLS
from ._tools_specs_data_materials import MATERIAL_TOOLS
from ._tools_specs_data_skills import SKILL_TOOLS
from ._tools_specs_data_user_files import USER_FILE_TOOLS
from ._tools_specs_knowledge import KNOWLEDGE_SEARCH_TOOLS
from ._types import Tool

# 求职偏好（T12）：只读查询 + 两个必走提案的写工具。声明体由 ActionSpec 生成，
# 权限 / preview / service_entry 都在 domains/job_preferences.py 里显式声明。
JOB_PREFERENCE_TOOLS: tuple[Tool, ...] = (
    as_tool(job_preference_actions()["get_job_preferences"]),
    as_tool(job_preference_actions()["create_job_preference"]),
    as_tool(job_preference_actions()["update_job_preference"]),
)

DATA_TOOLS: tuple[Tool, ...] = (
    *MATERIAL_TOOLS,
    *CLAIM_TOOLS,
    *CANDIDATE_JOB_TOOLS,
    *SKILL_TOOLS,
    *FORMAT_TEMPLATE_TOOLS,
    *USER_FILE_TOOLS,
    *JOB_PREFERENCE_TOOLS,
    *APPLY_QUEUE_TOOLS,
    # #29A 知识库混合检索（search_knowledge，只读）；追加在末尾，不重排既有分组。
    *KNOWLEDGE_SEARCH_TOOLS,
)
