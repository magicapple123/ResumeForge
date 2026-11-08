# SPDX-License-Identifier: Apache-2.0
"""求职助手联网搜索引用和降级行为测试。

R08 起联网**只有一个入口**：模型自己发起的 ``web_search`` 工具。打开开关不再先自动搜
一次，所以本文件里的用例都走"模型发一次工具调用"这条路径。
"""

from unittest.mock import AsyncMock

from app.services.assistant.assistant_web_search import AssistantSearchError
from app.services.llm.base import LLMDelta
from tests.test_assistant import (
    _configure_llm,
    _create_conversation,
    _events,
    _ScriptedProvider,
    _tool_call,
)


def _model_text(provider) -> str:
    """把最后一次请求里模型能看到的全部内容拼起来（系统提示 + 工具结果 + 用户消息）。"""
    return "\n".join(
        str(message.get("content", "")) for message in provider.requests[-1]["messages"]
    )


def test_web_search_results_are_cited_context_and_search_does_not_create_jobs(client, monkeypatch):
    _configure_llm(client)
    calls: list[str] = []

    # 工具内部是"每次调用现取"（函数内 import），所以替换 ``app.services.search`` 上的名字。
    #
    # 这里断言工具把**模型给的查询词原样**交给 aggregate_search——这是有意的接口约定：查询
    # 改写（build_search_query / 剥口语填充词）集中发生在聚合层，三个来源都在那里统一改写，
    # 免得在工具处改写后又被聚合层二次改写（build_search_query 对已是关键词列表的输入
    # 并不幂等）。改写行为本身由 test_search_aggregate 里那条用例钉住。
    async def fake_search(query: str, _config):
        calls.append(query)
        return [
            {
                "title": "示例企业招聘官网",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "数据分析师校园招聘",
            }
        ]

    monkeypatch.setattr("app.services.search.aggregate_search", fake_search)
    provider = _ScriptedProvider(
        [
            [_tool_call("web_search", {"query": "寻找数据分析师校招"})],
            [LLMDelta(text="可参考来源 [来源1]。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "寻找数据分析师校招", "web_search": True},
    )
    assert response.status_code == 200
    assert calls == ["寻找数据分析师校招"]

    events = _events(response)
    sources_event = next(event for event in events if event["type"] == "sources")
    assert sources_event["sources"][0]["url"] == "https://careers.example.com/jobs/1"
    # 工具结果原样进模型上下文：编号可引用 + 时效说明不许把结果说成"刚发布"。
    model_text = _model_text(provider)
    assert "[来源1]" in model_text
    assert "不要据此声称" in model_text
    # 助手只在被明确要求时才写数据；这轮对话没有让它写入，假 Provider 也没产出写类
    # 工具调用，所以岗位表应当仍是空的。
    assert client.get("/api/jobs").json()["total"] == 0

    context = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"][
        0
    ]["context"]
    assert context["sources"] == sources_event["sources"]


def test_web_search_failure_degrades_without_claiming_sources(client, monkeypatch):
    """搜索失败的降级：把原因如实回给模型，但绝不伪造来源。"""
    _configure_llm(client)

    async def unavailable(_query: str, _config):
        raise AssistantSearchError("联网搜索响应超时，请稍后重试")

    monkeypatch.setattr("app.services.search.aggregate_search", unavailable)
    provider = _ScriptedProvider(
        [
            [_tool_call("web_search", {"query": "岗位 招聘"})],
            [LLMDelta(text="没能搜到，先按已有信息说。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "搜索岗位", "web_search": True},
    )
    assert response.status_code == 200

    events = _events(response)
    # 没有来源就**不下发 sources 事件**：空列表配一句 error 会让界面显示"参考来源 0"，
    # 而事实是这次搜索压根没成。
    assert not any(event["type"] == "sources" for event in events)
    tool_event = next(event for event in events if event["type"] == "tool")
    assert tool_event["name"] == "web_search"
    assert "没有结果" in tool_event["summary"]

    model_text = _model_text(provider)
    assert "联网搜索响应超时" in model_text
    assert "请勿声称已获得联网资料" in model_text

    # 用户那条消息的 context 里不该留下任何伪造的来源。
    context = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"][
        0
    ]["context"]
    assert not context.get("sources")


def test_resume_forge_usage_question_skips_public_search(client, monkeypatch):
    """简历通自身的使用问题：模型调了 web_search 也只拿到本地指引，不打网络。"""
    _configure_llm(client)

    async def unexpected_search(_query: str, _config):
        raise AssertionError("ResumeForge 使用问题不应调用公开搜索")

    # 唯一的实现位置：``assistant_tools/search_tools.py`` 在调聚合层之前先做本地问题判断。
    monkeypatch.setattr("app.services.search.aggregate_search", unexpected_search)
    provider = _ScriptedProvider(
        [
            [_tool_call("web_search", {"query": "简历通怎么在 macOS 上使用？"})],
            [LLMDelta(text="请按本地使用说明操作。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "简历通怎么在 macOS 上使用？", "web_search": True},
    )

    assert response.status_code == 200
    events = _events(response)
    # 工具确实被调用了，且返回的是"本地指引"而不是搜索结果。
    tool_event = next(event for event in events if event["type"] == "tool")
    assert tool_event["name"] == "web_search"
    assert "未进行无关联网搜索" in tool_event["summary"]
    assert not any(event["type"] == "sources" for event in events)

    model_text = _model_text(provider)
    assert "这是 ResumeForge（简历通）本身的使用问题" in model_text
    assert "不要为这个问题搜索公开网页" in model_text

    # 跳过公开搜索不再在用户消息的 context 里留标记（那个字段只服务于已删除的预搜）。
    message = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"][0]
    assert "search_skipped" not in message["context"]


def test_source_numbers_are_globally_unique_across_tool_searches(client, monkeypatch):
    """来源编号在一次回答内全局单调：多次工具搜索不各自从 1 重新编号。

    前端要把正文里的 [来源N] 渲染成链接，靠的是"编号 → url"映射；如果第一次搜索占 1、2，
    第二次又从 1 开始，模型看到的 [来源1] 就会指到两条不同的 URL，链接必然跳错。
    这条测试走完整链路：第一次工具搜索命中两条 → 第二次再搜一条 → 断言模型看到的是
    [来源1]/[来源2]/[来源3]，且助手消息的 context 里持久化了这三条编号映射。
    """
    _configure_llm(client)
    calls: list[str] = []

    async def fake_search(query: str, _config):
        calls.append(query)
        index = len(calls)
        if index == 1:
            return [
                {"title": "工具A", "url": "https://example.com/tool-a", "snippet": "摘要A"},
                {"title": "工具B", "url": "https://example.com/tool-b", "snippet": "摘要B"},
            ]
        return [
            {"title": "工具C", "url": "https://example.com/tool-c", "snippet": "摘要C"},
        ]

    monkeypatch.setattr("app.services.search.aggregate_search", fake_search)
    provider = _ScriptedProvider(
        [
            [
                _tool_call("web_search", {"query": "后端 招聘"}, call_id="call_1"),
                _tool_call("web_search", {"query": "算法 招聘"}, call_id="call_2"),
            ],
            [LLMDelta(text="见 [来源1] 与 [来源3]。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "帮我搜最新的招聘信息", "web_search": True},
    )
    assert response.status_code == 200
    # 两次搜索全部来自工具调用（开关打开不再有自动预搜那一次）。
    assert len(calls) == 2

    # 模型看到的上下文里：第一次占 [来源1]/[来源2]，第二次是 [来源3]，不重号。
    model_text = _model_text(provider)
    assert "[来源1]" in model_text
    assert "[来源2]" in model_text
    assert "[来源3]" in model_text
    # 那句"编号只在本次搜索结果内有效"必须删掉——编号现在是全局唯一。
    assert "编号只在本次搜索结果内有效" not in model_text

    messages = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"]
    assistant_message = messages[1]
    assert assistant_message["content"] == "见 [来源1] 与 [来源3]。"
    # 编号 → url 映射持久化在助手消息的 context 里，前端按编号解析链接就靠它。
    assert assistant_message["context"]["source_map"] == [
        {"number": 1, "url": "https://example.com/tool-a"},
        {"number": 2, "url": "https://example.com/tool-b"},
        {"number": 3, "url": "https://example.com/tool-c"},
    ]
    # 去重后的"参考来源"面板仍按 URL 合并展示（这里没有重复 URL，所以是三条）。
    assert len(messages[0]["context"]["sources"]) == 3


def test_web_search_enabled_plain_request_never_triggers_a_search(client, monkeypatch):
    """R08 回归守卫：开关打开 + 普通改写请求，聚合搜索**零调用**。

    这条是"打开开关不再先自动搜一次"的核心断言。此前每条消息都会先用用户原话自动搜
    一遍，所以"帮我把这段实习描述改简洁"这类请求也会先发一次网络请求。现在联网只有一个
    入口（模型自己发起的 web_search），模型没发工具调用就一次都不该搜。

    断言方式用 mock 计数而不是"回答里有没有引用"：回答里没有引用也可能是模型拿到了
    来源却没引用，那样就漏掉了"其实搜过"这种情况。计数为 0 才是精确的红线。

    反证：把预搜块临时加回 assistant_stream_turns.py 后，本用例必须精确红在
    ``aggregate_search.call_count == 1``（不是导入错误），见 R08/red.txt。
    """
    _configure_llm(client)
    # 聚合搜索替换成 AsyncMock：只要有人调用它，call_count 立刻变正。
    search = AsyncMock(
        return_value=[
            {"title": "不该出现的来源", "url": "https://example.com/should-not-run", "snippet": ""}
        ]
    )
    monkeypatch.setattr("app.services.search.aggregate_search", search)
    # 模型只回正文、不发任何工具调用：这正是"帮我把这段实习描述改简洁"的应有行为。
    provider = _ScriptedProvider(
        [[LLMDelta(text="已帮你改简洁：负责数据分析与报表自动化，产出周报 12 份。")]]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "帮我把这段实习描述改简洁", "web_search": True},
    )

    assert response.status_code == 200
    # 核心断言：开关打开、模型没发工具调用 → 聚合搜索一次都不该跑。
    assert search.call_count == 0
    search.assert_not_awaited()
    # 也不该下发任何 sources 事件（没有来源可言）。
    events = _events(response)
    assert not any(event["type"] == "sources" for event in events)
    # 用户消息的 context 里不该凭空多出自动预搜塞进来的来源。
    context = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"][
        0
    ]["context"]
    assert not context.get("sources")


def test_web_search_enabled_recruitment_request_can_call_the_tool(client, monkeypatch):
    """R08 正向用例：开关打开 + 招聘类请求，模型可调用工具并拿到来源。

    与"普通请求零调用"配对：同一个开关，模型发工具调用时联网才真的发生——搜索调用一次、
    来源编号进模型上下文、``sources`` 事件带上 ``source_map``（前端按编号解析链接靠它）。
    """
    _configure_llm(client)
    search = AsyncMock(
        return_value=[
            {
                "title": "数据分析实习招聘",
                "url": "https://careers.example.com/intern/42",
                "snippet": "面向在校生的数据分析实习岗位",
            }
        ]
    )
    monkeypatch.setattr("app.services.search.aggregate_search", search)
    provider = _ScriptedProvider(
        [
            [_tool_call("web_search", {"query": "数据分析 实习 招聘"})],
            [LLMDelta(text="可参考 [来源1]。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "帮我找数据分析实习的招聘信息", "web_search": True},
    )
    assert response.status_code == 200
    # 招聘类请求下模型发了一次工具调用 → 聚合搜索恰好被调用一次，且查询词原样透传。
    assert search.call_count == 1
    assert search.await_args.args[0] == "数据分析 实习 招聘"

    # 来源编号进了模型上下文（模型能看到 [来源1] 才能引用）。
    model_text = _model_text(provider)
    assert "[来源1]" in model_text
    assert "https://careers.example.com/intern/42" in model_text

    # ``sources`` 事件带 ``source_map``：编号 → url 映射供前端渲染链接。
    events = _events(response)
    sources_event = next(event for event in events if event["type"] == "sources")
    assert sources_event["sources"][0]["url"] == "https://careers.example.com/intern/42"
    assert sources_event["source_map"] == [
        {"number": 1, "url": "https://careers.example.com/intern/42"}
    ]
