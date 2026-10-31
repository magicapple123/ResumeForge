# SPDX-License-Identifier: Apache-2.0
"""Preflight checks inspect the same visible native nodes as the export pipeline."""

import copy

from app.services.resume.preflight_rules_content import content_issues
from app.services.resume.preflight_rules_product import _hidden_leak_issue
from app.services.resume.product_text import expected_lines, tokens_of
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
        issue = _hidden_leak_issue(document, set(tokens_of(hidden)))
        assert issue is not None and issue.code == "product_hidden_leak"
