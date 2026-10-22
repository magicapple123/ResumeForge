# SPDX-License-Identifier: Apache-2.0
"""Built-in template layout defaults used by HTML, PDF, and Word renderers."""

from .resume_template_catalog import DEFAULT_TEMPLATE
from .resume_template_tags import (
    TEMPLATE_COLUMN_DEFAULTS,
    TEMPLATE_LIST_DEFAULTS,
    TEMPLATE_TAG_DEFAULTS,
)

# 每个模板在 CSS 里的版式默认值。**这些数字必须与模板文件一致**——
# 自动一页要靠它们判断"当前值是多少、还能往紧收多少"，抄错会让它收紧一个
# 用户根本没设置过的值（或反过来该收没收）。`test_resume_templates.py` 会
# 逐个模板读文件核对，所以这里改了模板不更新会直接测试失败。
#   padding_mm         ：body 的页边距
#   line_height        ：body 的 line-height
#   section_gap        ：`.section` 的 margin-bottom 系数（× 字号）
#   name_ratio         ：`.header .name` 的字号倍数（× 字号）
#   name_extra_ratio   ：`.name-extra`（姓名旁的性别等附加信息）的字号倍数
#   intent_ratio       ：`.header .intent`（求职意向）
#   contact_ratio      ：`.header .contact`（联系方式）
#   section_title_ratio：`.section-title`
#   entry_title_ratio  ：`.entry-head .title`
#   entry_meta_ratio   ：`.entry-head .meta`（条目头右侧的机构 / 时间等）
#   entry_sub_ratio    ：`.entry .sub`（条目下的绩点 / 核心课程 / 技术栈等副行）
#   tag_font_ratio     ：`.skill-list li`（技能标签字号）
# 注意 `.entry-head .meta` 与 `.entry .sub` 是**两个**选择器、多数模板比例相同但并非总是
# 相同（technical 是 0.86 / 0.9），所以各自一个键；合成一个会让其中之一悄悄偏掉。
# `*_ratio` 一律是"相对基准字号的倍数"：直出 PDF 与预览的字号层级靠它们对齐，
# 因此 PDF 侧**不再自带第二份系数**（那份只对 classic 成立的副本正是"导出与预览
# 字号不一致"的来源）。同一套 `test_resume_layout.py` 的 CSS 守卫会逐条核对。
#
# 每个模板的**配色默认值**也放在这里（`accent` / `text` / `muted` / `line`，键名对应模板
# `:root` 里的 CSS 变量去掉 `--` 前缀），值一律是**十六进制字符串**——与上面的数值键
# 类型不同，所以这个注册表的值类型是 `float | str`。直出 PDF 的强调色从这里读
# （`pdf_exporter` 曾自带一份 `_TEMPLATE_COLORS`，与 `--accent` 是同一件事的两份定义，
# 模板一改颜色 PDF 就悄悄漂移）。`line` 现在也被 PDF 读（区块标题的下划线用它画），
# `text`/`muted` 仍主要给 HTML 用，但一并收录让"模板颜色"在此一处定义。
#
# 除"字号层级"外，**垂直间距**与**区块标题的形状**也从这里读。它们曾只存在于模板 CSS、
# 而 PDF 侧完全没有，于是 PDF 排得比预览紧——用户看到的"被压扁"主要就是这些间距缺席造成的
# （条目之间 `.entry`、副行 `.sub`、列表项 `li`、页头之后 `.header`）。键与 CSS 的对应：
#   header_gap          ：`.header` 的 margin-bottom（页头与第一段之间的留白）
#   intent_gap          ：`.header .intent` 的 margin-top（姓名与求职意向之间）
#   contact_gap         ：`.header .contact` 的 margin-top（求职意向与联系方式之间）
#   entry_gap           ：`.entry` 的 margin-bottom（同一分区内条目之间的留白）
#   sub_gap_top         ：`.entry .sub` 的 margin-top
#   sub_gap_bottom      ：`.entry .sub` 的 margin-bottom
#   li_gap              ：`li` 的 margin-bottom（列表项之间）
#   section_title_gap   ：`.section-title` 的 margin-bottom（标题与正文之间的留白）
#   section_title_style ：区块标题的形状（left_bar / soft_box / underline / accent_box / plain）
#   section_title_text  ：标题文字颜色（accent / body / muted / white）
#   section_title_align ：标题对齐（left / center）
#   section_title_pad_x/y：标题的内边距（× 字号），左竖条与色块用得到
#   photo_width_ratio / photo_height_ratio：`.profile-photo` 的宽高（× 字号）
#   header_*            ：页头的装饰——底边线（`header_border_width` 固定 px / `header_border_color`）、
#                         文字与底边线之间的 `header_pad_bottom`（× 字号），以及 modern 那种
#                         **浅底色块**（`header_bg` = soft_accent、`header_pad_x/y`、`header_radius`，均 × 字号）。
#                         此前 PDF 只画了 `header_gap`（下边距），classic 页头下那条 2px 蓝线整条缺失。
# 这些数字同样由 `test_resume_layout.py` 拿模板 CSS 逐条核对，抄错会让 PDF 与预览再次分叉。
#
# ===== 技能标签的形状与正文分栏 =====
# 这两组键（`tag_style` / `tag_bg` / `tag_fg` / `tag_border_px` / `tag_radius` / `tag_pad_x` /
# `tag_gap_x-y` / `accent_soft` / `tag_align` / `tag_mono`，以及 `column_count` / `column_gap`）
# 的来处、取值与"为什么要从模板 CSS 抄过来"的完整说明在 `resume_template_tags.py` 的模块
# docstring 里：它们是**形状与排版开关**，与上面这堆"字号 / 间距"比例不同类，且本文件贴着
# 500 行预算（`tests/test_file_size_budget.py`），故拆到同目录的附表模块。
# **`TEMPLATE_LAYOUT_DEFAULTS` 仍是唯一对外入口**——它是母表 `_BASE_DEFAULTS` 与两张附表的
# 合并视图，`resolve_layout` / `skill_tags` / `columns` 与守卫测试都只认它，不看附表。
_BASE_DEFAULTS: dict[str, dict[str, float | str]] = {
    "classic": {
        "padding_mm": 14.0,
        "line_height": 1.7,
        "section_gap": 1.3,
        "name_ratio": 1.86,
        "name_extra_ratio": 1.0,
        "intent_ratio": 1.07,
        "contact_ratio": 0.93,
        "section_title_ratio": 1.14,
        "entry_title_ratio": 1.07,
        "entry_meta_ratio": 0.93,
        "entry_sub_ratio": 0.93,
        "tag_font_ratio": 0.93,
        "header_gap": 1.4,
        "intent_gap": 0.28,
        "contact_gap": 0.57,
        "entry_gap": 0.86,
        "sub_gap_top": 0.14,
        "sub_gap_bottom": 0.28,
        "li_gap": 0.21,
        "header_border_width": 2.0,
        "header_border_color": "accent",
        "header_pad_bottom": 1.1,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "left_bar",
        "section_title_text": "accent",
        "section_title_align": "left",
        "section_title_gap": 0.71,
        "section_title_pad_x": 0.71,
        "section_title_pad_y": 0.0,
        "photo_width_ratio": 6.3,
        "photo_height_ratio": 8.0,
        "accent": "#16365c",
        "text": "#1f2937",
        "muted": "#6b7280",
        "line": "#d9dee7",
    },
    "modern": {
        "padding_mm": 14.0,
        "line_height": 1.72,
        "section_gap": 1.2,
        "name_ratio": 2.0,
        "name_extra_ratio": 1.0,
        "intent_ratio": 1.07,
        "contact_ratio": 0.93,
        "section_title_ratio": 1.14,
        "entry_title_ratio": 1.07,
        "entry_meta_ratio": 0.93,
        "entry_sub_ratio": 0.93,
        "tag_font_ratio": 0.93,
        "header_gap": 1.5,
        "intent_gap": 0.3,
        "contact_gap": 0.5,
        "entry_gap": 0.9,
        "sub_gap_top": 0.14,
        "sub_gap_bottom": 0.28,
        "li_gap": 0.25,
        "header_border_width": 0.0,
        "header_border_color": "none",
        "header_pad_bottom": 0.0,
        "header_bg": "soft_accent",
        "header_pad_x": 1.3,
        "header_pad_y": 1.2,
        "header_radius": 0.6,
        "section_title_style": "soft_box",
        "section_title_text": "accent",
        "section_title_align": "left",
        "section_title_gap": 0.8,
        "section_title_pad_x": 0.8,
        "section_title_pad_y": 0.28,
        "photo_width_ratio": 6.6,
        "photo_height_ratio": 6.6,
        "accent": "#0f766e",
        "text": "#24303f",
        "muted": "#667085",
        "line": "#d7e0e6",
    },
    "compact": {
        "padding_mm": 12.0,
        "line_height": 1.55,
        "section_gap": 0.85,
        "name_ratio": 1.6,
        "name_extra_ratio": 0.93,
        "intent_ratio": 1.0,
        "contact_ratio": 0.9,
        "section_title_ratio": 1.05,
        "entry_title_ratio": 1.0,
        "entry_meta_ratio": 0.9,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.9,
        "header_gap": 0.9,
        "intent_gap": 0.2,
        "contact_gap": 0.3,
        "entry_gap": 0.5,
        "sub_gap_top": 0.1,
        "sub_gap_bottom": 0.2,
        "li_gap": 0.12,
        "header_border_width": 1.0,
        "header_border_color": "accent",
        "header_pad_bottom": 0.7,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "underline",
        "section_title_text": "body",
        "section_title_align": "left",
        "section_title_gap": 0.5,
        "section_title_pad_x": 0.0,
        "section_title_pad_y": 0.14,
        "photo_width_ratio": 5.4,
        "photo_height_ratio": 7.0,
        "accent": "#30363f",
        "text": "#1f2430",
        "muted": "#6b7280",
        "line": "#dcdfe6",
    },
    "elegant": {
        "padding_mm": 16.0,
        "line_height": 1.76,
        "section_gap": 1.35,
        "name_ratio": 1.9,
        "name_extra_ratio": 0.93,
        "intent_ratio": 1.0,
        "contact_ratio": 0.9,
        "section_title_ratio": 1.11,
        "entry_title_ratio": 1.05,
        "entry_meta_ratio": 0.9,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.93,
        "header_gap": 1.5,
        "intent_gap": 0.36,
        "contact_gap": 0.5,
        "entry_gap": 0.9,
        "sub_gap_top": 0.14,
        "sub_gap_bottom": 0.28,
        "li_gap": 0.2,
        "header_border_width": 1.0,
        "header_border_color": "accent",
        "header_pad_bottom": 0.9,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "underline",
        "section_title_text": "accent",
        "section_title_align": "center",
        "section_title_gap": 0.8,
        "section_title_pad_x": 0.0,
        "section_title_pad_y": 0.28,
        "photo_width_ratio": 5.6,
        "photo_height_ratio": 7.2,
        "accent": "#1f3b4d",
        "text": "#22252b",
        "muted": "#7a7f88",
        "line": "#e0ddd6",
    },
    "technical": {
        "padding_mm": 12.0,
        "line_height": 1.6,
        "section_gap": 1.0,
        "name_ratio": 1.8,
        "name_extra_ratio": 0.95,
        "intent_ratio": 1.04,
        "contact_ratio": 0.86,
        "section_title_ratio": 1.04,
        "entry_title_ratio": 1.04,
        "entry_meta_ratio": 0.86,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.86,
        "header_gap": 1.1,
        "intent_gap": 0.24,
        "contact_gap": 0.44,
        "entry_gap": 0.64,
        "sub_gap_top": 0.1,
        "sub_gap_bottom": 0.2,
        "li_gap": 0.14,
        "header_border_width": 3.0,
        "header_border_color": "accent",
        "header_pad_bottom": 0.8,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "accent_box",
        "section_title_text": "white",
        "section_title_align": "left",
        "section_title_gap": 0.57,
        "section_title_pad_x": 0.71,
        "section_title_pad_y": 0.1,
        "photo_width_ratio": 5.8,
        "photo_height_ratio": 7.4,
        "accent": "#0b5fa5",
        "text": "#1c2430",
        "muted": "#5d6b7a",
        "line": "#ccd6e0",
    },
    "minimal": {
        "padding_mm": 18.0,
        "line_height": 1.8,
        "section_gap": 1.45,
        "name_ratio": 1.75,
        "name_extra_ratio": 0.93,
        "intent_ratio": 1.0,
        "contact_ratio": 0.9,
        "section_title_ratio": 1.0,
        "entry_title_ratio": 1.04,
        "entry_meta_ratio": 0.9,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.93,
        "header_gap": 1.7,
        "intent_gap": 0.28,
        "contact_gap": 0.44,
        "entry_gap": 0.93,
        "sub_gap_top": 0.14,
        "sub_gap_bottom": 0.28,
        "li_gap": 0.21,
        "header_border_width": 0.0,
        "header_border_color": "none",
        "header_pad_bottom": 0.0,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "plain",
        "section_title_text": "muted",
        "section_title_align": "left",
        "section_title_gap": 0.71,
        "section_title_pad_x": 0.0,
        "section_title_pad_y": 0.0,
        "photo_width_ratio": 5.4,
        "photo_height_ratio": 7.0,
        "accent": "#17181a",
        "text": "#17181a",
        "muted": "#767a80",
        "line": "#e6e6e6",
    },
    "editorial": {
        "padding_mm": 18.0,
        "line_height": 1.75,
        "section_gap": 1.35,
        "name_ratio": 1.9,
        "name_extra_ratio": 0.93,
        "intent_ratio": 1.0,
        "contact_ratio": 0.9,
        "section_title_ratio": 1.11,
        "entry_title_ratio": 1.05,
        "entry_meta_ratio": 0.9,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.93,
        "header_gap": 1.5,
        "intent_gap": 0.28,
        "contact_gap": 0.57,
        "entry_gap": 0.85,
        "sub_gap_top": 0.14,
        "sub_gap_bottom": 0.28,
        "li_gap": 0.2,
        "header_border_width": 1.0,
        "header_border_color": "accent",
        "header_pad_bottom": 1.0,
        "header_bg": "none",
        "header_pad_x": 0.0,
        "header_pad_y": 0.0,
        "header_radius": 0.0,
        "section_title_style": "underline",
        "section_title_text": "accent",
        "section_title_align": "center",
        "section_title_gap": 0.75,
        "section_title_pad_x": 0.0,
        "section_title_pad_y": 0.25,
        "photo_width_ratio": 6.2,
        "photo_height_ratio": 6.2,
        "accent": "#8b3a3a",
        "text": "#2f2a28",
        "muted": "#81746e",
        "line": "#e5d8d3",
    },
    "split": {
        "padding_mm": 12.0,
        "line_height": 1.6,
        "section_gap": 1.0,
        "name_ratio": 1.8,
        "name_extra_ratio": 0.95,
        "intent_ratio": 1.04,
        "contact_ratio": 0.86,
        "section_title_ratio": 1.04,
        "entry_title_ratio": 1.04,
        "entry_meta_ratio": 0.86,
        "entry_sub_ratio": 0.9,
        "tag_font_ratio": 0.86,
        "header_gap": 1.1,
        "intent_gap": 0.25,
        "contact_gap": 0.45,
        "entry_gap": 0.64,
        "sub_gap_top": 0.1,
        "sub_gap_bottom": 0.2,
        "li_gap": 0.14,
        "header_border_width": 0.0,
        "header_border_color": "none",
        "header_pad_bottom": 0.0,
        "header_bg": "soft_accent",
        "header_pad_x": 1.1,
        "header_pad_y": 1.0,
        "header_radius": 0.5,
        "section_title_style": "accent_box",
        "section_title_text": "white",
        "section_title_align": "left",
        "section_title_gap": 0.57,
        "section_title_pad_x": 0.71,
        "section_title_pad_y": 0.1,
        "photo_width_ratio": 5.8,
        "photo_height_ratio": 7.4,
        "accent": "#6b4f2a",
        "text": "#2c2a26",
        "muted": "#77736b",
        "line": "#e1ddd5",
    },
}


TEMPLATE_LAYOUT_DEFAULTS: dict[str, dict[str, float | str | bool | int]] = {
    # 合并视图：**母表 + 标签附表 + 分栏附表 + 列表缩进附表**。顺序有意义（后者覆盖前者），
    # 但各表键不重叠，所以实际只是把几组键并成一条 `dict`；`TEMPLATE_LAYOUT_DEFAULTS` 借此
    # 保持"每个模板一份完整取值"的对外形态，下游不必知道内部拆成了几个文件。
    name: {
        **values,
        **TEMPLATE_TAG_DEFAULTS[name],
        **TEMPLATE_COLUMN_DEFAULTS[name],
        **TEMPLATE_LIST_DEFAULTS[name],
    }
    for name, values in _BASE_DEFAULTS.items()
}


def template_layout_defaults(name: str) -> dict[str, float | str | bool | int]:
    """某个模板的版式与配色默认值；未知模板退回经典模板的那一组。"""
    return TEMPLATE_LAYOUT_DEFAULTS.get(
        (name or "").strip(), TEMPLATE_LAYOUT_DEFAULTS[DEFAULT_TEMPLATE]
    )


__all__ = ["TEMPLATE_LAYOUT_DEFAULTS", "template_layout_defaults"]
