# SPDX-License-Identifier: Apache-2.0
"""Word 分区渲染的共用原语（W21 从 `docx_sections` 拆出）。

**为什么单独成文件**：`docx_sections.py` 的正文分区在 W14 扩到十个（论文发表 /
科研项目 / 专利）后已经贴住 500 行预算，而这三节与其余七节共用同一组
"角色覆盖 / 分页计划 / 值拼接"原语。把原语抽出来后，学术三节可以独立成文件，
两个渲染模块都从这里取——**不能互相 import**，那会形成循环依赖。

**口径**：`_role` 只读显式覆盖（`None` = 走模板默认）；`_break_plan` 只解释
`overrides.pagination`，不自己造默认值；`_apply_break` 在没有计划时一个属性都不加。
三者共同维持"没设置 = 产物逐字节不变"。
"""

from __future__ import annotations


def _join(values: list[str], separator: str = " · ") -> str:
    return separator.join(str(item).strip() for item in values if str(item).strip())


def _break_plan(overrides, kind: str, key: str | None = None):
    if overrides is None:
        return None
    plan = overrides.pagination
    return plan.section(key) if kind == "section" else plan.entry(key)


def _apply_break(doc, plan) -> None:
    """W08：把"从新页开始 / 整条保持一页"落到最近创建的段落上（Word 的 page_break_before /
    keep_together）。默认空计划 → 一个属性都不加（旧产物不变）。"""
    if plan is None or not doc.paragraphs:
        return
    node = doc.paragraphs[-1]
    if getattr(plan, "break_before_page", False):
        node.paragraph_format.page_break_before = True
    if getattr(plan, "keep_with_next", 0):
        node.paragraph_format.keep_with_next = True
    if getattr(plan, "allow_split", True) is False:
        node.paragraph_format.keep_together = True


def _role(overrides, role: str, object_id: str | None = None):
    """该角色在对象上下文下的显式覆盖；None = 默认路径（不动模板值）。"""
    if overrides is None:
        return None
    return overrides.style.effective(role, object_id=object_id)
