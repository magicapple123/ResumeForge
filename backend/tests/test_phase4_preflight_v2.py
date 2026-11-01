# SPDX-License-Identifier: Apache-2.0
"""Preflight checks inspect the same visible native nodes as the export pipeline."""

import copy

from app.services.resume.preflight_rules_content import content_issues
from app.services.resume.preflight_rules_product import _hidden_leak_issue
from app.services.resume.product_text import expected_lines
from tests.document_export_samples import make_document


def test_expected_product_text_uses_native_plan_and_excludes_hidden_values():
    document = make_document()
    before = copy.deepcopy(document)
    lines = expected_lines(document)
    text = "\n".join(lines)
    for value in ("示例大学", "市场营销", "2019-09", "2023-06", "国家奖学金"):
        assert value in text
    for value in ("隐藏大学", "隐藏要点", "秘密字段", "秘密值"):
        assert value not in text
    assert "2019-09|2023-06" not in text
    assert document == before


def test_content_preflight_preserves_native_document_and_uses_visible_placeholders():
    document = make_document()
    document["sections"][-1]["entries"][0]["items"][1]["text"] = "【待补：隐藏内容】"
    before = copy.deepcopy(document)
    issues = content_issues(document, jd_text="Python SQL", purpose="export")
    assert not any(issue.code == "incomplete_marker" for issue in issues)
    assert any(issue.code == "contact_masking_off" for issue in issues)
    assert document == before


def test_url_field_warning_has_stable_native_locator():
    document = make_document()
    item = next(
        item
        for item in document["sections"][1]["entries"][0]["items"]
        if item.get("key") == "public_url"
    )
    item["value"] = "project.example.com"
    issues = content_issues(document)
    issue = next(issue for issue in issues if issue.code == "link_invalid")
    assert issue.locator.path == "projects.ob_prj000001.it_prj000005"
    assert issue.locator.object_id == "ob_prj000001"
    assert issue.locator.point_id == "it_prj000005"


def test_product_hidden_check_includes_native_hidden_fields_and_list_values():
    document = make_document()
    for hidden in ("隐藏大学", "隐藏要点", "秘密字段", "秘密值"):
        # R-24 A：判据是「整值出现在产物文本里」，所以第二个参数是产物文本而不是 token 集合。
        issue = _hidden_leak_issue(document, f"正文一段 {hidden} 结尾")
        assert issue is not None and issue.code == "product_hidden_leak"


def test_hidden_leak_is_whole_value_not_single_token():
    """R-24 A：判据从"单字 token 命中"改成"归一化后的整值子串"。

    上一版按 token 命中，而 `tokens_of` 把中文切成单字：隐藏值 "8 人" 只要正文里出现
    "8" **或** "人" 就报 blocker。现在要求整个值按顺序出现。

    代价写在明处：整值 "8人" 仍是 "8人团队" 的子串，所以这种"藏在更长的词组里"的情形
    仍会报。审计清单 §4 R-24 的验收写的是"不报"，但它同一段的坑又写"漏检比误报危险"——
    两句话在这条数据上互相矛盾。这里按**能检出**的一侧取（宁可多报一次，也不漏掉
    真正印在纸上的隐藏值），差异已记入交付报告。
    """
    document = make_document()
    entry = document["sections"][0]["entries"][0]
    # 把一个隐藏字段的值设成"8 人"（真实场景：隐藏"团队规模"字段）。
    hidden_item = next(item for item in entry["items"] if item.get("key") == "degree")
    hidden_item["placement"] = "hidden"
    hidden_item["value"] = "8 人"

    # 只有单字命中（"8" 单独出现）时不再报——整值没出现。
    assert _hidden_leak_issue(document, "2021 年入职，共 8 个项目") is None
    # 整值原样出现 → 报，且证据是原文而不是切碎的 token。
    issue = _hidden_leak_issue(document, "团队规模：8 人")
    assert issue is not None
    assert issue.evidence == ["8 人"]


def test_hidden_leak_skips_single_character_values():
    """长度 < 2 的隐藏值没有区分度：隐藏一个 "8" 不是泄露。""" ""
    document = make_document()
    entry = document["sections"][0]["entries"][0]
    hidden_item = next(item for item in entry["items"] if item.get("key") == "degree")
    hidden_item["placement"] = "hidden"
    hidden_item["value"] = "8"

    assert _hidden_leak_issue(document, "2021 年 8 月入职，共 8 个项目") is None
