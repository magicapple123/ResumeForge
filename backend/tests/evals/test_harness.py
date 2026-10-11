"""RF-15 执行器与汇总的单测：跳过逻辑、聚合正确性、基线对比。

全部用 tmp_path 注入录制目录，不写仓库内任何路径（并行安全）。
"""
from __future__ import annotations

import json

import report
from runner import (
    Recording,
    evaluate_all,
    evaluate_sample,
    load_recording,
    load_sample,
)


def _write_recording(directory, case_id: str, output_text: str) -> None:
    payload = {
        "case_id": case_id,
        "output_text": output_text,
        "meta": {
            "prompt_version": "test-v1",
            "model": "fake-model",
            "generated_at": "2026-10-10T00:00:00",
        },
    }
    (directory / f"{case_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def test_load_recording_missing_returns_none(tmp_path):
    assert load_recording("synthetic_001", tmp_path) is None


def test_load_recording_parses_output_and_meta(tmp_path):
    _write_recording(tmp_path, "synthetic_001", "正文内容")
    recording = load_recording("synthetic_001", tmp_path)
    assert recording is not None
    assert recording.output_text == "正文内容"
    assert recording.prompt_version == "test-v1"
    assert recording.model == "fake-model"


def test_evaluate_all_skips_everything_without_recordings():
    results = evaluate_all(recordings_dir=None)
    assert len(results) == 50
    assert all(r["skipped"] for r in results)
    assert all(r["findings"] == [] for r in results)


def test_evaluate_all_runs_rules_on_recorded_cases(tmp_path):
    clean = (
        "张伟\n求职意向：后端开发工程师\n"
        "- 参与校园二手交易平台建设，完成订单服务接口联调。\n技能：Python。"
    )
    _write_recording(tmp_path, "synthetic_001", clean)
    _write_recording(
        tmp_path, "synthetic_002", "完成订单服务接口联调，节省成本300万元。\n技能：Python。"
    )
    results = evaluate_all(recordings_dir=tmp_path)
    by_id = {r["sample_id"]: r for r in results}
    assert len(results) == 50
    assert not by_id["synthetic_001"]["skipped"]
    assert by_id["synthetic_001"]["findings"] == []
    assert not by_id["synthetic_002"]["skipped"]
    assert by_id["synthetic_002"]["meta"]["model"] == "fake-model"
    rule_ids = {f["rule_id"] for f in by_id["synthetic_002"]["findings"]}
    assert "fact_addition" in rule_ids
    # 未录制的样本全部跳过，不报错、不联网。
    assert by_id["synthetic_003"]["skipped"]


def test_summarize_counts_matrix_and_pass_rate(tmp_path):
    _write_recording(tmp_path, "synthetic_001", "干净正文，完成订单服务接口联调。技能：Python。")
    _write_recording(
        tmp_path, "synthetic_002", "节省成本300万元，完成订单服务接口联调。技能：Python。"
    )
    results = evaluate_all(recordings_dir=tmp_path)
    summary = report.summarize(results)
    assert summary["total"] == 50
    assert summary["evaluated"] == 2
    assert summary["skipped"] == 48
    assert summary["clean"] == 1
    assert summary["pass_rate"] == 0.5
    assert summary["findings_by_rule"] == {"fact_addition": 1}
    assert summary["matrix"] == {"synthetic_002": {"fact_addition": 1}}
    assert summary["scoring"] == "rules-only"


def test_format_report_mentions_matrix_and_scoring_note(tmp_path):
    _write_recording(tmp_path, "synthetic_002", "节省成本300万元，完成订单服务接口联调。")
    summary = report.summarize(evaluate_all(recordings_dir=tmp_path))
    text = report.format_report(summary)
    assert "RF-15" in text
    assert "fact_addition: 1" in text
    assert "synthetic_002" in text
    assert "模型辅助评分属后续项" in text


def test_compare_with_baseline_detects_regression_and_improvement():
    baseline = {"findings_by_rule": {"fact_addition": 3, "privacy_leak": 2}}
    current = {"findings_by_rule": {"fact_addition": 5, "privacy_leak": 0}}
    comparison = report.compare_with_baseline(current, baseline)
    assert comparison["has_regression"] is True
    assert comparison["regressions"] == {"fact_addition": {"baseline": 3, "current": 5}}
    assert comparison["improvements"] == {"privacy_leak": {"baseline": 2, "current": 0}}


def test_compare_with_baseline_no_regression_when_equal_or_better():
    baseline = {"findings_by_rule": {"fact_addition": 3}}
    current = {"findings_by_rule": {"fact_addition": 2}}
    comparison = report.compare_with_baseline(current, baseline)
    assert comparison["has_regression"] is False
    assert comparison["regressions"] == {}


def test_evaluate_sample_uses_all_rules_on_recording():
    sample = load_sample("synthetic_001")
    assert sample is not None
    result = evaluate_sample(
        sample, Recording(output_text="独立负责数据库运维与值班，完成订单服务接口联调。")
    )
    rule_ids = {f["rule_id"] for f in result["findings"]}
    assert "boundary_violation" in rule_ids
    assert result["meta"]["prompt_version"] == "unknown"
