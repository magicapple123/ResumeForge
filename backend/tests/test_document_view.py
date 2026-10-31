# SPDX-License-Identifier: Apache-2.0
"""v2 文档原生只读访问器（T4b）：页眉/条目/整份文本的最小读取面。

这层存在的意义是"替换 v2→v1 分析桥"：只取值、不构造 ResumeContent、不猜内容。
用例覆盖正常形状、隐藏语义与脏数据（读侧不能因一份坏数据炸掉调用方）。
"""

from __future__ import annotations

from app.services.resume.document_view import (
    document_text,
    entry_texts,
    header_items,
    header_text,
    is_v2_document,
    iter_entries,
)
from tests.document_export_samples import make_document


def test_is_v2_document_distinguishes_v1_and_v2():
    document = make_document()
    assert is_v2_document(document) is True
    assert is_v2_document({"name": "张三"}) is False
    assert is_v2_document(None) is False
    assert is_v2_document({"version": 2}) is False


def test_header_text_reads_value_by_key():
    document = make_document()
    assert header_text(document, "name")
    assert header_text(document, "missing-field", default="fallback") == "fallback"


def test_iter_entries_follows_document_order_and_skips_bad_shapes():
    document = make_document()
    pairs = iter_entries(document)
    assert pairs
    expected = [
        section["key"]
        for section in document["sections"]
        if isinstance(section.get("entries"), list) and section["entries"]
    ]
    seen = []
    for section_key, _entry in pairs:
        if not seen or seen[-1] != section_key:
            seen.append(section_key)
    assert seen == expected
    # 非条目分区（inline/text）不会出现在 iter_entries 里。
    assert all(isinstance(entry, dict) for _key, entry in pairs)


def test_entry_texts_honours_hidden_semantics():
    entry = {
        "id": "en_000001",
        "items": [
            {"kind": "field", "key": "company", "value": "示例科技有限公司"},
            {"kind": "text", "text": "主导活动并复盘", "hidden": False},
            {"kind": "text", "text": "隐藏的草稿", "hidden": True},
            {"kind": "field", "key": "note", "value": "隐藏字段", "placement": "hidden"},
        ],
    }
    assert entry_texts(entry) == ["示例科技有限公司", "主导活动并复盘"]
    assert "隐藏的草稿" in entry_texts(entry, include_hidden=True)


def test_document_text_joins_visible_content_in_document_order():
    document = make_document()
    text = document_text(document)
    assert header_text(document, "name") in text
    first_entry = iter_entries(document)[0][1]
    assert entry_texts(first_entry)[0] in text
    assert "\x00" not in text


def test_readers_return_empty_values_for_bad_input():
    for bad in (None, {}, {"version": 2, "header": {}, "sections": "bad"}):
        assert header_items(bad) == []
        assert header_text(bad, "name") == ""
        assert entry_texts(bad) == []
        assert iter_entries(bad) == []
        assert document_text(bad) == ""
