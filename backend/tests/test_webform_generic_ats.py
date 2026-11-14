# SPDX-License-Identifier: Apache-2.0
"""通用 ATS 的姓名拆分与 AI 复核：有独立姓/名就用，不从全名猜；拆不出时留空。

姓名猜错不会报错，只会把"张"填进名字、"三"填进姓——提交后才发现，而且很难改回来。
"""

import pytest
from app.services.webform import ai
from app.services.webform.service import (
    build_preview,
    default_selections,
    enrich_preview_with_ai,
)
from test_webform_ai import UNKNOWN, FakeProvider, _raw, _snapshot


@pytest.fixture(autouse=True)
def clear_ai_cache():
    ai.clear_cache()
    yield
    ai.clear_cache()


def test_given_and_family_name_use_explicit_separate_values():
    snapshot = _snapshot(
        _raw(0, label="First name", autocomplete="given-name"),
        _raw(1, label="Last name", autocomplete="family-name"),
    )
    report = build_preview(
        snapshot, {"name": "Ada Lovelace", "given_name": "Ada", "family_name": "Lovelace"}
    )
    assert [(item.index, item.field, item.value) for item in report.items] == [
        (0, "given_name", "Ada"),
        (1, "family_name", "Lovelace"),
    ]


def test_split_name_never_guesses_from_full_name():
    snapshot = _snapshot(
        _raw(0, label="First name", autocomplete="given-name"),
        _raw(1, label="Last name", autocomplete="family-name"),
    )
    report = build_preview(snapshot, {"name": "Ada Lovelace"})
    assert report.items == []
    assert {item.field for item in report.missing_data} == {"given_name", "family_name"}


@pytest.mark.parametrize(
    "label",
    [
        "Are you legally authorized to work in this country?",
        "Will you require visa sponsorship?",
        "Years of experience with Python",
        "Are you willing to relocate?",
        "Professional license number",
        "工作许可说明",
        "相关工作年限",
        "是否愿意调动工作地点",
        "职业执照编号",
    ],
)
@pytest.mark.parametrize("relaxed", [False, True])
async def test_screening_questions_stay_manual_even_with_ai(label, relaxed):
    snapshot = _snapshot(_raw(0, label=label))
    report = build_preview(snapshot, {"name": "Ada", "phone": "13800000000"}, relaxed=relaxed)
    provider = FakeProvider({"matches": [{"index": 0, "field": "phone"}]})
    asked = await enrich_preview_with_ai(snapshot, {}, report, provider, relaxed=relaxed)
    assert [item.index for item in report.blocked] == [0]
    assert report.items == []
    assert asked == 0
    assert provider.messages == []


@pytest.mark.parametrize("confidence", [0.0, 0.69, 0.7, 1.0])
async def test_ai_confidence_and_evidence_are_review_only(confidence):
    snapshot = _snapshot(_raw(0, **UNKNOWN))
    report = build_preview(snapshot, {"research_direction": "Distributed systems"})
    provider = FakeProvider(
        {
            "matches": [
                {
                    "index": 0,
                    "field": "research_direction",
                    "confidence": confidence,
                    "evidence": "Topic of study",
                }
            ]
        }
    )
    await enrich_preview_with_ai(
        snapshot, {"research_direction": "Distributed systems"}, report, provider
    )
    (item,) = report.items
    assert item.confidence == confidence
    assert item.evidence == "Topic of study"
    assert item.status == ("low_confidence" if confidence < 0.7 else "ready")
    assert default_selections(report) == []


@pytest.mark.parametrize("confidence", [-0.1, 1.1, True, "certain", float("nan")])
async def test_invalid_explicit_ai_confidence_is_rejected(confidence):
    provider = FakeProvider({"matches": [{"index": 0, "field": "name", "confidence": confidence}]})
    assert await ai.identify_fields(provider, _snapshot(_raw(0, **UNKNOWN)).controls) == {}


async def test_ai_assessment_survives_semantic_cache_and_bounds_evidence():
    provider = FakeProvider(
        {"matches": [{"index": 0, "field": "name", "confidence": 0.6, "evidence": "e" * 300}]}
    )
    controls = _snapshot(_raw(0, **UNKNOWN)).controls
    first = await ai.identify_fields(provider, controls)
    second = await ai.identify_fields(provider, controls)
    assert first == second == {0: ("name",)}
    assert second[0].assessments["name"].confidence == 0.6
    assert second[0].assessments["name"].evidence == "e" * 160
    assert len(provider.messages) == 1
