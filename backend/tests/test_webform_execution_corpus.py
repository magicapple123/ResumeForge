"""执行语料回归：写入 → 回读 → 结果分类的脚本化场景。

每条语料（``fixtures/webform/execution/*.json``）自带一份**有序调用脚本**：
第 N 次 evaluate 必须命中脚本第 N 条，跑完必须一条不剩。所以这里同时钉住了
两件事——结果分类（filled / unverified / ...）与调用序列本身（写几次、回读几次、
有没有多余的点击）。恢复/重试类改动要在这里留出前后对照。
"""
from __future__ import annotations

import pytest
from webform_engine_support import load_execution_cases, run_execution_case

CASES = load_execution_cases()
CASE_IDS = [str(case["id"]) for case in CASES]


def test_execution_corpus_is_not_empty_and_ids_are_unique():
    assert CASES, "执行语料为空：tests/fixtures/webform/execution/ 下没有 case"
    assert len(CASE_IDS) == len(set(CASE_IDS)), f"case id 有重复：{CASE_IDS}"


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_execution_case_matches_expectations(case):
    outcomes, client = run_execution_case(case)
    by_field: dict[str, list] = {}
    for outcome in outcomes:
        by_field.setdefault(outcome.field, []).append(outcome)

    for expected in case["expect"]["outcomes"]:
        got = by_field.get(str(expected["field"]))
        assert got, f"{case['id']}：{expected['field']} 没有任何 outcome（{outcomes}）"
        assert got[0].status == expected["status"], (
            f"{case['id']}：{expected['field']} 的结果是 {got[0].status!r}"
            f"（注：{got[0].detail!r}），期望 {expected['status']!r}"
        )
        if "note_contains" in expected:
            assert expected["note_contains"] in (got[0].detail or ""), (
                f"{case['id']}：{expected['field']} 的注记 {got[0].detail!r} 不含 "
                f"{expected['note_contains']!r}"
            )
        if "reason" in expected:
            assert got[0].reason == expected["reason"], (
                f"{case['id']}：{expected['field']} 的原因码是 {got[0].reason!r}，"
                f"期望 {expected['reason']!r}"
            )
        if "attempts" in expected:
            assert got[0].attempts == expected["attempts"], (
                f"{case['id']}：{expected['field']} 尝试了 {got[0].attempts} 次，"
                f"期望 {expected['attempts']} 次（重试阶梯是行为契约的一部分）"
            )

    expect = case["expect"]
    if "mouse_events" in expect:
        assert client.sent_calls("Input.dispatchMouseEvent") == expect["mouse_events"], (
            f"{case['id']}：鼠标事件数与脚本不符"
        )
    if expect.get("no_click_rect"):
        assert client.calls("rf:click-rect") == 0, f"{case['id']}：不该发生的取坐标点击"
