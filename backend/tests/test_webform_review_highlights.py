# SPDX-License-Identifier: Apache-2.0
"""不确定 / 冲突 / AI 候选的控件要在原页面上打标记，但标记里只有状态、不带字段值。

同时守三条：页面已经导航走时不能误标；三类状态（unknown / manual / candidate）各有标记；
装饰失败只记诊断，不能把预览结果搞失败。
"""

import json
import re

import pytest
from app.services.webform.engine import FormEngine
from app.services.webform.review_highlights import highlight_review, review_script
from app.services.webform.service.models import PendingItem, PreviewItem, PreviewReport
from app.services.webform.session import Snapshot


def _item(index, *, status="ready", source="rule"):
    return PreviewItem(
        index=index,
        field="given_name",
        field_label="Given name",
        value="PRIVATE-PROFILE-VALUE",
        control_label="First name",
        control_type="text",
        status=status,
        source=source,
    )


def _targets(script):
    return json.loads(re.search(r"for \(const target of (\[.*?\])\) \{", script)[1])


@pytest.mark.parametrize("status", ["low_confidence", "conflict"])
def test_uncertain_rule_mapping_is_highlighted_without_exposing_its_value(status):
    snapshot = Snapshot(
        id="review",
        url="http://127.0.0.1/form",
        controls=FormEngine().snapshot_controls(
            [
                {"index": 0, "type": "text", "selector": "#uncertain"},
                {"index": 1, "type": "text", "selector": "#ready"},
            ]
        ),
    )
    report = PreviewReport(items=[_item(0, status=status), _item(1)])
    script = review_script(snapshot, report)
    assert _targets(script) == [{"selector": "#uncertain", "state": "candidate"}]
    assert "PRIVATE-PROFILE-VALUE" not in script
    assert ".value=" not in script


def test_unknown_manual_and_ai_marks_remain_supported():
    snapshot = Snapshot(
        id="review",
        controls=FormEngine().snapshot_controls(
            [{"index": index, "type": "text", "selector": f"#f{index}"} for index in range(3)]
        ),
    )
    report = PreviewReport(
        items=[_item(2, source="ai")],
        unrecognized=[PendingItem(index=0, label="Unknown")],
        blocked=[PendingItem(index=1, label="Manual")],
    )
    assert _targets(review_script(snapshot, report)) == [
        {"selector": "#f0", "state": "unknown"},
        {"selector": "#f1", "state": "manual"},
        {"selector": "#f2", "state": "candidate"},
    ]


def test_page_decoration_failure_keeps_preview_usable():
    class ClosedClient:
        def evaluate(self, script, timeout):
            assert timeout == 3
            raise RuntimeError("Closed tab")

    report = PreviewReport(items=[_item(0, status="conflict")])
    highlight_review(ClosedClient(), Snapshot(id="closed", controls=[]), report)
    assert report.items[0].status == "conflict"
