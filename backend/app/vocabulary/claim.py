# SPDX-License-Identifier: Apache-2.0
"""事实台账的词表：承担程度、核实状态、分类与未完成标记。

``app/models/claim.py`` 与 ``app/schemas/claim.py`` 都从这里取同一份取值——「哪些状态能
进最终简历」「哪些标记算未完成」这类判定不允许两处各写一份、各判一次。
"""

# ===== ① 承担程度：个人在其中的位置，用于防止把团队成果写成本人主导 =====
RESPONSIBILITY_PARTICIPATED = "参与"
RESPONSIBILITY_MODULE = "负责模块"
RESPONSIBILITY_LED = "主导方案或交付"
RESPONSIBILITY_OWNER = "项目负责人"
RESPONSIBILITY_LEVELS = (
    RESPONSIBILITY_PARTICIPATED,
    RESPONSIBILITY_MODULE,
    RESPONSIBILITY_LED,
    RESPONSIBILITY_OWNER,
)

# ===== ② 核实状态：决定这条主张能出现在哪一版材料里 =====
VERIFICATION_CONFIRMED = "已确认"
VERIFICATION_PENDING = "待确认"
VERIFICATION_EXPIRED = "已过期"
VERIFICATION_REJECTED = "不采用"
VERIFICATION_STATUSES = (
    VERIFICATION_CONFIRMED,
    VERIFICATION_PENDING,
    VERIFICATION_EXPIRED,
    VERIFICATION_REJECTED,
)

# ===== ③ 分类：与个人资料库的区块对齐，便于把资料一键转成台账草稿 =====
CLAIM_CATEGORY_EDUCATION = "教育经历"
CLAIM_CATEGORY_EXPERIENCE = "实习/工作"
CLAIM_CATEGORY_PROJECT = "项目经历"
CLAIM_CATEGORY_CAMPUS = "校园经历"
CLAIM_CATEGORY_SKILL = "专业技能"
CLAIM_CATEGORY_AWARD = "荣誉奖项"
CLAIM_CATEGORY_OTHER = "其他"
CLAIM_CATEGORIES = (
    CLAIM_CATEGORY_EDUCATION,
    CLAIM_CATEGORY_EXPERIENCE,
    CLAIM_CATEGORY_PROJECT,
    CLAIM_CATEGORY_CAMPUS,
    CLAIM_CATEGORY_SKILL,
    CLAIM_CATEGORY_AWARD,
    CLAIM_CATEGORY_OTHER,
)

# ===== ④ 未完成标记：全仓库统一的可检索标记，且被禁止进入最终导出 =====
# 用中括号【】而不是 Markdown 语法，一是中文语境下更醒目，二是能安全地出现在
# HTML/Markdown/JSON 三种导出格式里而不破坏结构。
PLACEHOLDER_PREFIX = "【待补"
PLACEHOLDER_MARKERS = (PLACEHOLDER_PREFIX, "【待确认", "【待补充", "【待核实")


def has_placeholder(text: str) -> bool:
    """文本里是否含未完成标记（决定它能不能进最终导出）。"""
    return any(marker in (text or "") for marker in PLACEHOLDER_MARKERS)


def placeholder_hit(text: str) -> str:
    """返回文本里命中的第一个未完成标记，便于在错误信息里指出具体位置。"""
    for marker in PLACEHOLDER_MARKERS:
        if marker in (text or ""):
            return marker
    return ""
