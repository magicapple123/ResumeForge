# SPDX-License-Identifier: Apache-2.0
"""R-73：语言能力 → 纸面「语言能力」分区的确定性补位（生成链路专用）。

**为什么需要补位**：语言能力现在是简历正文里的独立分区（2026-10 起），但模型输出
是自由 JSON——模型可能漏写语言，尤其当提示词里语言只作为素材出现时。R-73 要求：
当前组含语言能力、资料里有语言条目、而结果 `languages` 中缺该语言时，按资料
**确定性补一条**；补位属于"回填用户已有数据"（与 grounding 的 restored 同口径），
不调模型、不新造内容。

**边界**：languages 未参与当前组 → 不补；组内语言条目为空 → 不补；模型已写了同名
语言（含 AI 改写过 level）→ 保留模型结果，不覆盖（避免把改写优势丢掉，也避免重复
条目）。映射只做一次：字段取值复用 `language_projection.project_language_items`
（唯一资料来源），这里不自己重定义"哪几个字段算语言"。

**容量**：语言条目上限与其它正文分区一致（`MAX_RESUME_SECTION_ITEMS` = 200）；
超限时抛 LanguageCapacityError（结构化、可展示的中文错误），由生成编排转成 error
事件——绝不静默截断（"截到 200 条后装成功"是明确禁止的）。
"""

from __future__ import annotations

from typing import Any

from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ...schemas.resume_entries import ResumeLanguageItem
from ..profile.language_projection import project_language_items
from .resume_grounding_helpers import _similar_skill

# ResumeContent.languages 的结构上限（schemas/resume.py 用 MAX_RESUME_SECTION_ITEMS）。
MAX_LANGUAGES = 200


class LanguageCapacityError(ValueError):
    """语言条目超过单份简历上限：结构化报错，让用户减少条目而不是静默截断。"""

    def __init__(self, total: int) -> None:
        self.total = total
        self.detail = (
            f"语言能力共 {total} 条，超过单份简历 {MAX_LANGUAGES} 条上限："
            "请减少资料中的语言条目后重试"
        )
        super().__init__(self.detail)


def restore_languages(
    resume: ResumeContent, consumed: ConsumedProfile
) -> tuple[ResumeContent, list[dict[str, Any]]]:
    """把当前组内未隐藏的语言补进正文 `languages`；返回 (简历, 标注)。

    返回的标注形状与 grounding 的 fact_annotations 一致（origin=restored），可直接
    extend 进 done 事件；path 是新 languages 的下标，source_subject 是语言名。
    """
    languages = consumed.section("languages")
    if languages is None or not languages.entries:
        return resume, []
    projected = project_language_items(languages)
    if not projected:
        return resume, []
    existing = list(resume.languages or [])
    total = len(existing) + len(projected)
    if total > MAX_LANGUAGES:
        raise LanguageCapacityError(total)
    existing_names = [str(item.name or "").strip() for item in existing]
    additions: list[ResumeLanguageItem] = []
    annotations: list[dict[str, Any]] = []
    for item in projected:
        name = str(item.name or "").strip()
        if not name:
            continue
        if any(
            existing_name and _similar_skill(name, existing_name)
            for existing_name in existing_names
        ):
            # 模型已经写了这门语言（可能改写了 level）：保留模型结果，不覆盖/不重复。
            continue
        additions.append(item)
        existing_names.append(name)
        annotations.append(
            {
                "path": f"languages.{len(existing) + len(additions) - 1}",
                "origin": "restored",
                "source_subject": name,
                "source_fact": str(item.level or item.certificate or "").strip() or None,
            }
        )
    if not additions:
        return resume, []
    return resume.model_copy(update={"languages": [*existing, *additions]}), annotations


__all__ = ["LanguageCapacityError", "MAX_LANGUAGES", "restore_languages"]
