"""匹配语料的加载、跑分与报告——pytest 回归与人读报告共用同一份实现。

语料在 ``fixtures/webform/pages/*.json``：每条 = 一页真实页面（脱敏后）的控件清单
+ 一份资料 + **人工确认过的**期望映射。跑分口径：

- ``correct``：期望的映射全都发生且写值一致；
- ``wrong``：错填——期望之外的映射（``unexpected``）、写值与期望不符、命中
  ``forbidden``（期望之外的映射的显式版，用于强调"这个框绝不能被填"）；
- ``missing``：漏填——期望的映射没有发生。

``low_confidence`` 多/少只进报告不做断言：它是"该不该请用户确认"的观察项，
B 阶段的软信号调整要在这里留痕，但不该把它变成硬失败。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.services.webform.engine import FormEngine

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "webform"
PAGES_DIR = FIXTURES_DIR / "pages"
BASELINE_PATH = FIXTURES_DIR / "baseline.json"

# 脱敏 lint：明显合成值之外的手机号/邮箱/身份证一律拒绝进语料。
_PHONE_RE = re.compile(r"(?<!\d)(1\d{10})(?!\d)")
_SYNTHETIC_PHONE_RE = re.compile(r"^1\d{2}0{8}$")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_ALLOWED_EMAIL_DOMAINS = ("example.com", "example.invalid", "example.org")
_ID_CARD_RE = re.compile(r"(?<!\d)(\d{17}[\dXx])(?!\d)")


@dataclass
class CaseResult:
    case_id: str
    site: str
    correct: int = 0
    wrong_value: list[str] = field(default_factory=list)
    unexpected: list[str] = field(default_factory=list)
    forbidden_hits: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    low_conf_extra: list[str] = field(default_factory=list)
    low_conf_missing: list[str] = field(default_factory=list)

    @property
    def wrong(self) -> int:
        bad = {item for item in self.unexpected} | set(self.forbidden_hits)
        return len(bad) + len(self.wrong_value)

    @property
    def expected_count(self) -> int:
        return self.correct + len(self.wrong_value) + len(self.missing)


def load_match_cases() -> list[dict[str, Any]]:
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(PAGES_DIR.glob("*.json"))
    ]


def run_match_case(case: dict[str, Any]) -> CaseResult:
    engine = FormEngine()
    controls = engine.snapshot_controls(case["controls"])
    mapping_result = engine.match_fields(controls, case["profile"])

    actual = {
        (mapping.field, mapping.control.index): mapping.write_value()
        for mapping in mapping_result.mappings
    }
    actual_low = {
        mapping.field for mapping in mapping_result.mappings if mapping.low_confidence
    }
    expect = case["expect"]
    result = CaseResult(case_id=str(case["id"]), site=str(case.get("site", "")))

    expected_keys: set[tuple[str, int]] = set()
    for item in expect.get("mappings", []):
        key = (str(item["field"]), int(item["index"]))
        expected_keys.add(key)
        if key not in actual:
            result.missing.append(f"{key[0]}@{key[1]}")
            continue
        want_value = item.get("value")
        if want_value is not None and actual[key] != str(want_value):
            result.wrong_value.append(
                f"{key[0]}@{key[1]}：写值 {actual[key]!r} ≠ 期望 {want_value!r}"
            )
        else:
            result.correct += 1

    for key in sorted(set(actual) - expected_keys):
        result.unexpected.append(f"{key[0]}@{key[1]}")
    for item in expect.get("forbidden", []):
        key = (str(item["field"]), int(item["index"]))
        if key in actual:
            result.forbidden_hits.append(f"{key[0]}@{key[1]}")

    expected_low = {str(name) for name in expect.get("low_confidence", [])}
    result.low_conf_extra = sorted(actual_low - expected_low)
    result.low_conf_missing = sorted(expected_low - actual_low)
    return result


def format_details(result: CaseResult) -> str:
    lines: list[str] = []
    for label, items in (
        ("漏填", result.missing),
        ("写值不符", result.wrong_value),
        ("多填", result.unexpected),
        ("禁止框被填", result.forbidden_hits),
        ("多标需确认", result.low_conf_extra),
        ("漏标需确认", result.low_conf_missing),
    ):
        if items:
            lines.append(f"    {label}：{'；'.join(items)}")
    return "\n".join(lines)


def format_report(results: list[CaseResult]) -> str:
    header = f"{'case':<52}{'站点':<10}{'正确':>4}{'错填':>6}{'漏填':>6}{'低置信+-':>9}"
    separator = "-" * 90
    rows = [header, separator]
    for result in results:
        site = result.site[:8]
        low = f"{len(result.low_conf_extra)}/{len(result.low_conf_missing)}"
        rows.append(
            f"{result.case_id:<52}{site:<10}{result.correct:>4}{result.wrong:>6}"
            f"{len(result.missing):>6}{low:>9}"
        )
    rows.append(separator)
    rows.append(
        f"{'合计':<52}{'':<10}{sum(r.correct for r in results):>4}"
        f"{sum(r.wrong for r in results):>6}{sum(len(r.missing) for r in results):>6}"
    )
    detail_lines = [
        f"{result.case_id}：\n{format_details(result)}"
        for result in results
        if result.wrong or result.missing
    ]
    if detail_lines:
        rows.append("")
        rows.append("=== 有错填/漏填的 case 明细 ===")
        rows.extend(detail_lines)
    return "\n".join(rows)


def load_baseline() -> dict[str, Any]:
    if not BASELINE_PATH.exists():
        return {"version": 1, "cases": {}}
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def save_baseline(results: list[CaseResult]) -> None:
    payload = {
        "version": 1,
        "cases": {
            result.case_id: {"correct": result.correct, "missing": len(result.missing)}
            for result in sorted(results, key=lambda item: item.case_id)
        },
    }
    BASELINE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def desensitization_violations(text: str) -> list[str]:
    """fixture 原文里疑似真实个人数据的片段（手机号/邮箱/身份证形状）。"""
    violations: list[str] = []
    for phone in _PHONE_RE.findall(text):
        if not _SYNTHETIC_PHONE_RE.match(phone):
            violations.append(f"手机号形状：{phone}")
    for email in _EMAIL_RE.findall(text):
        domain = email.rsplit("@", 1)[-1].lower()
        if domain not in _ALLOWED_EMAIL_DOMAINS:
            violations.append(f"邮箱形状：{email}")
    for card in _ID_CARD_RE.findall(text):
        violations.append(f"身份证形状：{card}")
    return violations
