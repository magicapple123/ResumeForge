# SPDX-License-Identifier: Apache-2.0
"""RF-15 已知幻觉负例回归：手写坏输出必须被对应规则捕获。

`recordings/_known_bad/` 下每份文件是一段"曾经真实出现过的坏输出形态"的手写
复刻（杜撰金额、职责夸大、隐私泄露、待补残留、注入透传、时间矛盾、边界违背、
事实遗漏）。任何规则改动导致其中一条漏判，即已知幻觉负例回归，直接变红。
"""
from __future__ import annotations

import json
from pathlib import Path

import checks
import pytest
from runner import KNOWN_BAD_DIR, Recording, evaluate_sample, load_sample


def _known_bad_files() -> list[Path]:
    return sorted(KNOWN_BAD_DIR.glob("kb_*.json"))


def test_known_bad_corpus_exists_and_covers_all_rules():
    files = _known_bad_files()
    assert len(files) >= 6, "已知坏输出负例不足 6 份"
    expected_rules: set[str] = set()
    for path in files:
        raw = json.loads(path.read_text(encoding="utf-8"))
        expected_rules.update(raw["meta"]["expected_rules"])
    assert expected_rules == set(checks.RULE_ORDER), "负例必须覆盖全部规则各至少一条"


@pytest.mark.parametrize("path", _known_bad_files(), ids=lambda p: p.stem)
def test_known_bad_is_caught_by_expected_rules(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    sample = load_sample(raw["case_id"])
    assert sample is not None, f"负例 {path.stem} 指向不存在的样本 {raw['case_id']}"
    recording = Recording(
        output_text=raw["output_text"],
        prompt_version=raw["meta"]["prompt_version"],
        model=raw["meta"]["model"],
        generated_at=raw["meta"]["generated_at"],
    )
    result = evaluate_sample(sample, recording)
    rule_ids = {finding["rule_id"] for finding in result["findings"]}
    for expected in raw["meta"]["expected_rules"]:
        assert expected in rule_ids, (
            f"{path.stem}：规则 {expected} 未捕获已知坏输出——已知幻觉负例回归！\n"
            f"实际发现：{sorted(rule_ids)}"
        )


@pytest.mark.parametrize("path", _known_bad_files(), ids=lambda p: p.stem)
def test_known_bad_records_provenance_meta(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    meta = raw["meta"]
    assert meta["prompt_version"]
    assert meta["model"]
    assert meta["generated_at"]
    assert raw["case_id"].startswith("synthetic_")
