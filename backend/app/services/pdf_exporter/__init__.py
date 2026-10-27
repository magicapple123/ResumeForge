# SPDX-License-Identifier: Apache-2.0
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
  * 用户在「版式」里设过的 `line_height` / `page_padding` / `section_gap` / `accent`
    覆盖它们；
  * **不缩字号**（2026-10-21 用户要求）：按用户设定的参数原样排版，装不下就截断到页数
    上限并如实标记 ``overflow``（见 `build_resume_pdf`）。以前那套 `--fit-scale` 会把
    18px 悄悄压成 9px，滑杆与纸面对不上；现在参数就是权威。

**测量与结论分开**：`measure_content_height` / `rendered_page_count` 只回答"内容多高 /
排几页"，``build_resume_pdf`` 只回答"截不截断、溢出没有"。

本包由 fonts / theme / layout / skill_tags / canvas / columns / media / name_gender / render / fit
组成，此 ``__init__`` 作为原 ``pdf_exporter`` 模块路径的兼容门面：``__all__`` 与私有
符号再导出保持原命名空间全集，外部导入路径零改动。

``columns`` 是双栏正文（``split``）的行级排布：切行、半栏量高、行级分页与"单分区高于一页"
时的顺序降级。绘制函数仍只有 `render._draw_resume` 里那一批，两条路径共用。
"""

from __future__ import annotations

from .canvas import _ResumePDF as _ResumePDF
from .columns import column_frames, plan_rows, render_sections
from .fit import build_resume_pdf, measure_content_height, rendered_page_count
from .fonts import (
    _FONT_CANDIDATES as _FONT_CANDIDATES,
)
from .fonts import (
    FONT_ENV_VAR as FONT_ENV_VAR,
)
from .fonts import (
    FONT_FAMILY as FONT_FAMILY,
)
from .fonts import (
    ResumePDFError,
    font_available,
    reset_font_cache,
)
from .fonts import (
    _resolve_font_paths as _resolve_font_paths,
)
from .fonts import (
    resolve_font_paths as resolve_font_paths,
)
from .layout import (
    _BODY_TEXT as _BODY_TEXT,
)
from .layout import (
    _MUTED_TEXT as _MUTED_TEXT,
)
from .layout import (
    _PX_TO_MM as _PX_TO_MM,
)
from .layout import (
    _PX_TO_PT as _PX_TO_PT,
)
from .layout import (
    PAGE_HEIGHT_MM as PAGE_HEIGHT_MM,
)
from .layout import (
    PAGE_WIDTH_MM as PAGE_WIDTH_MM,
)
from .layout import (
    ResumeLayout,
    resolve_layout,
)
from .media import _join as _join
from .media import _photo_bytes as _photo_bytes
from .media import fit_photo_size
from .name_gender import NameGenderPlan, draw_name_gender, plan_name_gender
from .render import ResumePDF
from .skill_tags import SkillTagMetrics as SkillTagMetrics
from .skill_tags import draw_skill_tags, skill_tag_metrics, soft_accent, wrap_skill_tags
from .theme import resolve_accent, resolve_accent_soft, resolve_line, resolve_muted, resolve_text

__all__ = [
    "NameGenderPlan",
    "ResumeLayout",
    "ResumePDF",
    "ResumePDFError",
    "build_resume_pdf",
    "column_frames",
    "fit_photo_size",
    "draw_name_gender",
    "draw_skill_tags",
    "font_available",
    "reset_font_cache",
    "measure_content_height",
    "plan_name_gender",
    "plan_rows",
    "render_sections",
    "rendered_page_count",
    "resolve_accent",
    "resolve_accent_soft",
    "resolve_font_paths",
    "resolve_layout",
    "resolve_line",
    "resolve_muted",
    "resolve_text",
    "skill_tag_metrics",
    "soft_accent",
    "wrap_skill_tags",
]
