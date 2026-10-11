"""站点适配器契约测试（RF-19）：fixtures/sites/boss/*.json 参数化跑 BossAdapter。

每条场景 = 一段**虚构的**页面状态序列（延续 test_site_contract_drift 的哲学：不存真实
抓取样例，只有状态 dict 的形状）+ 对适配器结局的期望（成功 / 失败分类 / 诊断关键词）
+ 对**调用面**的期望（可信点击只发生在预期坐标、脚本状态被恰好服务完、标签页收养只发生
在预期步骤）。站点改版时先红在这里，而不是在真实投递里。

替身与断言辅助见 site_contract_support.ScriptedSiteClient。
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.services.sites.base import SiteFailure
from app.services.sites.boss import BossAdapter
from site_contract_support import ScriptedSiteClient

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "sites" / "boss"

# 与 test_boss_apply.py 同一 philosophy 的两档预算：期望超时的场景必须让预算真的到期，
# 期望成功/立即失败的场景给大预算当安全网（墙钟抖动不该决定用例成败）。
FAST_WAIT_TIMEOUT = 0.02
READY_WAIT_TIMEOUT = 2.0

GREETING = "您好，我对这个岗位很感兴趣"


def _load_cases() -> list[dict]:
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(FIXTURES_DIR.glob("*.json"))
    ]


CASES = _load_cases()
CASE_IDS = [str(case["id"]) for case in CASES]


def test_contract_fixtures_are_not_empty_and_ids_are_unique():
    assert CASES, f"契约场景为空：{FIXTURES_DIR} 下没有 case"
    assert len(CASE_IDS) == len(set(CASE_IDS)), f"case id 有重复：{CASE_IDS}"


def _client_for(case: dict) -> ScriptedSiteClient:
    targets = case.get("targets") or {}
    return ScriptedSiteClient(
        {entry["marker"]: entry["states"] for entry in case["expectations"]},
        targets_before_click=targets.get("before_click"),
        targets_after_click=targets.get("after_click"),
    )


def _assert_call_surface(case: dict, client: ScriptedSiteClient) -> None:
    """调用面契约：脚本被恰好服务完、可信点击只发生在预期坐标与步数。"""
    client.assert_all_consumed()
    points = case.get("expected_mouse_points")
    if points is not None:
        # 每次可信点击 = mouseMoved + mousePressed + mouseReleased 三段，不允许多余事件。
        assert len(client.mouse_events()) == 3 * len(points), (
            f"{case['id']}：dispatchMouseEvent 事件数与预期点击步数不符"
        )
        client.assert_no_unexpected_clicks(points)
    if "expected_switch_targets" in case:
        assert client.switch_calls == case["expected_switch_targets"], (
            f"{case['id']}：标签页切换与预期不符（收养只应发生在预期步骤）"
        )


def _assert_failure(case: dict, excinfo: pytest.ExceptionInfo) -> None:
    expected = case["expected_failure"]
    assert excinfo.value.category == expected["category"], (
        f"{case['id']}：失败分类是 {excinfo.value.category!r}，期望 {expected['category']!r}"
        f"（detail：{excinfo.value.detail!r}）"
    )
    if "detail_contains" in expected:
        assert expected["detail_contains"] in excinfo.value.detail, (
            f"{case['id']}：诊断 {excinfo.value.detail!r} 不含 {expected['detail_contains']!r}"
        )


def _run_fill(case: dict, client: ScriptedSiteClient) -> None:
    adapter = BossAdapter(ready_wait=_ready_wait(case))
    if "expected_failure" in case:
        with pytest.raises(SiteFailure) as excinfo:
            adapter.fill_and_submit(client, {}, GREETING)
        _assert_failure(case, excinfo)
    else:
        outcome = adapter.fill_and_submit(client, {}, GREETING)
        expected = case.get("expected_outcome") or {}
        assert outcome.success is True, f"{case['id']}：期望成功，实际失败"
        if "greeting_sent" in expected:
            assert outcome.greeting_sent == expected["greeting_sent"]


def _run_open_apply(case: dict, client: ScriptedSiteClient) -> None:
    job = SimpleNamespace(source_url=case.get("job_url", ""))
    adapter = BossAdapter(ready_wait=_ready_wait(case))
    if "expected_failure" in case:
        with pytest.raises(SiteFailure) as excinfo:
            adapter.open_apply(client, job)
        _assert_failure(case, excinfo)
    else:
        adapter.open_apply(client, job)


def _ready_wait(case: dict):
    from app.services.browser.page_ready import ReadyWait

    # 期望失败的场景里有的是"傻等超时"型——预算必须真的到期，所以越小越快；
    # 成功与立即失败（登录/验证码阻断）场景就绪即返回，预算只是安全网。
    timeout = FAST_WAIT_TIMEOUT if "expected_failure" in case else READY_WAIT_TIMEOUT
    return ReadyWait(timeout=timeout, poll_interval=0.001)


@pytest.mark.parametrize("case", [case for case in CASES if case["exercise"] == "fill_and_submit"], ids=[case["id"] for case in CASES if case["exercise"] == "fill_and_submit"])
def test_fill_and_submit_contract(case):
    client = _client_for(case)
    _run_fill(case, client)
    _assert_call_surface(case, client)


@pytest.mark.parametrize("case", [case for case in CASES if case["exercise"] == "open_apply"], ids=[case["id"] for case in CASES if case["exercise"] == "open_apply"])
def test_open_apply_contract(case):
    client = _client_for(case)
    _run_open_apply(case, client)
    _assert_call_surface(case, client)
