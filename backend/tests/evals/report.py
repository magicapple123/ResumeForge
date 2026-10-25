# SPDX-License-Identifier: Apache-2.0
"""RF-15 评测结果汇总：规则 × 样本矩阵、通过率、与基线的回归对比。

汇总只做确定性的计数与对比，不做任何模型评分。矩阵与通过率供人工判读；
``compare_with_baseline`` 是提示词/规则变更前后对比的核心：当前批次的
逐规则发现数**多于**基线即记为回归（regression），少于记为改善（improved）。
"""
from __future__ import annotations

from collections import Counter


def summarize(results: list[dict]) -> dict:
    """把 evaluate_all 的结果汇总成可比较的结构。

    - ``findings_by_rule``：每条规则的发现总数；
    - ``matrix``：样本 × 规则的发现计数（只含有发现的格子）；
    - ``pass_rate``：干净样本数 / 已评测样本数（跳过的不进分母）。
    """
    evaluated = [r for r in results if not r.get("skipped")]
    skipped = len(results) - len(evaluated)
    findings_by_rule: Counter[str] = Counter()
    matrix: dict[str, dict[str, int]] = {}
    clean = 0
    for result in evaluated:
        count_by_rule = Counter(f["rule_id"] for f in result["findings"])
        if count_by_rule:
            matrix[result["sample_id"]] = dict(count_by_rule)
        else:
            clean += 1
        findings_by_rule.update(count_by_rule)
    return {
        "total": len(results),
        "evaluated": len(evaluated),
        "skipped": skipped,
        "clean": clean,
        "pass_rate": round(clean / len(evaluated), 4) if evaluated else None,
        "findings_by_rule": dict(sorted(findings_by_rule.items())),
        "matrix": dict(sorted(matrix.items())),
        # 规则门禁全部为确定性判据；模型辅助评分属后续项，不进本汇总。
        "scoring": "rules-only",
    }


def format_report(summary: dict, title: str = "RF-15 离线评测报告") -> str:
    """渲染成可直接贴到交付说明/评审里的多行文本。"""
    lines = [f"# {title}", ""]
    lines.append(
        f"样本：{summary['total']}（已评测 {summary['evaluated']}，"
        f"无录制跳过 {summary['skipped']}）"
    )
    if summary["pass_rate"] is not None:
        lines.append(f"干净样本：{summary['clean']}（通过率 {summary['pass_rate']:.1%}）")
    lines.append("")
    lines.append("逐规则发现数：")
    if summary["findings_by_rule"]:
        for rule_id, count in summary["findings_by_rule"].items():
            lines.append(f"  - {rule_id}: {count}")
    else:
        lines.append("  （无）")
    if summary["matrix"]:
        lines.append("")
        lines.append("规则 × 样本矩阵（仅列出有发现的样本）：")
        for sample_id, by_rule in summary["matrix"].items():
            cells = ", ".join(f"{rule}×{count}" for rule, count in sorted(by_rule.items()))
            lines.append(f"  - {sample_id}: {cells}")
    lines.append("")
    lines.append("说明：模型辅助评分属后续项；当前汇总只含确定性规则门禁结果。")
    return "\n".join(lines)


def compare_with_baseline(current: dict, baseline: dict) -> dict:
    """与基线汇总对比：逐规则发现数增多即回归，减少即改善。

    基线里出现而当前批次没有的规则视为改善到 0；当前批次新增的规则
    （基线没有）直接按当前计数判断。
    """
    rule_ids = sorted(set(current["findings_by_rule"]) | set(baseline["findings_by_rule"]))
    regressions = {}
    improvements = {}
    for rule_id in rule_ids:
        now = current["findings_by_rule"].get(rule_id, 0)
        base = baseline["findings_by_rule"].get(rule_id, 0)
        if now > base:
            regressions[rule_id] = {"baseline": base, "current": now}
        elif now < base:
            improvements[rule_id] = {"baseline": base, "current": now}
    return {
        "regressions": dict(sorted(regressions.items())),
        "improvements": dict(sorted(improvements.items())),
        "has_regression": bool(regressions),
    }

# ===== 行业矩阵汇总（A4/A9，计划 §9.4）=====
#
# 与 summarize（录制回放）刻意分开：行业案例没有 skipped 这一说，available 必须
# 等于 executed；报告要同时列 available/executed/skipped 与失败明细（计划 §9.4），
# 以及"现有规则捕获不到的已知缺口"（不掩盖、供 A8 报告引用）。


def summarize_industry(results: list[dict]) -> dict:
    """把 evaluate_industry_cases 的结果汇总成 A8 报告可引用的结构。"""
    available = len(results)
    executed = sum(1 for item in results if item.get("executed") and not item.get("skipped"))
    skipped = sum(1 for item in results if item.get("skipped"))
    check_stats: dict[str, dict[str, int]] = {}
    findings: list[dict] = []
    passed_cases = 0
    for item in results:
        case_failed = False
        for check_id, outcome in (item.get("checks") or {}).items():
            stats = check_stats.setdefault(check_id, {"executed": 0, "passed": 0, "failed": 0})
            stats["executed"] += 1
            if outcome.get("passed"):
                stats["passed"] += 1
            else:
                stats["failed"] += 1
                case_failed = True
                findings.append(
                    {
                        "case_id": item.get("case_id", ""),
                        "check": check_id,
                        "detail": outcome.get("detail", ""),
                    }
                )
        if not case_failed:
            passed_cases += 1
    rule_gaps: dict[str, int] = {}
    for item in results:
        for gap in item.get("gaps") or []:
            rule_gaps[gap] = rule_gaps.get(gap, 0) + 1
    integration_gaps: dict[str, str] = {}
    for item in results:
        integration_gaps.update(item.get("integration_gaps") or {})
    return {
        "total": available,
        "available": available,
        "executed": executed,
        "skipped": skipped,
        "failed_cases": available - passed_cases if available else 0,
        "passed_cases": passed_cases,
        "pass_rate": round(passed_cases / available, 4) if available else None,
        "checks": dict(sorted(check_stats.items())),
        "findings": findings,
        "rule_gaps": dict(sorted(rule_gaps.items())),
        "integration_gaps": dict(sorted(integration_gaps.items())),
        "cases": [
            {
                "case_id": item.get("case_id", ""),
                "industry_group": item.get("industry_group", ""),
                "density": item.get("density", ""),
                "persona": item.get("persona", ""),
                "passed": not item.get("findings"),
            }
            for item in results
        ],
        "scoring": "deterministic-checks",
    }


def format_industry_report(summary: dict) -> str:
    """渲染成可直接贴进 A8 交付报告的文本（含 available/executed/skipped）。"""
    lines = ["# A4/A9 跨行业 24 案例执行报告", ""]
    lines.append(
        f"案例：available {summary['available']}，executed {summary['executed']}，"
        f"skipped {summary['skipped']}（要求 executed == available == 24）"
    )
    if summary.get("pass_rate") is not None:
        lines.append(
            f"通过：{summary['passed_cases']}/{summary['available']}"
            f"（通过率 {summary['pass_rate']:.1%}；失败案例 {summary['failed_cases']}）"
        )
    lines.append("")
    lines.append("逐检查执行数：")
    for check_id, stats in (summary.get("checks") or {}).items():
        lines.append(
            f"  - {check_id}: executed {stats['executed']}，passed {stats['passed']}，"
            f"failed {stats['failed']}"
        )
    if summary.get("findings"):
        lines.append("")
        lines.append("失败明细：")
        for finding in summary["findings"]:
            lines.append(f"  - {finding['case_id']} / {finding['check']}: {finding['detail']}")
    lines.append("")
    lines.append("已知规则缺口（现有检查捕获不到，报告列明，不用 xfail 掩盖）：")
    if summary.get("rule_gaps"):
        for gap_id, count in (summary.get("rule_gaps") or {}).items():
            lines.append(f"  - {gap_id}: {count} 份案例记录")
    else:
        lines.append("  （无）")
    if summary.get("integration_gaps"):
        lines.append("")
        lines.append("生产集成缺口（待对应 agent 修复后自动消失）：")
        for gap_id, description in (summary.get("integration_gaps") or {}).items():
            lines.append(f"  - {gap_id}: {description}")
    lines.append("")
    lines.append("说明：全部判据为确定性检查（不调模型）；executed==24 即 A4 退出证据。")
    return "\n".join(lines)

