# SPDX-License-Identifier: Apache-2.0
"""PDF 绘制前的"这个分区有没有内容"判定（A4 从 render.py 拆出：主文件贴着 500 行预算）。

**为什么需要它**：双栏模板把分区两两一行并排（columns.plan_rows）：只有"会画出来的
分区"参与配对，否则空板块会占掉网格格位、把后面的分区整体错位（实测整份简历凭空高出
40mm）。

**为什么从分区表推导而不是再写一份清单**：W14 科研三栏目与 A4 资格证照都已登记在
resume_sections.DEFAULT_SECTION_ORDER；手写第二份清单会让"新板块在双栏里被当成空"
这类错误在加栏目时静默出现。除 summary（字符串）外，所有分区都是 list[条目]。
"""

from __future__ import annotations

from ...schemas.resume import ResumeContent


def section_has_content(resume: ResumeContent, key: str) -> bool:
    """这个分区有没有内容可画；未知键按空处理（宁可少画一段，也不让整份导出抛错）。"""
    if key == "summary":
        return bool(resume.summary.strip())
    value = getattr(resume, key, None)
    return bool(value) if isinstance(value, list) else False


__all__ = ["section_has_content"]
