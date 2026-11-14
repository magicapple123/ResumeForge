# SPDX-License-Identifier: Apache-2.0
"""判断"这段条目头里，有没有哪个字段标签被单独设过样式"。

调用方据此在"字段级逐段绘制"和"原来的整段绘制"之间选路：只要有一个字段标签有非空
覆盖，就必须逐段画；否则走既有路径，普通条目的 PDF/Word 产物逐字节不变。

``object_id=seg.path or entry_id``：字段路径优先——标签的覆盖通常挂在具体字段上，
只有老数据（没有字段路径）才回退到条目级。
"""


def has_styled_labels(segments, query, entry_id=None):
    return bool(query) and any(
        seg.role == "field_label"
        and (style := query(seg.role, object_id=seg.path or entry_id))
        and not style.empty
        for seg in segments
    )
