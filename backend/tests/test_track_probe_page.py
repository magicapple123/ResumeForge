# SPDX-License-Identifier: Apache-2.0
"""把列表页回读的用例单独放：这块的风险全在"张冠李戴"。

一个投递记录页上有 8 家公司，写错一条就等于把别人的进度记到你头上。
所以这里的用例不是"能不能读到状态"，而是**读不到 / 不该读的时候有没有乱写**。
"""

from __future__ import annotations

import pytest
from app.models.tracker import (
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_REJECTED,
    STATUS_SCREENING,
    STATUS_UNKNOWN,
    ApplicationTrack,
    normalize_key,
)
from app.services import track_probe

PAGE_URL = "https://acme.jobs.feishu.cn/campus/applications"

PAGE = """我的投递
宇通集团
后端开发实习生
面试中
2026-09-18 投递
腾讯
游戏策划
已淘汰
2026-09-20 投递
"""


def _track(db, company: str, title: str, status: str = STATUS_APPLIED) -> ApplicationTrack:
    record = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _fetcher(body: str):
    def fetch(url: str, cookie: str) -> str:
        assert url == PAGE_URL
        return body

    return fetch


def test_one_page_updates_each_record_from_its_own_block(db_session):
    yutong = _track(db_session, "宇通集团", "后端开发实习生")
    tencent = _track(db_session, "腾讯", "游戏策划")

    outcomes = track_probe.refresh_from_page(
        db_session, PAGE_URL, [yutong, tencent], fetch=_fetcher(PAGE)
    )

    assert {item.company: item.outcome for item in outcomes} == {
        "宇通集团": "changed",
        "腾讯": "changed",
    }
    assert yutong.status == STATUS_INTERVIEW
    # 腾讯那条是「已淘汰」，不能被宇通那条的「面试中」串过来。
    assert tencent.status == STATUS_REJECTED


def test_record_missing_from_the_page_is_skipped(db_session):
    absent = _track(db_session, "字节跳动", "客户端开发")
    outcomes = track_probe.refresh_from_page(db_session, PAGE_URL, [absent], fetch=_fetcher(PAGE))
    assert outcomes[0].outcome == "skipped"
    assert "没找到" in outcomes[0].note
    assert absent.status == STATUS_APPLIED


def test_cross_block_combination_never_writes(db_session):
    """「宇通集团 + 游戏策划」在页面上都有，但不是同一条记录——绝不能命中。"""
    mixed = _track(db_session, "宇通集团", "游戏策划")
    outcomes = track_probe.refresh_from_page(db_session, PAGE_URL, [mixed], fetch=_fetcher(PAGE))
    assert outcomes[0].outcome == "skipped"
    assert mixed.status == STATUS_APPLIED


def test_single_company_site_uses_the_title_only(db_session):
    """字节这类单公司站点：卡片上不写公司名（整站就一家），只能按岗位名定位。"""
    record = _track(db_session, "字节跳动", "AI产品经理（Agent方向）", status=STATUS_UNKNOWN)
    page = """校招
应聘记录
AI产品经理（Agent方向） - 剪映CapCut
通过内推投递
北京、深圳校招 - 正式产品项目：2027届校园招聘
投递简历
2026-11-12
联系我们"""
    outcomes = track_probe.refresh_from_page(db_session, PAGE_URL, [record], fetch=_fetcher(page))
    assert outcomes[0].outcome == "changed"
    assert record.status == STATUS_APPLIED


def test_single_company_site_skips_when_the_title_is_ambiguous(db_session):
    """岗位名在整页出现多次（比如"相关职位"里也有同名）时无法判断，必须跳过。"""
    record = _track(db_session, "字节跳动", "AI产品经理（Agent方向）", status=STATUS_UNKNOWN)
    page = """应聘记录
AI产品经理（Agent方向）
投递简历
相关职位
AI产品经理（Agent方向）
已淘汰"""
    outcomes = track_probe.refresh_from_page(db_session, PAGE_URL, [record], fetch=_fetcher(page))
    assert outcomes[0].outcome == "skipped"
    assert record.status == STATUS_UNKNOWN


def test_fetch_failure_marks_every_record_without_touching_status(db_session):
    first = _track(db_session, "宇通集团", "后端开发实习生")
    second = _track(db_session, "腾讯", "游戏策划")

    def boom(url: str, cookie: str) -> str:
        raise TimeoutError("门户超时")

    outcomes = track_probe.refresh_from_page(db_session, PAGE_URL, [first, second], fetch=boom)
    assert [item.outcome for item in outcomes] == ["failed", "failed"]
    assert first.status == STATUS_APPLIED
    assert second.status == STATUS_APPLIED


def test_page_mode_also_respects_no_rollback(db_session):
    """页面还停在旧阶段时不能把进度打回去（与单条回读同一套合并规则）。"""
    ahead = _track(db_session, "宇通集团", "后端开发实习生", status=STATUS_INTERVIEW)
    outcomes = track_probe.refresh_from_page(
        db_session, PAGE_URL, [ahead], fetch=_fetcher("宇通集团\n后端开发实习生\n申请成功\n")
    )
    assert outcomes[0].outcome == "unchanged"
    assert ahead.status == STATUS_INTERVIEW


def test_empty_track_list_is_a_noop(db_session):
    assert track_probe.refresh_from_page(db_session, PAGE_URL, [], fetch=_fetcher(PAGE)) == []


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("宇通集团\n后端开发实习生\n筛选中\n", STATUS_SCREENING),
        ("后端开发实习生\n宇通集团\n面试中\n", STATUS_INTERVIEW),
    ],
)
def test_name_order_does_not_matter(db_session, body, expected):
    """有的卡片是「公司在前」，有的是「岗位在前」，两种排法都要认。"""
    record = _track(db_session, "宇通集团", "后端开发实习生")
    track_probe.refresh_from_page(db_session, PAGE_URL, [record], fetch=_fetcher(body))
    assert record.status == expected
