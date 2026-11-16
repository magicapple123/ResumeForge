# SPDX-License-Identifier: Apache-2.0
"""行内标记的**共享 fixture**：后端的解析结果就是前端的期望值。

## 为什么需要这一层

编辑器要在本地、同步地把源串画成"有样式的文字"（`frontend/src/features/resume/editor/
inlineMarkRuns.ts`），而标记的真源在这里（`resume_rich_text_parse` + `resume_inline_style`）。
两份实现必然存在，唯一的约束手段就是**同一份期望值**：

* `backend/tests/fixtures/inline_marks_cases.json` 由后端解析器生成（见文件头的 note）；
* 本文件断言后端解析与它一致；
* 前端 `inlineMarkRuns.test.ts` 读同一个文件，断言前端解析与它一致。

任何一侧改了配对规则（未闭合怎么退化、样式栈是不是区间局部的、URL 白名单的边界），
另一侧立刻红。没有这层，编辑器里的字号与导出结果会**静默**不一致——那种缺陷不会报错，
只会让用户觉得"预览和下载是两个东西"。

## 钉住的三条性质

1. 每个 case 的 runs 与后端 `parse_rich_runs` 逐项一致（text/bold/link/size/color）；
2. 各 run 的 text 拼接等于 fixture 的 `visible`，也等于 `strip_markers(raw)`；
3. 退化路径真的在用例里（未闭合、非法属性、非法 scheme、空串），防止用例集被悄悄改空。
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.resume.resume_rich_text import parse_rich_runs, strip_markers

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "inline_marks_cases.json"

FIELDS = ("text", "bold", "size", "color", "href")


def _load_cases() -> list[dict]:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return payload["cases"]


def _expected_runs(raw: str) -> list[dict]:
    """后端解析结果投影成 fixture 的口径（link → href，缺省字段不写）。"""
    runs: list[dict] = []
    for span in parse_rich_runs(raw):
        item: dict = {"text": span.text, "bold": span.bold}
        if span.size is not None:
            item["size"] = span.size
        if span.color:
            item["color"] = span.color
        if span.link:
            item["href"] = span.link
        runs.append(item)
    return runs


CASES = _load_cases()


def test_fixture_covers_every_marker_family() -> None:
    """用例集必须覆盖四类标记与三条退化路径（否则"全绿"没有意义）。"""
    assert len(CASES) >= 20
    raws = [case["raw"] for case in CASES]
    assert "" in raws
    assert any("**" in raw for raw in raws)
    assert any("{@size" in raw for raw in raws)
    assert any("{@color" in raw for raw in raws)
    assert any("](" in raw for raw in raws)
    # 退化：未闭合、非法属性、非法 scheme。
    assert any(raw.startswith("{@size=1.1}abc") for raw in raws)
    assert any("{@size=9}" in raw for raw in raws)
    assert any("javascript:" in raw for raw in raws)


def test_backend_parse_matches_fixture() -> None:
    for case in CASES:
        raw = case["raw"]
        actual = _expected_runs(raw)
        expected = [{key: run[key] for key in FIELDS if key in run} for run in case["runs"]]
        assert actual == expected, f"raw={raw!r}"


def test_visible_text_matches_fixture() -> None:
    for case in CASES:
        raw = case["raw"]
        joined = "".join(span.text for span in parse_rich_runs(raw))
        assert joined == case["visible"], f"raw={raw!r}"
        assert strip_markers(raw) == case["visible"], f"raw={raw!r}"


def test_fixture_is_normalised() -> None:
    """fixture 里不许出现空 run 或"有 href 但 label 为空"这类前端无法表达的形状。"""
    for case in CASES:
        for run in case["runs"]:
            assert run["text"], f"raw={case['raw']!r}"
            assert set(run) <= set(FIELDS), f"raw={case['raw']!r} run={run!r}"
