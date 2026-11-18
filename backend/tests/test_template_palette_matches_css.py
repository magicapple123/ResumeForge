# SPDX-License-Identifier: Apache-2.0
"""模板配色镜像表的**两处真源**守卫（I-09）。

`resume_template_palette.TEMPLATE_PALETTES` 是 `app/templates/resume_*.html.j2` 里
`:root { --text/--muted/--line/--accent }` 的镜像——模板是渲染真源，表只是给前端色卡
用的**数据**。镜像必然漂移，所以这里逐值比对：模板改了颜色而表没跟上，测试立刻变红。

反证过：把 `resume_modern.html.j2` 的 `--accent` 从 `#0f766e` 改成 `#0f766f`，本文件
的 `test_palette_matches_template_css[modern]` 精确失败（只有那一项红）。
"""

from __future__ import annotations

import re

import pytest
from app.services.resume.resume_template_catalog import RESUME_TEMPLATES, TEMPLATES_DIR
from app.services.resume.resume_template_palette import (
    PALETTE_CSS_VARS,
    TEMPLATE_PALETTES,
    palette_for,
)

#: 只取模板 `<style>` 里第一个 `:root { … }` 块（`--accent-soft`、`--bg` 不在比对口径内）。
_ROOT_BLOCK = re.compile(r":root\s*\{(?P<body>[^}]*)\}", re.S)
_CSS_VAR = re.compile(r"--(?P<name>[\w-]+)\s*:\s*(?P<value>[^;]+);")


def _root_vars(template_file: str) -> dict[str, str]:
    text = (TEMPLATES_DIR / template_file).read_text(encoding="utf-8")
    block = _ROOT_BLOCK.search(text)
    assert block is not None, f"{template_file} 里找不到 :root 块"
    return {
        match.group("name"): match.group("value").strip().lower()
        for match in _CSS_VAR.finditer(block.group("body"))
    }


@pytest.mark.parametrize("name", sorted(RESUME_TEMPLATES))
def test_palette_matches_template_css(name: str) -> None:
    """每个内置模板的四个颜色变量必须与 `TEMPLATE_PALETTES` 逐字相同。"""
    template_file = str(RESUME_TEMPLATES[name]["file"])
    css = _root_vars(template_file)
    palette = TEMPLATE_PALETTES.get(name)
    assert palette is not None, f"模板 {name} 没有配色条目"
    for key, css_var in PALETTE_CSS_VARS.items():
        assert css_var in css, f"{template_file} 的 :root 里没有 --{css_var}"
        assert palette[key].lower() == css[css_var], (
            f"{name}.{key} 与 {template_file} 的 --{css_var} 不一致："
            f"表里 {palette[key]} / 模板 {css[css_var]}"
        )


def test_palette_table_has_no_orphans() -> None:
    """表里不许有"模板清单里不存在"的条目（下线模板时忘了删表会藏在这里）。"""
    assert set(TEMPLATE_PALETTES) <= set(RESUME_TEMPLATES)


def test_palette_for_returns_copy_or_none() -> None:
    """取不到 → `None`（自制模板走降级）；取到 → 副本（改它不影响表）。"""
    assert palette_for("nope") is None
    assert palette_for("") is None
    copied = palette_for("classic")
    assert copied is not None and copied["accent"] == "#16365c"
    copied["accent"] = "#000000"
    assert TEMPLATE_PALETTES["classic"]["accent"] == "#16365c"
