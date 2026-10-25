# SPDX-License-Identifier: Apache-2.0
"""A4/A9 跨行业 24 案例矩阵：齐全性/维度/纯虚构守卫 + 逐份真实执行。

计划 §9.4 的硬要求：至少 24 个合成场景（§3.2 的 12 行 × 2），**每个案例都要实际
进入确定性检查**；只放样本、没有执行而被 harness 跳过，不算覆盖。因此本文件的
判据不是"文件存在"，而是：

- 'test_each_case_executes_*'（24 个参数化用例）：每份案例逐一跑完四条确定性检查；
- 'test_executed_count_is_24'：available == executed == 24、skipped == 0、失败为 0，
  并把 available/executed/skipped 写进失败信息；
- 'test_report_exposes_*'：runner/report 的汇总结构真的输出这三个计数与缺口清单，
  A8 报告可以直接引用。

其余用例钉住样本库本身：12 组 × 2 密度、十种就业状态全覆盖、九类事实全覆盖、
纯虚构扫描（联系方式保留号段 / example 域名 / 姓名与机构在虚构清单内）、
'_index.json' 与实际文件逐键一致、schema 对坏案例确实会拒绝。
"""
from __future__ import annotations

import inspect
from collections import Counter

import pytest
import report
import runner
from industry import checks as industry_checks
from industry.case_schema import (
    DENSITIES,
    EXTENSION_FACT_KINDS,
    FACT_KINDS,
    INDUSTRY_GROUPS,
    PERSONA_VALUES,
    IndustryCase,
)
from industry.loader import (
    CASES_DIR,
    INDEX_NAME,
    REQUIRED_PER_GROUP,
    REQUIRED_TOTAL,
    cases_by_group,
    compute_index,
    load_cases,
    load_index,
)
from pydantic import ValidationError

CASES = load_cases()
INDEX = load_index()
CASE_IDS = [case.id for case in CASES]


# ===== 样本库守卫：齐全性 / 维度 / 纯虚构 =====


def test_all_24_cases_are_present_and_valid():
    assert len(CASES) == REQUIRED_TOTAL == 24
    assert [case.id for case in CASES] == sorted(case.id for case in CASES)
    assert len(set(CASE_IDS)) == 24
    files = sorted(path.stem for path in CASES_DIR.glob("industry_*.json"))
    assert files == sorted(CASE_IDS), "文件与加载结果不一致（可能有多余/缺失文件）"
    for case in CASES:
        assert case.notes.strip(), f"{case.id} 缺少 notes（需写明最易产生的错误）"
        assert case.id.endswith(("_sufficient", "_sparse"))


def test_matrix_has_two_cases_per_industry_group():
    buckets = cases_by_group(CASES)
    assert list(buckets) == list(INDUSTRY_GROUPS)
    for group, by_density in buckets.items():
        assert set(by_density) == set(DENSITIES), f"{group} 缺少密度案例：{sorted(by_density)}"
    density_stats = Counter(case.density for case in CASES)
    assert dict(density_stats) == {
        "sufficient": REQUIRED_TOTAL // 2,
        "sparse": REQUIRED_TOTAL // 2,
    }


def test_persona_covers_all_ten_employment_statuses():
    stats = Counter(case.persona for case in CASES)
    missing = set(PERSONA_VALUES) - set(stats)
    assert not missing, f"就业状态未覆盖：{sorted(missing)}"
    assert len(stats) >= 10
    assert dict(stats) == INDEX["dimension_stats"]["persona"]


def test_all_nine_fact_kinds_appear_across_cases():
    kind_counter: Counter[str] = Counter()
    for case in CASES:
        kind_counter.update(fact.kind for fact in case.facts)
    missing = set(FACT_KINDS) - set(kind_counter)
    assert not missing, f"九类事实有未覆盖的种类：{sorted(missing)}"
    assert dict(kind_counter) == INDEX["dimension_stats"]["fact_kind"]
    # 每类事实至少出现在两份案例里（同一类事实只靠一份案例兜底太薄）。
    thin = {kind for kind, count in kind_counter.items() if count < 2}
    assert not thin, f"以下事实种类覆盖过薄（<2 份案例）：{sorted(thin)}"


def test_density_contract_matches_plan():
    for case in CASES:
        core_entries = (
            len(case.profile.educations)
            + len(case.profile.experiences)
            + len(case.profile.campus_experiences)
            + len(case.profile.projects)
        )
        kind_counter = Counter(fact.kind for fact in case.facts)
        for kind in EXTENSION_FACT_KINDS:
            assert kind_counter[kind] >= 1, f"{case.id} 缺少扩展事实类型 {kind}"
        legacy_facts = len(case.facts) - sum(kind_counter[kind] for kind in EXTENSION_FACT_KINDS)
        if case.density == "sparse":
            assert 1 <= legacy_facts <= 2, f"{case.id} 稀疏案例原始事实数应为 1–2"
            assert core_entries <= 1, f"{case.id} 稀疏案例核心栏目应 ≤1"
        else:
            assert legacy_facts >= 3, f"{case.id} 充分案例至少 3 条原始事实"
            assert core_entries >= 1 and case.profile.summary.strip()


def test_cases_are_pure_fiction_and_manifested():
    for case in CASES:
        record = industry_checks.scan_fiction(case, INDEX)
        assert record["phones"] == "reserved-only"
        assert record["urls"] == "example-domains-only"
    computed = compute_index(CASES)
    assert computed["fictional_names"] == INDEX["fictional_names"]
    assert computed["fictional_organizations"] == INDEX["fictional_organizations"]
    assert len(INDEX["fictional_names"]) >= 20
    assert len(INDEX["fictional_organizations"]) >= 30


def test_index_matches_actual_case_files():
    computed = compute_index(CASES)
    for key, value in computed.items():
        assert INDEX[key] == value, f"_index.json 的 {key} 与实际文件不一致（改案例后未重算？）"
    assert INDEX["total"] == REQUIRED_TOTAL
    assert INDEX["required_per_group"] == REQUIRED_PER_GROUP
    assert INDEX["industry_groups"] == list(INDUSTRY_GROUPS)
    assert INDEX.get("description")
    on_disk = CASES_DIR / INDEX_NAME
    assert on_disk.is_file()


# ===== 逐份真实执行（不允许跳过）=====


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_each_case_executes_all_deterministic_checks(case: IndustryCase):
    result = industry_checks.run_case(case)
    assert result["executed"] is True
    assert result["skipped"] is False
    assert set(result["checks"]) == set(industry_checks.CHECK_ORDER), (
        f"{case.id} 没有执行全部检查：{sorted(result['checks'])}"
    )
    failures = [
        f"{check_id}: {outcome['detail']}"
        for check_id, outcome in result["checks"].items()
        if not outcome["passed"]
    ]
    assert not failures, f"[{case.id}] 确定性检查失败：{failures}"
    for check_id, outcome in result["checks"].items():
        assert outcome["passed"] is True, f"[{case.id}] {check_id} 未通过"
    # 负例检出：除"极端稀疏无旧五栏条目"外，可捕获错误必须全部命中。
    probes = {
        probe["id"]: probe
        for probe in result["checks"]["rule_negative"]["metrics"]["probes"]
    }
    assert {"fabricated_number", "responsibility_inflation", "prompt_injection",
            "contact_privacy"} <= set(probes)
    for probe_id in ("fabricated_number", "responsibility_inflation", "prompt_injection",
                     "contact_privacy"):
        assert probes[probe_id]["caught"] is True
    assert set(result["gaps"]) == set(industry_checks.KNOWN_RULE_GAPS)
    assert result["gaps"]
    # 检查不是空转：每条检查都产出了针对本案例的真实计数/探针。
    retention = result["checks"]["fact_retention"]["metrics"]
    assert retention["facts"] == len(case.facts)
    assert sum(retention["sections"].values()) >= len(case.facts)
    candidate = result["checks"]["candidate_paths"]["metrics"]
    assert candidate["general_chars"] > 0 and candidate["targeted_chars"] > 0
    pipeline = result["checks"]["simulated_pipeline"]["metrics"]
    assert sum(pipeline["sections"].values()) >= len(case.facts)
    probes = result["checks"]["rule_negative"]["metrics"]["probes"]
    assert len(probes) >= 6


def test_deliberately_broken_case_is_detected_by_execution():
    """反空转：把 must_appear 改成案例里不存在的词，执行必须报错而不是继续全绿。"""
    base = next(case for case in CASES if case.density == "sufficient")
    broken_expected = base.expected.model_copy(
        update={"must_appear": ["这个关键词在任何资料里都不存在"]}
    )
    broken = base.model_copy(update={"expected": broken_expected})
    result = industry_checks.run_case(broken)
    assert result["executed"] is True and result["skipped"] is False
    assert result["findings"], "故意改坏的案例没有被任何检查捕获，executed==24 的绿灯是空的"
    assert any("simulated_pipeline" in finding for finding in result["findings"])


def test_executed_count_is_24_with_available_and_skipped_in_message():
    results = runner.evaluate_industry_cases()
    counts = industry_checks.executed_counts(results)
    message = (
        f"available={counts['available']} executed={counts['executed']} "
        f"skipped={counts['skipped']} failed={counts['failed']}"
    )
    assert counts["available"] == REQUIRED_TOTAL, message
    assert counts["executed"] == REQUIRED_TOTAL, message
    assert counts["skipped"] == 0, message
    assert counts["failed"] == 0, message
    summary = report.summarize_industry(results)
    assert summary["available"] == 24
    assert summary["executed"] == 24
    assert summary["skipped"] == 0
    assert summary["failed_cases"] == 0


def test_report_exposes_counts_findings_and_gaps():
    results = runner.evaluate_industry_cases()
    summary = report.summarize_industry(results)
    assert runner.summarize_industry_execution(results) == industry_checks.executed_counts(results)
    for check_id in industry_checks.CHECK_ORDER:
        stats = summary["checks"][check_id]
        assert stats["executed"] == REQUIRED_TOTAL
        assert stats["failed"] == 0
    assert summary["rule_gaps"] == {
        "status_upgrade": REQUIRED_TOTAL,
        "credential_number_leak": REQUIRED_TOTAL,
    }
    assert set(summary["rule_gaps"]) <= set(industry_checks.KNOWN_RULE_GAPS)
    assert set(summary["integration_gaps"]) <= set(industry_checks.KNOWN_INTEGRATION_GAPS)
    text = report.format_industry_report(summary)
    assert "available 24" in text
    assert "executed 24" in text
    assert "skipped 0" in text
    for gap_id in industry_checks.KNOWN_RULE_GAPS:
        assert gap_id in text, f"报告未列出已知规则缺口 {gap_id}"


def test_known_negative_gaps_are_recorded_for_every_case():
    results = runner.evaluate_industry_cases()
    for result in results:
        probes = {
            probe["id"]: probe
            for probe in result["checks"]["rule_negative"]["metrics"]["probes"]
        }
        for gap_id in industry_checks.KNOWN_RULE_GAPS:
            assert probes[gap_id]["caught"] is False
            assert probes[gap_id]["gap"] == gap_id
    summary = report.summarize_industry(results)
    assert summary["rule_gaps"] == {
        "status_upgrade": REQUIRED_TOTAL,
        "credential_number_leak": REQUIRED_TOTAL,
    }


def test_integration_gaps_are_documented_not_silent():
    detected = industry_checks.detect_integration_gaps()
    unknown = set(detected) - set(industry_checks.KNOWN_INTEGRATION_GAPS)
    assert not unknown, f"出现未登记的生产集成缺口：{sorted(unknown)}"
    results = runner.evaluate_industry_cases()
    summary = report.summarize_industry(results)
    assert summary["integration_gaps"] == detected
    assert report.format_industry_report(summary)


def test_candidate_paths_are_real_production_paths():
    """防止"用一段假 JSON 冒充候选路径"：两条路径必须真的来自生产函数。"""
    results = runner.evaluate_industry_cases()
    for result in results:
        metrics = result["checks"]["candidate_paths"]["metrics"]
        assert metrics["general_chars"] > 0
        assert metrics["targeted_chars"] > 0
    assert inspect.signature(
        industry_checks.build_targeted_profile_context
    ).parameters.get("fact_sections") is not None


# ===== schema 反例：坏案例必须被拒绝，而不是静默进评测集 =====


def _raw_case(case_id: str) -> dict:
    for case in CASES:
        if case.id == case_id:
            return case.model_dump(mode="json")
    raise AssertionError(f"找不到案例 {case_id}")


def test_schema_rejects_sparse_case_with_too_many_facts():
    raw = _raw_case("industry_software-data-product_sparse")
    raw["facts"].append(raw["facts"][0])
    with pytest.raises(ValidationError):
        IndustryCase.model_validate(raw)


def test_schema_rejects_credential_number_mismatch():
    raw = _raw_case("industry_software-data-product_sufficient")
    raw["expected"]["credential_number"] = "CERT-OTHER-0000-0000"
    with pytest.raises(ValidationError):
        IndustryCase.model_validate(raw)


def test_schema_rejects_unknown_persona_and_group():
    raw = _raw_case("industry_software-data-product_sufficient")
    raw["persona"] = "霸道总裁"
    with pytest.raises(ValidationError):
        IndustryCase.model_validate(raw)
    raw = _raw_case("industry_software-data-product_sufficient")
    raw["industry_group"] = "不存在的行业"
    with pytest.raises(ValidationError):
        IndustryCase.model_validate(raw)


def test_schema_rejects_status_claim_that_upgrades_itself():
    raw = _raw_case("industry_software-data-product_sufficient")
    claim = raw["expected"]["status_claims"][0]
    claim["status"] = claim["upgraded_values"][0] if claim["upgraded_values"] else "published"
    with pytest.raises(ValidationError):
        IndustryCase.model_validate(raw)
