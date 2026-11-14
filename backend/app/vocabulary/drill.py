# SPDX-License-Identifier: Apache-2.0
"""按事实台账深挖的反馈策略词表：真实模拟与训练模式的分野。"""

# ===== 反馈策略：真实模拟与训练模式的分野 =====
# 真实模拟默认**不在每题后**把判定念给用户（那会让人按判分标准答题，而不是像真面试）；
# 训练模式则每题后立刻给一段简短反馈。
FEEDBACK_DEFERRED = "deferred"
FEEDBACK_IMMEDIATE = "immediate"
FEEDBACK_POLICIES = (FEEDBACK_DEFERRED, FEEDBACK_IMMEDIATE)
