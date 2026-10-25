# SPDX-License-Identifier: Apache-2.0
"""R-73：语言能力 → 纸面 skills 的确定性补位（生成链路专用）。

**为什么需要补位**：语言能力条目的纸面形态是"专业技能"里的一条 skills 记录（路线 1），
但模型输出是自由 JSON——模型可能漏写语言，尤其当提示词里语言只作为素材出现时。
R-73 要求：当前组含语言能力、资料里有语言条目、而结果 skills 中缺该语言时，按资料
**确定性补一条**；补位属于"回填用户已有数据"（与 grounding 的 restored 同口径），
不调模型、不新造内容。

**边界**：languages 未参与当前组 → 不补；组内语言条目为空 → 不补；模型已写了同名语言
（含 AI 改写过 level）→ 保留模型结果，不覆盖（避免把改写优势丢掉，也避免重复条目）。
映射只做一次：name/level 取自 paper_projection.project_language_skills（R-72 唯一实现），
这里不自己拼 level、不做第二个语言映射。

**C14 容量**：技能与语言各自可达 200 条，合并进 ResumeContent.skills 上限 200。超限时
抛 LanguageCapacityError（结构化、可展示的中文错误），由生成编排转成 error 事件——绝不
静默截断（"截到 200 条后装成功"是明确禁止的）。
"""

from __future__ import annotations

from typing import Any

from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ..profile.language_projection import project_language_skills
from .resume_grounding_helpers import _similar_skill

# ResumeContent.skills 的结构上限（schemas/resume.py 用 MAX_RESUME_SECTION_ITEMS）。
MAX_SKILLS = 200


class LanguageCapacityError(ValueError):
    """技能 + 语言合并超过 200 条：结构化报错，让用户减少条目而不是静默截断。"""

    def __init__(self, total: int) -> None:
        self.total = total
        self.detail = (
            f"技能与语言合并后共 {total} 条，超过单份简历 {MAX_SKILLS} 条上限："
            "请减少资料中的技能或语言条目后重试"
        )
        super().__init__(self.detail)


def restore_language_skills(
    resume: ResumeContent, consumed: ConsumedProfile
) -> tuple[ResumeContent, list[dict[str, Any]]]:
    """把当前组内未隐藏的语言按 R-72 映射补进 skills 末尾；返回 (简历, 标注)。

    返回的标注形状与 grounding 的 fact_annotations 一致（origin=restored），可直接
    extend 进 done 事件；path 是新 skills 的下标，source_subject 是语言名。
    """
    languages = consumed.section("languages")
    if languages is None or not languages.entries:
        return resume, []
    projected = project_language_skills(languages)
    if not projected:
        return resume, []
    existing = list(resume.skills or [])
    total = len(existing) + len(projected)
    if total > MAX_SKILLS:
        raise LanguageCapacityError(total)
    existing_names = [str(skill.name or "").strip() for skill in existing]
    additions: list[Any] = []
    annotations: list[dict[str, Any]] = []
    for skill in projected:
        name = str(skill.name or "").strip()
        if not name:
            continue
        if any(
            existing_name and _similar_skill(name, existing_name)
            for existing_name in existing_names
        ):
            # 模型已经写了这门语言（可能改写了 level）：保留模型结果，不覆盖/不重复。
            continue
        additions.append(skill)
        existing_names.append(name)
        annotations.append(
            {
                "path": f"skills.{len(existing) + len(additions) - 1}",
                "origin": "restored",
                "source_subject": name,
                "source_fact": str(skill.level or "").strip() or None,
            }
        )
    if not additions:
        return resume, []
    return resume.model_copy(update={"skills": [*existing, *additions]}), annotations


__all__ = ["LanguageCapacityError", "MAX_SKILLS", "restore_language_skills"]
