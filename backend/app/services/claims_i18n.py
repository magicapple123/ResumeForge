# SPDX-License-Identifier: Apache-2.0
"""事实台账改进建议的英文本案（en-US 界面专用）。

为什么单独一个模块：``services/claims.py`` 已经顶在 500 行生产代码预算附近
（tests/test_file_size_budget.py），而这几条建议是**纯文案**，塞回去只会把规则逻辑挤走。
这和 ``services/trash.py`` 里的 ``TRASH_LABELS_EN`` 是同一类东西：中文原文留在原处
（日志、测试、中文界面都直接引用它），英文另给一份。

两条约定：

1. **键是协议值，不是译文**。``RESPONSIBILITY_LABELS_EN`` 的键必须与
   ``models/claim.py`` 里的 ``RESPONSIBILITY_LEVELS`` 逐字一致——库里存的是中文枚举，
   翻译它会让界面按值查不到语言包。这里只在**渲染那一刻**换成英文。
2. **覆盖 ``claim_warnings()`` 的每一个分支**。少一条，英文界面上就会冒出一句中文，
   而中文界面对应位置是空的——比没翻更难发现。
"""

from __future__ import annotations

# 承担程度（``claim_record.responsibility_level``）的中 -> 英。键是协议值。
# 译法与前端语言包 ``en-US.enumsClaims.ts`` 的 ``enumsClaims.responsibility.*`` 逐字对齐：
# 同一枚举在徽标与建议文案里必须叫同一个名字，否则用户会以为是两回事。
RESPONSIBILITY_LABELS_EN: dict[str, str] = {
    "参与": "Participated",
    "负责模块": "Owned a module",
    "主导方案或交付": "Led the solution or delivery",
    "项目负责人": "Project owner",
}

# 与 ``claims.claim_warnings()`` 里的规则一一对应，顺序也一致。
STRONG_RESPONSIBILITY_WARNING = (
    "Responsibility level is “{level}”, and a claim this strong will always be probed in an "
    "interview; add the decisions you made, the difficulties, how you verified it, and the result."
)
NO_BOUNDARY_WARNING = (
    "This claim goes into the live resume but carries no personal boundary; spell out what the "
    "team did versus what you did, so team results are not read as your own."
)
NO_SOURCES_WARNING = (
    "Confirmed, but no evidence source was recorded, so it cannot be traced back when it needs "
    "re-checking later."
)
PENDING_PLACEHOLDER_WARNING = (
    "This unverified wording has no [TODO] placeholder; the final export cannot tell that it is "
    "unverified yet and may use it by mistake."
)
EXPIRED_WARNING = "Marked as expired; update the content and re-verify it before using it."
REJECTED_WARNING = "Marked as not adopted; resume generation will explicitly avoid this wording."
WORDING_CONFLICT_WARNING = (
    "The wording uses strong verbs (“led / independently delivered / owned”) while the "
    "responsibility level is “Participated” — the two disagree, which is easy to break down "
    "in an interview."
)


def responsibility_label(value: str) -> str:
    """承担程度的中文协议值 -> 英文短语；未知值原样返回（不吞掉信息）。"""
    return RESPONSIBILITY_LABELS_EN.get(value, value)
