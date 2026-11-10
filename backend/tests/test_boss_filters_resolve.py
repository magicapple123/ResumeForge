# SPDX-License-Identifier: Apache-2.0
"""BOSS 筛选项编码校验与适配器接线（从 test_boss_filters.py 拆出）。

payload helper 与 fake_fetcher 留在主文件（test_boss_filters.py）。本文件守 15.2 的
能力表在"编码 → 查询参数"这一步的行为：多选逗号拼接、单选只留第一个、联动组在
不适用的时候**一个参数都不发**、旧配置的单字符串照样能读。
"""
from __future__ import annotations

import time

from app.services.sites.base import (
    SOURCE_SESSION,
    CollectQuery,
    FilterResolution,
)
from app.services.sites.boss import BossAdapter
from app.services.sites.boss_filters import (
    CONDITIONS_ENDPOINT,
    INDUSTRY_ENDPOINT,
    build_catalogue,
    parse_conditions,
    resolve_codes,
    snapshot_catalogue,
)
from app.services.sites.boss_search import CONDITIONS_FETCH_WAIT_SECONDS
from test_boss_filters import (
    bar_payload,
    conditions_payload,
    fake_fetcher,
    industry_payload,
)


def _catalogue():
    return build_catalogue(conditions=parse_conditions(conditions_payload()))


def _url(filters: dict[str, str], **kwargs) -> str:
    return BossAdapter().build_search_url(
        CollectQuery(keywords=["python"], city="成都", filters=filters, **kwargs), 1
    )


# ===== 编码校验 =====


def test_resolve_codes_skips_unlimited_and_builds_params():
    resolved = resolve_codes({"degree": ["203"], "scale": ["0"]}, _catalogue())
    assert resolved.params == {"degree": "203"}
    assert resolved.applied == ["学历要求：本科"]
    assert resolved.unapplied == []
    assert resolved.as_dict()["params"] == {"degree": "203"}


def test_resolve_codes_builds_comma_joined_multi_values():
    """多选组（实测站点接受）→ 逗号连接的参数值；文案用「、」连接。"""
    resolved = resolve_codes({"degree": ["203", "202"]}, _catalogue())
    assert resolved.params == {"degree": "203,202"}
    assert resolved.applied == ["学历要求：本科、大专"]
    assert resolved.unapplied == []


def test_resolve_codes_keeps_only_first_for_single_select_groups():
    """求职类型是单选（实测多值只取第一个）：多给时只发第一个并如实提示。"""
    resolved = resolve_codes({"jobType": ["1901", "1903"]}, _catalogue())
    assert resolved.params == {"jobType": "1901"}
    assert resolved.applied == ["求职类型：全职"]
    assert any("只支持单选" in reason for reason in resolved.unapplied)
    assert resolved.job_type_selected is True


def test_resolve_codes_drops_unlimited_even_when_mixed_with_real_codes():
    """「不限 + 本科」等于「本科」：0 永远不变成查询参数。"""
    resolved = resolve_codes({"degree": ["0", "202"]}, _catalogue())
    assert resolved.params == {"degree": "202"}
    assert resolved.applied == ["学历要求：大专"]


def test_resolve_codes_refuses_codes_it_cannot_verify():
    """站点改版后旧编码照样"合法"，发出去会静默筛错——宁可如实报未生效。"""
    resolved = resolve_codes({"scale": ["999999"], "degree": ["203"]}, _catalogue())
    assert resolved.params == {"degree": "203"}
    assert resolved.unapplied == ["公司规模：999999（已失效）"]
    assert "scale" not in resolved.params


def test_resolve_codes_drops_only_the_invalid_code_of_a_multi_group():
    resolved = resolve_codes({"degree": ["203", "999"]}, _catalogue())
    assert resolved.params == {"degree": "203"}
    assert resolved.unapplied == ["学历要求：999（已失效）"]


def test_resolve_codes_reports_a_group_whose_list_is_missing():
    resolved = resolve_codes({"industry": ["100028"]}, snapshot_catalogue())
    assert resolved.params == {}
    assert resolved.unapplied == ["公司行业"]


def test_resolve_codes_reports_a_group_the_site_no_longer_offers():
    """旧配置里留下的分组（站点已经不提供了）也要报出来，不能悄悄丢掉。"""
    resolved = resolve_codes({"obsoleteGroup": ["1"]}, snapshot_catalogue())
    assert resolved.unapplied == ["obsoleteGroup"]


def test_resolve_codes_without_selection_is_a_no_op():
    assert resolve_codes(None, snapshot_catalogue()).as_dict() == {
        "params": {},
        "applied": [],
        "unapplied": [],
    }
    assert resolve_codes({}, snapshot_catalogue()).job_type_selected is False


def test_resolve_codes_accepts_legacy_single_string_values():
    """旧配置/旧前端快照存的是单个字符串（§15.3-A：必须能读）。"""
    resolved = resolve_codes({"degree": "203"}, _catalogue())
    assert resolved.params == {"degree": "203"}


# ===== 兼职联动（visible_when，§15.2/§15.4-2） =====


def test_resolve_codes_drops_salary_in_part_time_mode():
    """兼职时「薪资待遇」整组不可见：历史配置里残留的 salary **一个参数都不发**。"""
    resolved = resolve_codes({"jobType": ["1903"], "salary": ["405"]}, _catalogue())
    assert "salary" not in resolved.params
    assert resolved.params == {"jobType": "1903"}
    assert any("薪资待遇" in reason and "不适用" in reason for reason in resolved.unapplied)


def test_resolve_codes_drops_pay_type_outside_part_time_mode():
    """反向不成立（实测全职下传 payType 站点不认）：只在兼职下可见。"""
    resolved = resolve_codes({"jobType": ["1901"], "payType": ["2503"]}, _catalogue())
    assert "payType" not in resolved.params
    assert resolved.params == {"jobType": "1901"}


def test_resolve_codes_keeps_pay_type_under_part_time():
    resolved = resolve_codes(
        {"jobType": ["1903"], "payType": ["2503", "2504"]}, _catalogue()
    )
    assert resolved.params["payType"] == "2503,2504"


def test_resolve_codes_keeps_salary_when_job_type_is_unset_or_unlimited():
    """没选求职类型（或选「不限」）时薪资照常可用——站点默认不限类型。"""
    unset = resolve_codes({"salary": ["405"]}, _catalogue())
    assert unset.params == {"salary": "405"}
    unlimited = resolve_codes({"jobType": ["0"], "salary": ["405"]}, _catalogue())
    assert unlimited.params == {"salary": "405"}
    # 显式选了「不限」也算"用户动过求职类型"（要压住旧映射，§15.4-1）。
    assert unlimited.job_type_selected is True


# ===== 适配器接线 =====


def test_build_search_url_carries_the_verified_filter_params():
    url = _url({"degree": "203", "salary": "405"})
    assert "degree=203" in url
    assert "salary=405" in url


def test_build_search_url_keeps_the_comma_literal_for_multi_values():
    """多值用字面逗号（%2C 会被站点当成未知值整串忽略）。"""
    url = _url({"degree": "203,202"})
    assert "degree=203,202" in url
    assert "%2C" not in url


def test_build_search_url_lets_the_explicit_job_type_win():
    """同一个 jobType 不能在地址里出现两次：旧映射与用户显式选择撞车时以用户为准。"""
    url = _url({"jobType": "1902"}, job_type="社招")
    assert url.count("jobType=") == 1
    assert "jobType=1902" in url
    assert "jobType=1901" not in url


def test_build_search_url_keeps_the_legacy_job_type_mapping_without_site_filters():
    url = _url({}, job_type="实习")
    assert "jobType=1902" in url


def test_build_search_url_skips_legacy_mapping_when_the_user_touched_job_type():
    """用户显式选了「不限」：不能再追加旧映射，否则"不限"会静默变成"只采某一类"（§15.4-1）。"""
    url = _url({}, job_type="实习", skip_job_type_mapping=True)
    assert "jobType=" not in url


def test_build_search_url_escapes_param_names_and_codes():
    """键名来自站点，一律转义——站点改个键名不该把查询串拼坏。"""
    url = _url({"a b": "x&y=1", "": "skip"})
    assert "a%20b=x%26y%3D1" in url
    assert "skip" not in url


def test_adapter_prepares_filters_offline_with_an_injected_fetcher():
    adapter = BossAdapter(
        filter_fetcher=fake_fetcher(
            {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
        )
    )
    resolved = adapter.prepare_collect_filters({"degree": ["203"], "scale": ["306"]}, None)
    assert resolved.params == {"degree": "203", "scale": "306"}
    assert resolved.unapplied == []


def test_adapter_prepares_a_multi_value_group_into_one_param():
    adapter = BossAdapter(
        filter_fetcher=fake_fetcher(
            {CONDITIONS_ENDPOINT: conditions_payload(), INDUSTRY_ENDPOINT: industry_payload()}
        )
    )
    resolved = adapter.prepare_collect_filters({"degree": ["203", "202"]}, None)
    assert resolved.params == {"degree": "203,202"}
    assert resolved.applied == ["学历要求：本科、大专"]


def test_adapter_reports_filters_it_could_not_verify():
    adapter = BossAdapter(filter_fetcher=fake_fetcher({CONDITIONS_ENDPOINT: conditions_payload()}))
    resolved = adapter.prepare_collect_filters({"degree": ["999"]}, None)
    assert isinstance(resolved, FilterResolution)
    assert resolved.params == {}
    assert resolved.unapplied == ["学历要求：999（已失效）"]


def test_adapter_reports_the_job_type_selection_for_the_legacy_mapping_guard():
    """适配器要把"用户动过求职类型"传出去：采集器据此压住旧的岗位类型映射。"""
    adapter = BossAdapter(filter_fetcher=fake_fetcher({CONDITIONS_ENDPOINT: conditions_payload()}))
    resolved = adapter.prepare_collect_filters({"jobType": ["0"]}, None)
    assert resolved.params == {}
    assert resolved.job_type_selected is True


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
    """**实测过的站点行为**：geek 页面上那次 fetch 永远不 resolve。它必须迅速收手。"""

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
