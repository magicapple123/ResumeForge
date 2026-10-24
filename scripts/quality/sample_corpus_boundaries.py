# SPDX-License-Identifier: Apache-2.0
"""100 份**边界样例**：类别清单与装配。

本模块只做两件事：声明"有哪 13 个类别、每类几条"（CATEGORY_BUILDERS 的第三个元素，
check 命令据此核对 manifest 条数），以及把 sample_boundary_builders_a/b 的构造器按
固定顺序拼成一个列表。每条样例要覆盖什么、期望什么写在对应构造器里。

边界样例覆盖 W20 要求的全部维度：中英混排、少/多内容、照片、缺字、长链接、特殊
符号、局部强调、不同模板、极端边距、分页边界、旧记录、scholar 长 CV。
"""

from __future__ import annotations

from dataclasses import replace

from .sample_boundary_builders_a import (
    build_dense,
    build_long_url,
    build_missing_glyph,
    build_mixed_language,
    build_photo,
    build_sparse,
)
from .sample_boundary_builders_b import (
    build_emphasis,
    build_extreme_margins,
    build_legacy_record,
    build_page_boundary,
    build_scholar_long_cv,
    build_special_chars,
    build_template_matrix,
)
from .sample_specs import Sample

# (类别键, 构造器, 声明份数)；顺序即 manifest 顺序，份数之和必须是 100。
CATEGORY_BUILDERS = (
    ("mixed-language", build_mixed_language, 8),
    ("sparse", build_sparse, 8),
    ("dense", build_dense, 8),
    ("photo", build_photo, 8),
    ("missing-glyph", build_missing_glyph, 8),
    ("long-url", build_long_url, 8),
    ("special-chars", build_special_chars, 8),
    ("emphasis", build_emphasis, 8),
    ("template-matrix", build_template_matrix, 9),
    ("extreme-margins", build_extreme_margins, 8),
    ("page-boundary", build_page_boundary, 8),
    ("legacy-record", build_legacy_record, 8),
    ("scholar-long-cv", build_scholar_long_cv, 3),
)

BOUNDARY_SAMPLE_COUNT = sum(count for _name, _builder, count in CATEGORY_BUILDERS)


def boundary_samples() -> list[Sample]:
    """按 CATEGORY_BUILDERS 顺序返回全部 100 份边界样例，并统一编号。

    构造器只负责类目内顺序（其 sample_id 是临时的），全局编号在这里一次性分配：
    bound-001 … bound-100。这样"类别内 N 份"与"全局唯一 id"只有一处真相。
    """
    result: list[Sample] = []
    for name, builder, count in CATEGORY_BUILDERS:
        samples = builder()
        if len(samples) != count:
            raise AssertionError(f"类别 {name} 声明 {count} 份，构造器实际返回 {len(samples)} 份")
        result.extend(samples)
    return [
        replace(sample, sample_id=f"bound-{index:03d}")
        for index, sample in enumerate(result, start=1)
    ]


__all__ = ["BOUNDARY_SAMPLE_COUNT", "CATEGORY_BUILDERS", "boundary_samples"]
