# SPDX-License-Identifier: Apache-2.0
"""I-29 精确模式：页眉分隔线不能压在照片上。

照片允许越出页眉内容区（照片偏移是"照片框"的属性），此时线要让开照片：按照片横向
区间拆段，端点内缩 0.5mm，过短的段丢弃。**不改页眉高度**——`header_bottom` 决定
分页，改了会连锁影响 fit.py 的 18 组「1 页 + 填充率」校验。

这里测的是几何（纯函数）；像素级的"照片区域没有 accent 色"由渲染层保证，
本组用"线段的 x 区间与照片区间不相交"表达同一性质。
"""

from __future__ import annotations

from app.services.pdf_exporter.header import (
    _MIN_LINE_SEGMENT_MM,
    _PHOTO_LINE_GAP_MM,
    _line_segments_around_photo,
)

LEFT = 18.0
RIGHT = 192.0


def _intersects(segment: tuple[float, float], photo: tuple[float, float, float, float]) -> bool:
    start, end = segment
    x, _y, w, _h = photo
    return start < x + w and end > x


def test_line_is_untouched_without_a_photo():
    assert _line_segments_around_photo(LEFT, RIGHT, 40.0, None) == [(LEFT, RIGHT)]


def test_line_is_untouched_when_it_does_not_cross_the_photo():
    """照片整体在线下方（或上方）时线照旧整条画。"""
    photo = (150.0, 20.0, 24.0, 15.0)
    assert _line_segments_around_photo(LEFT, RIGHT, 40.0, photo) == [(LEFT, RIGHT)]


def test_line_splits_around_a_right_side_photo():
    photo = (150.0, 20.0, 24.0, 30.0)
    segments = _line_segments_around_photo(LEFT, RIGHT, 40.0, photo)

    assert len(segments) == 2
    assert segments[0][1] == photo[0] - _PHOTO_LINE_GAP_MM
    assert segments[1][0] == photo[0] + photo[2] + _PHOTO_LINE_GAP_MM
    assert not any(_intersects(segment, photo) for segment in segments)


def test_line_splits_around_a_left_side_photo():
    photo = (18.0, 20.0, 24.0, 30.0)
    segments = _line_segments_around_photo(LEFT, RIGHT, 40.0, photo)

    # 左边那一段只有 0mm（照片贴着左边距），必须被丢掉，只留右边一段。
    assert len(segments) == 1
    assert segments[0][0] == photo[0] + photo[2] + _PHOTO_LINE_GAP_MM
    assert not any(_intersects(segment, photo) for segment in segments)


def test_short_segments_are_dropped():
    """照片几乎占满整行时，两侧余量都不到 2mm → 一条线都不画（而不是画两个点）。"""
    photo = (LEFT + 1.0, 20.0, RIGHT - LEFT - 2.0, 30.0)
    assert _line_segments_around_photo(LEFT, RIGHT, 40.0, photo) == []
    assert _MIN_LINE_SEGMENT_MM > 1.0
