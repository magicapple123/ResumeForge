"""服务端直接生成 PDF（fpdf2 + 系统中文字体）。

为什么自己排版而不是复用 HTML：浏览器打印要用户再点一次「另存为 PDF」，且分页
由浏览器决定；服务端生成可以直接下载，版式稳定。代价是需要一个中文字体——从
系统字体目录里找（Windows 微软雅黑/黑体、macOS PingFang、Linux Noto CJK），
找不到时抛出明确错误，让用户改用浏览器打印，而不是产出一份乱码 PDF。

**版式口径与预览对齐**（这是本条最重要的约束）：PDF 与 HTML 预览是两套独立的排版
引擎，只要两边的行距/页边距/区块间距各写各的，就会出现"预览一个样、下载的 PDF 另一个
样"。所以这里**不再内置一套硬编码系数**，而是：

  * 行距、页边距、区块间距、**各层级字号比例**、以及**强调色**都从
    `resume_templates.template_layout_defaults` 读——那是模板参数**唯一的结构化来源**
    （`test_resume_layout.py` 会拿模板 CSS 逐条核对），抄一份到 PDF 里就会在模板改动后
    悄悄漂移。PDF 曾经自带一份只对 classic 成立的字号副本，于是 technical 等模板的
    姓名 / 区块标题比预览大 7%~10%；也曾经自带一份 `_TEMPLATE_COLORS` 强调色表，与
    模板的 `--accent` 是同一件事的两份定义；
  * 用户在「格式模板」里设过的 `line_height` / `page_padding` / `section_gap` / `accent`
    覆盖它们；
  * 一页适配复用预览那套 `--fit-scale` 的口径：**只缩字号派生的尺寸，mm 页边距不动**，
    有下限（`MIN_FIT_SCALE`）、迭代式、装不下就如实标记 overflow。是否"装得下"以
    **真实渲染出来的页数**为准（见 `decide_fit_scale`），而不是连续内容高度——后者
    会低估分页后的实际高度（`ensure_space` 为不切断条目会提前换页、留下一段空隙）。

**测量与决策分开**：`measure_content_height` / `rendered_page_count` 只回答"某个缩放下
内容多高 / 排几页"，`decide_fit_scale` 只回答"该缩到多少 / 是否溢出"。后续要做
"并排展示多页而不是截断"时，只需替换决策这一步，测量与绘制都不必动。

本包由 fonts / theme / layout / skill_tags / canvas / media / name_gender / render / fit
组成，此 ``__init__`` 作为原 ``pdf_exporter`` 模块路径的兼容门面：``__all__`` 与私有
符号再导出保持原命名空间全集，外部导入路径零改动。
"""
from __future__ import annotations

from .canvas import _ResumePDF
from .fit import build_resume_pdf, decide_fit_scale, measure_content_height, rendered_page_count
from .fonts import (
    FONT_ENV_VAR,
    FONT_FAMILY,
    ResumePDFError,
    _FONT_CANDIDATES,
    _resolve_font_paths,
    font_available,
)
from .layout import (
    MIN_FIT_SCALE,
    PAGE_HEIGHT_MM,
    PAGE_WIDTH_MM,
    ResumeLayout,
    _BODY_TEXT,
    _FIT_MAX_PASSES,
    _FIT_MIN_STEP,
    _FIT_PAGE_STEP,
    _FIT_RATIO_MARGIN,
    _FIT_TOLERANCE_MM,
    _MUTED_TEXT,
    _PX_TO_MM,
    _PX_TO_PT,
    resolve_layout,
)
from .media import _join, _photo_bytes, crop_image_to_cover
from .name_gender import NameGenderPlan, draw_name_gender, plan_name_gender
from .render import ResumePDF
from .skill_tags import SkillTagMetrics, skill_tag_metrics, soft_accent, wrap_skill_tags
from .theme import resolve_accent, resolve_line

__all__ = [
    "MIN_FIT_SCALE",
    "NameGenderPlan",
    "ResumeLayout",
    "ResumePDF",
    "ResumePDFError",
    "build_resume_pdf",
    "crop_image_to_cover",
    "decide_fit_scale",
    "draw_name_gender",
    "font_available",
    "measure_content_height",
    "plan_name_gender",
    "rendered_page_count",
    "resolve_accent",
    "resolve_layout",
    "resolve_line",
    "skill_tag_metrics",
    "soft_accent",
    "wrap_skill_tags",
]
