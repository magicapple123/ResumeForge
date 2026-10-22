# SPDX-License-Identifier: Apache-2.0
"""SLO 判定与测点清单：测点模板、百分位、路由存在性、阈值判定、退出码。

搬迁自 ``scripts/measure_api_perf.py`` 第 68–89 行（测点清单 + SLO 口径）与第 92–184 行
（6 个纯函数）。这些函数不碰文件系统、不导入 app，可被单元测试直接调用。
"""

from __future__ import annotations

import math
from typing import Any

# ---------------------------------------------------------------------------
# 测点清单：与 backend/app/api 实际注册的路由一一对应（配套测试
# tests/test_perf_measure_api.py::test_endpoint_routes_registered 用
# FastAPI 路由表钉住每个路径，404/改路由会让测试变红）。
# ``{knowledge_term}`` / ``{job_term}`` 在运行时用被测库里的真实数据填充，
# 保证搜索端点真正命中（而不是测一个空结果集的固定字符串）。
# ---------------------------------------------------------------------------
ENDPOINT_TEMPLATES: list[tuple[str, str, str]] = [
    ("GET", "/api/jobs?page=1&page_size=20", "job_list_page"),
    ("GET", "/api/resumes?page=1&page_size=20", "resume_list_page"),
    ("GET", "/api/tracker/page?page_size=20", "tracker_page"),
    ("GET", "/api/tracker/stats", "tracker_stats"),
    ("GET", "/api/candidate-jobs/page?page=1&page_size=20", "candidate_jobs_page"),
    ("GET", "/api/knowledge/page?page=1&page_size=20", "knowledge_page"),
    ("GET", "/api/knowledge/page?page=1&page_size=20&q={knowledge_term}", "knowledge_search"),
    ("GET", "/api/search?q={job_term}", "global_search"),
    ("GET", "/api/stats", "stats"),
]

# SLO 口径（§3.3）：普通列表类端点 p95 ≤ 300ms。这是目标值不是现状声明；
# 超限即 FAILED + 退出非零。所有端点默认同一条阈值，--slo-p95-ms 可整体放宽。
DEFAULT_SLO_P95_MS = 300.0


# ---------------------------------------------------------------------------
# 纯函数助手（模块导入无副作用，可被单元测试直接调用）。
# ---------------------------------------------------------------------------
def percentile_nearest_rank(sorted_values: list[float], pct: float) -> float:
    """最近邻秩百分位：30 个样本的 p95 = 第 ceil(0.95*30)=29 个值。"""
    if not sorted_values:
        raise ValueError("percentile_nearest_rank needs a non-empty sample list")
    rank = max(1, math.ceil(pct / 100 * len(sorted_values)))
    return sorted_values[rank - 1]


def classify_detail(detail: str) -> str:
    """把 EXPLAIN QUERY PLAN 的 detail 归类成可读标记。"""
    if "TEMP B-TREE" in detail:
        return "临时排序"
    if "SCALAR SUBQUERY" in detail or "SUBQUERY" in detail:
        return "子查询"
    if "SCAN" in detail:
        return "全表扫描（经索引）" if "USING" in detail else "全表扫描"
    if "SEARCH" in detail:
        return "索引命中" if "USING" in detail else "检索"
    return "其他"


def route_exists(app: Any, method: str, path: str) -> bool:
    """路径（可带 query string）是否命中 app 上真实注册的某条路由。

    用来钉住测点清单与路由注册的一致性：端点改名/删除后，测量脚本不该
    把 404 悄悄记成一个"样本"。判定来源用 **OpenAPI schema**（``app.openapi()``
    的 paths 表）：它是 FastAPI 从真实路由注册表派生的权威清单，不受路由
    包装形态影响（本仓库新版 FastAPI 把 ``include_router`` 包成
    ``_IncludedRouter``，静态遍历 ``app.router.routes`` 会漏掉嵌套聚合路由，
    2026-10-13 实测 ``GET /api/resumes`` 就漏了）。schema 由 FastAPI 内部缓存，
    反复调用无额外开销。
    """
    clean_path = path.split("?", 1)[0].rstrip("/") or "/"
    entry = (app.openapi().get("paths") or {}).get(clean_path)
    if not entry:
        return False
    return method.lower() in {key.lower() for key in entry}


def resolve_endpoints(terms: dict[str, str]) -> list[dict[str, str]]:
    """把测点模板里的搜索词占位符填上被测库的真实数据。"""
    resolved: list[dict[str, str]] = []
    for method, template, name in ENDPOINT_TEMPLATES:
        url = template.format(
            knowledge_term=terms.get("knowledge", ""),
            job_term=terms.get("job", ""),
        )
        resolved.append({"method": method, "url": url, "name": name})
    return resolved


def evaluate_slo(
    results: list[dict[str, Any]], default_p95_ms: float = DEFAULT_SLO_P95_MS
) -> list[dict[str, Any]]:
    """对照 SLO 阈值逐端点判定；测量出错也判 FAILED（不许静默漏过）。"""
    verdicts: list[dict[str, Any]] = []
    for result in results:
        threshold = float(result.get("slo_p95_ms", default_p95_ms))
        if "error" in result:
            verdicts.append(
                {
                    "name": result.get("name", result.get("url", "?")),
                    "url": result.get("url", ""),
                    "status": "failed",
                    "p95_ms": None,
                    "threshold_ms": threshold,
                    "detail": f"测量失败: {result['error']}",
                }
            )
            continue
        p95 = result["p95_ms"]
        status = "passed" if p95 <= threshold else "failed"
        verdicts.append(
            {
                "name": result["name"],
                "url": result["url"],
                "status": status,
                "p95_ms": p95,
                "threshold_ms": threshold,
                "detail": ""
                if status == "passed"
                else f"p95 {p95:.1f}ms 超过阈值 {threshold:.0f}ms",
            }
        )
    return verdicts


def exit_code_for(verdicts: list[dict[str, Any]]) -> int:
    """SLO 全过且无测量错误 → 0；任何 FAILED → 1（fail-closed）。"""
    return 0 if all(v["status"] == "passed" for v in verdicts) else 1
