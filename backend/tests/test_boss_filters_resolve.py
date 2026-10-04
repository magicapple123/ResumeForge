"""BOSS 筛选项编码校验与适配器接线（从 test_boss_filters.py 拆出）。

payload helper 与 fake_fetcher 留在主文件（test_boss_filters.py）。
"""
from __future__ import annotations

import time

from app.services.sites.base import (
    SOURCE_SESSION,
    CollectQuery,
    FilterResolution,
)
from app.services.sites.boss import BossAdapter
from app.services.sites.boss_search import CONDITIONS_FETCH_WAIT_SECONDS
from app.services.sites.boss_filters import (
    CONDITIONS_ENDPOINT,
    INDUSTRY_ENDPOINT,
    build_catalogue,
    parse_conditions,
    resolve_codes,
    snapshot_catalogue,
)

from test_boss_filters import (
    bar_payload,
    conditions_payload,
    fake_fetcher,
    industry_payload,
)


# ===== 编码校验 =====


def test_resolve_codes_skips_unlimited_and_builds_params():
    resolved = resolve_codes(
        {"degree": "203", "scale": "0"}, build_catalogue(conditions=parse_conditions(conditions_payload()))
    )
    assert resolved.params == {"degree": "203"}
    assert resolved.applied == ["学历要求：本科"]
    assert resolved.unapplied == []
    assert resolved.as_dict()["params"] == {"degree": "203"}


def test_resolve_codes_refuses_codes_it_cannot_verify():
    """站点改版后旧编码照样"合法"，发出去会静默筛错——**宁可如实报未生效**。"""
    resolved = resolve_codes(
        {"scale": "999999", "degree": "203"},
        build_catalogue(conditions=parse_conditions(conditions_payload())),
    )
    assert resolved.params == {"degree": "203"}
    assert resolved.unapplied == ["公司规模"]
    assert "scale" not in resolved.params


def test_resolve_codes_reports_a_group_whose_list_is_missing():
    resolved = resolve_codes({"industry": "100028"}, snapshot_catalogue())
    assert resolved.params == {}
    assert resolved.unapplied == ["公司行业"]


def test_resolve_codes_reports_a_group_the_site_no_longer_offers():
    """旧配置里留下的分组（站点已经不提供了）也要报出来，不能悄悄丢掉。"""
    resolved = resolve_codes({"payType": "2503"}, snapshot_catalogue())
    assert resolved.unapplied == ["payType"]


def test_resolve_codes_without_selection_is_a_no_op():
    assert resolve_codes(None, snapshot_catalogue()).as_dict() == {
        "params": {},
        "applied": [],
        "unapplied": [],
    }


# ===== 适配器接线 =====


def test_build_search_url_carries_the_verified_filter_params():
    adapter = BossAdapter()
    url = adapter.build_search_url(
        CollectQuery(
            keywords=["python"],
            city="成都",
            filters={"degree": "203", "salary": "405"},
        ),
        2,
    )
    assert "degree=203" in url
    assert "salary=405" in url
    assert url.endswith("&page=2")


def test_build_search_url_lets_the_explicit_job_type_win():
    """同一个 ``jobType`` 不能在地址里出现两次：旧映射（岗位类型）与用户显式选择
    （站点筛选）撞车时，站点取哪一个不确定——那正是"我选了实习却混进全职"的成因。"""
    adapter = BossAdapter()
    url = adapter.build_search_url(
        CollectQuery(keywords=["python"], city="成都", job_type="社招",
                     filters={"jobType": "1902"}),
        1,
    )
    assert url.count("jobType=") == 1
    assert "jobType=1902" in url
    assert "jobType=1901" not in url


def test_build_search_url_keeps_the_legacy_job_type_mapping_without_site_filters():
    adapter = BossAdapter()
    url = adapter.build_search_url(
        CollectQuery(keywords=["python"], city="成都", job_type="实习"), 1
    )
    assert "jobType=1902" in url


def test_build_search_url_escapes_param_names_and_codes():
    """键名来自站点，一律转义——站点改个键名不该把查询串拼坏。"""
    adapter = BossAdapter()
    url = adapter.build_search_url(
        CollectQuery(keywords=["a"], city="成都", filters={"a b": "x&y=1", "": "skip"}), 1
    )
    assert "a%20b=x%26y%3D1" in url
    assert "skip" not in url


def test_adapter_prepares_filters_offline_with_an_injected_fetcher():
    adapter = BossAdapter(
        filter_fetcher=fake_fetcher(
            {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
        )
    )
    resolved = adapter.prepare_collect_filters({"degree": "203", "scale": "306"}, None)
    assert resolved.params == {"degree": "203", "scale": "306"}
    assert resolved.unapplied == []


def test_adapter_reports_filters_it_could_not_verify():
    adapter = BossAdapter(
        filter_fetcher=fake_fetcher({CONDITIONS_ENDPOINT: conditions_payload()})
    )
    resolved = adapter.prepare_collect_filters({"degree": "999"}, None)
    assert isinstance(resolved, FilterResolution)
    assert resolved.params == {}
    assert resolved.unapplied == ["学历要求"]


def test_adapter_without_selection_never_touches_the_network():
    """没选任何筛选项时不该发请求：这是最常见的一次采集，白读一次清单毫无意义。"""
    getter = fake_fetcher({})
    adapter = BossAdapter(filter_fetcher=getter)
    assert adapter.prepare_collect_filters({}, None).params == {}
    assert adapter.prepare_collect_filters(None, None).unapplied == []
    assert getter.calls == []  # type: ignore[attr-defined]


def test_adapter_reads_the_session_first_when_a_client_is_available():
    getter = fake_fetcher({INDUSTRY_ENDPOINT: industry_payload()})

    class FakeClient:
        def __init__(self) -> None:
            self.scripts: list[str] = []

        def evaluate(self, expression: str, **_kwargs):
            self.scripts.append(expression)
            if "rf:filter-conditions" in expression:
                import json

                return json.dumps(conditions_payload(), ensure_ascii=False)
            return bar_payload()

    client = FakeClient()
    adapter = BossAdapter(filter_fetcher=getter)
    groups = adapter.fetch_filter_options(client)
    assert [item.label for item in groups[0].options] == ["不限", "全职", "兼职", "实习"]
    assert groups[0].source == SOURCE_SESSION
    # 页面上已经有筛选栏时**不再发那次接口请求**：筛选栏更完整，而那次 fetch 在 geek 页面上
    # 根本不会 resolve，继续等它只会白等一个轮询预算。
    assert any("rf:filters" in script for script in client.scripts)
    assert not any("rf:filter-conditions" in script for script in client.scripts)


def test_adapter_uses_the_credentialed_fetch_when_the_page_has_no_bar():
    """页面不是搜索结果页（例如停在站点首页）时，靠带登录态的接口请求补齐账号可见的选项。"""
    getter = fake_fetcher({INDUSTRY_ENDPOINT: industry_payload()})

    class HomePageClient:
        def __init__(self) -> None:
            self.saw_fetch_script = False

        def evaluate(self, expression: str, **_kwargs):
            if "rf:filters" in expression:
                return {"groups": []}  # 首页上没有筛选栏
            if "rf:filter-conditions" in expression:
                self.saw_fetch_script = True
                return 1
            if "__rfFilterConditions" in expression:
                import json

                return json.dumps(conditions_payload(), ensure_ascii=False)
            return None

    client = HomePageClient()
    adapter = BossAdapter(filter_fetcher=getter)
    groups = adapter.fetch_filter_options(client)
    assert client.saw_fetch_script
    assert groups[0].source == SOURCE_SESSION
    assert [item.label for item in groups[0].options] == ["不限", "全职", "兼职"]


def test_adapter_gives_up_quickly_when_the_credentialed_fetch_never_resolves():
    """**实测过的站点行为**：geek 页面上那次 fetch 永远不 resolve。它必须迅速收手，
    而不是把每一次读取都拖成一次完整超时（那会让配置界面转圈、让采集启动变慢）。"""

    class HangingClient:
        def __init__(self) -> None:
            self.polls = 0

        def evaluate(self, expression: str, **_kwargs):
            if "rf:filters" in expression:
                return {"groups": []}
            if "rf:filter-conditions" in expression:
                return 1
            if "__rfFilterConditions" in expression:
                self.polls += 1
                return None  # 永远 pending
            return None

    client = HangingClient()
    adapter = BossAdapter(filter_fetcher=fake_fetcher({}))
    started = time.monotonic()
    groups = adapter.fetch_filter_options(client)
    elapsed = time.monotonic() - started
    assert client.polls > 0
    assert elapsed < CONDITIONS_FETCH_WAIT_SECONDS + 3
    # 拿不到就退回公开清单（测试环境里公开也读不到 → 快照），**不是**空清单。
    assert groups[0].options
