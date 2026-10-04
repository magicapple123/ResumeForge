"""BOSS 站点侧筛选项：清单读取、来源降级、编码校验与 URL 拼接。

**每个用例都不联网**：要么注入假的 fetcher，要么走内置快照。真实站点行为由
``tests/test_boss_filters_live.py`` 之外的实测记录保证（见模块文档里的实测注释）。

（拆分说明：编码校验与适配器接线在 test_boss_filters_resolve.py；页面 prepare、API
接口与采集配置在 test_boss_filters_endpoint.py。payload helper 与 fake_fetcher 留在本文件。）
"""
from __future__ import annotations

from app.services.sites.base import (
    SOURCE_PUBLIC,
    SOURCE_SESSION,
    SOURCE_SNAPSHOT,
    SOURCE_UNAVAILABLE,
)
from app.services.sites.boss_filters import (
    CONDITIONS_ENDPOINT,
    INDUSTRY_ENDPOINT,
    UNLIMITED_CODE,
    build_catalogue,
    fetch_catalogue,
    parse_conditions,
    parse_filter_bar,
    parse_industries,
    snapshot_catalogue,
)


def conditions_payload(job_types: list[dict] | None = None) -> dict:
    """一份与真实 ``conditions.json`` 同形的响应（编码是数字，含 0）。"""
    return {
        "code": 0,
        "message": "Success",
        "zpData": {
            "jobTypeList": job_types
            if job_types is not None
            else [
                {"code": 0, "name": "不限"},
                {"code": 1901, "name": "全职"},
                {"code": 1903, "name": "兼职"},
            ],
            "salaryList": [
                {"code": 0, "name": "不限", "lowSalary": 0, "highSalary": 0},
                {"code": 405, "name": "10-20K", "lowSalary": 10, "highSalary": 20},
            ],
            "experienceList": [
                {"code": 0, "name": "不限"},
                {"code": 104, "name": "1-3年"},
            ],
            "degreeList": [
                {"code": 0, "name": "不限"},
                {"code": 203, "name": "本科"},
            ],
            "scaleList": [
                {"code": 0, "name": "不限"},
                {"code": 306, "name": "10000人以上"},
            ],
            "stageList": [
                {"code": 0, "name": "不限"},
                {"code": 803, "name": "A轮"},
            ],
        },
    }


def industry_payload() -> dict:
    """``industry.json`` 的 ``zpData`` 是**数组**（与 conditions.json 的对象形状不同）。"""
    return {
        "code": 0,
        "zpData": [
            {
                "code": 100000,
                "name": "互联网/AI",
                "subLevelModelList": [
                    {"code": 100020, "name": "互联网"},
                    {"code": 100028, "name": "人工智能"},
                ],
            }
        ],
    }


def bar_payload(industry_code: str = "23") -> dict:
    """一份与 ``FILTER_BAR_SCRIPT`` 同形的产出（含行业的渲染序号陷阱）。"""
    return {
        "url": "https://www.zhipin.com/web/geek/jobs?query=python",
        "groups": [
            {
                "title": "求职类型",
                "options": [
                    {"code": "0", "label": "不限", "group": ""},
                    {"code": "1901", "label": "全职", "group": ""},
                    {"code": "1903", "label": "兼职", "group": ""},
                    {"code": "1902", "label": "实习", "group": ""},
                ],
            },
            {
                "title": "公司行业",
                "options": [
                    {"code": industry_code, "label": "电子/半导体/集成电路",
                     "group": "电子/通信/半导体"},
                ],
            },
        ],
    }


def fake_fetcher(mapping: dict[str, object]):
    calls: list[str] = []

    def _get(url: str, timeout: float):
        calls.append(url)
        if url not in mapping:
            raise OSError(f"没有为 {url} 准备假响应")
        return mapping[url]

    _get.calls = calls  # type: ignore[attr-defined]
    return _get


# ===== 解析 =====


def test_parse_conditions_keeps_the_zero_code():
    """「不限」的编码是数字 0。**它必须留下来**——`str(0 or "")` 会把它吃成空串，
    每个下拉框就都少一个选项，而用户看不出少的是哪一个。"""
    parsed = parse_conditions(conditions_payload())
    assert parsed["jobType"][0].code == UNLIMITED_CODE
    assert parsed["jobType"][0].label == "不限"
    assert [item.code for item in parsed["degree"]] == ["0", "203"]


def test_parse_conditions_ignores_error_responses():
    assert parse_conditions({"code": 403, "message": "forbidden", "zpData": {}}) == {}
    assert parse_conditions(None) == {}
    assert parse_conditions("<html>") == {}


def test_parse_industries_accepts_the_array_shaped_container():
    """``industry.json`` 的 ``zpData`` 是数组。只认对象的写法会让行业清单**静默变空**。"""
    parsed = parse_industries(industry_payload())
    assert [(item.code, item.label, item.group) for item in parsed] == [
        ("100020", "互联网", "互联网/AI"),
        ("100028", "人工智能", "互联网/AI"),
    ]
    assert parse_industries({"code": 0, "zpData": {"industryList": []}}) == ()


def test_parse_filter_bar_maps_groups_by_title():
    parsed = parse_filter_bar(bar_payload())
    assert [item.code for item in parsed["jobType"]] == ["0", "1901", "1903", "1902"]
    # 行业缺席：它在筛选栏里只给渲染序号，真实编码要从接口拿（见下一个用例）。
    assert "industry" not in parsed


def test_parse_filter_bar_never_trusts_the_industry_render_index():
    """**这是本模块最要紧的一条**：行业的 ``ka`` 后缀是渲染序号（``sel-industry-23``），
    真实编码是 ``101407``。照抄序号会发一个"合法但不相干"的编码出去，站点照样返回结果——
    用户以为筛了，那是最坏的一种错。所以行业一律不采纳页面那份。"""
    catalogue = build_catalogue(bar=parse_filter_bar(bar_payload(industry_code="23")))
    industry = next(group for group in catalogue if group.key == "industry")
    assert industry.options == ()
    assert industry.source == SOURCE_UNAVAILABLE


def test_parse_filter_bar_tolerates_unknown_titles_and_junk():
    parsed = parse_filter_bar(
        {"groups": [{"title": "没见过的格子", "options": [{"code": "1", "label": "x"}]},
                    "junk", {"title": "学历要求", "options": [{"code": "", "label": "空编码"}]}]}
    )
    assert parsed == {}


# ===== 目录构建与来源 =====


def test_build_catalogue_lets_the_page_win_over_the_interface():
    """页面那份是用户真实看到的（含账号可见的完整求职类型），接口那份只是补它的缺。"""
    catalogue = build_catalogue(
        conditions=parse_conditions(conditions_payload()),
        industries=parse_industries(industry_payload()),
        bar=parse_filter_bar(bar_payload()),
        source=SOURCE_SESSION,
    )
    by_key = {group.key: group for group in catalogue}
    assert [item.label for item in by_key["jobType"].options] == ["不限", "全职", "兼职", "实习"]
    assert [item.label for item in by_key["industry"].options] == ["互联网", "人工智能"]
    assert by_key["industry"].source == SOURCE_SESSION


def test_snapshot_covers_every_short_list_but_not_industry():
    by_key = {group.key: group for group in snapshot_catalogue()}
    for key in ("jobType", "salary", "experience", "degree", "scale", "stage"):
        assert by_key[key].options, f"{key} 的快照不该是空的"
        assert by_key[key].source == SOURCE_SNAPSHOT
    # 行业 134 条不进代码，拿不到就如实标不可用。
    assert by_key["industry"].source == SOURCE_UNAVAILABLE


def test_fetch_catalogue_prefers_the_session_then_public_then_snapshot():
    getter = fake_fetcher(
        {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
    )
    # 1) 会话里读到了 → 用会话那份，同时**仍然补一次免登录请求**拿行业。
    session = fetch_catalogue(
        fetcher=getter, session_values={CONDITIONS_ENDPOINT: conditions_payload()},
        bar_payload=bar_payload(),
    )
    assert all(group.source == SOURCE_SESSION for group in session)
    assert INDUSTRY_ENDPOINT in getter.calls

    # 2) 会话读不到 → 免登录公开清单。
    public = fetch_catalogue(fetcher=getter)
    assert all(group.source == SOURCE_PUBLIC for group in public)

    # 3) 网络也不通 → 内置快照。
    def boom(url: str, timeout: float):
        raise OSError("offline")

    offline = fetch_catalogue(fetcher=boom)
    assert next(g for g in offline if g.key == "degree").source == SOURCE_SNAPSHOT


def test_fetch_catalogue_uses_the_session_bar_even_when_the_fetch_failed():
    """页面筛选栏读到了、带凭据的接口没读到，也要用页面那份——它同样含账号可见的选项。"""
    getter = fake_fetcher({INDUSTRY_ENDPOINT: industry_payload()})
    catalogue = fetch_catalogue(fetcher=getter, bar_payload=bar_payload())
    job_type = next(group for group in catalogue if group.key == "jobType")
    assert [item.label for item in job_type.options] == ["不限", "全职", "兼职", "实习"]
    assert job_type.source == SOURCE_SESSION
