# SPDX-License-Identifier: Apache-2.0
"""逐列宽度 / 逐间隔的生效值判定（HTML / PDF / Word 三个出口共用一份口径）。

为什么要单独一个模块：这是**四个出口必须一致**的判据（HTML 与 PDF 共用一份模板，
Word 走 python-docx 的表格），放在任一渲染器里都会让另一个反向依赖它。这里只有纯函数，
不 import 任何渲染模块，谁都能引。

规则一句话：**长度对不上就整体作废**。用户把三列改成两列时，旧的三段宽度会暂时对不上，
此时必须干净地回到等宽，而不是"前两段生效、第三段挤成 0"。
"""

from __future__ import annotations

from collections.abc import Sequence

__all__ = ["resolved_column_geometry"]


def resolved_column_geometry(
    columns: int,
    widths: Sequence[float] | None,
    gaps: Sequence[float] | None,
) -> tuple[list[float] | None, list[float] | None]:
    """返回生效的 ``(逐列宽度, 逐间隔)``；任一为 ``None`` 表示该维度沿用等宽口径。

    - 宽度：长度必须等于 ``columns``，合计由 schema 保证为 100；
    - 间隔：长度必须等于 ``columns - 1``（N 列只有 N−1 个间隔）；
    - 单列（``columns < 2``）没有"逐列"可言，两个维度都作废。
    """
    if columns < 2:
        return None, None
    resolved_widths = (
        [float(width) for width in widths] if widths and len(widths) == columns else None
    )
    resolved_gaps = [float(gap) for gap in gaps] if gaps and len(gaps) == columns - 1 else None
    if resolved_widths is None and resolved_gaps is None:
        return None, None
    return resolved_widths, resolved_gaps
