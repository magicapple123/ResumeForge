"""QA 独立对抗测试（第 1、2 节）：证明"未加载就抓"这个缺陷真的被修掉了。

立场：**证明它能工作，而不是确认它存在**。这些用例不重跑工程师的断言，而是自己构造
"页面还没加载好 → 之后才出现内容"的原始缺陷场景，以及围绕"0 结果"判定的每个边界分支。

关键手法：用一个按脚本回放"就绪探针"的假 CDP 客户端，让前若干次探针返回"空 / 未就绪"，
直到第 N+1 次才吐出真实岗位卡片。原实现在第一次就会 break 并报 0，修复后必须**真的采到**。

只在内存/临时库里跑，不联网、不起真浏览器。

拆分说明：登录墙 / 验证码 / 超时诊断用例已迁至 test_qa_collect_blocking.py；
陈旧文档 / 重定向 / 迟到内容 / 全重复 / 等待原语用例已迁至 test_qa_collect_staleness.py。
"""
from __future__ import annotations

import json

import pytest

from app.models.apply import FAILURE_SELECTOR_INVALID
from app.services.browser.cdp_client import CdpClient
from app.services.browser.page_ready import ReadyWait
from app.services.sites.base import CollectQuery, SiteFailure
from app.services.sites.boss import BossAdapter


class ScriptedReadyClient(CdpClient):
    """按脚本回放"就绪探针"状态的假 CDP 客户端。

    - ``readiness`` 是一个状态序列，第 i 次 ``rf:readiness`` 取第 i 个（越界后重复最后一个）；
      用它模拟"页面从空白/加载中逐渐变成有内容"。
    - ``rf:collect`` 固定返回 ``collect_payload``，并记录调用次数。
    - ``rf:url``（导航前记录当前地址）固定返回 ``previous_url``。
    """

    def __init__(self, *, readiness, collect_payload=None, previous_url="about:blank"):
        self._readiness = list(readiness)
        self._collect_payload = collect_payload
        self._previous_url = previous_url
        self._index = 0
        self.readiness_probes = 0
        self.collect_calls = 0
        self.new_tab_calls = 0
        self.navigations: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        self.new_tab_calls += 1
        return "tab"

    def navigate(self, url: str, *, timeout=None):
        self.navigations.append(url)
        return {}

    def send(self, method, params=None, *, timeout=None):
        return {}

    def set_file_input(self, selector, files, *, timeout=None):
        return None

    def evaluate(self, expression, *, timeout=None):
        if "rf:url" in expression:
            return {"url": self._previous_url}
        if "rf:readiness" in expression:
            self.readiness_probes += 1
            state = self._readiness[min(self._index, len(self._readiness) - 1)]
            self._index += 1
            return dict(state)
        if "rf:collect" in expression:
            self.collect_calls += 1
            return self._collect_payload
        return None

    def close(self):
        return None


def _adapter(timeout: float = 5.0, poll: float = 0.002) -> BossAdapter:
    return BossAdapter(ready_wait=ReadyWait(timeout=timeout, poll_interval=poll))


QUERY = CollectQuery(keywords=["后端"], city="北京")
REAL_ITEM = {
    "title": "后端开发工程师",
    "company": "示例科技",
    "salary": "20-30K",
    "location": "北京",
    "url": "https://www.zhipin.com/job_detail/1.html",
}


# ===== 第 1 节：原始缺陷场景——"前 N 次空，第 N+1 次才有内容" =====


def test_original_defect_loads_then_actually_collects():
    """原始缺陷：探针前几次都读不到卡片（页面尚未加载好）。修复后必须最终采到，而不是报 0。

    原实现 ``new_tab`` 后立刻 ``evaluate``，在空白文档上得到 ``items: []`` 且
    ``has_next: false``，采集循环第一页就 break，任务却以"完成，新增 0 个"收尾。
    """
    adapter = _adapter()
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            # 导航刚发起：旧文档（about:blank）还在，读不到卡片。
            {"url": "about:blank", "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            {"url": "about:blank", "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            # 新文档接管，但 SPA 还没渲染出卡片。
            {"url": target, "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            {"url": target, "matched": 0, "ready_state": "interactive", "explicitly_empty": False},
            # 第 5 次才真正看到岗位卡片。
            {"url": target, "matched": 4, "ready_state": "complete", "explicitly_empty": False},
        ],
        collect_payload=json.dumps({"items": [REAL_ITEM], "has_next": False}),
    )

    page = adapter.collect_search(client, QUERY, page=1)

    # 关键断言：真的采到了（原实现这里是空）。
    assert [r.title for r in page.results] == ["后端开发工程师"]
    assert page.has_next is False
    # 导航后确实发生了**多次**探针调用——说明它在等，而不是一次就下结论。
    assert client.readiness_probes >= 5
    # 采集脚本只在就绪后跑一次。
    assert client.collect_calls == 1


def test_collect_waits_for_the_page_instead_of_reading_it_once():
    """反例对照：只探一次就下结论的实现会在这里得到空结果。"""
    adapter = _adapter()
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "loading", "explicitly_empty": False},
            {"url": target, "matched": 2, "ready_state": "complete", "explicitly_empty": False},
        ],
        collect_payload=json.dumps({"items": [REAL_ITEM], "has_next": False}),
    )

    page = adapter.collect_search(client, QUERY, page=1)

    assert page.results and client.readiness_probes >= 2


def test_tiny_timeout_fails_instead_of_silently_returning_zero():
    """反证：把等待超时设得极小 → 必须**失败**，而不是静默返回"采到 0 个"。"""
    adapter = _adapter(timeout=0.0, poll=0.001)
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[{"url": target, "matched": 0, "ready_state": "loading", "explicitly_empty": False}],
        collect_payload=json.dumps({"items": [], "has_next": False}),
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    # 未就绪就绝不去跑采集脚本（拿不到就不装作拿到了）。
    assert client.collect_calls == 0


# ===== 第 2 节：攻击"0 结果"判定边界 =====


def test_loaded_but_empty_without_marker_is_a_failure_not_a_success():
    """页面已 complete、无内容、无"无结果"标志 → 必须失败（不得当成功）。"""
    adapter = _adapter()
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "complete", "explicitly_empty": False}
        ],
        collect_payload=json.dumps({"items": [], "has_next": False}),
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, QUERY, page=1)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert client.collect_calls == 0


def test_genuinely_empty_search_is_a_legal_empty_page():
    """真的搜不到（页面明确呈现"无结果"）→ 合法返回空，不报错。"""
    adapter = _adapter()
    target = adapter.build_search_url(QUERY, 1)
    client = ScriptedReadyClient(
        readiness=[
            {"url": target, "matched": 0, "ready_state": "complete", "explicitly_empty": True}
        ]
    )

    page = adapter.collect_search(client, QUERY, page=1)

    assert page.results == []
    assert page.has_next is False


def test_empty_result_message_differs_from_failure_message():
    """合法空页与失败在**任务文案**上必须能区分（用户要能一眼看懂发生了什么）。"""
    from app.models.apply import ApplyTask
    from app.services.apply.task_runner import TaskRunner

    empty_msg = TaskRunner._collect_message(ApplyTask(kind="collect", succeeded=0))
    result_msg = TaskRunner._collect_message(ApplyTask(kind="collect", succeeded=7))

    assert "没有找到匹配的岗位" in empty_msg
    # 文案说的是"已暂存"而不是"已新增"：采集**不写岗位广场**，岗位要用户勾选后才导入。
    # 措辞必须与真实行为一致，否则用户会去岗位广场找一个还没被导入的岗位。
    assert "已暂存 7 个岗位" in result_msg
    assert "共新增" not in result_msg
    assert empty_msg != result_msg


def test_collect_message_tells_the_user_what_to_do_next():
    """用户反馈过"采集完只知道成功了，不知道下一步该做什么"——文案必须给出下一个动作。

    只说"已完成"等于把"接下来怎么办"留给用户猜；而这一步（勾选 → 导入）恰恰是整条链路里
    最需要人来做决定的地方。
    """
    from app.models.apply import ApplyTask
    from app.services.apply.task_runner import TaskRunner

    message = TaskRunner._collect_message(ApplyTask(kind="collect", succeeded=3))

    assert "本次采集结果" in message
    assert "导入" in message


def test_collect_message_reports_how_many_were_filtered_out():
    """筛掉了多少、因为什么，必须写进文案——否则用户只会觉得"怎么少了几个"。"""
    from app.models.apply import ApplyTask
    from app.services.apply.task_runner import TaskRunner

    task = ApplyTask(
        kind="collect", succeeded=4, config={"filtered_out": 2, "filter_reasons": ["学历"]}
    )
    message = TaskRunner._collect_message(task)

    assert "已暂存 4 个岗位" in message
    assert "另有 2 个不符合" in message


def test_collect_message_says_when_a_condition_was_not_understood():
    """用户填了读不懂的条件时必须明说"这次没生效"——这是本项目最忌讳的静默失效。"""
    from app.models.apply import ApplyTask
    from app.services.apply.task_runner import TaskRunner

    task = ApplyTask(kind="collect", succeeded=1, config={"filter_unapplied": ["学历"]})
    message = TaskRunner._collect_message(task)

    assert "没能识别" in message
    assert "学历" in message


def test_collect_message_distinguishes_all_filtered_from_nothing_found():
    """全被筛掉与"没搜到"是两回事：说成后者会让用户去改关键词，而问题出在筛选条件上。"""
    from app.models.apply import ApplyTask
    from app.services.apply.task_runner import TaskRunner

    message = TaskRunner._collect_message(
        ApplyTask(kind="collect", succeeded=0, skipped=0, config={"filtered_out": 5})
    )

    assert "不符合你填的筛选条件" in message
    assert "没有找到匹配的岗位" not in message

