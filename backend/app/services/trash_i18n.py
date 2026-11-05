# SPDX-License-Identifier: Apache-2.0
"""回收站副标题的英文本案（en-US 界面专用）。

``material.category`` 是**协议值**（``证书 / 作品 / 链接 / 校园材料 / 笔记 / 其他``）：
资料箱页面按这个值查语言包，翻库里的值会让分类筛选与图标一起失效。但回收站把同一个值
当**副标题**直接渲染，英文界面就会冒出一行中文。所以翻译只发生在展示出口：中文值进来、
英文标签出去，库里的值一个字都不动。

放在独立模块是为了守住 ``services/trash.py`` 的行数预算（498 行），与
``claims_i18n.py`` 同一模式。
"""

from __future__ import annotations

# 资料箱分类（``material.category``）的中 -> 英。键是协议值。
MATERIAL_CATEGORY_LABELS_EN: dict[str, str] = {
    "证书": "Certificates",
    "作品": "Work samples",
    "链接": "Links",
    "校园材料": "Campus material",
    "笔记": "Notes",
    "其他": "Other",
}


def material_subtitle(category: str) -> str:
    """资料箱条目的副标题：已知分类给英文标签，未知值原样返回。"""
    return MATERIAL_CATEGORY_LABELS_EN.get(category, category)
