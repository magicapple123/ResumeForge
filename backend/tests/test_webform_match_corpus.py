"""匹配语料回归：真实页面 case 的期望映射、错填为零与基线门槛。

语料与跑分实现见 ``webform_corpus_support.py``；人读报告用
``scripts/webform_match_report.py``。新增 / 修改 case 的流程：先在报告里确认
数字无误，再用 ``--update-baseline`` 更新 ``fixtures/webform/baseline.json``，
两者一起提交。基线是**单调门槛**（correct 不许降、missing 不许升），不是快照。
"""
from __future__ import annotations

import pytest

from webform_corpus_support import (
    FIXTURES_DIR,
    PAGES_DIR,
    desensitization_violations,
    format_details,
    load_baseline,
    load_match_cases,
    run_match_case,
)

CASES = load_match_cases()
CASE_IDS = [str(case["id"]) for case in CASES]
BASELINE = load_baseline()["cases"]

_ALL_FIXTURE_FILES = sorted(PAGES_DIR.glob("*.json")) + sorted(
    (FIXTURES_DIR / "execution").glob("*.json")
)


def test_corpus_is_not_empty_and_ids_are_unique():
    assert CASES, "语料为空：tests/fixtures/webform/pages/ 下没有 case"
    assert len(CASE_IDS) == len(set(CASE_IDS)), f"case id 有重复：{CASE_IDS}"


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_match_case_meets_expectations(case):
    """错填必须为零；基线内的 case 不许低于基线，新 case 必须完全正确。"""
    result = run_match_case(case)
    assert result.wrong == 0, f"{result.case_id} 出现错填：\n{format_details(result)}"

    baseline = BASELINE.get(result.case_id)
    if baseline is None:
        assert not result.missing, (
            f"{result.case_id} 尚未立基线，但存在漏填（立基线前必须全部对上）：\n"
            f"{format_details(result)}"
        )
        return
    assert result.correct >= baseline["correct"], (
        f"{result.case_id} 正确映射从基线 {baseline['correct']} 降到 {result.correct}：\n"
        f"{format_details(result)}"
    )
    assert len(result.missing) <= baseline["missing"], (
        f"{result.case_id} 漏填从基线 {baseline['missing']} 升到 {len(result.missing)}：\n"
        f"{format_details(result)}"
    )


def test_baseline_file_exists():
    """基线文件是回归门槛的数据源，不许丢失（新增 case 单独放行）。"""
    assert BASELINE, "baseline.json 缺失或为空——请跑 scripts/webform_match_report.py --update-baseline"


def test_case_schema_is_complete():
    for case in CASES:
        assert not case.get("draft"), (
            f"{case['id']} 还是采集脚本生成的草稿（draft: true）："
            "补全 profile/expect、填上来源后删掉 draft 字段"
        )
        assert case.get("controls"), f"{case['id']} 缺 controls"
        assert case.get("profile") is not None, f"{case['id']} 缺 profile"
        for item in case["expect"].get("mappings", []):
            assert "field" in item and "index" in item, f"{case['id']} 的 mappings 条目缺 field/index"


@pytest.mark.parametrize("path", _ALL_FIXTURE_FILES, ids=lambda path: path.name)
def test_fixture_files_are_desensitized(path):
    """语料只允许出现明显合成的手机号 / 邮箱（example.* 域），不得夹带真实个人数据。"""
    violations = desensitization_violations(path.read_text(encoding="utf-8"))
    assert not violations, f"{path.name} 疑似含真实个人数据：{violations}"
