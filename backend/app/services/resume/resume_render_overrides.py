# SPDX-License-Identifier: Apache-2.0
"""渲染覆盖的唯一入口：把四个 format_config 域解析成 ``RenderOverrides``（Wave2 §1.5/§1.6）。

**为什么必须只有这一个入口**：W07 角色/对象、W08 分页、W15 照片裁剪三批都要被
HTML / PDF / Word 三个渲染器消费。若每个渲染器自己 ``config.get("roles")``，就会出现
"PDF 读了、Word 忘了"这类只在一个格式上失效的 bug（W05 已踩过同类）。所以渲染器只认
``RenderOverrides``，不再碰原始 dict。

三块职责：
* ``resolve_render_overrides``：唯一构造点（纯函数，不读 DB、畸形输入按空域）；
* ``render_overrides_css``：HTML 侧唯一 CSS 产出（角色 + 对象 + 分页 @media print）；
* ``prune_overrides``：保存时裁掉"指向已不存在对象 / 照片已换"的死数据（契约 §1.6）。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .resume_config_domains import DOMAIN_KEYS
from .resume_pagination import PaginationPlan, pagination_css, resolve_pagination
from .resume_photo_crop import (
    PhotoCropPlan,
    cropped_photo_data_url,
    photo_sha256,
    resolve_photo_crop,
)
from .resume_style import ResolvedStyle, entry_style_css, resolve_style, role_style_css

# 六个条目数组（id 校验与可见性过滤共用同一份定义来源）。
_ENTRY_FIELDS: tuple[str, ...] = (
    "education",
    "experience",
    "campus_experience",
    "projects",
    "skills",
    "awards",
)


@dataclass(frozen=True)
class RenderOverrides:
    """一次渲染的全部扩展覆盖（四域解析结果）。"""

    style: ResolvedStyle
    pagination: PaginationPlan = field(default_factory=PaginationPlan)
    photo_crop: PhotoCropPlan | None = None

    @property
    def empty(self) -> bool:
        """四域全空（默认路径零变化的判据）。"""
        return self.style.empty and self.pagination.empty and self.photo_crop is None

    def photo_for_render(self, photo: str | None) -> str:
        """渲染用的照片：有裁剪计划时返回**派生**的裁剪后 data URL，否则原图。

        派生结果只用于本次渲染，不写库、不改 content（非破坏编辑）。
        """
        if self.photo_crop is None:
            return photo or ""
        return cropped_photo_data_url(photo, self.photo_crop)


def resolve_render_overrides(
    *, template: str, format_config: dict | None, photo: str | None = None
) -> RenderOverrides:
    """唯一构造点：解析 L4/L5 + 分页 + 照片裁剪（纯函数，不抛异常）。"""
    return RenderOverrides(
        style=resolve_style(template=template, format_config=format_config),
        pagination=resolve_pagination(format_config),
        photo_crop=resolve_photo_crop(format_config, photo),
    )


def render_overrides_css(overrides: RenderOverrides) -> str:
    """HTML 侧唯一 CSS 产出；四域全空返回空串（默认产物一个字符都不多）。

    ``base_px`` / ``template`` 不需要单独传：角色 CSS 以模板基准比例 + CSS 变量
    ``--fs`` 表达，与模板自己的写法同口径（契约 §2.2 HTML 列）。
    """
    blocks = [
        role_style_css(overrides.style),
        entry_style_css(overrides.style),
        pagination_css(overrides.pagination),
    ]
    return "\n".join(block for block in blocks if block)


def _content_object_ids(content: dict | None) -> set[str]:
    """content 里现存的条目对象 id（只有条目 id 可作为 objects/pagination 的键）。"""
    if not isinstance(content, dict):
        return set()
    found: set[str] = set()
    for field_name in _ENTRY_FIELDS:
        for entry in content.get(field_name) or []:
            if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                found.add(entry["id"])
    return found


def prune_overrides(content: dict | None, format_config: dict | None) -> dict | None:
    """裁掉指向不存在对象的 objects/pagination.entries 与哈希失效的 photo_crop。

    Returns:
        None（无需改动）或**新** format_config（调用方与 content 写入同一条 UPDATE）。
    """
    if not isinstance(format_config, dict):
        return None
    result = dict(format_config)
    changed = False
    valid_ids = _content_object_ids(content)

    objects = result.get("objects")
    if isinstance(objects, dict):
        kept = {
            key: value
            for key, value in objects.items()
            if key == "version" or (isinstance(key, str) and key in valid_ids)
        }
        if kept != objects:
            changed = True
            if len(kept) <= 1:  # 只有 version → 空域，整键删除（R3）
                result.pop("objects", None)
            else:
                result["objects"] = kept

    pagination = result.get("pagination")
    if isinstance(pagination, dict):
        entries = pagination.get("entries")
        if isinstance(entries, dict):
            kept_entries = {
                key: value
                for key, value in entries.items()
                if isinstance(key, str) and key in valid_ids
            }
            if kept_entries != entries:
                changed = True
                pruned = dict(pagination)
                if kept_entries:
                    pruned["entries"] = kept_entries
                else:
                    pruned.pop("entries", None)
                if len(pruned) <= 1:  # 只剩 version
                    result.pop("pagination", None)
                else:
                    result["pagination"] = pruned

    photo = content.get("photo") if isinstance(content, dict) else None
    crop = result.get("photo_crop")
    if isinstance(crop, dict):
        source = crop.get("source")
        sha = source.get("sha256") if isinstance(source, dict) else None
        if not isinstance(sha, str) or sha != photo_sha256(
            photo if isinstance(photo, str) else None
        ):
            changed = True
            result.pop("photo_crop", None)

    if not changed:
        return None
    # 域键全部消失时与"从未设置"逐字节等价（其余键与顺序原样保留）。
    return result


__all__ = [
    "DOMAIN_KEYS",
    "RenderOverrides",
    "prune_overrides",
    "render_overrides_css",
    "resolve_render_overrides",
]
