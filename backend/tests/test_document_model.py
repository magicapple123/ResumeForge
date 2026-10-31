# SPDX-License-Identifier: Apache-2.0
"""v2 文档模型：解析/归一化/id/校验（计划 §3.4 + §10.1 schema 用例）。"""

from __future__ import annotations

import pytest
from app.schemas.resume_document import (
    OBJECT_ID_PATTERN as V2_ID_PATTERN,
)
from app.schemas.resume_document import (
    AuthorsItem,
    DocumentValidationError,
    FieldItem,
    HeaderItem,
    ListItem,
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeSection,
    TextItem,
    block_index,
    document_item_count,
    iter_items,
    normalize_document,
    parse_document,
)
from app.services.resume.document_identity import OBJECT_ID_PATTERN as W01_ID_PATTERN

VALID_ID = "it_12345678"
VALID_ID_2 = "it_87654321"
ENTRY_ID = "ob_abcdefgh"


def _field(**overrides):
    data = {
        "id": VALID_ID,
        "key": "school",
        "value": "上海大学",
        "placement": "title",
        "show_label": False,
    }
    data.update(overrides)
    return FieldItem(**data)


def _doc(*sections, header_items=None) -> ResumeDocument:
    return ResumeDocument(
        header=ResumeHeader(items=header_items or []),
        sections=list(sections),
    )


def _section(items, *, key="education", entry_id=ENTRY_ID, kind="entries"):
    return ResumeSection(
        key=key,
        kind=kind,
        entries=[ResumeEntry(id=entry_id, items=list(items))],
    )


def test_object_id_pattern_is_same_as_w01() -> None:
    assert V2_ID_PATTERN.pattern == W01_ID_PATTERN.pattern


def test_parse_requires_version_two() -> None:
    with pytest.raises(DocumentValidationError):
        parse_document({"education": []})
    with pytest.raises(DocumentValidationError):
        parse_document({"version": 1, "education": []})
    with pytest.raises(DocumentValidationError):
        parse_document([])
    assert parse_document({"version": 2}).version == 2


def test_parse_fills_missing_ids_and_normalizes() -> None:
    raw = {
        "version": 2,
        "header": {
            "items": [{"kind": "field", "key": "name", "value": "张三", "placement": "name"}]
        },
        "sections": [
            {
                "key": "education",
                "entries": [
                    {
                        "items": [
                            {
                                "kind": "field",
                                "key": "school",
                                "value": "上海大学",
                                "placement": "title",
                            },
                            {"kind": "text", "text": "国家奖学金"},
                        ]
                    }
                ],
            }
        ],
    }
    document = parse_document(raw)
    assert document.header.items[0].id
    entry = document.sections[0].entries[0]
    assert entry.id
    assert all(item.id for item in entry.items)
    # 幂等：再解析一次 id 不变
    again = parse_document(document.model_dump(mode="json", exclude_none=True))
    assert again.model_dump() == document.model_dump()


def test_parse_ignores_unknown_keys_and_drops_empty_content() -> None:
    raw = {
        "version": 2,
        "future_field": {"x": 1},
        "sections": [
            {"key": "education", "unknown": True, "entries": [{"items": []}]},
            {"key": "skills", "entries": [{"items": [{"kind": "text", "text": "   "}]}]},
            {"key": "summary", "entries": [{"items": [{"kind": "text", "text": "总结"}]}]},
        ],
    }
    document = parse_document(raw)
    assert [section.key for section in document.sections] == ["summary"]


def test_normalize_drops_duplicate_builtin_keys_but_keeps_text_duplicates() -> None:
    section = _section(
        [
            _field(value="甲"),
            _field(value="乙"),
            TextItem(id=VALID_ID_2, text="同一个段落"),
            TextItem(id="pt_12345678", text="同一个段落"),
        ]
    )
    document = normalize_document(_doc(section))
    items = document.sections[0].entries[0].items
    assert [item.value for item in items if isinstance(item, FieldItem)] == ["甲"]
    assert sum(isinstance(item, TextItem) for item in items) == 2


def test_invalid_id_is_rejected_not_silently_regenerated() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        TextItem(id="bad", text="x")
    raw = {
        "version": 2,
        "sections": [
            {
                "key": "education",
                "entries": [{"items": [{"kind": "text", "id": "bad", "text": "x"}]}],
            }
        ],
    }
    with pytest.raises(DocumentValidationError):
        parse_document(raw)


def test_validate_rejects_duplicate_ids() -> None:
    raw = {
        "version": 2,
        "sections": [
            {
                "key": "education",
                "entries": [
                    {
                        "items": [
                            {"kind": "text", "id": VALID_ID, "text": "a"},
                            {"kind": "text", "id": VALID_ID, "text": "b"},
                        ]
                    }
                ],
            }
        ],
    }
    with pytest.raises(DocumentValidationError):
        parse_document(raw)


def test_normalize_clips_list_values_and_authors() -> None:
    section = _section(
        [
            ListItem(
                id=VALID_ID,
                key="courses",
                values=["  课程A  ", "", "课程B"],
                placement="lead",
            ),
            AuthorsItem(
                id=VALID_ID_2,
                key="authors",
                authors=[{"name": "张三", "is_self": True}, {"name": "  "}],
                placement="trail",
            ),
        ]
    )
    document = normalize_document(_doc(section))
    items = document.sections[0].entries[0].items
    assert items[0].values == ["课程A", "课程B"]
    assert [author.name for author in items[1].authors] == ["张三"]


def test_iter_and_block_index() -> None:
    document = _doc(
        _section(
            [
                _field(placement="body", key="achievements", value="正文"),
                TextItem(id=VALID_ID_2, text="文本块"),
            ]
        )
    )
    assert document_item_count(document) == 2
    assert [item.id for _, _, item in iter_items(document)] == [VALID_ID, VALID_ID_2]
    index = block_index(document.sections[0].entries[0].items)
    assert index == {VALID_ID: 0, VALID_ID_2: 1}


def test_header_contact_breaks_normalized() -> None:
    document = ResumeDocument(
        header=ResumeHeader(
            items=[
                HeaderItem(id=VALID_ID, key="phone", value=" 13800000000 ", placement="contact")
            ],
            contact_breaks=["email", "  ", "github"],
        )
    )
    normalized = normalize_document(document)
    assert normalized.header.items[0].value == "13800000000"
    assert normalized.header.contact_breaks == ["email", "github"]
