"""AI 求职助手的提示表面：思考开关隔离、技能注入、联网搜索承诺与提示守卫。

拆分自 test_assistant.py——凡是"发给模型的 system 消息 / 工具描述里写了什么"的用例
都收在这里：设置页思考开关不得泄漏进助手、技能提示词注入与停用、联网搜索 3 次上限、
工具中文标签与系统提示守卫。
"""
from app.schemas.setting import LLMConfig
from app.services.llm.base import LLMDelta
from test_assistant import (
    _configure_llm,
    _create_conversation,
    _empty_search,
    _FakeProvider,
    _import_skill,
    _ScriptedProvider,
    _send,
    _tool_call,
)


def test_the_assistant_never_inherits_the_settings_thinking_switch(client, monkeypatch):
    """设置页的「思考模式」**只作用于除助手以外的调用**。

    助手有自己的单次请求级「思考强度」，两者必须分开：在设置页开一次开关，不该把助手的
    每一轮对话也一起改掉——用户可能正用一个不认识该参数的服务商，那样连聊天都会失败。
    """
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model="assistant-model",
        thinking_enabled=True,
        thinking_effort="high",
        thinking_budget=4096,
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200
    captured = {}

    class Provider(_FakeProvider):
        async def stream_chat(self, _messages):
            yield "好的"

    def fake_create_provider(received):
        captured["config"] = received
        return Provider()

    monkeypatch.setattr("app.api.assistant.create_provider", fake_create_provider)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], "你好")

    assert captured["config"].thinking_enabled is False
    assert captured["config"].thinking_budget is None


def test_a_custom_reasoning_effort_reaches_the_provider(client, monkeypatch):
    """自定义档位（各家自创的词，如 `xhigh`）必须被接受并原样交给 provider。

    它以前是 Literal：填 `xhigh` 直接 422——而"各家档位划分不同"恰恰是允许自定义的理由。
    """
    _configure_llm(client)
    captured = {}

    class Provider(_FakeProvider):
        async def stream_chat(self, _messages):
            yield "好的"

    def fake_create_provider(_config):
        captured["provider"] = Provider()
        return captured["provider"]

    monkeypatch.setattr("app.api.assistant.create_provider", fake_create_provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "你好", "reasoning_effort": "xhigh"},
    )

    assert response.status_code == 200
    assert captured["provider"].request_overrides == {"reasoning_effort": "xhigh"}


def test_a_malformed_reasoning_effort_is_rejected(client):
    """格式约束仍然要有：空白/中文/超长串一定发不出去，早拒绝比让上游 400 好。"""
    conversation = _create_conversation(client)

    for bad in ("有中文", "with space", "x" * 33):
        response = client.post(
            f"/api/assistant/conversations/{conversation['id']}/messages",
            json={"content": "你好", "reasoning_effort": bad},
        )
        assert response.status_code == 422, bad


def test_enabled_skills_reach_the_system_prompt(client, monkeypatch):
    """技能提示词必须真的进到发给模型的 system 消息里，而不是只躺在库里。"""
    _configure_llm(client)
    provider = _ScriptedProvider([[LLMDelta(text="好。")]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    skill = _import_skill(client, "面试模拟官", "先连问三道八股题，再逐条点评。")
    _send(client, conversation["id"], "我们开始吧")

    system = provider.requests[0]["messages"][0]
    assert system["role"] == "system"
    assert "面试模拟官" in system["content"]
    assert "先连问三道八股题，再逐条点评。" in system["content"]

    # 停用之后下一轮就不再注入：系统提示是每条消息现拼的，改技能不需要重启应用。
    client.patch(f"/api/assistant/skills/{skill['id']}", json={"enabled": False})
    _send(client, conversation["id"], "继续")

    assert "面试模拟官" not in provider.requests[1]["messages"][0]["content"]


def test_knowledge_files_are_listed_but_not_preloaded(client, monkeypatch):
    """知识文件只列清单，正文由模型按需读——否则一个技能包就能塞满上下文。"""
    _configure_llm(client)
    provider = _ScriptedProvider([[LLMDelta(text="好。")]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)
    _import_skill(client, "面试模拟官", "照题库提问。", files={"题库.md": "压舱石级别的独特句子"})
    _send(client, conversation["id"], "开始")

    system = provider.requests[0]["messages"][0]["content"]
    assert "题库.md" in system
    assert "压舱石级别的独特句子" not in system


def test_web_search_never_exceeds_the_documented_limit(client, monkeypatch):
    """系统提示、README 与使用指南都写着"一次回答最多 3 次"，这里验证它真的是上限。

    此前那句话只活在提示词里：代码侧真正的约束是 5 轮工具调用，而且每轮可以并行发多个
    搜索请求，用户按 3 次的预期可能会多花几倍。

    这个 3 次是**总数**，包含打开联网开关时那次自动预搜——它同样真的发了请求。此前那个
    计数从 0 起算，所以两个入口加起来实际是 4 次。
    """
    from app.api.assistant_stream import MAX_TOOL_ROUNDS, MAX_WEB_SEARCHES

    _configure_llm(client)
    executed: list[str] = []

    # 签名比单引擎版本多一个搜索设置参数。
    async def fake_search(query: str, _config) -> list[dict[str, str]]:
        executed.append(query)
        index = len(executed)
        return [{"title": f"招聘 {index}", "url": f"https://example.com/{index}", "snippet": "摘要"}]

    # 两个入口要分别替换：工具内部是"每次调用现取"（函数内 import），改包上的属性即可；
    # 自动预搜走的是 api 模块导入时就绑好的名字。以前只替换了前者，于是预搜那次真的去打
    # 了网络——不仅让这个测试依赖外网，它的那次搜索也没被算进断言里。
    monkeypatch.setattr("app.services.search.aggregate_search", fake_search)
    monkeypatch.setattr("app.api.assistant.aggregate_search", fake_search)
    # 每一轮都要搜索，永不收敛：没有上限就会一直搜到工具轮次用尽。
    provider = _ScriptedProvider([[_tool_call("web_search", {"query": "后端 招聘"})]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "帮我搜最新的招聘信息", "web_search": True},
    )

    assert response.status_code == 200
    # 第 1 次是自动预搜，剩 2 次留给工具。
    assert len(executed) == MAX_WEB_SEARCHES
    # 确实是被搜索上限拦下的，而不是因为工具轮次用尽才停。
    assert MAX_WEB_SEARCHES < MAX_TOOL_ROUNDS
    # 超预算时模型要收到"次数已用完"，而不是这次调用被静默丢掉（那会让它以为搜索失败，
    # 换个词再烧一轮）。这里只断言"传达到了"：同一轮的消息会在后续每一轮的请求里重复出现，
    # 数出现次数没有意义。
    assert any(
        "次数已用完" in str(message.get("content", ""))
        for request in provider.requests
        for message in request["messages"]
        if message.get("role") == "tool"
    )


def test_web_search_tool_description_follows_the_page_fetch_setting(client, monkeypatch):
    """工具描述要跟着「抓取正文的条数」走。

    描述是模型判断"这个工具能拿到什么"的唯一依据：设置里开了正文抓取、应用真的会打开
    结果页，却还告诉模型"不打开网页"，它就会认为只有摘要——于是明明够用的资料还要反复换词
    搜，或者直接告诉用户"我只能看到摘要"。这条链路（设置 → tool_definitions → 请求体）
    隔了三层，只能靠端到端断言拴住。
    """
    _configure_llm(client)
    monkeypatch.setattr("app.api.assistant.aggregate_search", _empty_search)
    provider = _ScriptedProvider([[LLMDelta(text="好的。")]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    def prompt_for(fetch_pages: int) -> str:
        """按指定的抓取条数发一次请求，把发给模型的系统提示拼上工具描述一起取回来。"""
        client.put(
            "/api/settings/search",
            json={"sources": ["bing"], "fetch_pages": fetch_pages, "max_results": 8},
        )
        provider.requests.clear()
        client.post(
            f"/api/assistant/conversations/{conversation['id']}/messages",
            json={"content": "帮我搜最新的招聘信息", "web_search": True},
        )
        request = provider.requests[0]
        tools = request["tools"]
        tool_description = next(
            item["function"]["description"]
            for item in tools
            if item["function"]["name"] == "web_search"
        )
        # 系统提示同样是"关于这个工具能做什么"的说明，两处必须一致。
        return f"{request['messages'][0]['content']}\n{tool_description}"

    only_summaries = prompt_for(0)
    with_pages = prompt_for(2)

    assert "不打开网页" in only_summaries
    assert "不打开网页" not in with_pages
    assert "抓取正文" in with_pages
    assert "正文节选" in with_pages


def test_every_tool_has_a_chinese_label_in_the_ui():
    """后端注册的每个工具都要在助手界面里有中文说法。

    「助手做了什么」那一行是用户用来确认助手改动的地方：漏标一个工具，那里就会
    露出 `import_candidate_job` 这种内部名字。两边隔着一个仓库，只能靠测试拴住。
    """
    from pathlib import Path

    from app.services import assistant_tools

    labels_source = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "features"
        / "assistant"
        / "components"
        / "AssistantMessageContent.tsx"
    ).read_text(encoding="utf-8")

    missing = [tool.name for tool in assistant_tools._TOOLS if f"{tool.name}:" not in labels_source]
    assert missing == []


def test_system_prompt_does_not_deny_capabilities_the_tools_provide():
    """系统提示不能否认工具真的有的能力，也不能漏掉新增的写入能力。

    提示里曾写着"教育经历、工作经历、项目、技能、奖项等结构化条目你也改不了"，而
    ``add_profile_entry`` 一直能追加这些条目。模型照着提示回答，用户听到的是"我没有
    修改你资料的权限"——「把资料箱里的材料整理进个人资料」这条路就这样被挡在门外，
    而代码里其实什么都不缺。提示和工具注册表隔着一个文件，只能靠断言拴住。

    这条守卫此前**只认 ``add_profile_entry`` 那一句**：把「简历样式/格式模板不能改」的
    旧文案改回提示里，测试仍然全绿——于是后来补上的 ``create_format_template`` /
    ``update_format_template``（以及技能的知识文件）就没人守，将来谁把提示改回去都不会
    报警。这里把新能力一并钉进来：每个"写入类"工具都要在提示里被点名，且对应的否认句
    不得出现。
    """
    from pathlib import Path

    from app.services.assistant_tools import _TOOLS, tool_names

    prompt = (
        Path(__file__).resolve().parents[1] / "app" / "prompts" / "assistant_system.md"
    ).read_text(encoding="utf-8")
    names = tool_names()

    # 工具还在，提示就必须提到它，否则模型不知道这条路存在。写入类工具以 `_TOOLS`
    # 里的 `writes` 字段为准（与注册写在同一处），而不是在这里再抄一份硬编码名单——
    # 否则将来新增写入工具却忘了把名字加进这行元组，测试照样全绿，守卫就形同虚设。
    write_tools = [tool.name for tool in _TOOLS if tool.writes]
    # 至少要有一批工具被标成写入类：全空说明 `writes` 字段或注册表本身坏了，要立刻暴露。
    assert write_tools, "没有任何工具被标记为写入类，writes 字段可能全部漏标"
    for tool in write_tools:
        assert tool in names, f"工具 {tool} 不在注册表里"
        assert tool in prompt, f"工具 {tool} 的能力没在系统提示里点名"

    # 技能知识文件是随工具一起补上的新能力，提示里要有对应说法，
    # 否则用户说"把这个规范记进技能里"时模型不会想到用 files。
    assert "知识文件" in prompt

    # 一票否决句不能再回来：把第 20 行改回旧文案（"不能改模板本身"）必须让这条守卫变红。
    for denial in ("结构化条目你也改不了", "不能改模板"):
        assert denial not in prompt, f"系统提示里又出现了否认句：{denial}"

