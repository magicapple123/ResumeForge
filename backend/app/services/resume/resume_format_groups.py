# SPDX-License-Identifier: Apache-2.0
"""版式字段的编辑器分组（「自制版式」表单的分区依据）。

## 为什么单独成模块

分组是**纯展示元数据**：它不参与校验、不影响渲染产物，只回答"这一栏该排在哪一区"。
`FORMAT_FIELDS` 所在的 `resume_template_format.py` 已贴着 500 行预算（后端
`tests/test_file_size_budget.py` 是硬闸门），把十几条分组名塞回去只能靠删注释腾地方；
搬到这里既守住了预算，也让"哪一栏属于哪一组"只有**一处**定义。

## 口径（与 `label` / `label_en` 完全一致）

* ``group`` 是中文分组正名，也就是**分区键本身**——同一 ``group`` 的字段连成一区；
* ``group_en`` 是同一组的英文名，只是附加键：中文界面读法不变，旧前端忽略即可。

前端按 ``group`` 的值分区、按字段**出现的先后**决定分区顺序（见
``frontend/src/features/templates/FormatTemplateEditorModal.tsx``），因此这里不需要
（也不应该）再维护一份"组的顺序"——那会和 `FORMAT_FIELDS` 的实际顺序漂成两套。

未登记的字段拿到的是空串：前端把它归入"无组头"的收尾区照常渲染。这是**可见的降级**
（多一栏没有组头的参数），不是静默丢字段。
"""

from __future__ import annotations

#: 分组名 → 英文分组名。值里不出现"其他"这类兜底组：未登记就是空串（见模块注释）。
GROUP_LABELS: dict[str, str] = {
    "颜色": "Colors",
    "字号与行距": "Type and line spacing",
    "间距": "Spacing",
    "照片": "Photo",
    "页眉": "Header",
}

#: ``FORMAT_FIELDS`` 每一项的 ``key`` → 分组名。新增字段必须在这里登记，
#: 否则它会落到"无组头"的收尾区（`format_field_options()` 不会报错）。
FIELD_GROUPS: dict[str, str] = {
    # 色彩：四个 CSS 变量，改的是整份简历的配色关系。
    "accent": "颜色",
    "text_color": "颜色",
    "muted_color": "颜色",
    "line_color": "颜色",
    # 文字：字号系数与行高决定"一页装多少"，必须挨着调。
    "font_scale_adjust": "字号与行距",
    "line_height": "字号与行距",
    # 间距：区块之间、页边距、技能标签的密度。
    "skill_columns": "间距",
    "page_padding": "间距",
    "section_gap": "间距",
    # 照片：五项共同描述同一个相框（含边框颜色——它和圆角/偏移是一组参数）。
    "photo_border_width": "照片",
    "photo_border_color": "照片",
    "photo_radius": "照片",
    "photo_offset_x": "照片",
    "photo_offset_y": "照片",
    # 页眉：只有页眉线位置一项，模板没有页眉线时前端按 `requires` 置灰。
    "header_rule_gap": "页眉",
}

#: 照片框的五项参数。**唯一定义处**：`format_css` 判"用户是否设过照片参数"、
#: 编辑器把五项归入「照片」区，两处读的都是这一份，避免两套清单各自漂移。
PHOTO_FIELD_KEYS: frozenset[str] = frozenset(
    {
        "photo_border_width",
        "photo_border_color",
        "photo_radius",
        "photo_offset_x",
        "photo_offset_y",
    }
)


def format_field_group(key: str) -> dict[str, str]:
    """取一项版式字段的分组附加键。

    Args:
        key: ``FORMAT_FIELDS`` 里某项的 ``key``。

    Returns:
        ``{"group": <中文分组名>, "group_en": <英文分组名>}``；未登记的键两者都是空串
        （前端据此归入"无组头"的收尾区，而不是把这一项藏起来）。
    """
    group = FIELD_GROUPS.get(key, "")
    return {"group": group, "group_en": GROUP_LABELS.get(group, "")}


__all__ = ["FIELD_GROUPS", "GROUP_LABELS", "PHOTO_FIELD_KEYS", "format_field_group"]
