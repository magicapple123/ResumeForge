# SPDX-License-Identifier: Apache-2.0
"""内置模板的**真实配色**（左栏「外观」组 2×2 色卡的数据源）。

## 为什么要有这张表

模板配色只存在于 `app/templates/resume_*.html.j2` 的 `:root` 里。前端在"用户没设过
覆盖"时拿不到它们，只能用同一个占位色（`#374151`）画四个色块——四张卡长得一模一样，
用户看不出强调色/正文/次要/分隔线各是什么颜色。这张表把那份 CSS 变量搬进目录，让色卡
显示**生效值**（`自己的覆盖 > 版式预设 > 模板配色 > 占位`）。

## 两处真源是刻意的

模板 CSS 是**渲染真源**（PDF / Word / HTML 三个出口都吃它），这张表只是它的镜像。
不把 CSS 改成"读这张表"是因为模板是用户/设计者改得动的文件，`<style>` 里内联一切更
直白；而前端要的是**数据**，不能去 `import` 一个 `.j2`。

镜像就必然漂移，因此 `tests/test_template_palette_matches_css.py` 用正则逐值比对，
模板改了色而表没跟上就变红。**不要**为了让它变绿而放宽比对项。
"""

from __future__ import annotations

#: 四个颜色键 → 模板 `:root` 里的 CSS 变量名（与 `resume_template_format.FORMAT_FIELDS`
#: 里 `type == "color"` 的四项一一对应，顺序也一致）。
PALETTE_CSS_VARS: dict[str, str] = {
    "accent": "accent",
    "text_color": "text",
    "muted_color": "muted",
    "line_color": "line",
}

#: 模板名 → 四项十六进制色（**小写**，与 `:root` 逐字相同；比对测试按小写口径）。
TEMPLATE_PALETTES: dict[str, dict[str, str]] = {
    "classic": {
        "accent": "#16365c",
        "text_color": "#1f2937",
        "muted_color": "#6b7280",
        "line_color": "#d9dee7",
    },
    "modern": {
        "accent": "#0f766e",
        "text_color": "#24303f",
        "muted_color": "#667085",
        "line_color": "#d7e0e6",
    },
    "compact": {
        "accent": "#30363f",
        "text_color": "#1f2430",
        "muted_color": "#6b7280",
        "line_color": "#dcdfe6",
    },
    "elegant": {
        "accent": "#1f3b4d",
        "text_color": "#22252b",
        "muted_color": "#7a7f88",
        "line_color": "#e0ddd6",
    },
    "technical": {
        "accent": "#0b5fa5",
        "text_color": "#1c2430",
        "muted_color": "#5d6b7a",
        "line_color": "#ccd6e0",
    },
    "minimal": {
        "accent": "#17181a",
        "text_color": "#17181a",
        "muted_color": "#767a80",
        "line_color": "#e6e6e6",
    },
    "scholar": {
        "accent": "#1a1a1a",
        "text_color": "#1a1a1a",
        "muted_color": "#4f4f4f",
        "line_color": "#8f8f8f",
    },
    "editorial": {
        "accent": "#8b3a3a",
        "text_color": "#2f2a28",
        "muted_color": "#81746e",
        "line_color": "#e5d8d3",
    },
    "split": {
        "accent": "#6b4f2a",
        "text_color": "#2c2a26",
        "muted_color": "#77736b",
        "line_color": "#e1ddd5",
    },
}


def palette_for(name: str) -> dict[str, str] | None:
    """模板名 → 四项配色；**取不到返回 `None`**（自制模板 / 未知名字）。

    返回 `None` 而不是空字典：前端据此区分"这个模板没有配色数据"（显示斜纹占位 + 「随模板」）
    与"配色是空的"（不该发生）。字典每次都给一份新的，调用方改了也不会污染这张表。
    """
    palette = TEMPLATE_PALETTES.get((name or "").strip())
    return dict(palette) if palette else None


__all__ = ["PALETTE_CSS_VARS", "TEMPLATE_PALETTES", "palette_for"]
