# SPDX-License-Identifier: Apache-2.0
"""内推状态词表：一次内推从"已联系"到"已提交 / 已关闭 / 无效"的完整生命周期。"""

# ===== 内推状态（前后端共用一份取值）=====
REFERRAL_STATUS_ACTIVE = "active"
REFERRAL_STATUS_SUBMITTED = "submitted"
REFERRAL_STATUS_CLOSED = "closed"
REFERRAL_STATUS_INVALID = "invalid"
REFERRAL_STATUSES = (
    REFERRAL_STATUS_ACTIVE,
    REFERRAL_STATUS_SUBMITTED,
    REFERRAL_STATUS_CLOSED,
    REFERRAL_STATUS_INVALID,
)
