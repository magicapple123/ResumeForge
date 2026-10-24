# SPDX-License-Identifier: Apache-2.0
"""边界样例的公共常量与构造入口（由 sample_boundary_builders_a/b 共用）。

类别构造器拆成两个模块只是因为单文件行数预算（新文件目标 300 行）；分类逻辑
（谁属于哪个类别）仍只在 sample_corpus_boundaries.CATEGORY_BUILDERS 一处。
"""

from __future__ import annotations

from typing import Any

from .sample_specs import Expect, Sample

VISIBLE_TEMPLATES = ("classic", "modern", "compact", "elegant", "minimal", "scholar")
LEGACY_TEMPLATES = ("technical", "editorial", "split")
ALL_TEMPLATES = VISIBLE_TEMPLATES + LEGACY_TEMPLATES
FONT_SCALES = ("small", "standard", "large")
DOLLAR = chr(36)


def make_sample(
    category: str,
    index: int,
    title: str,
    coverage: tuple[str, ...],
    content: dict[str, Any],
    *,
    template: str = "classic",
    font_scale: str = "standard",
    page_limit: int = 1,
    language: str = "zh-CN",
    format_config: dict[str, Any] | None = None,
    include_photo: bool = True,
    expect: Expect | None = None,
) -> Sample:
    """按类别序号生成样例；期望缺省为"排进声明的页数、不溢出"。"""
    return Sample(
        sample_id=f"bound-{index:03d}",
        kind="boundary",
        category=category,
        title=title,
        coverage=coverage,
        content=content,
        template=template,
        font_scale=font_scale,
        page_limit=page_limit,
        language=language,
        format_config=format_config,
        include_photo=include_photo,
        expect=expect or Expect(max_pages=page_limit, overflow=False),
    )


__all__ = [
    "ALL_TEMPLATES",
    "DOLLAR",
    "FONT_SCALES",
    "LEGACY_TEMPLATES",
    "VISIBLE_TEMPLATES",
    "make_sample",
]
