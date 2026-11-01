# SPDX-License-Identifier: Apache-2.0
"""#5a：inline 日期位置的伴随 CSS（从 resume_style.py 拆出守 500 行预算）。

`justify-content: flex-start` 只在容器有自由空间时可见，而 `_DOCUMENT_CSS` 里
`.entry-head .title { flex: 1 1 auto; }` 会把标题撑满整行——这三条伴随规则必须排在
`document_css` **之后**注入（exporter 侧的 css_blocks 末位），同权重下后来者胜。
"""

from __future__ import annotations

from .resume_style import _ENTRY_HEAD_SELECTOR, ROLES, ResolvedStyle, RoleStyle, _rule


def _meta_align_companion_rules(prefix: str, style: RoleStyle) -> str:
    """#5a：inline 日期位置的伴随规则（.title 不再吃满整行、.meta 贴左）。

    `justify-content: flex-start` 只在容器**有自由空间**时可见：_DOCUMENT_CSS 里
    `.entry-head .title { flex: 1 1 auto; }` 会把标题撑满整行，inline 等于没设。
    这三条必须排在 `document_css` **之后**注入（同权重下后来者胜），right / 未设置
    不需要（space-between 靠两端对齐本来就有空间可分）。head-stacked / head-meta_first
    下条目头是 block 布局，这些规则不起作用（等于忽略），无需按布局分支。
    """
    if style.meta_align is None or style.meta_align == "right":
        return ""
    return "\n".join(
        rule
        for rule in (
            _rule(prefix, ["justify-content: flex-start;"]),
            _rule(f"{prefix} .title", ["flex: 0 1 auto;"]),
            _rule(f"{prefix} .meta", ["margin-left: 0; text-align: left; max-width: none;"]),
        )
        if rule
    )


def meta_align_css(style: ResolvedStyle) -> str:
    """#5a：日期位置 inline 的伴随规则（HTML 渲染器在 `document_css` 之后注入）。

    覆盖三层来源（与 `_role_rules` / `_object_spatial_rules` 的落点同源）：
    L4 角色层 → 全局 `.entry-head`；L5 对象层与 L5.5 对象角色层 → 该条目自己的
    `[data-object-id] .entry-head`。只对 meta_align=inline 的来源产出，默认零字符。
    """
    blocks: list[str] = []
    for role in ROLES:
        role_style = style.roles.get(role)
        if role_style is not None:
            blocks.append(_meta_align_companion_rules(_ENTRY_HEAD_SELECTOR, role_style))
    for object_id, object_style in style.objects.items():
        if object_style.meta_align is not None:
            prefix = f'[data-object-id="{object_id}"] {_ENTRY_HEAD_SELECTOR}'
            blocks.append(_meta_align_companion_rules(prefix, object_style))
    for key, object_role_style in style.object_roles.items():
        if object_role_style.meta_align is None:
            continue
        object_id = key.rpartition(":")[0]
        prefix = f'[data-object-id="{object_id}"] {_ENTRY_HEAD_SELECTOR}'
        blocks.append(_meta_align_companion_rules(prefix, object_role_style))
    return "\n".join(block for block in blocks if block)
