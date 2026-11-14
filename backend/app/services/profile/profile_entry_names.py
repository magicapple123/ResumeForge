# SPDX-License-Identifier: Apache-2.0
"""经历类分区的"筛选前都有谁"清单（从 ``profile_relevance.py`` 纯搬迁）。

为什么独立成模块：``profile_relevance.py`` 贴着 500 行预算；这段逻辑与岗位相关性
排序无关，也不参与测试在 ``profile_relevance`` 模块命名空间上的 monkeypatch
（``build_job_focus`` / ``_select_entries`` / ``_select_skills`` /
``serialize_profile_prompt_data``），因此可以整体搬出、由原模块再导出。
"""

from __future__ import annotations

from typing import Any

# 经历类分区 → 身份字段（判断"是不是同一条"）。键名与 resume_coverage.py 的比对表
# 共用同一套分区名——那边是消费方，两边不能各叫一套。
_IDENTITY_FIELDS: dict[str, str] = {
    "educations": "school",
    "experiences": "company",
    "campus_experiences": "organization",
    "projects": "name",
    "awards": "name",
    # A4 扩展栏目：论文/专利用标题、科研/证照用名称（与 resume_coverage._SECTION_MAP
    # 的身份字段逐字一致）。作品/实践已并入 projects/experiences，不在这里重复登记。
    "publications": "title",
    "research_projects": "name",
    "patents": "title",
    "credentials": "name",
}


def collect_entry_names(
    full: dict[str, Any], sections: tuple[str, ...] | None = None
) -> dict[str, tuple[str, ...]]:
    """筛选前每段经历类分区里"都有谁"（按条目的身份字段）。

    生成结束后，覆盖度检查用它回答"我的某段经历为什么没写进简历"：
    没有这份清单，data 里就只剩被留下来的条目，说不清是"没被选中"还是"模型没写"。

    sections 非空时只登记这些分区（生成链路传参与清单，R-30：诊断只含参与分区）。
    候选里没有该分区键就跳过：旧链路没有 v3 新键，entry_names 的键集合与改动前一致。
    """
    names: dict[str, tuple[str, ...]] = {}
    allowed = set(sections) if sections is not None else None
    for section, field in _IDENTITY_FIELDS.items():
        if allowed is not None and section not in allowed:
            continue
        if section not in full:
            continue
        values: list[str] = []
        for item in full.get(section) or []:
            if isinstance(item, dict):
                value = str(item.get(field) or "").strip()
                if value:
                    values.append(value)
        names[section] = tuple(values)
    return names


__all__ = ["_IDENTITY_FIELDS", "collect_entry_names"]
