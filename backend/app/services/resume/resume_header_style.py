# SPDX-License-Identifier: Apache-2.0
"""页眉姓名 / 性别的**最终样式**：一处解析，PDF 与 Word 共用（I-03）。

为什么单独成一个模块：这两个导出器是"重画一遍"的独立渲染器，没有 HTML 那条
`[data-role]` + `[data-resume-path]` 的两级继承链。I-03 之前，PDF 的姓名只查
`style("name")`（没有 object_id），Word 的姓名干脆是常量（`bold=True` / `accent` /
`name_ratio`）——于是"把姓名改成红色"在草稿生效、在 PDF 与 Word 全部失效。

**优先级（用户 2026-11-18 拍板"全量对齐"）**：

* 姓名段：字段级（`style("meta", object_id=name_path)`）覆盖姓名角色级（`style("name")`）；
* 性别段：字段级（`style("meta", object_id=gender_path)`）覆盖 **meta 角色级**
  （`style("meta")`，I-42），角色级再覆盖调用方的固定值（muted / `name_extra_ratio`）。

顺序是 **字段级 > 角色级 > 固定值**，两层都不能反：反了 I-03 的"只点性别字段"就会
被角色级吃掉。取值的键是 **字段路径** `header.<item_id>`（`ResolvedStyle.entry_role`
拼的是 `f"{object_id}:{role}"`，见 `resume_style_types.py`），不是 item id。

返回 `None` 表示"这一层没有任何覆盖"，调用方沿用各自的历史默认值（颜色取 accent/muted、
字号取 `name_ratio`、加粗默认 True）。这样"没设过姓名/性别样式的旧简历"产物逐字节不变。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from ...schemas.resume_document_plan import HeaderPlan, Inline
from .field_style_target import is_header_path
from .resume_style import RoleStyle

#: 与 PDF / HTML 同一形态的角色/对象样式查询函数。
RoleStyleQuery = Callable[..., RoleStyle | None]


def _first_header_path(segments: Sequence[Inline]) -> str | None:
    """段列表里第一条页眉字段路径；没有（空姓名等）返回 None。"""
    for segment in segments:
        if is_header_path(segment.path):
            return segment.path
    return None


def name_block_styles(
    header: HeaderPlan, style: RoleStyleQuery
) -> tuple[RoleStyle | None, RoleStyle | None]:
    """姓名段 / 性别段的最终样式。

    - 第一个返回值给姓名（`name` 行）：字段级 > 姓名角色级 > None；
    - 第二个返回值给性别（`name_meta` 行）：字段级 > meta 角色级 > None。

    调用方取 `font_scale` / `color` / `bold` 三项；姓名另可取 `letter_spacing`
    （I-41：该属性的角色白名单不含 `meta`，所以它只可能来自姓名角色级），
    姓名不是段落、没有缩进与项目符号。
    """
    name_path = _first_header_path(header.name)
    gender_path = _first_header_path(header.name_meta)

    name_style = style("name") or RoleStyle()
    if name_path:
        # `field_only`：只取 `object_roles["header.<id>:meta"]`，**不叠 meta 角色层**。
        # HTML 里姓名 span 只带 `data-resume-path`（`data-role="name"` 在容器上），
        # 所以"灰字角色"的颜色/字号不该染到姓名——不传 field_only 就会（I-42 现场抓到）。
        field_style = style("meta", object_id=name_path, field_only=True)
        if field_style is not None:
            name_style = name_style.merged_with(field_style)

    # I-42：性别段的角色级 meta 是**兜底一层**，字段级仍压在它上面。
    gender_style = style("meta") or RoleStyle()
    if gender_path:
        field_style = style("meta", object_id=gender_path, field_only=True)
        if field_style is not None:
            gender_style = gender_style.merged_with(field_style)
    name_result = None if name_style.empty else name_style
    gender_result = None if gender_style.empty else gender_style
    return name_result, gender_result


__all__ = ["RoleStyleQuery", "name_block_styles"]
