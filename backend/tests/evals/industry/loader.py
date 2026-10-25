# SPDX-License-Identifier: Apache-2.0
"""24 份跨行业案例与 `_index.json` 的加载/汇总（runner、report 与测试共用）。

目录约定（沿用 evals/fixtures/synthetic 的做法）：

- `cases/industry_<group-slug>_<density>.json`：一份案例 = 一个 JSON 文件，文件名即 id；
- `cases/_index.json`：维度清单（组/密度/就业状态/事实种类统计 + 虚构姓名与机构清单）。
  它**不是装饰**：`test_industry_matrix.py` 会断言清单与实际文件完全一致——
  维度矩阵、虚构性声明与案例内容不允许长期漂移。

加载失败（JSON 不合法 / schema 校验失败 / id 与文件名不一致）直接抛错，不跳过：
评测集缺一份与坏一份同样严重，快失败才能让 24 案例的计数可信。
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .case_schema import (
    DENSITIES,
    FACT_KINDS,
    INDUSTRY_GROUPS,
    PERSONA_VALUES,
    IndustryCase,
)

INDUSTRY_DIR = Path(__file__).resolve().parent
CASES_DIR = INDUSTRY_DIR / "cases"
INDEX_NAME = "_index.json"
CASE_GLOB = "industry_*.json"
REQUIRED_PER_GROUP = 2
REQUIRED_TOTAL = len(INDUSTRY_GROUPS) * REQUIRED_PER_GROUP


def _case_files(cases_dir: Path | None = None) -> list[Path]:
    return sorted((cases_dir or CASES_DIR).glob(CASE_GLOB))


def load_cases(cases_dir: Path | None = None) -> list[IndustryCase]:
    """加载全部案例并按 id 排序；id 与文件名不一致或 schema 不合法直接抛错。"""
    cases: list[IndustryCase] = []
    for path in _case_files(cases_dir):
        case = IndustryCase.model_validate_json(path.read_text(encoding="utf-8"))
        if case.id != path.stem:
            raise ValueError(f"案例 id 与文件名不一致：{case.id} vs {path.stem}")
        cases.append(case)
    return cases


def load_case(case_id: str, cases_dir: Path | None = None) -> IndustryCase | None:
    path = (cases_dir or CASES_DIR) / f"{case_id}.json"
    if not path.is_file():
        return None
    return IndustryCase.model_validate_json(path.read_text(encoding="utf-8"))


def load_index(cases_dir: Path | None = None) -> dict:
    return json.loads(((cases_dir or CASES_DIR) / INDEX_NAME).read_text(encoding="utf-8"))


def compute_index(cases: list[IndustryCase]) -> dict:
    """从案例内容计算索引；与 `_index.json` 逐键相等是"清单没漂移"的判据。"""
    density_stats = Counter(case.density for case in cases)
    persona_stats = Counter(case.persona for case in cases)
    group_stats = Counter(case.industry_group for case in cases)
    fact_kind_stats: Counter[str] = Counter()
    for case in cases:
        for fact in case.facts:
            fact_kind_stats[fact.kind] += 1
    names: set[str] = set()
    organizations: set[str] = set()
    for case in cases:
        names |= case.person_names()
        organizations |= case.organization_names()
    return {
        "version": 1,
        "total": len(cases),
        "required_per_group": REQUIRED_PER_GROUP,
        "industry_groups": list(INDUSTRY_GROUPS),
        "cases": [
            {
                "id": case.id,
                "industry_group": case.industry_group,
                "density": case.density,
                "persona": case.persona,
                "fact_kinds": sorted(fact.kind for fact in case.facts),
            }
            for case in cases
        ],
        "dimension_stats": {
            "density": {key: density_stats.get(key, 0) for key in DENSITIES},
            "persona": {key: persona_stats.get(key, 0) for key in PERSONA_VALUES},
            "industry_group": {key: group_stats.get(key, 0) for key in INDUSTRY_GROUPS},
            "fact_kind": {key: fact_kind_stats.get(key, 0) for key in FACT_KINDS},
        },
        "fictional_names": sorted(names),
        "fictional_organizations": sorted(organizations),
    }


def cases_by_group(cases: list[IndustryCase]) -> dict[str, dict[str, IndustryCase]]:
    """按 组 → 密度 分桶；测试据此断言每组恰好 sufficient + sparse 各一份。"""
    buckets: dict[str, dict[str, IndustryCase]] = {group: {} for group in INDUSTRY_GROUPS}
    for case in cases:
        buckets[case.industry_group][case.density] = case
    return buckets


__all__ = [
    "CASES_DIR",
    "CASE_GLOB",
    "INDEX_NAME",
    "INDUSTRY_DIR",
    "REQUIRED_PER_GROUP",
    "REQUIRED_TOTAL",
    "cases_by_group",
    "compute_index",
    "load_case",
    "load_cases",
    "load_index",
]
