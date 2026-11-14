# SPDX-License-Identifier: Apache-2.0
"""求职进度的词表：漏斗状态 / 记录来源 / 投递渠道。

三个维度刻意分开，不许混用：``status`` 描述"对方走到哪一步了"，``source`` 描述
"这一行怎么进系统的"，``channel`` 描述"这份工作从哪来的"。
"""

# ===== ① 状态：秋招漏斗的六个阶段 =====
STATUS_UNKNOWN = "unknown"
STATUS_APPLIED = "applied"
STATUS_SCREENING = "screening"
STATUS_ASSESSMENT = "assessment"
STATUS_INTERVIEW = "interview"
STATUS_OFFER = "offer"
STATUS_REJECTED = "rejected"

STATUSES = (
    STATUS_APPLIED,
    STATUS_SCREENING,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_UNKNOWN,
)

# ===== ② 记录来源 =====
SOURCE_APPLY = "apply"
SOURCE_MANUAL = "manual"
SOURCE_RECOGNIZED = "recognized"
SOURCES = (SOURCE_APPLY, SOURCE_MANUAL, SOURCE_RECOGNIZED)

# ===== ②′ 投递渠道（RF-18）：用户自己选的"这份工作从哪来的" =====
# 与 ``source``（记录来源：这一行**怎么进系统的**）是两个维度，不许混用。
# 未知是合法取值且是默认值：不知道就是不知道，宁可留空也不替用户编一个渠道。
CHANNEL_UNKNOWN = "unknown"
CHANNEL_REFERRAL = "referral"
CHANNEL_WEBSITE = "official_website"
CHANNEL_PLATFORM = "job_platform"
CHANNEL_HEADHUNTER = "headhunter"
CHANNEL_OTHER = "other"
CHANNELS = (
    CHANNEL_UNKNOWN,
    CHANNEL_REFERRAL,
    CHANNEL_WEBSITE,
    CHANNEL_PLATFORM,
    CHANNEL_HEADHUNTER,
    CHANNEL_OTHER,
)
