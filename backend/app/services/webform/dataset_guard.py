# SPDX-License-Identifier: Apache-2.0
"""示例数据集不得参与真实填表（台账第 11 条 A 部分）。

「体验示例」是纯虚构数据：它存在的意义是让新用户每个页面都有内容可看，而不是当真实
资料填进公司的网申系统。示例数据的来源标记是 sidecar 里的 ``source == "sample"``
（见 ``services/sample_dataset.py`` 与 ``services/datasets_admin.py`` 的 ``_SOURCE_CODES``）。

判据抽成纯函数，API 层（``api/webform/live_routes.py`` 的 start、
``api/webform/fill_routes.py`` 的 preview）只负责把结论翻成 409，单测直接打这里。

只拦 ``sample``：主数据、新建、导入、随备份包导入的数据集行为一律不变；历史数据集
没有 sidecar（``read_metadata`` 返回 ``{}``）同样放行——认不出就不拦。
"""

from __future__ import annotations

from ...dataset_registry import read_active_dataset_id, read_metadata

SAMPLE_SOURCE = "sample"

# 409 的唯一文案：前端页内提示复用这一句，别在别处再编一个版本。
SAMPLE_FILL_BLOCKED_DETAIL = "当前是体验示例数据集，示例数据不参与真实填表；请切换到自己的数据集"


def dataset_blocks_fill(metadata: dict | None) -> bool:
    """元信息来源是示例时返回 True；空/缺失/其它来源一律 False。"""
    return str((metadata or {}).get("source") or "").strip().lower() == SAMPLE_SOURCE


def active_dataset_blocks_fill() -> bool:
    """当前激活的数据集是不是示例数据集。"""
    return dataset_blocks_fill(read_metadata(read_active_dataset_id()))


__all__ = [
    "SAMPLE_FILL_BLOCKED_DETAIL",
    "SAMPLE_SOURCE",
    "active_dataset_blocks_fill",
    "dataset_blocks_fill",
]
