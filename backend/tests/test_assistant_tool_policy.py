"""RF-01 工具执行授权策略测试：下发与执行同源 + 负例全部执行层拒绝。"""

import pytest
from app.services.assistant_tools import _TOOLS, execute_tool, tool_definitions, tool_names
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools.policy import ToolExecutionContext


def _ctx(web_search=False, relaxed=False, writable=False) -> ToolExecutionContext:
    return ToolExecutionContext(
        dataset_id="main",
        dataset_generation=1,
        web_search=web_search,
        fetch_pages=0,
        relaxed=relaxed,
        writable=writable,
    )


def _names(definitions: list[dict]) -> set[str]:
    return {item["function"]["name"] for item in definitions}


@pytest.mark.parametrize(
    "web_search,relaxed",
    [(False, False), (True, False), (False, True), (True, True)],
)
def test_tool_definitions_and_allowed_tools_are_the_same_set(web_search: bool, relaxed: bool):
    """下发集合与执行白名单恒等——任何过滤条件只改 policy.allowed_tools。"""
    ctx = _ctx(web_search=web_search, relaxed=relaxed)
    assert _names(tool_definitions(ctx)) == set(tool_policy.allowed_tools(ctx))


def test_legacy_kwargs_path_matches_the_ctx_path():
    """不传 ctx 的历史调用方（kwargs）与显式 ctx 产生同一份下发集合。"""
    assert _names(tool_definitions(web_search=True, relaxed=True)) == set(
        tool_policy.allowed_tools(_ctx(web_search=True, relaxed=True))
    )
    assert tool_definitions(enabled=False) == []


def test_undistributed_tool_is_refused_at_the_execution_layer(db_session):
    """放宽模式关着时，Provider 硬要调敏感读取工具 → 拒绝，handler 不执行。"""
    relaxed_names = [
        tool.name for tool in _TOOLS if tool.requires_relaxed
    ]
    assert relaxed_names, "前提：注册表里存在放宽模式工具"
    ctx = _ctx(relaxed=False)
    for name in relaxed_names:
        result = execute_tool(db_session, name, {}, ctx=ctx)
        assert result.text.startswith("工具未获授权")
        assert result.summary == "" and result.changed is False


def test_web_search_is_refused_when_the_switch_is_off(db_session):
    ctx = _ctx(web_search=False)
    result = execute_tool(db_session, "web_search", {"query": "x"}, ctx=ctx)
    assert result.text.startswith("工具未获授权")


def test_unknown_tool_is_refused_not_raised(db_session):
    result = execute_tool(db_session, "definitely_not_a_tool", {}, ctx=_ctx())
    assert result.text.startswith("工具未获授权")


def test_write_tool_is_refused_without_writable_even_if_allowed(db_session):
    """兜底防线：名字在白名单里的写工具，writable=False 也绝不执行。"""
    write_names = [tool.name for tool in _TOOLS if tool.writes]
    assert write_names
    ctx = _ctx(writable=False)
    result = execute_tool(db_session, write_names[0], {}, ctx=ctx)
    assert result.text.startswith("工具未获授权")
    assert "写入" in result.text


def test_every_write_tool_has_a_preview():
    """守卫：新增写工具忘了做提案预览会被测试抓住（RF-01 契约）。"""
    missing = [tool.name for tool in _TOOLS if tool.writes and tool.preview is None]
    assert missing == []


def test_context_binds_the_current_dataset_identity():
    ctx = tool_policy.build_context(web_search=False, relaxed=False, writable=False)
    assert ctx.dataset_id
    assert ctx.dataset_generation >= 1


def test_rebuilt_context_picks_up_the_new_switch_state():
    """撤销策略的单元面：每轮重建的 ctx 用调用方传入的新设置，旧快照不残留。"""
    off = _ctx(relaxed=False)
    on = _ctx(relaxed=True)
    relaxed_names = {tool.name for tool in _TOOLS if tool.requires_relaxed}
    assert relaxed_names & set(tool_names())
    assert not (relaxed_names & set(tool_policy.allowed_tools(off)))
    assert relaxed_names <= set(tool_policy.allowed_tools(on))
