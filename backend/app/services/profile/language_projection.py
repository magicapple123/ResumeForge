# SPDX-License-Identifier: Apache-2.0
"""语言能力的唯一纸面映射（2026-10 起：语言是独立分区，不再并入 skills）。

**历史**：旧版 R-72 把每条语言压成一条 `ResumeSkill`（name=语言，level=「水平/证书/分数」）
塞进 `content.skills`，于是制作台里语言能力显示成「专业技能」——用户反馈 #11 明确要求
拆开。现在：

- `ResumeContent.languages` 是独立数组，五个资料字段各自往返（语言 / 水平 / 证书 /
  分数 / 取得时间），不再做有损拼接；
- 本模块是「资料消费分区的字段 → ResumeContent.languages 属性」的**唯一映射**：
  投影组装（paper_content_builder）与生成补位（language_restore）都从这里取，
  不在两处各写一份字段表；
- 空条目不产生纸面占位；整条为空由调用方跳过。

纸面渲染的拼接（「语言（水平 · 证书 · 分数）· 取得时间」）是**展示层**的事，分别在
HTML 模板 / Word / PDF / Markdown 的渲染器里按同一字段顺序组装，本模块不产出成品文案。
"""

from __future__ import annotations

from ...schemas.profile_projection import ConsumedSection
from ...schemas.resume_entries import ResumeLanguageItem

# 资料字段 key → ResumeContent.languages 属性名（顺序即编辑器与纸面字段顺序）。
LANGUAGE_FIELD_IDS: dict[str, str] = {
    "name": "languages.language",
    "level": "languages.level",
    "certificate": "languages.certificate",
    "score": "languages.score",
    "obtained_at": "languages.obtained_at",
}

# 与 ResumeLanguageItem 各字段的 max_length 一致（超长截断而不是丢整条）。
_FIELD_LIMITS: dict[str, int] = {
    "name": 128,
    "level": 64,
    "certificate": 128,
    "score": 64,
    "obtained_at": 32,
}


def _text(entry, key: str) -> str:
    return str(entry.values.get(LANGUAGE_FIELD_IDS[key]) or "").strip()


def project_language_item_entries(
    languages: ConsumedSection,
) -> list[tuple[str, ResumeLanguageItem]]:
    """语言分区 → [(entry_id, ResumeLanguageItem)]（按条目顺序，空条目跳过）。

    带上 entry_id 是为了让投影层回答"这条语言在 content.languages 的第几项"
    （候选的 paper_content_path）；生成补位只需要 item 列表，见下面薄封装。
    """
    items: list[tuple[str, ResumeLanguageItem]] = []
    for entry in languages.entries:
        values = {
            key: _text(entry, key)[:_FIELD_LIMITS[key]] for key in LANGUAGE_FIELD_IDS
        }
        if not any(values.values()):
            continue  # 完全空的条目不产生纸面占位
        items.append((entry.entry_id, ResumeLanguageItem(**values)))
    return items


def project_language_items(languages: ConsumedSection) -> list[ResumeLanguageItem]:
    """同 project_language_item_entries，但不带来源 id（生成补位用）。"""
    return [item for _entry_id, item in project_language_item_entries(languages)]


__all__ = [
    "LANGUAGE_FIELD_IDS",
    "project_language_item_entries",
    "project_language_items",
]
