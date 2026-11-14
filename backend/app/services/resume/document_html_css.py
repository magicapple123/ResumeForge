# SPDX-License-Identifier: Apache-2.0
"""v2 文档结构 CSS（从 app.services.resume.document_html 纯搬迁拆出）。

模板只提供主题（:root / 字号 / 颜色 / 间距），条目头三种布局、灰字段网格与正文段落的
结构规则集中在这里：document_html 的 build_resume_html 把它拼进 style 收口。常量注释里
「不许出现 markdown 加粗标记 / 尖括号标签字面量」的约束随常量一起搬过来。
"""

from __future__ import annotations

from ...schemas.resume_document_plan import DocumentPlan

# v2 结构样式：条目头三种布局 / 灰字段网格 / 正文段落。集中注入而不是 9 套模板各抄
# 一份：模板只提供主题（:root、字号、颜色、间距），结构与 W07 角色样式都在这里收口；
# 自制模板 include 正文片段时同样拿到这套规则。
_DOCUMENT_CSS = """
  /* ===== v2 文档结构（由 exporter 统一注入；模板只提供主题样式）===== */
  .entry-head .title { flex: 1 1 auto; min-width: 0; }
  .entry-head .meta { flex: 0 1 auto; max-width: 55%; text-align: right; white-space: normal; }
  .entry-head.head-stacked, .entry-head.head-meta_first { display: block; }
  /* title / meta 在模板里是「行内 span」：只把容器改成 block 并不能让它们换行，
     两个 span 仍然拼在一行（审计 R-04 的实测症状）。必须逐个改成 block。
     写注释注意两件事：① 这里会被原样写进产物的样式表，所以不许出现星号星号那种
     markdown 加粗标记（`test_rich_export_consistency` 判它"漏进产物"）；
     ② 不许出现尖括号标签名字面量（style / script 这类），`apply_rich_html` 按标签切
     文本段，脏标签会让"跳过脚本样式"的深度算错，后面整段正文都不再做加粗转换。 */
  .entry-head.head-stacked .title,
  .entry-head.head-stacked .meta,
  .entry-head.head-meta_first .title,
  .entry-head.head-meta_first .meta { display: block; }
  .entry-head.head-stacked .meta, .entry-head.head-meta_first .meta { max-width: none; text-align: left; }
  /* 模板给 `.entry-head .meta` 写的是 `white-space: nowrap`（右对齐时不许折行）。
     上下 / 元信息在上两种布局里元信息独占一行，长元信息（"· 项目负责人 · 8 人团队"）
     会顶出纸边——这里用 0,3,0 的选择器压过模板的 0,2,0，允许折行。 */
  .entry-head.head-stacked .meta,
  .entry-head.head-meta_first .meta { white-space: normal; }
  .entry-head.head-stacked .meta { margin-top: calc(var(--fs) * 0.14); }
  .entry-head.head-meta_first .title { margin-top: calc(var(--fs) * 0.14); }
  /* 灰字段：equal = 网格（跨行列宽一致，solo 独占整行）；flow = 行内顺排。 */
  .sub-grid { display: grid; align-items: baseline; }
  .sub-grid.sub-cols-1 { grid-template-columns: repeat(1, minmax(0, auto)); }
  .sub-grid.sub-cols-2 { grid-template-columns: repeat(2, minmax(0, auto)); }
  .sub-grid.sub-cols-3 { grid-template-columns: repeat(3, minmax(0, auto)); }
  /* 分布 = 两端（问题 4）：列宽仍按内容，剩余空白均分到列之间，最后一列右缘贴住内容区
     右边界。只由模板在 equal + 多列 + 无显式逐列宽度时挂上这个 class。 */
  .sub-grid.sub-justify-between { justify-content: space-between; }
  .sub-cell-solo { grid-column: 1 / -1; }
  .sub-flow .sub-cell { margin-right: calc(var(--fs) * 0.4); }
  .sub-flow .sub-cell:last-child { margin-right: 0; }
  /* inline 板块（技能/语言）：一行一个 li，标签形状由模板的 .skill-list / .skill-list li
     决定。这里的 :where() 是零特异性兜底——只给没有主题 CSS 的自制模板补上"标签排成一排"
     的最小结构，内置 9 套模板自己的 .skill-list 规则仍然优先（Q26）。 */
  :where(.skill-list) { list-style: none; margin: 0; padding-left: 0; }
  :where(.skill-list > li) { display: inline-block; margin: 0 calc(var(--fs) * 0.57) calc(var(--fs) * 0.36) 0; }
  .body-paragraph { margin-bottom: calc(var(--fs) * 0.21); }
  .entry .body-paragraph:last-child { margin-bottom: 0; }
  /* 条目级分页（计划 §6.2）：只作用于打印/分页引擎。 */
  .entry-break-before{break-before:page;page-break-before:always}
  .entry-keep{break-inside:avoid;page-break-inside:avoid}
"""


def document_css(plan: DocumentPlan) -> str:
    """v2 文档结构 CSS（plan 里没有需要逐份生成的结构规则；保留入参便于将来扩展）。"""
    if not plan.sections:
        return ""
    return _DOCUMENT_CSS.strip()
