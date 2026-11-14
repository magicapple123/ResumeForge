# SPDX-License-Identifier: Apache-2.0
"""模拟面试的词表：面试类型 / 难度 / 面试官风格 / 会话状态 / 消息阶段。"""

# 面试类型：覆盖校招/社招常见形式，前端按这个清单给选项。
INTERVIEW_TYPES = (
    "技术面",
    "项目深挖",
    "行为面（STAR）",
    "HR 面",
    "综合面",
    "案例分析",
    "英语面试",
    "压力面",
)

INTERVIEW_DIFFICULTIES = ("初级", "中级", "高级")

# 面试官风格：影响提问语气与追问强度。
INTERVIEWER_STYLES = (
    "严谨专业",
    "温和引导",
    "持续追问",
    "压力质询",
)

INTERVIEW_STATUS_ACTIVE = "active"
INTERVIEW_STATUS_FINISHED = "finished"

# 消息所属的阶段（0071 / #41）：``interview`` = 正式面试的问答，**只有它计入轮次**
# （进度条与报告都按它算）。结束后追问用的 ``followup`` 阶段不参与轮次口径，
# 其取值与 ``MESSAGE_PHASES`` 一起留在 ``app/models/interview.py``。
MESSAGE_PHASE_INTERVIEW = "interview"
