# SPDX-License-Identifier: Apache-2.0
"""外部简历文本级检查的纯规则测试（清单 `21.4）。

这层是**纯函数**（不碰数据库、不调模型），所以测试只钉规则本身：占位符、量化比例、
联系方式、长度与篇幅、弱表述，以及"有 JD 才出关键词覆盖 / 没有总分"两条口径。

刻意不 mock `ats_keywords`：关键词覆盖要用真实词库抽 JD 目标词，而"命中数 / 目标词数"
的分子分母都从接口结果里独立数一遍——用同一份实现互相印证会得到恒等式，证明不了什么。
"""

from __future__ import annotations

from app.services.external_resume_analysis import CHARS_PER_PAGE, analyze_external_resume

# 5 行内容（空行不算内容行）：
# 1 姓名；2 联系方式（手机 + 邮箱，含数字所以也算量化）；3 弱表述（带项目符号）；
# 4 有数字/百分比的成果；5 占位符。
RESUME_TEXT = "\n".join(
    [
        "张三",
        "手机：13800138000 邮箱：zhangsan@example.com",
        "- 负责了后端接口开发",
        "2024 年接口耗时下降 30%",
        "【待补】项目经历",
        "",
    ]
)


def _checks(result):
    return {check.key: check for check in result.checks}


def test_empty_text_is_explicitly_not_checked():
    """没有文字层时不能说"检查通过"：has_text=False、没有检查项、有一条警告。"""
    result = analyze_external_resume("   \n  ")

    assert result.has_text is False
    assert result.text_chars == 0
    assert result.checks == []
    assert result.warnings == ["这份简历没有提取到文字，无法做文本检查"]


def test_text_level_checks_are_itemized_with_line_numbers():
    """五个分项都出结论：每条结论带 1 基行号与原文片段，且顺序固定。"""
    result = analyze_external_resume(RESUME_TEXT, resume_id=7)

    assert result.resume_id == 7
    assert result.has_text is True
    assert result.text_chars == len(RESUME_TEXT.strip())
    assert result.line_count == 5
    assert [check.key for check in result.checks] == [
        "placeholder",
        "quantification",
        "contact",
        "length",
        "weak_wording",
    ]
    checks = _checks(result)
    assert checks["placeholder"].count == 1
    assert [(item.line, item.text) for item in checks["placeholder"].items] == [
        (5, "【待补】项目经历")
    ]
    # 手机号 + 邮箱在同一行，count 是两个联系方式而不是两行。
    assert checks["contact"].count == 2
    assert [item.line for item in checks["contact"].items] == [2]
    # 量化：第 2 行（手机号含数字）与第 4 行（30%）→ 2/5。
    assert checks["quantification"].count == 2
    assert checks["quantification"].sample_size == 5
    assert checks["quantification"].ratio == 0.4
    # 弱表述：项目符号后的"负责了..."照常命中。
    assert checks["weak_wording"].count == 1
    assert [item.line for item in checks["weak_wording"].items] == [3]
    assert checks["weak_wording"].ratio == 0.2
    # 长度：count 是字数、sample_size 是内容行数；估算页数在顶层。
    assert checks["length"].count == len(RESUME_TEXT.strip())
    assert checks["length"].sample_size == 5
    assert result.estimated_pages == round(len(RESUME_TEXT.strip()) / CHARS_PER_PAGE, 1)


def test_no_jd_means_no_keyword_section_not_zero_score():
    """没有 JD 时关键词分项**不出现**（不是 0 分），与 check_ats 的 coverage_ratio=None 同口径。"""
    result = analyze_external_resume(RESUME_TEXT)

    assert "keywords" not in _checks(result)
    # 也不给任何总分：schema 里没有 score，dump 里也不该冒出来。
    dumped = result.model_dump()
    assert "score" not in dumped
    assert "total_score" not in dumped


def test_jd_adds_keyword_coverage_with_explicit_denominator():
    """有 JD 时给出目标词、命中词、缺失词与覆盖率；覆盖率 = 命中数 / 目标词数。"""
    text = "使用 Python 和 FastAPI 开发过订单服务"
    jd_text = "岗位要求：熟悉 Python、FastAPI、Kubernetes，有高并发经验"

    result = analyze_external_resume(text, jd_text=jd_text)
    keywords = _checks(result)["keywords"].keywords

    assert keywords is not None
    assert keywords.target, "JD 里应能抽出目标词，否则这个用例没有意义"
    assert "Python" in keywords.target and "Kubernetes" in keywords.target
    assert "Python" in keywords.matched
    assert "Kubernetes" in keywords.missing
    assert keywords.missing == [word for word in keywords.target if word not in keywords.matched]
    assert keywords.coverage_ratio == round(len(keywords.matched) / len(keywords.target), 3)
    assert _checks(result)["keywords"].ratio == keywords.coverage_ratio


def test_jd_without_any_target_keyword_adds_no_section():
    """JD 存在但抽不出目标词时同样不出现关键词分项（没有分母就没有分项）。"""
    result = analyze_external_resume(RESUME_TEXT, jd_text="我们希望你踏实肯干、沟通顺畅")

    assert "keywords" not in _checks(result)


def test_phone_boundary_is_not_fooled_by_longer_digit_runs():
    """11 位手机号两侧不能再接数字：订单号里的 12 位数字不算联系方式。"""
    result = analyze_external_resume("订单号 138001380001 已发货")

    assert _checks(result)["contact"].count == 0


def test_estimated_pages_are_rounded_and_scaled_by_chars_per_page():
    text = "字" * (CHARS_PER_PAGE * 2)

    result = analyze_external_resume(text)

    assert result.estimated_pages == 2.0
