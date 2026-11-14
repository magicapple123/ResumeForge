# SPDX-License-Identifier: Apache-2.0
"""纸面状态枚举映射表：「资料 → ResumeContent」时中文状态值落到 A4 固定 code。

纯搬迁自 ``paper_policy.py``：映射表是唯一来源（投影/回填共用 ``SlotRule.enum``），
分区槽位表与校验留在原模块。"""

from __future__ import annotations

from collections.abc import Mapping

from ...schemas.resume_entries import EXPERIENCE_KINDS

_PUBLICATION_STATUS: Mapping[str, str] = {
    "已发表": "published",
    "已录用": "accepted",
    "录用": "accepted",
    "接收": "accepted",
    "在印": "in_press",
    "即将发表": "in_press",
    "审稿中": "under_review",
    "在审": "under_review",
    "预印本": "preprint",
    "预印": "preprint",
    "其他": "other",
}
_PATENT_STATUS: Mapping[str, str] = {
    "已受理": "filed",
    "申请中": "filed",
    "实审中": "pending",
    "审查中": "pending",
    "已授权": "granted",
    "授权": "granted",
    "已过期": "expired",
    "其他": "other",
}
_CREDENTIAL_STATUS: Mapping[str, str] = {
    "有效": "active",
    "已取得": "active",
    "待定": "pending",
    "办理中": "pending",
    "已过期": "expired",
    "未知": "unknown",
}
# F8（R-81）：资料页"工作类型"是自由文本，纸面 experience_kind 是 A4 固定 code 白名单；
# 中文→code 映射只在这里一份（投影/回填共用 SlotRule.enum）。
# 同时接受 code 自身（identity），旧内容/外部工具写入的 code 不会被误追加到承载区。
_WORK_TYPE: Mapping[str, str] = {
    "全职": "full_time",
    "兼职": "part_time",
    "合同": "contract",
    "合同制": "contract",
    "自雇": "self_employed",
    "自由职业": "self_employed",
    "实习": "internship",
    "志愿": "volunteer",
    "志愿服务": "volunteer",
    "其他": "other",
}
# 同时接受 code 自身（旧内容/外部工具可能直接写 code），不把已知值误当未识别。
_WORK_TYPE.update({code: code for code in EXPERIENCE_KINDS})
