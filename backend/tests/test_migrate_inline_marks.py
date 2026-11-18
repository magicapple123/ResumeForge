# SPDX-License-Identifier: Apache-2.0
"""I-12：迁移工具必须覆盖正文文本块（`kind:"text"`，正文在 `text` 上）。

`_iter_items` 只认容器位置（header.items / entries[].items），正文存哪个键由
`_text_field` 分流：文本块是 `text`，其余是 `value`。这条用例是那次"扩范围"的守卫：

1. 文本块的标记被搬到 `text`（纯文本）+ `rich.runs`；
2. 已带 `rich` 的直接跳过（幂等），不会再叠加一遍；
3. 残留的未闭合标记原样保留（不猜）——文本块也不例外；
4. 字段 item 仍然只读写 `value`（不把 `text` 键误加到字段上）。
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from migrate_inline_marks import Report, migrate_document  # noqa: E402 - 先补 scripts/ 到 sys.path


def _doc(*items: dict) -> dict:
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {"items": []},
        "sections": [
            {
                "key": "summary",
                "kind": "text",
                "entries": [{"id": "ob_sum000001", "items": list(items)}],
            }
        ],
    }


def _first_item(doc: dict) -> dict:
    return doc["sections"][0]["entries"][0]["items"][0]


def test_text_item_marks_move_to_text_and_rich() -> None:
    """文本块：`**…**` 变纯文本 + runs，报告计入"可转换"。"""
    doc = _doc({"kind": "text", "id": "pt_000000001", "text": "**带 8 人团队**，覆盖 3 条产品线"})
    report = Report()
    assert migrate_document(1, doc, apply=True, report=report) is True
    item = _first_item(doc)
    assert item["text"] == "带 8 人团队，覆盖 3 条产品线"
    assert item["rich"] == {"runs": [{"start": 0, "end": 7, "bold": True}]}
    assert "value" not in item
    assert report.counts()["可转换"] == 1


def test_text_item_without_marks_is_not_touched() -> None:
    """普通文本块：没有标记就不写 rich、不改字。"""
    doc = _doc({"kind": "text", "id": "pt_000000002", "text": "普通正文，不动它"})
    report = Report()
    assert migrate_document(1, doc, apply=True, report=report) is False
    assert _first_item(doc) == {"kind": "text", "id": "pt_000000002", "text": "普通正文，不动它"}


def test_text_item_with_rich_is_skipped() -> None:
    """幂等：已经有 rich 的文本块跳过，text 与 rich 都不变。"""
    item = {
        "kind": "text",
        "id": "pt_000000003",
        "text": "带 8 人团队",
        "rich": {"runs": [{"start": 0, "end": 7, "bold": True}]},
    }
    doc = _doc(dict(item))
    report = Report()
    assert migrate_document(1, doc, apply=True, report=report) is False
    assert _first_item(doc) == item
    assert report.counts()["已有 rich（跳过）"] == 1


def test_text_item_residual_marks_are_kept_verbatim() -> None:
    """不猜：未闭合的 `{@…` 原样留在 text 里，不产出 rich。"""
    original = "未闭合 {@color=#c00 露出来"
    doc = _doc({"kind": "text", "id": "pt_000000004", "text": original})
    report = Report()
    assert migrate_document(1, doc, apply=True, report=report) is False
    item = _first_item(doc)
    assert item["text"] == original
    assert "rich" not in item
    assert report.counts()["含畸形串（保留原样）"] == 1


def test_field_item_still_reads_and_writes_value_only() -> None:
    """字段 item 的正文是 `value`：不被文本块分支带偏，也不凭空多出 `text` 键。"""
    doc = _doc({"kind": "field", "id": "it_000000001", "key": "name", "value": "**负责人**"})
    report = Report()
    assert migrate_document(1, doc, apply=True, report=report) is True
    item = _first_item(doc)
    assert item["value"] == "负责人"
    assert item["rich"] == {"runs": [{"start": 0, "end": 3, "bold": True}]}
    assert "text" not in item
