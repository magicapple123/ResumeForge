# SPDX-License-Identifier: Apache-2.0
"""版式字段、校验与 CSS 覆盖。"""

from __future__ import annotations

from .resume_config_domains import DOMAIN_KEYS, HEX_COLOR_RE, domain_version, is_supported
from .resume_contact import (
    CONTACT_BREAKS_KEY,
    CONTACT_SEPARATOR_KEY,
    validate_contact_breaks,
    validate_contact_separator,
)
from .resume_layout_overrides import (
    EXTRA_FORMAT_KEYS,
    PAGE_MARGIN_KEYS,
    PAGE_MARGIN_SIDES,
    PAGE_PADDING_KEY,
    PHOTO_SCALE_CSS_VAR,
    PHOTO_SCALE_KEY,
    SCALE_CSS_VARS,
    SCALE_KEYS,
    SCALE_STEPS,
    extra_bounds,
    page_padding_rule,
    photo_scale_css_value,
    resolve_page_margins,
    resolve_photo_scale,
    scale_css_vars,
)
from .resume_pagination import validate_pagination_domain
from .resume_photo_crop import validate_photo_crop_domain
from .resume_sections import normalized_section_order
from .resume_style_schema import (
    validate_object_roles_domain,
    validate_objects_domain,
    validate_roles_domain,
)

# ===== 每份简历选字体（项 14）=====
#
# **不是** ``FORMAT_FIELDS`` 的一项：那张表是「版式编辑器」的字段清单，每一项都会被
# 渲染成一个输入控件（数字/颜色）。字体是一个"从已上传字体里挑一个"的枚举，塞进去会让
# 编辑器长出一个"字体 = 18"的数字框（D26）。
#
# 但它**必须**和格式配置存在同一个抽屉里（`format_config`）：它同样是"这份简历怎么排"
# 的一部分，跟着简历走、跟着导出走。所以只在 `validated_format_config` 里单独放行。
FONT_KEY = "font"
# 显式"这份简历不使用自定义字体"：与"没设过（跟随全局当前字体）"是**两种**语义，
# 所以要用一个哨兵值把前者表达出来——删键等于后者。
SYSTEM_FONT = "__system__"

FORMAT_FIELDS: tuple[dict, ...] = (
    {"key": "accent", "label": "强调色", "label_en": "Accent", "type": "color", "css": "--accent"},
    {
        "key": "text_color",
        "label": "正文",
        "label_en": "Body text",
        "type": "color",
        "css": "--text",
    },
    {
        "key": "muted_color",
        "label": "次要文字",
        "label_en": "Secondary text",
        "type": "color",
        "css": "--muted",
    },
    {
        "key": "line_color",
        "label": "分隔线",
        "label_en": "Dividers",
        "type": "color",
        "css": "--line",
    },
    {
        "key": "font_scale_adjust",
        "label": "字号系数",
        "label_en": "Font scale",
        "type": "number",
        # 下限 0.35：无级字号滑块允许小到 5px（最小档 11px 时系数 5/11≈0.455），
        # 所以字段范围必须能装下它，否则用户拖到 5px 会被 `validated_format_config`
        # 静默丢弃——存下来却不是他调的那个字号，是最难被发现的一类失败。
        # **自动一页仍然只到 0.88**（见 `resume_fit.AUTO_FIT_MIN_ADJUST`），
        # 放宽字段范围不等于让自动一页把字缩到看不清。
        "min": 0.35,
        "max": 1.16,
        "step": 0.02,
        "description": "在所选字号档位上再乘一个系数",
        "description_en": "Multiplies the selected font size",
    },
    {
        "key": "photo_border_width",
        "label": "照片边框粗细",
        "label_en": "Photo border width",
        "type": "number",
        # 0–8px：模板默认 1px（`.profile-photo { border: 1px solid var(--line) }`），
        # 0 = 明确"不要边框"。上限 8px 时边框仍不会盖住五官。
        "min": 0,
        "max": 8,
        "step": 1,
        "description": "照片边框的粗细（像素），0 为无边框",
        "description_en": "Photo border width in px; 0 removes it",
    },
    {
        "key": "photo_border_color",
        "label": "照片边框颜色",
        "label_en": "Photo border color",
        "type": "color",
        "description": "照片边框颜色，默认跟随分隔线色",
        "description_en": "Photo border color; defaults to the divider color",
    },
    {
        "key": "photo_radius",
        "label": "照片圆角",
        "label_en": "Photo corner radius",
        "type": "number",
        "min": 0,
        "max": 24,
        "step": 1,
        "description": "照片框圆角（像素），模板默认 4",
        "description_en": "Photo corner radius in px; templates default to 4",
    },
    {
        "key": "photo_offset_x",
        "label": "照片左右偏移",
        "label_en": "Photo offset X",
        "type": "number",
        # ±20mm：照片框本身约 30–45mm 宽，20mm 已能把照片推到另一侧边缘；
        # 再大就一定压到姓名，所以上限停在"还能读"的位置。
        "min": -20,
        "max": 20,
        "step": 0.5,
        "description": "照片相对模板位置的左右偏移（毫米）",
        "description_en": "Horizontal photo offset in mm",
    },
    {
        "key": "photo_offset_y",
        "label": "照片上下偏移",
        "label_en": "Photo offset Y",
        "type": "number",
        "min": -20,
        "max": 20,
        "step": 0.5,
        "description": "照片相对模板位置的上下偏移（毫米）",
        "description_en": "Vertical photo offset in mm",
    },
    {
        "key": "skill_columns",
        "label": "技能每行个数",
        "label_en": "Skills per row",
        "type": "number",
        # 1–4：小于 1 没有意义（一行至少一个标签），大于 4 时标签被压到读不清；
        # 上限与前端分段控件（1/2/3/4）逐项一致。
        "min": 1,
        "max": 4,
        "step": 1,
        "css": "--skill-columns",
        "description": "技能标签一行最多排几个",
        "description_en": "Maximum skill tags per row",
    },
    {
        "key": "line_height",
        "label": "行高",
        "label_en": "Line height",
        "type": "number",
        "min": 1.2,
        "max": 2.2,
        # 0.05 → 0.01（2026-10-21 用户要求）：行距常常差 0.05 就压不进一页，
        # 粗档位下只能靠 ± 按钮一点点蹭。前端 `LINE_HEIGHT_STEP` 必须与这里一致。
        "step": 0.01,
        "css_rule": "body { line-height: %s !important; }",
    },
    {
        "key": "page_padding",
        "label": "页边距（mm）",
        "label_en": "Page margin (mm)",
        "type": "number",
        # 下限 8 → 0（2026-10-22 用户要求）：要"正文铺满整张纸"时 8mm 是硬墙，
        # 而模板本来就可能自带 0。上限 26 不变：再宽正文就只剩一条窄条。
        "min": 0,
        "max": 26,
        # 1 → 0.1（2026-10-21 用户要求）：页边距直接决定"一页能塞多少"，1mm 一档时
        # 常常"小 1mm 就断行、大了装不下"，没有中间值。前端 `PAGE_PADDING_STEP` 同步。
        "step": 0.1,
        "css_rule": "body { padding: %smm !important; }",
    },
    {
        "key": "section_gap",
        "label": "区块间距",
        "label_en": "Section spacing",
        "type": "number",
        "min": 0.6,
        "max": 2.2,
        "step": 0.1,
        "css_rule": ".section { margin-bottom: calc(var(--fs) * %s) !important; }",
    },
)

FORMAT_FIELD_KEYS = tuple(field["key"] for field in FORMAT_FIELDS)
# 颜色正则的唯一来源：resume_config_domains（角色/对象/照片裁剪域共用同一口径）。
_HEX_COLOR_RE = HEX_COLOR_RE

# `page_padding`、四条支路、`photo_scale` 与三个"乘在模板基准上"的系数（`name_scale` /
# `section_title_scale` / `entry_gap`）**不走** `css_rule` 通用循环：
# 四条边必须合成**一条** CSS `padding` 简写（两条独立规则会互相覆盖，后出现的赢），
# 照片与三个系数走 `:root` 的自定义变量（模板侧写 `* var(--x, 1)` 兜底）。
# 它们由 `page_padding_rule` / `photo_scale_css_value` / `scale_css_vars` 在循环之后显式产出。
_CSS_MANUAL_KEYS: frozenset[str] = frozenset({PAGE_PADDING_KEY, *EXTRA_FORMAT_KEYS})

# ===== Wave2 扩展域的分派表（契约第 1 册 §1.2，全仓库唯一扩展点）=====
# 严格白名单：只有登记在这里的键会被当成"域"；每个域的自有校验在各自模块里，这里只负责
# 把"合法且非空"的域写回 format_config。None = 空域/不可用域 → 键不落库（契约 R3）。
_DOMAIN_VALIDATORS: dict[str, object] = {
    "roles": validate_roles_domain,
    "objects": validate_objects_domain,
    "pagination": validate_pagination_domain,
    "photo_crop": validate_photo_crop_domain,
    "object_roles": validate_object_roles_domain,
}


def _format_field(key: str) -> dict | None:
    return next((field for field in FORMAT_FIELDS if field["key"] == key), None)


def _validated_font_name(value: object) -> str | None:
    """校验"这份简历用哪个字体文件"，返回可用的字体名；不可用返回 ``None``。

    校验交给 ``user_fonts.font_path``——它已经做了"拒绝目录成分 + 后缀白名单 + 文件必须
    存在"三件事，这里再抄一份只会漂移。

    **取不到就静默丢弃**（返回 ``None``，调用方据此不写这个键）：字体文件被用户删掉之后，
    那份简历应当退回"跟随全局当前字体"，而不是整份打不开。这是本条唯一的失败策略——
    字体是显示细节，不该升级成打开简历的前置条件。
    """
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name:
        return None
    if name == SYSTEM_FONT:
        return name
    # 局部 import：`resume_template_format` 被模板/渲染链路广泛引用，模块级再拉一个
    # `user_fonts`（它要读配置目录）会把"只想拿字段表"的调用方也拖进文件系统。
    from ..user_fonts import FontError, font_path

    try:
        font_path(name)
    except FontError:
        return None
    return name


def validated_format_config(raw: dict | None) -> dict:
    """校验可写入 CSS 或版式渲染器的格式配置。

    ``FORMAT_FIELDS`` 之外还有两类键会被放行（它们**刻意不进** ``FORMAT_FIELDS``，
    否则「自制版式」编辑器会凭空多出 5 条滑杆、导入的模板还会报"缺键"）：

    * ``section_order``（分区顺序，列表）与 ``font``（这份简历用哪个字体文件）——各有自己的
      校验函数；
    * ``EXTRA_FORMAT_KEYS``：四条分边页边距 + ``photo_scale`` + 三个系数（``name_scale`` /
      ``section_title_scale`` / ``entry_gap``）。走 ``extra_bounds`` 的区间，
      **越界丢弃**（与 ``page_padding`` 及 ``test_format_config_is_whitelisted`` 同一条契约）。
    """
    if not isinstance(raw, dict):
        return {}
    result: dict = {}
    for key, value in raw.items():
        if str(key) == "section_order":
            if isinstance(value, (list, tuple)) and value:
                result["section_order"] = normalized_section_order(value)
            continue
        if str(key) == FONT_KEY:
            font_name = _validated_font_name(value)
            if font_name is not None:
                result[FONT_KEY] = font_name
            continue
        if str(key) == CONTACT_SEPARATOR_KEY:
            # 联系方式同行分隔符：未知值回落到 space（＝不写这个键），旧产物逐字节不变。
            style = validate_contact_separator(value)
            if style != "space":
                result[CONTACT_SEPARATOR_KEY] = style
            continue
        if str(key) == CONTACT_BREAKS_KEY:
            # #3：联系方式强制换行的字段白名单。空列表 = 空域（不写这个键），与"从未设置"
            # 逐字节等价；未知字段键丢弃而不是 422——`format_config` 是用户可以随手改的 JSON。
            breaks = validate_contact_breaks(value)
            if breaks:
                result[CONTACT_BREAKS_KEY] = breaks
            continue
        if str(key) in _DOMAIN_VALIDATORS:
            # R2：本端不认识的版本整域丢弃（不 422、不按旧语义误读）。
            if not is_supported(str(key), domain_version(value)):
                continue
            domain = _DOMAIN_VALIDATORS[str(key)](value)  # type: ignore[operator]
            if domain is not None:
                result[str(key)] = domain
            continue
        if str(key) in EXTRA_FORMAT_KEYS:
            try:
                number = float(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            low, high = extra_bounds(str(key))
            if low <= number <= high:
                result[str(key)] = round(number, 3)
            continue
        field = _format_field(str(key))
        if field is None or value in (None, ""):
            continue
        if field["type"] == "color":
            text = str(value).strip()
            if _HEX_COLOR_RE.fullmatch(text):
                result[field["key"]] = text.lower()
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if float(field.get("min", 0)) <= number <= float(field.get("max", 1)):
            result[field["key"]] = round(number, 3)
    return result


def format_css(config: dict | None) -> str:
    """把格式配置翻译成覆盖模板的 CSS 片段（空配置返回空串）。

    三条链路（草稿 HTML / 导出 HTML / 自动一页的探针）都读这一份产出，所以它必须：
    1. **默认参数下逐字节不变**——``page_padding`` 的四边相等时仍输出单值形态，
       ``photo_scale`` 与三个系数（``name_scale`` / ``section_title_scale`` / ``entry_gap``）
       等于 1 时一个字符都不写；
    2. 四边不等时输出 CSS 简写顺序（上右下左）的四值形态；
    3. 什么都不设时返回空串，让模板 CSS 成为唯一权威。
    """
    values = validated_format_config(config)
    if not values:
        return ""
    root_parts: list[str] = []
    extra_rules: list[str] = []
    for key, value in values.items():
        if key in _CSS_MANUAL_KEYS:
            # 页边距与照片系数**不在**这里产出，见循环之后的显式调用。
            continue
        field = _format_field(key)
        if field is None:
            continue
        if field.get("css"):
            root_parts.append(f"{field['css']}: {value};")
        if field.get("css_rule"):
            extra_rules.append(field["css_rule"] % f"{value:g}")
    # 技能标签的"每行最多 N 个"：`max-width` 让第 N+1 个标签必然换行。
    # 用 flex/flow 的 max-width 而不是 `grid-template-columns: repeat(N,1fr)`——
    # 后者强制等宽，长标签会被压扁到同一宽度里（2026-11 用户明确否决过 grid 方案）。
    # 未设这个键时**一个字都不写**：存量简历的技能标签排版逐字节不变。
    columns = values.get("skill_columns")
    if isinstance(columns, (int, float)) and columns >= 1:
        count = int(columns)
        extra_rules.append(
            f":root {{ --skill-columns: {count}; }}"
            " .skill-list li { max-width: calc((100% - var(--fs) * (var(--skill-columns) - 1))"
            " / var(--skill-columns)); }"
        )
    # 照片框（R-07/R-10）：边框粗细/颜色/圆角与 X/Y 偏移。
    # **只有用户设过这五项之一时才写规则**——模板自身已经是「1px + var(--line) + 4px」，
    # 默认态写一遍只会制造无意义 diff，也会让旧简历的 HTML 变成"另一份产物"。
    photo_keys = {
        "photo_border_width",
        "photo_border_color",
        "photo_radius",
        "photo_offset_x",
        "photo_offset_y",
    }
    if photo_keys & set(values):
        width = float(values.get("photo_border_width", 1) or 0)
        radius = float(values.get("photo_radius", 4) or 0)
        color = values.get("photo_border_color")
        offset_x = float(values.get("photo_offset_x", 0) or 0)
        offset_y = float(values.get("photo_offset_y", 0) or 0)
        declarations = [f"border-radius: {radius:g}px"]
        if width <= 0:
            declarations.insert(0, "border: 0")
        elif color:
            declarations.insert(0, f"border: {width:g}px solid {color}")
        else:
            declarations.insert(0, f"border: {width:g}px solid var(--line)")
        if offset_x or offset_y:
            declarations.append(f"transform: translate({offset_x:g}mm, {offset_y:g}mm)")
        extra_rules.append(".profile-photo { " + "; ".join(declarations) + " }")
    # 四条边合成一条规则（四边相等 → 单值形态，与历史产物逐字一致）。
    padding = page_padding_rule(values)
    if padding is not None:
        extra_rules.append(padding)
    # 照片系数只在真设过（≠1）时才写变量；`var(--photo-scale, 1)` 的回退值让"没设过"
    # 与今天完全等价，也不依赖声明顺序。
    photo_scale = photo_scale_css_value(values)
    if photo_scale is not None:
        root_parts.append(f"{PHOTO_SCALE_CSS_VAR}: {photo_scale};")
    # 三个系数的顺序由 `SCALE_KEYS_ORDER` 固定（name → section-title → entry），且 ≈1 的键
    # **一个字符都不写**——`format_css({"name_scale": 1})` 必须仍是空串。
    for key, value in scale_css_vars(values):
        root_parts.append(f"{SCALE_CSS_VARS[key]}: {value};")
    blocks: list[str] = []
    if root_parts:
        blocks.append(":root { " + " ".join(root_parts) + " }")
    blocks.extend(extra_rules)
    return "\n".join(blocks)


def format_field_options() -> list[dict]:
    """版式字段清单（喂「版式」编辑器的输入控件）。

    ``label`` / ``description`` 是中文正名，**保持原样**；``label_en`` /
    ``description_en`` 是同一项的英文名，只是附加键：zh 侧读法不变，旧前端忽略即可。
    英文为空串时前端回落 ``label``（见 ``frontend/src/utils/resumeFormatLabels.ts``）。
    """
    return [
        {
            "key": field["key"],
            "label": field["label"],
            "label_en": field.get("label_en", ""),
            "type": field["type"],
            **(
                {"min": field["min"], "max": field["max"], "step": field.get("step", 0.1)}
                if field["type"] == "number"
                else {}
            ),
            "description": field.get("description", ""),
            "description_en": field.get("description_en", ""),
        }
        for field in FORMAT_FIELDS
    ]


def page_padding_bounds() -> tuple[float, float]:
    """``page_padding`` 字段的 ``(min, max)``，单位 mm。

    给"兼容字段"做回落时的 clamp 用：``ExportRequest.margin_mm`` 已经不再是独立旋钮，
    但旧客户端仍可能给出 4mm / 40mm（它自己那份历史范围）。收进这里的区间，而不是让
    一个越界值把正文排出页面。**范围只在本模块定义一次**，别处不要再抄一份 8 和 26。

    四条分边支路共用同一区间，那份定义在 ``resume_layout_overrides``
    （``PAGE_MARGIN_MIN`` / ``PAGE_MARGIN_MAX``）——两处必须相等，
    ``test_layout_overrides.py`` 有一条漂移守卫钉住它。
    """
    field = _format_field("page_padding")
    if field is None:  # pragma: no cover - FORMAT_FIELDS 里必然有 page_padding
        raise RuntimeError("格式字段表缺少 page_padding，页边距范围无从取值")
    return float(field["min"]), float(field["max"])


__all__ = [
    "DOMAIN_KEYS",
    "EXTRA_FORMAT_KEYS",
    "FONT_KEY",
    "FORMAT_FIELDS",
    "FORMAT_FIELD_KEYS",
    "PAGE_MARGIN_KEYS",
    "PAGE_MARGIN_SIDES",
    "PAGE_PADDING_KEY",
    "PHOTO_SCALE_KEY",
    "SCALE_CSS_VARS",
    "SCALE_KEYS",
    "SCALE_STEPS",
    "SYSTEM_FONT",
    "_format_field",
    "_validated_font_name",
    "extra_bounds",
    "format_css",
    "format_field_options",
    "page_padding_bounds",
    "page_padding_rule",
    "photo_scale_css_value",
    "resolve_page_margins",
    "resolve_photo_scale",
    "scale_css_vars",
    "validated_format_config",
]
