# SPDX-License-Identifier: Apache-2.0
"""离线分享包的权限词表：只有两态，且只做标记（离线包里没有在线鉴权）。"""

# ===== 分享权限（前后端共用一份取值）=====
SHARE_PERMISSION_READ_ONLY = "read_only"
SHARE_PERMISSION_COMMENT = "comment"
SHARE_PERMISSIONS = (
    SHARE_PERMISSION_READ_ONLY,
    SHARE_PERMISSION_COMMENT,
)
