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
