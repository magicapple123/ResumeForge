"""版式常量与 ``ResumeLayout``（PDF 唯一的版式来源）。"""
from __future__ import annotations

from dataclasses import dataclass, replace

# 1 px = 0.75 pt = 0.2646 mm。行推进量统一按 `字号(px) × _PX_TO_MM × 行高系数` 计算。
_PX_TO_PT = 0.75
_PX_TO_MM = 0.264_583

# 正文与辅助文字的 PDF 颜色（与模板 `:root` 的 `--text` / `--muted` 同值；多数模板一致）。
_BODY_TEXT = (31, 41, 55)
_MUTED_TEXT = (107, 114, 128)

# A4 短边宽（mm）。页面所有横向定位都以它为基准，避免在代码里到处写 210。
PAGE_WIDTH_MM = 210.0
PAGE_HEIGHT_MM = 297.0

# ===== 一页适配（与 `_resume_fit_script.j2` 同口径）=====
# 预览的 `--fit-scale` 有没有可缩的余地、缩到多小为止，尽量沿用那套规则，避免又造出
# 第二套分页/溢出判定。两边是两套引擎（这里是 Python、脚本里是 JS），**无法共享同一份常量**，
# 只能靠 `test_pdf_exporter.py` 的 `test_fit_scale_constants_match_the_preview_script`
# 把两边的字面量拿出来逐个数值比对来钉住同步。**改动下面任何一个数值，都必须同步改
# `backend/app/templates/_resume_fit_script.j2` 里对应的 JS 字面量**，否则那条测试会红。
MIN_FIT_SCALE = 0.5  # = 脚本 `minScale`；再小就"缩到看不清"了
_FIT_MAX_PASSES = 3  # = 脚本 `maxPasses`
_FIT_RATIO_MARGIN = 0.995  # = 脚本里 `Math.min(...) * 0.995`；给"绝对尺寸不参与缩放"留的余量
_FIT_MIN_STEP = 0.001  # = 脚本里 `scale - 0.001`；一档缩不下去就停
# 高度比较的容差（mm）：= 脚本里 `referenceHeight + 1` 的 1px（1px = _PX_TO_MM mm）。
# 它只用来判断"比例跳档有没有意义"，真正的"装不装得下"由真实页数决定。
_FIT_TOLERANCE_MM = _PX_TO_MM
# 连续高判断"刚好装得下"、真实分页却超出一页时的**离散收档**步长。这是本模块相对预览脚本
# 多出来的一档：预览只用 `scrollHeight / referenceHeight` 的比例跳档，当这个比例 ≥ 1
# （连续高已"达标"）时它跳不动，于是会在**连续高 ≠ 实际分页高**的边界上不动（见
# `decide_fit_scale` 的说明）。每轮至少收这么多，才能把这类内容真正压回一页。
_FIT_PAGE_STEP = 0.02

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
    ``fit_scale`` 是一页适配算出的缩放，**只**乘在字号派生的尺寸上（`scaled_base_px`），
    mm 页边距不参与——与预览把 `--fit-scale` 吸进 `--fs` 的做法完全一致。
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
    fit_scale: float = 1.0

    @property
    def scaled_base_px(self) -> float:
        """一页适配之后的基准字号（px）。所有尺寸都由它派生。"""
        return self.base_px * self.fit_scale

    def gap_mm(self, ratio: float) -> float:
        """把"× 基准字号"的间距系数换成毫米（随一页适配缩放，与预览同口径）。"""
        return self.scaled_base_px * _PX_TO_MM * ratio

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

    def with_fit_scale(self, scale: float) -> ResumeLayout:
        return replace(self, fit_scale=scale)


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

    ``margin_mm`` 是导出时的**页边距直接覆盖**（R-16 全参数导出）：给定时优先于
    ``format_config.page_padding`` 与模板默认值，让 PDF / Word 共用同一边距口径。
    """
    from ..resume.resume_templates import template_layout_defaults, validated_format_config

    defaults = template_layout_defaults(template)
    overrides = validated_format_config(format_config)

    def pick(key: str, default_key: str) -> float:
        value = overrides.get(key)
        # 只有用户**确实设过**才覆盖默认；没设过时保持模板自带的值，
        # 否则存量简历的 PDF 会因为"凭空多了一个默认值"而无端跳变。
        return float(value) if value is not None else float(defaults[default_key])

    resolved_margin = float(margin_mm) if margin_mm is not None else pick("page_padding", "padding_mm")

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
    )
