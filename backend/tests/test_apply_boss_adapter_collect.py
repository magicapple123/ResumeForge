"""BOSS 适配器 collect_search 全流程与 DOM 兜底（从 test_apply_boss_adapter.py 拆出）。

`boss()`/`ScriptedCdpClient` 留在主文件；`StaleDocumentClient` 只被本文件的
陈旧文档用例使用，随组迁入。
"""
import json

import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_SELECTOR_INVALID,
)
from app.services.apply.task_runner import TaskStopped
from app.services.sites.base import CollectQuery, SiteFailure
from app.services.sites.boss import parse_job_detail, parse_search_payload
from app.services.sites.boss_network import search_has_more
from test_apply_boss_adapter import ScriptedCdpClient, boss


def test_collect_search_reuses_the_tab_and_parses_the_page():
    adapter = boss()
    client = ScriptedCdpClient(
        {"rf:collect": json.dumps({"items": [{"title": "后端开发"}], "has_next": False})}
    )

    page = adapter.collect_search(client, CollectQuery(keywords=["后端"], city="北京"), page=1)

    # 复用当前标签页导航（navigate），而不是每页 new_tab。
    assert client.navigations and client.navigations[0].startswith(
        "https://www.zhipin.com/web/geek/job"
    )
    assert client.tabs == []
    assert [result.title for result in page.results] == ["后端开发"]
    # 先探针（等待就绪），再采集。
    assert any("rf:readiness" in expression for expression in client.expressions)
    assert any("rf:collect" in expression for expression in client.expressions)


def test_collect_search_stops_on_a_captcha():
    adapter = boss()
    client = ScriptedCdpClient({"rf:collect": json.dumps({"captcha": True, "items": []})})

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    assert excinfo.value.category == FAILURE_CAPTCHA_REQUIRED


def test_collect_search_fails_when_the_page_is_loaded_but_has_no_cards():
    """页面已加载完成、却既没有卡片也没有"无结果"标志 → **必须失败**，不能静默当成采到 0 个。"""
    adapter = boss()
    client = ScriptedCdpClient(
        ready={"matched": 0, "explicitly_empty": False, "ready_state": "complete"}
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    assert excinfo.value.category == FAILURE_SELECTOR_INVALID
    assert "期望" in excinfo.value.detail
    # 失败时**不应**再执行采集脚本（拿不到就别装作拿到了）。
    assert not any("rf:collect" in expression for expression in client.expressions)


def test_timeout_message_when_document_never_finishes_loading():
    """从未到达 complete（``ready_state`` 非 complete / 空）→ 文案是"页面加载超时…请稍后重试"。

    这是"网络慢/被拦截"该看到的提示，**不能**误报成"页面结构可能已变化"。
    """
    adapter = boss()
    client = ScriptedCdpClient(
        ready={
            "url": adapter.build_search_url(CollectQuery(keywords=["后端"]), 1),
            "title": "搜索中",
            "matched": 0,
            "explicitly_empty": False,
            "ready_state": "loading",
        }
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    detail = excinfo.value.detail
    assert "页面加载超时" in detail
    assert "页面结构可能已变化" not in detail
    assert "期望" in detail  # 诊断仍然齐备


def test_timeout_message_when_page_is_loaded_but_has_no_cards():
    """已 complete、且是新文档、却无卡片也无"无结果" → 文案是"页面已加载但找不到岗位卡片…"。"""
    adapter = boss()
    client = ScriptedCdpClient(
        ready={
            "url": adapter.build_search_url(CollectQuery(keywords=["后端"]), 1),
            "title": "职位搜索",
            "matched": 0,
            "explicitly_empty": False,
            "ready_state": "complete",
        }
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    detail = excinfo.value.detail
    assert "页面已加载但找不到岗位卡片" in detail
    assert "页面结构可能已变化" in detail
    assert "匹配到的控件数：0" in detail


def test_collect_search_returns_an_empty_page_when_there_are_genuinely_no_results():
    """关键词真的搜不到：页面明确呈现"无结果"，返回空页是合法的（不报错）。"""
    adapter = boss()
    client = ScriptedCdpClient(
        ready={"matched": 0, "explicitly_empty": True, "ready_state": "complete"}
    )

    page = adapter.collect_search(client, CollectQuery(keywords=["不存在的关键词"]), page=1)

    assert page.results == []
    assert page.has_next is False


def test_collect_search_fails_immediately_when_a_login_wall_is_shown_while_waiting():
    """等待期间出现登录墙 → **立刻**抛对应失败，不傻等满超时。"""
    adapter = boss()
    client = ScriptedCdpClient(
        ready={"matched": 0, "explicitly_empty": False, "login_required": True, "url": "u", "title": "t"}
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    assert excinfo.value.category == FAILURE_LOGIN_REQUIRED


def test_wait_can_be_interrupted_by_the_stop_signal():
    """等待是可被"停止"打断的：停止信号在下一次 CDP 调用（探针）前抛出。"""
    adapter = boss()
    client = ScriptedCdpClient(
        ready={"matched": 0, "explicitly_empty": False, "ready_state": "loading"}
    )
    original = client.evaluate
    calls = {"n": 0}

    def stop_on_second_call(expression, *, timeout=None):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise TaskStopped()
        return original(expression, timeout=timeout)

    client.evaluate = stop_on_second_call  # type: ignore[assignment]

    with pytest.raises(TaskStopped):
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)


class StaleDocumentClient(ScriptedCdpClient):
    """模拟"导航已发起、但旧文档仍短暂存活"：先返回旧页地址，再切到新页。"""

    def __init__(self, states, *, previous_url, responses=None):
        super().__init__(responses)
        self._states = list(states)
        self._index = 0
        self._previous_url = previous_url
        self.readiness_polls = 0

    def evaluate(self, expression, *, timeout=None):
        if "rf:url" in expression:
            return {"url": self._previous_url}
        if "rf:readiness" in expression:
            self.readiness_polls += 1
            state = self._states[min(self._index, len(self._states) - 1)]
            self._index += 1
            return state
        return super().evaluate(expression, timeout=timeout)


def test_collect_search_waits_until_the_new_document_takes_over():
    """导航刚发起时旧文档还在：地址没变成新页就**不能**认这次读取，否则会读到上一页。"""
    adapter = boss()
    old = "https://www.zhipin.com/web/geek/job?query=%E5%90%8E%E7%AB%AF&city=&page=1"
    new = "https://www.zhipin.com/web/geek/job?query=%E5%90%8E%E7%AB%AF&city=&page=2"
    client = StaleDocumentClient(
        [
            {"url": old, "matched": 5, "ready_state": "complete"},  # 旧文档，仍在 page=1
            {"url": old, "matched": 5, "ready_state": "complete"},  # 仍是旧文档
            {"url": new, "matched": 5, "ready_state": "complete"},  # 新文档已接管
        ],
        previous_url=old,
        responses={"rf:collect": json.dumps({"items": [{"title": "第二页岗位"}], "has_next": False})},
    )

    page = adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=2)

    assert [result.title for result in page.results] == ["第二页岗位"]
    # 旧文档被跳过，至少要轮询到第三次才接受。
    assert client.readiness_polls >= 3


def test_timeout_message_when_the_document_never_switches_to_the_target():
    """始终是陈旧文档（地址没切到目标页）→ 文案是"页面没有切换到目标地址"。"""
    adapter = boss()
    old = "https://www.zhipin.com/web/geek/job?query=x&city=&page=1"
    client = StaleDocumentClient(
        [{"url": old, "title": "旧页", "matched": 8, "ready_state": "complete"}],
        previous_url=old,
    )

    with pytest.raises(SiteFailure) as excinfo:
        adapter.collect_search(client, CollectQuery(keywords=["后端"]), page=1)

    detail = excinfo.value.detail
    assert "页面没有切换到目标地址" in detail
    assert old in detail  # 诊断里的"当前地址"就是那份陈旧文档


def test_search_has_more_returns_none_when_the_flag_is_absent():
    """接口没给翻页标志时返回 None（由调用方决定退路），不要瞎猜一个 False。"""
    assert search_has_more({"zpData": {"hasMore": True}}) is True
    assert search_has_more({"zpData": {"hasMore": False}}) is False
    assert search_has_more({"zpData": {"jobList": []}}) is None
    assert search_has_more(None) is None


# ===== 反爬混淆的还原（用户实测：职位名 "-K"、薪资为空）=====


def test_dom_collection_restores_the_obfuscated_title_and_hands_back_the_salary():
    """真实故障形态：新版列表把岗位名与薪资放在**同一个节点**里，数字还被字体反爬吃掉。

    用户在界面上看到的是职位名 "全栈工程师-K"（数字变成方框）而薪资列为空。
    这两件事是同一个根因的两面：文本没还原 + 没把粘连的薪资拆出来。
    """
    payload = {
        "items": [
            {
                "title": "全栈工程师\ue032\ue033-\ue032\ue036K",
                "company": "天津云际",
                "location": "天津·西青区·侯台",
                "salary": "",  # 新版列表没有独立的薪资节点，取到空
                "url": "https://www.zhipin.com/job_detail/x.html",
            }
        ],
        "has_next": False,
    }

    page = parse_search_payload(payload, 1)

    assert page.results[0].title == "全栈工程师"
    assert page.results[0].salary == "23-26K"


def test_dom_collection_rejects_a_salary_node_that_is_not_a_salary():
    """薪资选择器放宽之后可能取到一个同时含岗位名的容器，不能把它当薪资写进库。"""
    payload = {
        "items": [
            {
                "title": "全栈工程师23-26K",
                "salary": "全栈工程师23-26K",  # 取错了节点
                "url": "https://x/job_detail/1.html",
            }
        ],
        "has_next": False,
    }

    page = parse_search_payload(payload, 1)

    assert page.results[0].title == "全栈工程师"
    assert page.results[0].salary == "23-26K"


def test_dom_detail_splits_description_and_requirements():
    """用户实测："有的全部被塞进职位描述里面了"——按小标题切出来。"""
    payload = {
        "job_title": "全栈工程师",
        "company": "某某科技",
        "description": (
            "岗位职责：负责前后端开发与系统设计，参与需求评审并把方案落地。"
            "岗位要求：1、三年以上全栈经验。2、熟悉 Python。"
        ),
        "requirements": "",
    }

    detail = parse_job_detail(payload)

    assert detail["description"].startswith("岗位职责")
    assert "岗位要求" not in detail["description"]
    assert detail["requirements"].startswith("岗位要求")


def test_dom_detail_keeps_a_dedicated_requirements_container_when_present():
    payload = {
        "description": "岗位职责：负责前后端开发与系统设计，参与需求评审并把方案落地。",
        "requirements": "任职要求：1、精通 Python。",
    }

    detail = parse_job_detail(payload)

    assert detail["requirements"] == "任职要求：1、精通 Python。"


def test_dom_detail_cleans_watermarks_from_the_job_description():
    """真实 JD 里被塞了 ``boss`` / ``kanzhun`` / ``直聘`` 三种水印，不清会一路进到匹配分析。"""
    payload = {
        "description": "教育背景：本boss科在校生；熟练使kanzhun用Golang；工kanzhun作周期：长直聘期兼职。",
    }

    detail = parse_job_detail(payload)

    assert "boss" not in detail["description"]
    assert "kanzhun" not in detail["description"]
    assert "本科在校生" in detail["description"]
    assert "熟练使用Golang" in detail["description"]
    assert "工作周期：长期兼职" in detail["description"]
