# SPDX-License-Identifier: Apache-2.0
"""v1 -> v2 转换的共享类型：报告、错误、自定义字段提示（D11）。

拆出这个模块的唯一原因是 converter 主模块与逐分区映射模块要共用类型，而它们互相
import 会成环；本模块不 import 任何业务模块（只有标准库 + schema 枚举）。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

__all__ = [
    "CONVERSION_VERSION",
    "ConversionError",
    "ConversionReport",
    "CustomFieldHint",
    "stable_object_id",
]

#: 转换器实现版本（报告里记录；以后规则变化时用它对账）。
CONVERSION_VERSION = 1


class ConversionError(ValueError):
    """v1 内容无法转换（结构非法/不是对象）。API 层翻成 422，不静默丢整份内容。"""


@dataclass(frozen=True)
class CustomFieldHint:
    """资料库自定义字段的定义提示（converter 用它识别承载区里的「标签：值」行）。"""

    # 资料分区 key（educations / custom:<section_id> / ...），用于归属校验。
    section_key: str
    field_id: str
    label: str
    # single_line / multi_line / date_text / enum / number
    field_type: str = "single_line"
    # D6 默认位置：短文本/日期/枚举 -> trail；多行 -> body；仅素材 -> hidden。
    default_placement: str = "trail"
    material_only: bool = False


@dataclass
class ConversionReport:
    """转换报告：逐条差异（多少字段被识别、多少行保留为文本、哪些分区为空）。

    文字不丢的判据是 lines_preserved + fields_recognized 覆盖 v1 里全部非空内容：
    识别不了的行走 TextItem（lines_preserved），绝不静默丢行。
    """

    source_version: int = 1
    fields_recognized: int = 0
    lines_preserved: int = 0
    fields_dropped: int = 0
    fields_merged: int = 0
    custom_fields_recorded: int = 0
    empty_sections: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def warn(self, message: str) -> None:
        text = str(message or "").strip()
        if text and text not in self.warnings:
            self.warnings.append(text)

    def as_dict(self) -> dict:
        """稳定序列化（详情响应 document_conversion / 批量脚本 --report 共用）。"""
        return {
            "version": CONVERSION_VERSION,
            "source_version": self.source_version,
            "fields_recognized": self.fields_recognized,
            "lines_preserved": self.lines_preserved,
            "fields_dropped": self.fields_dropped,
            "fields_merged": self.fields_merged,
            "custom_fields_recorded": self.custom_fields_recorded,
            "empty_sections": list(self.empty_sections),
            "warnings": list(self.warnings),
        }


def stable_object_id(prefix: str, *parts: object) -> str:
    """由稳定输入派生对象 id（v1 -> v2 转换必须**确定性**）。

    为什么不能用随机 uuid：同一份 v1 内容每次转换都得到不同 id，会让
    "内容没变却判定变了"（W02 保存不 bump revision 被破坏）、"同一份内容两次渲染
    HTML 逐字节不同"（历史/缓存/黄金基线全部失准）。所以转换器生成 id 时一律走
    这里：前缀 + sha1(稳定输入) 前 16 位，天然满足 W01 的 8–32 位口径。
    """
    payload = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()
    return prefix + digest[:16]
