# SPDX-License-Identifier: Apache-2.0
"""T16 非 token 用量计数：累加、按天聚合、时间窗、幂等键，以及"**不出现金额**"。

硬验收（决策 #5）：返回结构里没有 cost / price / amount / currency 一类的键，也没有任何
"元/¥/$"字样。这条不是注释约定——`_assert_no_money` 会把整段响应序列化后逐字搜一遍，
新增一个金额字段就会让本文件变红。
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest
from app.models.setting import AppSetting
from app.schemas.usage import UsageExternalOut
from app.services import usage_counters, usage_units

TODAY = date(2026, 11, 15)
#: 金额相关线索：键名、符号、中文都算。命中即视为"开始折算金额"。
MONEY_HINTS = (
    "cost",
    "price",
    "amount",
    "currency",
    "money",
    "fee",
    "cny",
    "usd",
    "yuan",
    "¥",
    "$",
    "金额",
    "费用",
    "成本",
    "单价",
    "价",
)
EXPECTED_KEYS = {"ocr_pages", "tts_chars", "asr_seconds", "search_calls", "window"}


def _assert_no_money(payload: object) -> None:
    """把响应（或 ORM 行字段名）序列化后逐字搜金额线索。"""
    text = json.dumps(payload, ensure_ascii=False, default=str).lower()
    for hint in MONEY_HINTS:
        assert hint.lower() not in text, f"外部用量里出现了金额线索：{hint!r} → {text}"


def test_record_accumulates_per_kind(db_session):
    usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 3, source="resume_ocr", at=TODAY, db=db_session
    )
    second = usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 4, source="material_ocr", at=TODAY, db=db_session
    )
    assert second.recorded is True
    assert second.quantity == 4.0
    # day_total 是"当天该类别累计"，含本次。
    assert second.day_total == 7.0

    usage_counters.record_external_usage(usage_counters.KIND_TTS, 1200, at=TODAY, db=db_session)
    usage_counters.record_external_usage(usage_counters.KIND_ASR, 95.5, at=TODAY, db=db_session)
    usage_counters.record_external_usage(usage_counters.KIND_SEARCH, 2, at=TODAY, db=db_session)

    block = usage_counters.summary(db_session, today=TODAY)
    assert block["ocr_pages"] == 7
    assert block["tts_chars"] == 1200
    assert block["asr_seconds"] == 95.5
    assert block["search_calls"] == 2


def test_totals_by_kind_and_zero_defaults(db_session):
    """没记过数时四项都是 0（不是 None）：界面显示"0 页"而不是空白。"""
    assert usage_counters.totals_by_kind(db_session, today=TODAY) == {
        "ocr": 0.0,
        "tts": 0.0,
        "asr": 0.0,
        "search": 0.0,
    }
    block = usage_counters.summary(db_session, today=TODAY)
    assert (block["ocr_pages"], block["tts_chars"], block["asr_seconds"]) == (0, 0, 0.0)
    assert block["search_calls"] == 0


def test_daily_series_groups_by_day_newest_first(db_session):
    usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 2, at=TODAY - timedelta(days=1), db=db_session
    )
    usage_counters.record_external_usage(usage_counters.KIND_OCR, 5, at=TODAY, db=db_session)
    usage_counters.record_external_usage(usage_counters.KIND_SEARCH, 1, at=TODAY, db=db_session)

    rows = usage_counters.daily_series(db_session, days=30, today=TODAY)
    assert [row["day"] for row in rows] == [
        TODAY.isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
    ]
    assert rows[0]["ocr_pages"] == 5
    assert rows[0]["search_calls"] == 1
    assert rows[1]["ocr_pages"] == 2
    # 只有记录过的天才出现：不补零，否则"那天没用"与"那天没记"分不开。
    assert len(rows) == 2


def test_window_filter_excludes_old_days(db_session):
    usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 100, at=TODAY - timedelta(days=40), db=db_session
    )
    usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 3, at=TODAY - timedelta(days=2), db=db_session
    )

    recent = usage_counters.summary(db_session, days=7, today=TODAY)
    assert recent["ocr_pages"] == 3
    assert recent["window"] == {
        "days": 7,
        "since": (TODAY - timedelta(days=6)).isoformat(),
        "until": TODAY.isoformat(),
    }
    # 40 天前那条要等窗口放宽到 ≥41 天才回来：30 天窗口里看不到它。
    assert usage_counters.summary(db_session, days=30, today=TODAY)["ocr_pages"] == 3
    assert usage_counters.summary(db_session, days=60, today=TODAY)["ocr_pages"] == 103


def test_since_and_days_take_the_narrower_end(db_session):
    usage_counters.record_external_usage(
        usage_counters.KIND_TTS, 10, at=TODAY - timedelta(days=10), db=db_session
    )
    usage_counters.record_external_usage(usage_counters.KIND_TTS, 20, at=TODAY, db=db_session)
    since = TODAY - timedelta(days=3)
    block = usage_counters.summary(db_session, days=90, since=since, today=TODAY)
    assert block["tts_chars"] == 20
    assert block["window"]["since"] == since.isoformat()


def test_datetime_updates_use_local_date_part(db_session):
    moment = datetime(2026, 11, 15, 23, 59, 30)
    usage_counters.record_external_usage(usage_counters.KIND_ASR, 12.5, at=moment, db=db_session)
    rows = usage_counters.daily_series(db_session, days=7, today=TODAY)
    assert rows == [
        {
            "day": "2026-11-15",
            "ocr_pages": 0,
            "tts_chars": 0,
            "asr_seconds": 12.5,
            "search_calls": 0,
        }
    ]


def test_dedupe_key_is_idempotent(db_session):
    first = usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 5, at=TODAY, dedupe_key="doc-42:pages", db=db_session
    )
    retry = usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 5, at=TODAY, dedupe_key="doc-42:pages", db=db_session
    )
    assert first.recorded is True and first.deduped is False
    assert retry.recorded is False and retry.deduped is True
    assert retry.quantity == 0.0
    # 幂等命中时 day_total 仍然是"当前累计"，不是 0——生产方据此判断要不要重试。
    assert retry.day_total == 5.0
    assert usage_counters.summary(db_session, today=TODAY)["ocr_pages"] == 5

    # 换一个 key 就是另一次上报（重试与"另一份文件"必须能分开）。
    usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 5, at=TODAY, dedupe_key="doc-43:pages", db=db_session
    )
    assert usage_counters.summary(db_session, today=TODAY)["ocr_pages"] == 10


def test_long_dedupe_key_is_hashed_not_truncated(db_session):
    """超长 key 走 sha256：直接截断会让两个不同的 key 撞在一起、少记一次。"""
    prefix = "x" * 200
    usage_counters.record_external_usage(
        usage_counters.KIND_SEARCH, 1, at=TODAY, dedupe_key=prefix + "-a", db=db_session
    )
    usage_counters.record_external_usage(
        usage_counters.KIND_SEARCH, 1, at=TODAY, dedupe_key=prefix + "-b", db=db_session
    )
    assert usage_counters.summary(db_session, today=TODAY)["search_calls"] == 2


def test_zero_quantity_is_a_noop_and_negative_is_a_programming_error(db_session):
    outcome = usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 0, at=TODAY, db=db_session
    )
    assert (outcome.recorded, outcome.deduped, outcome.quantity) == (False, False, 0.0)
    assert db_session.get(AppSetting, "external_usage_counters") is None

    with pytest.raises(ValueError):
        usage_counters.record_external_usage(usage_counters.KIND_OCR, -1, at=TODAY, db=db_session)
    with pytest.raises(ValueError):
        usage_counters.record_external_usage(
            usage_counters.KIND_ASR, float("nan"), at=TODAY, db=db_session
        )
    with pytest.raises(ValueError):
        usage_counters.record_external_usage("tts_typo", 1, at=TODAY, db=db_session)
    with pytest.raises(ValueError):
        usage_counters.record_external_usage(usage_counters.KIND_TTS, True, at=TODAY, db=db_session)


def test_fractional_seconds_keep_precision(db_session):
    for value in (0.5, 0.25, 0.125):
        usage_counters.record_external_usage(
            usage_counters.KIND_ASR, value, at=TODAY, db=db_session
        )
    assert usage_counters.summary(db_session, today=TODAY)["asr_seconds"] == 0.875


def test_corrupt_partition_is_salvaged_then_reset(db_session):
    """分区坏了：原文留在 `.corrupt`，计数从零重来，且不抛异常影响业务调用。"""
    db_session.add(AppSetting(key="external_usage_counters", value="{not json"))
    db_session.commit()

    outcome = usage_counters.record_external_usage(
        usage_counters.KIND_OCR, 1, at=TODAY, db=db_session
    )
    assert outcome.recorded is True
    assert db_session.get(AppSetting, "external_usage_counters.corrupt").value == "{not json"
    assert usage_counters.summary(db_session, today=TODAY)["ocr_pages"] == 1


def test_summary_has_no_money_fields(db_session):
    usage_counters.record_external_usage(usage_counters.KIND_OCR, 8, at=TODAY, db=db_session)
    block = usage_counters.summary(db_session, today=TODAY)
    assert set(block) == EXPECTED_KEYS
    assert set(block["window"]) == {"days", "since", "until"}
    _assert_no_money(block)


def test_response_schema_declares_no_money_fields():
    """schema 层同样不许出现金额字段——只改 service 不改 schema 一样是违规。"""
    assert set(UsageExternalOut.model_fields) == EXPECTED_KEYS
    _assert_no_money(sorted(UsageExternalOut.model_fields))


def test_api_returns_external_block(client):
    usage_counters.record_external_usage(usage_counters.KIND_OCR, 6, at=date.today())
    usage_counters.record_external_usage(usage_counters.KIND_ASR, 30.5, at=date.today())

    response = client.get("/api/analytics/usage")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"dataset_id", "external"}
    block = payload["external"]
    assert set(block) == EXPECTED_KEYS
    assert block["ocr_pages"] == 6
    assert block["asr_seconds"] == 30.5
    assert block["tts_chars"] == 0
    assert block["search_calls"] == 0
    assert block["window"]["days"] == usage_counters.DEFAULT_WINDOW_DAYS
    _assert_no_money(payload)


def test_api_rejects_out_of_range_window(client):
    assert client.get("/api/analytics/usage", params={"days": 0}).status_code == 422
    assert (
        client.get(
            "/api/analytics/usage", params={"days": usage_counters.MAX_WINDOW_DAYS + 1}
        ).status_code
        == 422
    )


def test_usage_summary_endpoint_carries_external_block(client):
    """/api/usage/summary 与 token 汇总同屏也带 external；两块数字同一个时间窗。"""
    usage_counters.record_external_usage(usage_counters.KIND_SEARCH, 4, at=date.today())

    response = client.get("/api/usage/summary")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["external"]) == EXPECTED_KEYS
    assert payload["external"]["search_calls"] == 4
    _assert_no_money(payload["external"])


def test_tts_billable_chars_counts_cjk_double():
    """TTS 计费字符：汉字算 2、其余算 1（与上游口径一致，折算只写这一处）。"""
    assert usage_units.tts_billable_chars("测试") == 4
    assert usage_units.tts_billable_chars("ab") == 2
    assert usage_units.tts_billable_chars("好a") == 3
    assert usage_units.tts_billable_chars("") == 0
