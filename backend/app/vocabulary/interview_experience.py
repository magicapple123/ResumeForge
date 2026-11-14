# SPDX-License-Identifier: Apache-2.0
"""面经知识库的词表：来源三类（自己 / 同行 / 公开），只做分类不做断言。"""

# ===== 面经来源（前后端共用一份取值）=====
EXPERIENCE_SOURCE_SELF = "self"
EXPERIENCE_SOURCE_PEER = "peer"
EXPERIENCE_SOURCE_PUBLIC = "public"
EXPERIENCE_SOURCES = (
    EXPERIENCE_SOURCE_SELF,
    EXPERIENCE_SOURCE_PEER,
    EXPERIENCE_SOURCE_PUBLIC,
)
