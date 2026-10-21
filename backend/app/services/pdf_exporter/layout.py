# SPDX-License-Identifier: Apache-2.0
"""版式常量与 ``ResumeLayout``（PDF 唯一的版式来源）。"""

from __future__ import annotations

from dataclasses import dataclass

# 1 px = 0.75 pt = 0.2646 mm。行推进量统一按 `字号(px) × _PX_TO_MM × 行高系数` 计算。
_PX_TO_PT = 0.75
_PX_TO_MM = 0.264_583

# 正文与辅助文字的 PDF 颜色（与模板 `:root` 的 `--text` / `--muted` 同值；多数模板一致）。
_BODY_TEXT = (31, 41, 55)
_MUTED_TEXT = (107, 114, 128)

# A4 短边宽（mm）。页面所有横向定位都以它为基准，避免在代码里到处写 210。
PAGE_WIDTH_MM = 210.0
PAGE_HEIGHT_MM = 297.0

# ===== 字号层级系数 =====
# 姓名 / 求职意向 / 联系方式 / 区块标题 / 条目标题 / 条目头副行(`.entry-head .meta`) /
# 条目下副行(`.entry .sub`) / 技能标签 的字号比例 **不再定义在本模块**：它们已纳入
# `resume_templates.TEMPLATE_LAYOUT_DEFAULTS`（模板参数唯一的结构化来源），由 `ResumeLayout`
# 带进来。此前这里存的是一份**只对 classic 成立**的副本，导致 technical 等模板的层级比例
# 与预览差 7%~10%（见 `resolve_layout`）。条目头副行与条目下副行**分成两个键**：多数模板
# 比例相同，technical 却是 0.86 / 0.9，合并一个会让其中之一悄悄偏掉。


@dataclass(frozen=True)
class ResumeLayout:
    """一份简历当前生效的版式（PDF 唯一的版式来源）。

    数值来自"模板默认值 + 用户已设的覆盖"，两者合成之后 PDF 与预览读的是同一组数：
    页边距（mm）、行高系数、区块间距系数，各层级（姓名 / 求职意向 / 联系方式 /
    区块标题 / 条目标题 / 条目头副行 / 条目下副行 / 技能标签）的字号比例，以及**垂直间距**
    （页头 / 条目 / 副行 / 列表项 / 区块标题与正文之间）与**区块标题的形状**、**照片尺寸**。

    **这里没有"缩放"这个概念**（2026-10-21 用户要求）：`base_px` 就是用户在版式栏里
    设定的字号，所有尺寸由它直接派生。装不下时不再压小字号，而是截断到页数上限并标记
    `overflow`，由界面提示用户加页 / 收紧版式——参数与纸面必须严格一致。
    """

    base_px: float
    margin_mm: float
    line_height: float
    section_gap: float
    name_ratio: float
    # 姓名旁附加信息（性别）的字号比例——预览里是 `.name-extra`（常规字重、muted 灰），
    # 每模板不同（classic/modern 1.0，compact/minimal/elegant 0.93，technical 0.95），
    # 与其它层级一样只从 `TEMPLATE_LAYOUT_DEFAULTS` 读。
    name_extra_ratio: float
    intent_ratio: float
    contact_ratio: float
    section_title_ratio: float
    entry_title_ratio: float
    entry_meta_ratio: float
    entry_sub_ratio: float
    tag_font_ratio: float
    # ===== 垂直间距（× 基准字号的倍数，见 `resume_templates.TEMPLATE_LAYOUT_DEFAULTS`）=====
    header_gap: float
    # 页头内部的两段上边距：`.header .intent` / `.header .contact` 的 margin-top。它们此前
    # 只存在于模板 CSS，PDF 画完姓名就紧接着画意向与联系方式，页头因此比预览矮 ~3mm。
    intent_gap: float
    contact_gap: float
    entry_gap: float
    sub_gap_top: float
    sub_gap_bottom: float
    li_gap: float
    # ===== 页头装饰（底边线 / modern 的浅底色块，见模板 `.header` 的 CSS）=====
    header_border_width: float
    header_border_color: str
    header_pad_bottom: float
    header_bg: str
    header_pad_x: float
    header_pad_y: float
    header_radius: float
    # ===== 区块标题的形状（来自模板 `.section-title` 的 CSS）=====
    section_title_style: str
    section_title_text: str
    section_title_align: str
    section_title_gap: float
    section_title_pad_x: float
    section_title_pad_y: float
    # ===== 照片尺寸（× 基准字号，来自模板 `.profile-photo` 的 width/height）=====
    photo_width_ratio: float
    photo_height_ratio: float
    # ===== 技能标签的形状（来自模板 `.skill-list li` 的 CSS，见注册表同名键）=====
    # 8 个内置模板的标签有 5 种形态（填充 / 描边胶囊 / 左侧色条 / 无框+「·」分隔 / 纯文字），
    # 圆角与内边距也各不相同。此前 PDF 侧写死 0.71 / 0.57 / 0.4 三个比例、统一画成"带底色的
    # 圆角框"，于是 7 个模板的标签在导出的 PDF 里长得和预览都不一样。
    tag_style: str
    tag_bg: str
    tag_fg: str
    tag_border_px: float
    # 圆角：数字 = "× 标签字号"；`"pill"` = 胶囊（CSS `border-radius: 999px`）。
    tag_radius: float | str
    tag_pad_x: float
    tag_gap_x: float
    tag_gap_y: float
    # ===== 技能标签的两个排版开关（来自模板 `.skill-list` / `.skill-list li` 的 CSS）=====
    # `tag_align`：`left` / `center`——elegant 的 `.skill-list { text-align: center }` 让**整段**
    # 标签水平居中（单个标签的形状由 `tag_style` 管，两者正交）。
    tag_align: str
    # `tag_mono`：technical 的 `.skill-list li` 用等宽字族。PDF 只有一套注册字体，
    # 纯 ASCII 标签改用 fpdf2 内置的 courier，含中文时退回正文（见 `skill_tags` docstring）。
    tag_mono: bool
    # ===== 正文分栏（来自模板 `.resume-sections` 的 CSS）=====
    # 草稿侧 `split` 是两栏网格（`exporter.py` 把 `column_count` 置 2），其余模板单栏。
    # `column_gap` 是栏间距（× 基准字号，= CSS `column-gap: calc(var(--fs) * 1.2)`）。
    # 分栏一开，同一份内容的总高度就变了（并排两段比顺序两段矮），所以 PDF 必须知道它。
    column_count: int
    column_gap: float
    # ===== 列表缩进（来自模板 `ul { padding-left: calc(var(--fs) * N) }`）=====
    # `li_indent` 是 N（× 基准字号）：列表正文的起始位置与可用宽度都由它派生
    # （`canvas.bullets`）。此前 PDF 写死 3.0mm，与模板差 1.6~2.3mm，窄栏里足以改变折行行数。
    li_indent: float

    def gap_mm(self, ratio: float) -> float:
        """把"× 基准字号"的间距系数换成毫米（与预览的 `calc(var(--fs) * N)` 同口径）。"""
        return self.base_px * _PX_TO_MM * ratio

    @property
    def margin_x(self) -> float:
        return self.margin_mm

    @property
    def margin_top(self) -> float:
        # 预览的 `body { padding: Pmm }` 是四边等距，所以这里上下也跟着页边距走，
        # 不再用一组自造的 12/13mm。
        return self.margin_mm

    @property
    def margin_bottom(self) -> float:
        return self.margin_mm

    @property
    def usable_height_per_page(self) -> float:
        """一页里正文可用高度（mm）= 页高 − 上下页边距。"""
        return PAGE_HEIGHT_MM - 2 * self.margin_mm

    @property
    def usable_width_mm(self) -> float:
        """正文可用宽度（mm）= 页宽 − 左右页边距。

        双栏模板要把这个宽度再切成两栏（见 `columns.column_frames`），单栏模板里它就等于
        整页正文宽度。放在这里而不是各模块自己算，是为了"页宽 − 页边距"只有一处定义。
        """
        return PAGE_WIDTH_MM - 2 * self.margin_mm


def _resolve_margin_mm(overrides: dict, defaults: dict, margin_mm: float | None) -> float:
    """页边距的**唯一**解析口径：``page_padding`` 权威，``margin_mm`` 只是它的回落值。

    优先级（R1，PDF / Word 共用这一份）：

    1. ``format_config.page_padding``（预览、HTML、PDF、Word 读的都是它）；
    2. 没有它时，``margin_mm`` 收进 ``page_padding`` 的合法区间后作为回落值——
       旧客户端的"只给 margin_mm"行为保持不变；
    3. 两者都没有，用模板自带的 ``padding_mm``。

    为什么 ``margin_mm`` 不能覆盖 ``page_padding``：它是面板历史上的第二个旋钮，只有
    PDF/Word 读，预览不读。两者并存时会出现"面板 30mm、预览 8mm"——同一个页边距有两个
    数字，正是 R1 要消灭的分叉。
    """
    from ..resume.resume_templates import page_padding_bounds

    page_padding = overrides.get("page_padding")
    if page_padding is not None:
        return float(page_padding)
    if margin_mm is not None:
        # 兼容值按 page_padding 的区间 clamp：旧请求可能带 4mm / 40mm（它自己那份历史
        # 范围），越界不该让正文排出纸张，也不该为此回 4xx/5xx——静默收到合法区间即可。
        low, high = page_padding_bounds()
        return min(high, max(low, float(margin_mm)))
    return float(defaults["padding_mm"])


def resolve_layout(
    *,
    template: str,
    base_px: float,
    format_config: dict | None,
    margin_mm: float | None = None,
) -> ResumeLayout:
    """合成"模板默认值 + 用户覆盖"，得到 PDF 的版式。

    **为什么不在这里再写一份默认系数**：模板真实的行高/页边距/区块间距**与各层级字号比例**
    定义在 `app/templates/resume*.html.j2` 的 CSS 里，`resume_templates.TEMPLATE_LAYOUT_DEFAULTS`
    是它们的结构化映射（`test_resume_layout.py` 拿 CSS 逐条核对）。从注册表读，模板一改
    PDF 自动跟上；抄一份到本模块，就是"今天对了、明天模板一改又漂移"——这正是"直出 PDF
    与预览不一致"这个 bug 的来源。

    ``margin_mm`` 是**兼容字段**，不是第二个旋钮（R1）：页边距的唯一权威是
    ``format_config.page_padding``（预览、HTML、PDF、Word 都读它）。只有请求**没有**给出
    ``page_padding`` 时，``margin_mm`` 才作为它的回落值；两者同时出现时以
    ``page_padding`` 为准——否则旧客户端/手工请求能重新制造"预览 8mm、PDF 30mm"。
    """
    from ..resume.resume_templates import (
        template_layout_defaults,
        validated_format_config,
    )

    defaults = template_layout_defaults(template)
    overrides = validated_format_config(format_config)

    def pick(key: str, default_key: str) -> float:
        value = overrides.get(key)
        # 只有用户**确实设过**才覆盖默认；没设过时保持模板自带的值，
        # 否则存量简历的 PDF 会因为"凭空多了一个默认值"而无端跳变。
        return float(value) if value is not None else float(defaults[default_key])

    resolved_margin = _resolve_margin_mm(overrides, defaults, margin_mm)

    return ResumeLayout(
        base_px=base_px,
        margin_mm=resolved_margin,
        line_height=pick("line_height", "line_height"),
        section_gap=pick("section_gap", "section_gap"),
        # 字号层级比例只来自模板（格式模板没有对应的用户覆盖项）。
        name_ratio=float(defaults["name_ratio"]),
        name_extra_ratio=float(defaults["name_extra_ratio"]),
        intent_ratio=float(defaults["intent_ratio"]),
        contact_ratio=float(defaults["contact_ratio"]),
        section_title_ratio=float(defaults["section_title_ratio"]),
        entry_title_ratio=float(defaults["entry_title_ratio"]),
        # `.entry-head .meta`（条目头右侧）与 `.entry .sub`（条目下副行）是**两个**选择器，
        # 比例多数模板相同、technical 却是 0.86 / 0.9，所以各取各的，不合并。
        entry_meta_ratio=float(defaults["entry_meta_ratio"]),
        entry_sub_ratio=float(defaults["entry_sub_ratio"]),
        tag_font_ratio=float(defaults["tag_font_ratio"]),
        # 垂直间距、区块标题形状与照片尺寸同样只来自模板——这些此前只存在于模板 CSS，
        # PDF 侧没有，于是排得比预览紧（"被压扁"的主要来源）。
        header_gap=float(defaults["header_gap"]),
        intent_gap=float(defaults["intent_gap"]),
        contact_gap=float(defaults["contact_gap"]),
        entry_gap=float(defaults["entry_gap"]),
        sub_gap_top=float(defaults["sub_gap_top"]),
        sub_gap_bottom=float(defaults["sub_gap_bottom"]),
        li_gap=float(defaults["li_gap"]),
        header_border_width=float(defaults["header_border_width"]),
        header_border_color=str(defaults["header_border_color"]),
        header_pad_bottom=float(defaults["header_pad_bottom"]),
        header_bg=str(defaults["header_bg"]),
        header_pad_x=float(defaults["header_pad_x"]),
        header_pad_y=float(defaults["header_pad_y"]),
        header_radius=float(defaults["header_radius"]),
        section_title_style=str(defaults["section_title_style"]),
        section_title_text=str(defaults["section_title_text"]),
        section_title_align=str(defaults["section_title_align"]),
        section_title_gap=float(defaults["section_title_gap"]),
        section_title_pad_x=float(defaults["section_title_pad_x"]),
        section_title_pad_y=float(defaults["section_title_pad_y"]),
        photo_width_ratio=float(defaults["photo_width_ratio"]),
        photo_height_ratio=float(defaults["photo_height_ratio"]),
        # 技能标签的形态与几何同样只来自模板：`tag_radius` 保留注册表原值（可能是 `"pill"`），
        # 不在这一层把哨兵解释成数字——"怎么画"是 `skill_tags` 的事。
        tag_style=str(defaults["tag_style"]),
        tag_bg=str(defaults["tag_bg"]),
        tag_fg=str(defaults["tag_fg"]),
        tag_border_px=float(defaults["tag_border_px"]),
        tag_radius=defaults["tag_radius"],
        tag_pad_x=float(defaults["tag_pad_x"]),
        tag_gap_x=float(defaults["tag_gap_x"]),
        tag_gap_y=float(defaults["tag_gap_y"]),
        # 标签的"整段排版"两个开关（居中 / 等宽）与正文分栏同样只来自模板：
        # 它们决定"画在哪"与"用什么字体画"，都属于模板 CSS 的语义，不在这里另设默认。
        tag_align=str(defaults["tag_align"]),
        tag_mono=bool(defaults["tag_mono"]),
        # 正文分栏：栏数决定 `_draw_resume` 走 `columns.render_sections` 还是顺序路径；
        # 栏间距参与半栏宽度的计算（见 `columns.column_frames`）。
        column_count=int(defaults["column_count"]),
        column_gap=float(defaults["column_gap"]),
        # 列表缩进同样只来自模板 `ul { padding-left }`：写死 3.0mm 会让每条 li 的行宽
        # 比草稿宽 1.6~2.3mm，窄栏里少折一行 —— 就是 split 比草稿矮、单栏偏紧的主要来源。
        li_indent=float(defaults["li_indent"]),
    )
