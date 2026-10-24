# SPDX-License-Identifier: Apache-2.0
"""模板的**技能标签形状**与**正文分栏**默认值（``TEMPLATE_LAYOUT_DEFAULTS`` 的两张附表）。

`resume_template_layout.TEMPLATE_LAYOUT_DEFAULTS` 仍是模板参数的**唯一对外入口**
（它是"母表 + 本模块两张附表"的合并视图）；本模块只是把键表挪出来，让两个文件各自待在
500 行预算内（见 ``tests/test_file_size_budget.py``）。搬运是纯搬迁：键名、取值、注释
一字未改，守卫测试仍从入口读，所以对外契约零变化。

===== 一、技能标签的形状（来自模板 ``.skill-list li`` 的 CSS）=====
8 个内置模板的标签有 **5 种形态**，而 PDF 曾统一画成"带底色的圆角框 + 强调色文字"一种
（写死 0.71 / 0.57 / 0.4 三个比例、底色用 ``soft_accent(accent)`` 现算），于是 classic 的
硬编码浅灰、modern 的描边胶囊、technical 的左侧色条、compact 的「·」分隔、minimal 的纯文字
导出后全一个样。键与 CSS 的对应：

  tag_style    ：fill 填充 / outline 描边 / left_bar 左侧色条 / dot 无框+`li::after` 的「·」/ plain 纯文字
  tag_bg       ：底色十六进制（`var(--accent-soft)` 已按 `:root` 展开）；`"none"` = 不填色
  tag_fg       ：字色 accent / body / muted（`var(--accent)` / `var(--text)` / 无 color 即继承正文）
  tag_border_px：边框宽度，**固定 px**（CSS `border` / `border-left` 的字面值），0 = 无边框
  tag_radius   ：圆角（× 标签字号）；胶囊 `border-radius: 999px` 用哨兵 `"pill"` → 画成 `height/2`。
                 classic 是**固定** `4px`，按标准字号档（14px、标签字号 0.93×14）折成
                 `4/(0.93×14) ≈ 0.307`；small/large 档有 ±0.5px 视觉误差，可接受
  tag_pad_x    ：左右内边距（× 标签字号）
  tag_gap_x/y  ：横向 / 纵向间距（× 标签字号），CSS `margin` 简写的右 / 下值
  accent_soft  ：模板 `:root` 的 `--accent-soft`。页头浅底色块（modern / split）与部分标签
                 底色都用它；`soft_accent()` 只是没有这个键时的兜底（split 的 accent
                 `#6b4f2a` 现算约 `#edeae5`，模板写死 `#f3eee6`——页头色差就是这么来的）。
                 classic / compact / editorial 三个模板 CSS 里没有这个变量，写 `"none"`。

===== 技能标签的两个"排版"开关（本轮新增）=====
`tag_style` 描述的是**单个**标签的样子，而整段标签怎么排还有两件事与模板有关：

  tag_align ：`left` / `center`。来自 ``.skill-list { text-align: center }``——只有 elegant
              写了它，其余 7 个模板是默认的 `left`。PDF 侧在 `skill_tags.draw_skill_tags`
              里按行整体水平居中（行宽 = 该行标签总宽 + 标签间距之和），否则 elegant 的
              标签在 PDF 里左对齐、在预览里居中，是最容易一眼看出的偏差。
  tag_mono  ：bool。来自 ``.skill-list li { font-family: Consolas, "Cascadia Mono", Menlo,
              monospace }``——只有 technical 写了它。PDF 只有一套注册的中文字体
              （`FONT_FAMILY`），**不为它引入新的字体包**：标签文本全为 ASCII 时改用
              fpdf2 内置的 `courier`（真等宽），含中文时退回 `FONT_FAMILY`（fpdf2 没有
              逐字形回退能力，而等宽对中文本来就无意义）。细节见 `skill_tags` 的 docstring。
  tag_columns：int。来自 ``.skill-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) }``
              ——只有 scholar 写它（3）；其余模板是普通流式标签列表（1）。HTML 里是三列网格，
              PDF 侧在 `skill_tags.draw_skill_tags` 的网格分支里按同样列数铺格子：单元格宽
              =（可用宽 −（列数−1）× 横向间距）÷ 列数，单元格内画「• 标签」，超宽时格内折行。

===== 二、正文分栏（来自模板 ``.resume-sections`` 的 CSS）=====
split 模板的正文是**两栏网格**，其余 7 个模板是单栏。草稿侧由
`exporter.py` 在模板名为 `split` 时把 ``column_count`` 置 2，`_resume_sections.j2` 据此
把七个分区包进 ``<div class="resume-sections" data-columns="2">``：

  column_count：栏数（split = 2，其余 = 1）
  column_gap  ：栏间距（× 基准字号），对应 CSS 的 ``column-gap: calc(var(--fs) * 1.2)``；
                单栏模板为 0（没有栏间距这回事）。

**为什么这两个键必须在注册表里**：PDF 侧的 `columns.render_sections` 用它决定"要不要分栏"
与"两栏各多宽"，而分栏一开，同一份内容的高度就变了（并排两段比顺序两段矮一半）。写在
`pdf_exporter` 里就是又一份"与模板 CSS 各自表述"的常量——正是这一系列 bug 的来源。守卫见
``tests/test_resume_layout_templates.py::test_template_columns_and_tag_flags_match_the_template_files``。

===== 三、列表缩进（来自模板 ``ul`` 的 CSS）=====
草稿里列表项的缩进是 ``ul { padding-left: calc(var(--fs) * N) }``，**8 个模板各不相同**
（classic / modern / editorial 1.43、compact 1.3、elegant / minimal 1.35、technical 1.29、
split 1.25），而 PDF 侧此前写死 3.0mm。差 1.6~2.3mm 的行宽在窄栏里会直接改变折行行数：
split 两栏每栏只有 81.7mm，一条 li 少折一行就是 5.9mm 的整份高度差——实测 split 比草稿
矮 9.2mm、单栏 A_default 矮 3.0mm，主要就是这一项。

  li_indent：`ul { padding-left: calc(var(--fs) * N) }` 的 N（× 基准字号）。PDF 用它算
             列表正文的起始位置与可用宽度（`canvas.bullets`），符号「·」落在它左侧的
             留白里（等价 CSS 的 `list-style-position: outside`）。
"""

from __future__ import annotations

# 技能标签：形状 + 几何 + 两个排版开关。键的来处见模块 docstring 第一节。
TEMPLATE_TAG_DEFAULTS: dict[str, dict[str, float | str | bool | int]] = {
    "classic": {
        "tag_style": "fill",
        "tag_bg": "#eef2f7",
        "tag_fg": "body",
        "tag_border_px": 0.0,
        "tag_radius": 0.307,
        "tag_pad_x": 0.71,
        "tag_gap_x": 0.57,
        "tag_gap_y": 0.57,
        "accent_soft": "none",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "modern": {
        "tag_style": "outline",
        "tag_bg": "none",
        "tag_fg": "accent",
        "tag_border_px": 1.0,
        "tag_radius": "pill",
        "tag_pad_x": 0.8,
        "tag_gap_x": 0.57,
        "tag_gap_y": 0.57,
        "accent_soft": "#e6f4f1",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "compact": {
        "tag_style": "dot",
        "tag_bg": "none",
        "tag_fg": "body",
        "tag_border_px": 0.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.0,
        "tag_gap_x": 0.7,
        "tag_gap_y": 0.3,
        "accent_soft": "none",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "elegant": {
        "tag_style": "fill",
        "tag_bg": "#f3f1ec",
        "tag_fg": "accent",
        "tag_border_px": 0.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.71,
        "tag_gap_x": 0.36,
        "tag_gap_y": 0.43,
        "accent_soft": "#f3f1ec",
        # `.skill-list { text-align: center }`——8 个模板里唯一的居中。
        "tag_align": "center",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "technical": {
        "tag_style": "left_bar",
        "tag_bg": "#eaf2fa",
        "tag_fg": "accent",
        "tag_border_px": 2.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.5,
        "tag_gap_x": 0.43,
        "tag_gap_y": 0.36,
        "accent_soft": "#eaf2fa",
        "tag_align": "left",
        # `.skill-list li { font-family: Consolas, "Cascadia Mono", Menlo, monospace }`。
        "tag_mono": True,
        "tag_columns": 1,
    },
    "minimal": {
        "tag_style": "plain",
        "tag_bg": "none",
        "tag_fg": "body",
        "tag_border_px": 0.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.0,
        "tag_gap_x": 1.0,
        "tag_gap_y": 0.36,
        "accent_soft": "#f4f4f4",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "scholar": {
        # 纯文字标签：三列并排的项目符号列表（`li::before` 画「•」），没有底色也没有边框。
        # 三列由 `tag_columns` 表达：PDF 侧按同样列数铺格子（`skill_tags` 的网格分支），
        # 不再是"HTML 三列 / PDF 一行行"的已知差异。
        "tag_style": "plain",
        "tag_bg": "none",
        "tag_fg": "body",
        "tag_border_px": 0.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.0,
        "tag_gap_x": 0.5,
        "tag_gap_y": 0.2,
        # 模板 `:root` 的 `--accent-soft`：首段信息区的浅灰底用它，标签不用。
        "accent_soft": "#f1f1f1",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 3,
    },
    "editorial": {
        "tag_style": "plain",
        "tag_bg": "none",
        "tag_fg": "accent",
        "tag_border_px": 0.0,
        "tag_radius": 0.0,
        "tag_pad_x": 0.0,
        "tag_gap_x": 0.57,
        "tag_gap_y": 0.35,
        "accent_soft": "none",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
    "split": {
        "tag_style": "outline",
        "tag_bg": "none",
        "tag_fg": "accent",
        "tag_border_px": 1.0,
        "tag_radius": "pill",
        "tag_pad_x": 0.6,
        "tag_gap_x": 0.4,
        "tag_gap_y": 0.35,
        "accent_soft": "#f3eee6",
        "tag_align": "left",
        "tag_mono": False,
        "tag_columns": 1,
    },
}

# 正文分栏：栏数 + 栏间距（× 基准字号）。键的来处见模块 docstring 第二节。
# 只有 split 是两栏；`column_gap` 在单栏模板上无意义（没有栏间距），写 0 让"有没有分栏"
# 只有一个判据（`column_count`），不必让下游再判断 gap。
TEMPLATE_COLUMN_DEFAULTS: dict[str, dict[str, float | int]] = {
    "classic": {"column_count": 1, "column_gap": 0.0},
    "modern": {"column_count": 1, "column_gap": 0.0},
    "compact": {"column_count": 1, "column_gap": 0.0},
    "elegant": {"column_count": 1, "column_gap": 0.0},
    "technical": {"column_count": 1, "column_gap": 0.0},
    "minimal": {"column_count": 1, "column_gap": 0.0},
    "editorial": {"column_count": 1, "column_gap": 0.0},
    # scholar 的正文仍是单栏：它的"三列"只作用于**技能列表内部**
    # （`.skill-list { display: grid; grid-template-columns: repeat(3, 1fr) }`），
    # 不是把七个分区切成两栏。所以这里填 1 —— `column_count` 的语义是"分区网格的栏数"，
    # 与 `.skill-list` 的列数不是同一件事，混用会让 PDF 也去收窄正文列框。
    "scholar": {"column_count": 1, "column_gap": 0.0},
    "split": {"column_count": 2, "column_gap": 1.2},
}


# 正文列表缩进：`ul { padding-left: calc(var(--fs) * N) }` 的 N，逐模板读、不许估。
# 键的来处见模块 docstring 第三节。
TEMPLATE_LIST_DEFAULTS: dict[str, dict[str, float]] = {
    "classic": {"li_indent": 1.43},
    "modern": {"li_indent": 1.43},
    "compact": {"li_indent": 1.3},
    "elegant": {"li_indent": 1.35},
    "technical": {"li_indent": 1.29},
    "minimal": {"li_indent": 1.35},
    "editorial": {"li_indent": 1.43},
    "scholar": {"li_indent": 1.28},
    "split": {"li_indent": 1.25},
}


__all__ = [
    "TEMPLATE_COLUMN_DEFAULTS",
    "TEMPLATE_LIST_DEFAULTS",
    "TEMPLATE_TAG_DEFAULTS",
]
