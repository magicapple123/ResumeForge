# SPDX-License-Identifier: Apache-2.0
"""四向页边距与照片大小的**唯一**参数定义 + 优先级解析。

这个模块只做三件事，却是三条链路（草稿 HTML / 服务端 PDF / Word）共用的同一份口径：

1. **定义键名与区间**（``PAGE_MARGIN_KEYS`` / ``EXTRA_FORMAT_KEYS`` / 上下限常量）。
2. **解析"这一份简历最终四边各是多少"**（``resolve_page_margins``）。
3. **产出 CSS**（``page_padding_rule``）与照片系数（``resolve_photo_scale``）。

## 键名与语义

| 键 | 类型 | 区间 | 缺键时生效值 |
|---|---|---|---|
| ``page_padding`` | float mm | 0 – 26 | 模板 ``padding_mm`` |
| ``page_padding_top/right/bottom/left`` | float mm | 0 – 26 | ``page_padding`` → 模板 ``padding_mm`` |
| ``photo_scale`` | float 系数 | 0.6 – 1.6 | ``1.0``（= 模板原尺寸） |
| ``name_scale`` | float 系数 | 0.8 – 1.3 | ``1.0``（= 模板基准 1.86/1.6/…） |
| ``section_title_scale`` | float 系数 | 0.85 – 1.25 | ``1.0``（= 模板基准 1.14/1.05/…） |
| ``entry_gap`` | float 系数 | 0.6 – 1.8 | ``1.0``（= 模板基准 0.86/0.5/…） |

三个 ``*_scale`` / ``entry_gap`` 与 ``photo_scale`` **完全同构**：不是绝对覆盖值，而是"乘在
模板基准上的系数"，所以只能走 ``:root`` 变量注入（模板侧写 ``* var(--name-scale, 1)``）。
Python 侧抄一份 1.86 / 1.14 / 0.86 必然与 8 套模板漂移——每个模板的基准都不一样。

``page_padding`` **保留为"总"**：它是四边的兜底值来源（``支路 > 总 > 模板默认``）。改总
滑杆 = 写 ``page_padding`` 并删掉四条支路 → 四边一起变。

## 为什么这四个边距键与 ``photo_scale`` **不进** ``FORMAT_FIELDS``

``FORMAT_FIELDS`` 直接喂「自制版式」编辑器（每一项渲染成一个输入控件），并且被
``resume_template_import`` 用来算"导入的版式缺哪些键"。把它们塞进表里，编辑器会凭空
多出 5 条滑杆，每个导入的模板还会报"缺 ``page_padding_top``"。代价是 ``format_css`` 不能
再靠 ``css_rule`` 通用循环产出这两类规则，改为**显式产出**（见 ``page_padding_rule``）——
这正好也是必要条件：四条边必须合成**一条** CSS ``padding`` 简写，两条独立规则会互相覆盖。

## 越界行为（不对称是**故意**的）

* 前端滑杆：**夹紧**（``clampPageMargin`` / ``clampPhotoScale``）——滑杆不该产出非法值。
* 后端白名单（``validated_format_config``）：**丢弃**——与 ``page_padding`` 及
  ``test_format_config_is_whitelisted`` 同一条既有契约："非法输入不进入 CSS/渲染"。

代价：手工请求给 ``page_padding_top=30`` 时该边静默退回"总"值。可接受，且与今天
``page_padding`` 越界退回模板默认是同一类行为。
"""

from __future__ import annotations

# ===== 键名 =====

# 书写顺序是 CSS ``padding`` 简写的顺序（上右下左）：解析结果、CSS 产出、前端控件排列
# 全都用它，避免三处各写一遍顺序。
PAGE_MARGIN_SIDES: tuple[str, ...] = ("top", "right", "bottom", "left")
PAGE_MARGIN_KEYS: dict[str, str] = {side: f"page_padding_{side}" for side in PAGE_MARGIN_SIDES}

# "总"滑杆的历史键名：语义已降级为"四边的默认值来源"，键名保持不变。
PAGE_PADDING_KEY = "page_padding"

PHOTO_SCALE_KEY = "photo_scale"

# CSS 变量名（**连字符**，不是配置键名）：8 个模板的 `.profile-photo` 写的是
# `calc(var(--fs) * 6.3 * var(--photo-scale, 1))`，`format_css` 写的是 `:root` 里那条
# `--photo-scale` 声明——两处必须是同一个字面量，所以常量只在这里定义。
PHOTO_SCALE_CSS_VAR = "--photo-scale"

# ===== 三个"乘在模板基准上"的系数 =====
#
# 为什么同样**不进** ``FORMAT_FIELDS``：那张表直接喂「自制版式」编辑器与
# ``resume_template_import.missing_format_keys()``。加进去会让编辑器凭空多 3 条滑杆，
# 并且**所有存量自定义版式**在导入时报"缺 name_scale"——这是一次纯粹的界面回归。
#
# 书写顺序就是 ``scale_css_vars()`` 的产出顺序（name → section-title → entry），
# 让"变量顺序"只有一个出处，测试可以逐字钉住。
SCALE_KEYS_ORDER: tuple[str, ...] = ("name_scale", "section_title_scale", "entry_gap")

# 区间：下限/上限都取"还能救回一行、但比例不崩"的那一档。
# name 0.8 → 姓名比正文字号只大 49%（1.86×0.8），再小就不像姓名了；
# 1.3 → 1.86×1.3≈2.4 倍，页头仍不超过正文宽的一半。
# section_title 0.85 → 与正文几乎同高（层次仍在，靠字重和颜色区分）；1.25 → 明显强于姓名。
# entry 1.8 → 三条实习之间能空出近两行，再大就是"故意分开"，用户会用 section_gap。
_SCALE_MIN_MAX: dict[str, tuple[float, float]] = {
    "name_scale": (0.8, 1.3),
    "section_title_scale": (0.85, 1.25),
    "entry_gap": (0.6, 1.8),
}

# 步长：姓名/小节标题是字号，0.02 已是肉眼可辨的一档；条目间距是垂直距离，0.05 一档够用。
# 前端 ``resumeScaleParams.SCALE_BOUNDS`` 必须与这两张表逐键相等（有漂移守卫）。
SCALE_STEPS: dict[str, float] = {
    "name_scale": 0.02,
    "section_title_scale": 0.02,
    "entry_gap": 0.05,
}

SCALE_KEYS: frozenset[str] = frozenset(SCALE_KEYS_ORDER)

# CSS 变量名（**连字符**，不是配置键名）：8 个模板写的是
# `calc(var(--fs) * 1.86 * var(--name-scale, 1))`，`format_css` 写的是 `:root` 里那条
# `--name-scale` 声明——两处必须是同一个字面量，所以常量只在这里定义。
SCALE_CSS_VARS: dict[str, str] = {
    "name_scale": "--name-scale",
    "section_title_scale": "--section-title-scale",
    "entry_gap": "--entry-gap",
}

# "没设过"时系数就是 1（模板基准原样）。写成常量而不是各处 ``1.0``，
# 是为了让"缺键 = 不变"这条性质只有一个出处——它正是"默认参数产物逐字节不变"的地基。
DEFAULT_SCALE = 1.0

# 需要白名单放行、但不进 ``FORMAT_FIELDS`` 的全部键：
# 四条分边页边距 + ``photo_scale`` + 三个系数。
EXTRA_FORMAT_KEYS = frozenset({*PAGE_MARGIN_KEYS.values(), PHOTO_SCALE_KEY, *SCALE_KEYS})

# ===== 区间（与 ``FORMAT_FIELDS["page_padding"]`` 完全一致）=====
#
# 四条支路共用 ``page_padding`` 的区间，不引入"和约束"：
# ``max(左)+max(右) = 52mm`` 恰好等于今天的最坏情况（正文宽 158mm），
# ``max(上)+max(下) = 52mm`` → 可用高 245mm，都已验证。上限再放宽就得引入第二条
# 夹紧规则（左右之和、上下之和），收益不抵复杂度。
#
# 下限 8 → 0（2026-10-22 用户要求）：用户要让正文铺满整张纸时，8mm 是一道没有道理的墙。
# 下限放到 0 只会让正文更宽，不会把内容排出纸张——真正需要防的是上限那一侧。
PAGE_MARGIN_MIN = 0.0
PAGE_MARGIN_MAX = 26.0
PAGE_MARGIN_STEP = 0.1

# 照片系数：0.6 时 classic 照片约 14×18mm（还认得出脸）；1.6 时约 37×48mm，页头仍宽裕
# （正文宽最少 158mm）。放到 2.0 会让页头比正文高出 60mm，把一页简历的头部吃掉五分之一。
PHOTO_SCALE_MIN = 0.6
PHOTO_SCALE_MAX = 1.6
PHOTO_SCALE_STEP = 0.02

# "没设过"时照片就是模板原尺寸。写成常量而不是各处 ``1.0``，是为了让"缺键 = 不变"这条
# 性质只有一个出处。
DEFAULT_PHOTO_SCALE = 1.0

# 浮点比较的一次性容差：滑杆步长 0.02，序列化后可能出现 1.1500000000000001 这样的尾巴。
_EPSILON = 1e-9


def _as_float(value: object) -> float | None:
    """把配置值读成浮点数；读不出（None / 空串 / 非数字）返回 ``None``。

    解析层拿到的通常是 ``validated_format_config`` 的输出（已经是 float），但
    ``page_padding_rule`` 也会被"只做过局部校验"的调用方用到，所以这里做一次防御性收口：
    一个畸形值应当表现为"这个键没设过"，而不是抛异常让整份简历渲染不出来。
    """
    if value is None or value == "":
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def extra_bounds(key: str) -> tuple[float, float]:
    """某个"额外格式键"的 ``(min, max)``，供白名单校验与前端常量对齐。

    未知键返回 ``page_padding`` 那一档区间——它不会发生（``EXTRA_FORMAT_KEYS`` 是唯一的
    调用来源），但宁可给一个合法区间也不要抛异常：白名单是"过滤"环节，不该成为崩溃点。
    """
    if key == PHOTO_SCALE_KEY:
        return PHOTO_SCALE_MIN, PHOTO_SCALE_MAX
    scale_bounds = _SCALE_MIN_MAX.get(key)
    if scale_bounds is not None:
        return scale_bounds
    return PAGE_MARGIN_MIN, PAGE_MARGIN_MAX


def clamp_page_margin(value: float) -> float:
    """把页边距收进 ``[0, 26]``（前端夹紧的同一条规则，后端只在兜底路径用）。"""
    return min(PAGE_MARGIN_MAX, max(PAGE_MARGIN_MIN, float(value)))


def clamp_photo_scale(value: float) -> float:
    """把照片系数收进 ``[0.6, 1.6]``。"""
    return min(PHOTO_SCALE_MAX, max(PHOTO_SCALE_MIN, float(value)))


def _master_margin(
    page_padding: float | None,
    template_padding_mm: float,
    legacy_margin_mm: float | None,
) -> float:
    """按 §优先级 ① 取"总"值：``page_padding`` → ``legacy_margin_mm``（clamp）→ 模板默认。

    ``legacy_margin_mm`` 是 ``ExportRequest.margin_mm`` 这个历史旋钮：旧客户端仍可能给出
    4mm / 40mm（它自己那份历史范围）。收进页边距区间，而不是让越界值把正文排出纸张，
    也不该为此回 4xx/5xx——静默收到合法区间即可。
    """
    if page_padding is not None:
        return page_padding
    if legacy_margin_mm is not None:
        return clamp_page_margin(legacy_margin_mm)
    return float(template_padding_mm)


def _resolve_side_values(values: dict) -> dict[str, float] | None:
    """按 §优先级 ②③ 解析出四边；"什么都没设"或"支路不全且无总"返回 ``None``。

    ``None`` 的语义是**"模板 CSS 权威"**：不产出任何 ``padding`` 规则，PDF/Word 用模板
    自带的 ``padding_mm``。这是"默认参数下产物逐字节不变"的开关——判错一格，存量简历的
    页边距就会集体漂移。
    """
    provided: dict[str, float] = {}
    for side in PAGE_MARGIN_SIDES:
        number = _as_float(values.get(PAGE_MARGIN_KEYS[side]))
        if number is not None:
            provided[side] = number
    master = _as_float(values.get(PAGE_PADDING_KEY))

    if not provided:
        # ③ 一条支路都没有：四边跟"总"走；连"总"都没有 → 模板 CSS 权威。
        if master is None:
            return None
        return {side: master for side in PAGE_MARGIN_SIDES}
    if master is not None:
        # ② 支路覆盖"总"，缺的边跟"总"走。
        return {side: provided.get(side, master) for side in PAGE_MARGIN_SIDES}
    if len(provided) == len(PAGE_MARGIN_SIDES):
        # ④ 只有四条支路、没有"总"：四边就是它们（总滑杆读数显示「自定义」）。
        return provided
    # ③ "不完整支路"兜底：只有手工请求会撞上（前端永远写全四条）。整组作废，
    # 等价于"没设过"——这一条保证 HTML（不知道模板默认值）与 PDF（知道）在同一输入下
    # 不出分歧。
    return None


def resolve_page_margins(
    config: dict | None,
    template_padding_mm: float,
    legacy_margin_mm: float | None = None,
) -> tuple[float, float, float, float]:
    """解析"这份简历最终四边各是多少 mm"，返回 ``(上, 右, 下, 左)``。

    Args:
        config: 已过白名单的 ``format_config``（未校验的原始 dict 也能吃，畸形值按"没设过"）。
        template_padding_mm: 模板自带的 ``padding_mm``，四边的最终兜底值。
        legacy_margin_mm: ``ExportRequest.margin_mm`` 这个历史旋钮；只在 ``config`` 没有
            ``page_padding`` 时作回落值（旧客户端兼容）。

    Returns:
        ``(top, right, bottom, left)``，单位 mm。**顺序就是 CSS ``padding`` 简写的顺序**，
        调用方按位置解包即可，不要自己重排。

    优先级（PDF / Word 共用这一份；HTML 的等价实现是 ``page_padding_rule``）：

    1. 四条支路（``page_padding_top/right/bottom/left``）逐边覆盖；
    2. 缺的边跟"总"（``page_padding``，没有则 ``legacy_margin_mm``，再没有则模板默认）；
    3. 支路不足四条且没有"总"时**整组作废**——否则 HTML 与 PDF 会得出不同结论。
    """
    values = config if isinstance(config, dict) else {}
    master = _master_margin(
        _as_float(values.get(PAGE_PADDING_KEY)), template_padding_mm, legacy_margin_mm
    )
    # 逐边解析与 CSS 产出**共用** ``_resolve_side_values``：两处各写一遍判断，迟早会出现
    # "预览是 8/12/12/12、PDF 是 8/8/8/8"这种最难发现的分叉。
    sides = _resolve_side_values(values)
    if sides is None:
        # 这里的出口不是"模板 CSS 权威"而是"四边都等于总"——因为调用方（PDF/Word）必须
        # 拿到一个确定值；"总"此刻就是 ``page_padding`` / 兼容值 / 模板默认。
        return (master, master, master, master)
    return (sides["top"], sides["right"], sides["bottom"], sides["left"])


def resolve_photo_scale(config: dict | None) -> float:
    """解析照片系数：缺键 = ``1.0``（模板原尺寸），越界值收进 ``[0.6, 1.6]``。

    系数的落点只有两个：``format_css`` 的 ``--photo-scale`` 变量（HTML）与
    ``resolve_layout`` 里乘进 ``photo_width_ratio`` / ``photo_height_ratio``（PDF/Word）。
    **宽高同乘 → 宽高比不变 → 8 个模板的取景裁剪结果一像素都不变**，只有画框变大变小。
    """
    values = config if isinstance(config, dict) else {}
    scale = _as_float(values.get(PHOTO_SCALE_KEY))
    if scale is None:
        return DEFAULT_PHOTO_SCALE
    return clamp_photo_scale(scale)


def page_padding_rule(values: dict | None) -> str | None:
    """产出 ``body { padding: ... !important; }`` 那一条规则；不该产出时返回 ``None``。

    **两种形态是故意的**（不是历史包袱）：

    * 四边相等 → ``body { padding: 14mm !important; }`` —— 与今天**逐字一致**，所以
      "默认参数下 HTML 字节不变"成立，既有断言（前端探针、页边距同源）一行都不用改；
    * 四边不等 → ``body { padding: 8mm 14mm 12mm 14mm !important; }``（上右下左）。

    统一成四值形态会让至少 8 条既有断言变红、并让所有存量简历的 HTML 漂移一次。代价只是
    这里多一个 ``len(set(...)) == 1`` 分支，非常划算。
    """
    sides = _resolve_side_values(values if isinstance(values, dict) else {})
    if sides is None:
        return None
    if len(set(sides.values())) == 1:
        return f"body {{ padding: {sides['top']:g}mm !important; }}"
    return (
        "body { padding: "
        f"{sides['top']:g}mm {sides['right']:g}mm {sides['bottom']:g}mm {sides['left']:g}mm"
        " !important; }"
    )


def photo_scale_css_value(config: dict | None) -> str | None:
    """``:root`` 里那条 ``--photo-scale`` 声明的值部分；缺键/等于 1 时返回 ``None``。

    **只在 ``≠ 1`` 时才写**：默认参数下 HTML 必须逐字节不变（连一条空声明都不许多）。
    回退值 ``var(--photo-scale, 1)`` 让"没设过"与今天完全等价，也不依赖声明顺序。
    """
    scale = resolve_photo_scale(config)
    if abs(scale - DEFAULT_PHOTO_SCALE) <= _EPSILON:
        return None
    return f"{scale:g}"


def resolve_scale(config: dict | None, key: str) -> float:
    """解析某个"乘在模板基准上"的系数：缺键 = ``1.0``，越界值收进自己的区间。

    与 :func:`resolve_photo_scale` 是同一个口径（缺键不变、越界夹紧），只是区间按 ``key``
    取。``key`` 不在 ``SCALE_KEYS`` 里时返回 ``1.0`` 而不是抛异常——调用方（``format_css``、
    ``pdf_exporter.resolve_layout``）都是"按表取值"的循环，一个未知键应当表现为"这一项没设过"。

    系数的落点只有三处，**三处必须同口径**：
    1. ``format_css`` 的 ``:root`` 变量（HTML 预览 / 导出 HTML）；
    2. ``pdf_exporter.resolve_layout`` 乘进 ``name_ratio`` / ``section_title_ratio`` / ``entry_gap``；
    3. 前端 ``resumeScaleParams.resolveScale``（滑杆与探针）。
    """
    bounds = _SCALE_MIN_MAX.get(key)
    if bounds is None:
        return DEFAULT_SCALE
    values = config if isinstance(config, dict) else {}
    raw = _as_float(values.get(key))
    if raw is None:
        return DEFAULT_SCALE
    return min(bounds[1], max(bounds[0], raw))


def scale_css_vars(config: dict | None) -> list[tuple[str, str]]:
    """逐键产出 ``(配置键, 值字符串)``，供 ``format_css`` 拼成 ``:root`` 声明。

    两条硬性质：

    1. **≈1 的键一个都不产出**——默认参数下 HTML 必须逐字节不变（``format_css({})`` 仍是
       空串，``format_css({"name_scale": 1})`` 也是空串）。模板侧靠 ``var(--name-scale, 1)``
       兜底，所以"不写"与"写 1"渲染结果完全相同。
    2. **顺序固定** ``name → section-title → entry``（``SCALE_KEYS_ORDER``），不依赖 dict 或
       frozenset 的遍历顺序——``:root`` 里的声明顺序参与字节对比。

    值的形式与 ``photo_scale_css_value`` 一致（``f"{value:g}"``）：整数不带小数点、
    无意义尾零去掉。前端 ``scaleProbeCss`` 逐字复刻这一条。
    """
    values = config if isinstance(config, dict) else {}
    produced: list[tuple[str, str]] = []
    for key in SCALE_KEYS_ORDER:
        if key not in values:
            continue
        scale = resolve_scale(values, key)
        if abs(scale - DEFAULT_SCALE) <= _EPSILON:
            continue
        produced.append((key, f"{scale:g}"))
    return produced


__all__ = [
    "DEFAULT_PHOTO_SCALE",
    "DEFAULT_SCALE",
    "EXTRA_FORMAT_KEYS",
    "PAGE_MARGIN_KEYS",
    "PAGE_MARGIN_MAX",
    "PAGE_MARGIN_MIN",
    "PAGE_MARGIN_SIDES",
    "PAGE_MARGIN_STEP",
    "PAGE_PADDING_KEY",
    "PHOTO_SCALE_CSS_VAR",
    "PHOTO_SCALE_KEY",
    "PHOTO_SCALE_MAX",
    "PHOTO_SCALE_MIN",
    "PHOTO_SCALE_STEP",
    "SCALE_CSS_VARS",
    "SCALE_KEYS",
    "SCALE_KEYS_ORDER",
    "SCALE_STEPS",
    "clamp_page_margin",
    "clamp_photo_scale",
    "extra_bounds",
    "page_padding_rule",
    "photo_scale_css_value",
    "resolve_page_margins",
    "resolve_photo_scale",
    "resolve_scale",
    "scale_css_vars",
]
