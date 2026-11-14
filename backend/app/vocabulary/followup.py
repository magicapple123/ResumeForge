# SPDX-License-Identifier: Apache-2.0
"""跟进巡检的封闭决策集（contacted / replied / stopped）。

这三个取值不是漏斗状态：完整语义（为什么 ``replied`` 不改
``application_track.status``）见 ``app/models/followup.py`` 的模块注释。
"""

FOLLOWUP_DECISION_CONTACTED = "contacted"
FOLLOWUP_DECISION_REPLIED = "replied"
FOLLOWUP_DECISION_STOPPED = "stopped"
FOLLOWUP_DECISIONS: tuple[str, ...] = (
    FOLLOWUP_DECISION_CONTACTED,
    FOLLOWUP_DECISION_REPLIED,
    FOLLOWUP_DECISION_STOPPED,
)
