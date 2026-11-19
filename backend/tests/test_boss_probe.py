# SPDX-License-Identifier: Apache-2.0
"""BOSS 反爬探针的用例：只验证"有没有被记录"，不验证解码结果。

探针的价值全在**不改变行为**上，所以这里有两条主线：
1. 没有私用区字符时，一条日志都不能产生（否则真实环境会被刷满）；
2. 有私用区字符时，记下的东西要够定位（哪一侧、几个符号、样本、URL）。
"""

import logging

import pytest
from app.services.sites.boss_network import parse_search_response
from app.services.sites.boss_probe import note_encoded_digits, scan
from app.services.sites.boss_search_parse import parse_search_payload

# 真实混淆形态：``全栈工程师\ue032\ue033-\ue032\ue036K``（23-26K）。
_ENCODED_TITLE = "全栈工程师\ue032\ue033-\ue032\ue036K"
_PUA_SYMBOL = "\ue032"


def test_scan_ignores_plain_text():
    assert scan(["12-24K·14薪", "北京", ""]) == (0, set(), [])


def test_scan_counts_occurrences_and_symbols():
    count, symbols, samples = scan([_ENCODED_TITLE, "8-\ue039K"])
    assert count == 5
    assert symbols == {"\ue032", "\ue033", "\ue036", "\ue039"}
    assert samples == [_ENCODED_TITLE, "8-\ue039K"]


def test_scan_keeps_at_most_three_samples():
    count, _symbols, samples = scan([f"{_PUA_SYMBOL}K"] * 5)
    assert count == 5
    assert len(samples) == 3


def test_scan_tolerates_none_and_objects():
    count, symbols, samples = scan([None, 42, _PUA_SYMBOL])  # type: ignore[list-item]
    assert count == 1
    assert symbols == {_PUA_SYMBOL}
    assert samples == [_PUA_SYMBOL]


def test_note_is_silent_without_encoded_chars(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_probe"):
        note_encoded_digits("DOM 列表", ["12-24K", "北京"], url="https://example.test")
    assert caplog.records == []


def test_note_logs_once_with_surface_and_url(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_probe"):
        note_encoded_digits(
            "接口列表", [_ENCODED_TITLE], url="https://www.zhipin.com/web/geek/jobs"
        )
    records = [r for r in caplog.records if r.name == "app.services.sites.boss_probe"]
    assert len(records) == 1
    message = records[0].getMessage()
    assert "接口列表" in message
    assert "4 处" in message
    assert "https://www.zhipin.com/web/geek/jobs" in message


def test_parse_search_payload_reports_encoded_digits(caplog: pytest.LogCaptureFixture):
    """接线用例：把探针从 DOM 解析里删掉，这条会精确变红。"""
    payload = {
        "items": [
            {
                "title": _ENCODED_TITLE,
                "salary": "",
                "company": "示例科技",
                "location": "北京",
                "url": "https://www.zhipin.com/job_detail/1.html",
            }
        ],
        "url": "https://www.zhipin.com/web/geek/jobs",
        "has_next": False,
    }
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_probe"):
        page = parse_search_payload(payload, 1)
    # 探针只读：解析结果必须和没有探针时完全一致。
    assert page.results[0].title == "全栈工程师"
    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "app.services.sites.boss_probe"
    ]
    assert any("DOM 列表" in message for message in messages)


def test_parse_search_response_reports_encoded_digits(caplog: pytest.LogCaptureFixture):
    """接线用例：把探针从接口解析里删掉，这条会精确变红。"""
    payload = {
        "code": 0,
        "zpData": {
            "jobList": [
                {
                    "jobName": _ENCODED_TITLE,
                    "brandName": "示例科技",
                    "salaryDesc": "23-26K",
                    "encryptJobId": "abc123",
                }
            ]
        },
    }
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_probe"):
        parsed = parse_search_response(payload)
    assert parsed and parsed[0]["title"] == "全栈工程师"
    messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "app.services.sites.boss_probe"
    ]
    assert any("接口列表" in message for message in messages)
