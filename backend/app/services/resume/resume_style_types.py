# SPDX-License-Identifier: Apache-2.0
"""W07 局部排版的类型与合成（从 app.services.resume.resume_style 纯搬迁拆出）。

RoleStyle（只承载用户显式设过的值）、ResolvedStyle（合成结果 + 属性来源查询）与纯函数
resolve_style（L4 角色 / L5 对象 / L5.5 对象角色）。resume_style 对它们做 re-export 并在
CSS 产出里使用，既有 import 路径不变；本模块不 import 渲染器 / exporter。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from .field_style_target import field_entry_id
from .resume_style_schema import (
    PROP_KEYS,
    ROLES,
    validate_object_roles_domain,
    validate_objects_domain,
    validate_roles_domain,
)

StyleSource = Literal["template", "format", "resume", "role", "object"]

# 扁平键 → 角色属性：用于 ``source_of`` 判断"这份属性是不是在更低层被设过"。
# 只有确实存在对应关系的键才列（颜色/字号/行高/间距），不硬凑。
_FLAT_PROP_KEYS: dict[str, str] = {
    "text_color": "color",
    "accent": "color",
    "line_height": "line_height",
    "section_gap": "space_after",
    "font_scale_adjust": "font_scale",
}


@dataclass(frozen=True)
class RoleStyle:
    """一层合成后的角色样式（只保存显式值；None = 未覆盖）。"""

    font_scale: float | None = None
    color: str | None = None
    bold: bool | None = None
    space_before: float | None = None
    space_after: float | None = None
    line_height: float | None = None
    indent: float | None = None
    bullet: str | None = None
    align: str | None = None
    meta_align: str | None = None
    letter_spacing: float | None = None

    def get(self, prop: str) -> object:
        return getattr(self, prop, None)

    @property
    def empty(self) -> bool:
        return all(getattr(self, prop) is None for prop in PROP_KEYS)

    def merged_with(self, other: RoleStyle) -> RoleStyle:
        """``other`` 的非 None 值覆盖本层（L4 → L5 的合成规则）。"""
        return RoleStyle(
            **{
                prop: getattr(other, prop)
                if getattr(other, prop) is not None
                else getattr(self, prop)
                for prop in PROP_KEYS
            }
        )


_EMPTY_ROLE = RoleStyle()


def _role_style(raw: Mapping[str, object] | None) -> RoleStyle:
    if not raw:
        return _EMPTY_ROLE
    values = {prop: raw.get(prop) for prop in PROP_KEYS if raw.get(prop) is not None}
    return RoleStyle(**values)  # type: ignore[arg-type]


@dataclass(frozen=True)
class ResolvedStyle:
    template: str
    roles: Mapping[str, RoleStyle]
    objects: Mapping[str, RoleStyle]
    # 键为 ``"<object_id>:<role>"``：该对象该角色的最高优先覆盖（W3）。
    object_roles: Mapping[str, RoleStyle] = field(default_factory=dict)
    flat: Mapping[str, object] = field(default_factory=dict)

    def role(self, role: str) -> RoleStyle:
        return self.roles.get(role, _EMPTY_ROLE)

    def entry(self, object_id: str | None) -> RoleStyle:
        """该对象的 L5 覆盖；未命中返回空 RoleStyle（调用方再用角色层/模板值）。"""
        return self.objects.get(object_id or "", _EMPTY_ROLE)

    def entry_role(self, role: str, object_id: str | None) -> RoleStyle:
        """该对象该角色的 L5.5 覆盖（W3）；未命中返回空 RoleStyle。"""
        return self.object_roles.get(f"{object_id or ''}:{role}", _EMPTY_ROLE)

    def effective(self, role: str, *, object_id: str | None = None) -> RoleStyle:
        """角色层 → 对象层 → 对象角色层合成后的显式值（越具体越优先）。

        ``obj:<role>`` 是 W3 新增的最高层：用户把「文字级别」限定到某个字段后，
        同一条目其它角色仍走对象层/角色层，互不污染。
        """
        parent = field_entry_id(object_id)
        inherited = (
            self.role(role)
            .merged_with(self.entry(parent))
            .merged_with(self.entry_role(role, parent))
            .merged_with(self.entry(object_id))
            .merged_with(self.entry_role(role, object_id))
        )
        return inherited

    def source_of(
        self, prop: str, *, role: str | None = None, object_id: str | None = None
    ) -> StyleSource:
        """某属性当前生效值的来源：object > role > resume(扁平键) > template。

        L2（具名版式）与 L3（简历覆盖）在调用方已经合成进同一份 format_config，这里
        无法再区分——两者都报 ``resume``，属性面板文案按"已调整"处理（契约 §2.5 三态）。
        """
        if object_id and role and getattr(self.entry_role(role, object_id), prop, None) is not None:
            return "object"
        if object_id and getattr(self.entry(object_id), prop, None) is not None:
            return "object"
        parent = field_entry_id(object_id)
        if parent and (
            (role and getattr(self.entry_role(role, parent), prop, None) is not None)
            or getattr(self.entry(parent), prop, None) is not None
        ):
            return "object"
        if role and getattr(self.role(role), prop, None) is not None:
            return "role"
        flat_keys = [key for key, mapped in _FLAT_PROP_KEYS.items() if mapped == prop]
        if any(key in self.flat for key in flat_keys):
            return "resume"
        return "template"

    @property
    def empty(self) -> bool:
        return not (
            any(not style.empty for style in self.roles.values())
            or any(not style.empty for style in self.objects.values())
            or any(not style.empty for style in self.object_roles.values())
        )


def resolve_style(*, template: str, format_config: dict | None) -> ResolvedStyle:
    """L4/L5/L5.5 合成。纯函数：不读 DB / 不读文件 / 不抛异常（畸形输入按"未设置"）。"""
    config = format_config if isinstance(format_config, dict) else {}
    roles_domain = validate_roles_domain(config.get("roles")) or {}
    objects_domain = validate_objects_domain(config.get("objects")) or {}
    object_roles_domain = validate_object_roles_domain(config.get("object_roles")) or {}
    roles = {
        role: _role_style(roles_domain.get(role))
        for role in ROLES
        if isinstance(roles_domain.get(role), dict)
    }
    objects = {
        str(object_id): _role_style(payload)
        for object_id, payload in objects_domain.items()
        if str(object_id) != "version" and isinstance(payload, dict)
    }
    # 键已由校验器归一成 ``"<object_id>:<role>"``，这里原样保留（不重新拼）。
    object_roles = {
        str(key): _role_style(payload)
        for key, payload in object_roles_domain.items()
        if str(key) != "version" and isinstance(payload, dict)
    }
    return ResolvedStyle(
        template=template,
        roles=roles,
        objects=objects,
        object_roles=object_roles,
        flat=config,
    )
