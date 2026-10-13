"""LLM 共享连接池：两家 provider 复用连接，省掉每次请求的握手开销。"""

import asyncio
import json

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.client_pool import (
    aclose_clients_for_current_loop,
    aclose_shared_clients,
    get_shared_client,
)
from app.services.llm.openai_compat import OpenAICompatProvider


@pytest.fixture(autouse=True)
def _clean_pool():
    yield
    # 池在事件循环间共享：每个用例结束清掉，避免下一个用例撞上已关闭的循环。
    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    # aclose 需要事件循环；pytest-asyncio 的用例内清理靠各用例自行 await。
    # 这里只清引用（MockTransport 无真实连接，无需真正关闭）。
    from app.services.llm import client_pool

    client_pool._pool.clear()


def _config() -> LLMConfig:
    return LLMConfig(base_url="https://api.example.com/v1", model="demo", api_key="k")


@pytest.mark.asyncio
async def test_same_transport_and_loop_reuse_one_client():
    """同一事件循环 + 同一传输层：两个 provider 实例共享同一个客户端（连接复用的前提）。"""
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={}))
    provider_a = OpenAICompatProvider(_config(), transport=transport)
    provider_b = OpenAICompatProvider(_config(), transport=transport)

    assert provider_a._client() is provider_b._client()
    # 生产路径（transport=None）共享同一个默认客户端。
    assert OpenAICompatProvider(_config())._client() is OpenAICompatProvider(_config())._client()


@pytest.mark.asyncio
async def test_different_transports_do_not_share():
    """注入的 MockTransport 必须请求间隔离：不同传输层绝不共用客户端。"""
    transport_a = httpx.MockTransport(lambda request: httpx.Response(200, json={}))
    transport_b = httpx.MockTransport(lambda request: httpx.Response(200, json={}))

    client_a = OpenAICompatProvider(_config(), transport=transport_a)._client()
    client_b = OpenAICompatProvider(_config(), transport=transport_b)._client()
    assert client_a is not client_b


@pytest.mark.asyncio
async def test_pool_is_bounded():
    """池有上限：塞进更多（传输层, 循环）组合也不会无限增长。"""
    from app.services.llm import client_pool

    before = len(client_pool._pool)
    transports = [
        httpx.MockTransport(lambda request: httpx.Response(200, json={})) for _ in range(12)
    ]
    for transport in transports:
        get_shared_client(transport=transport)

    assert len(client_pool._pool) <= before + 8


@pytest.mark.asyncio
async def test_aclose_clears_the_pool():
    get_shared_client()
    await aclose_shared_clients()
    from app.services.llm import client_pool

    assert client_pool._pool == {}


# ===== 生命周期（审计 PR-08）：淘汰按循环关闭 + cookie 隔离 =====


def _ok_transport() -> httpx.MockTransport:
    return httpx.MockTransport(lambda request: httpx.Response(200, json={}))


@pytest.mark.asyncio
async def test_evicted_current_loop_client_is_closed():
    """淘汰发生在当前循环：被淘汰客户端必须真的 aclose（修复前只丢引用——红）。"""
    transports = [_ok_transport() for _ in range(9)]
    clients = [get_shared_client(transport=transport) for transport in transports]
    await asyncio.sleep(0)  # 让淘汰调度的关闭任务跑起来
    assert clients[0].is_closed, "最早的条目被淘汰后应被关闭"
    assert not clients[-1].is_closed
    # 复用同一个 transport 取客户端：拿到的仍是未淘汰的那个（连接复用语义不变）。
    assert get_shared_client(transport=transports[-1]) is clients[-1]


@pytest.mark.asyncio
async def test_evicting_other_loop_client_does_not_raise_and_eventually_closes():
    """跨循环淘汰：不炸（不能跨循环 await），关闭被投递到所属循环并最终执行。"""
    import threading
    import time

    other_loop = asyncio.new_event_loop()
    thread = threading.Thread(target=other_loop.run_forever, daemon=True)
    thread.start()
    try:
        transport = _ok_transport()

        async def _acquire():
            return get_shared_client(transport=transport)

        other_client = await asyncio.wrap_future(
            asyncio.run_coroutine_threadsafe(_acquire(), other_loop)
        )
        # 当前循环塞满池：跨循环条目被淘汰——这一步本身不能抛异常。
        for _ in range(8):
            get_shared_client(transport=_ok_transport())
        deadline = time.monotonic() + 5
        while not other_client.is_closed and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert other_client.is_closed, "跨循环客户端应由其所属循环最终关闭"
    finally:
        other_loop.call_soon_threadsafe(other_loop.stop)
        thread.join(timeout=2)
        other_loop.close()


@pytest.mark.asyncio
async def test_aclose_clients_for_current_loop_keeps_other_loops():
    """per-loop 清理 API：只关当前循环的客户端，别的循环条目原样保留。"""
    import threading

    other_loop = asyncio.new_event_loop()
    thread = threading.Thread(target=other_loop.run_forever, daemon=True)
    thread.start()
    try:
        transport = _ok_transport()

        async def _acquire():
            return get_shared_client(transport=transport)

        other_client = await asyncio.wrap_future(
            asyncio.run_coroutine_threadsafe(_acquire(), other_loop)
        )
        mine = get_shared_client()
        await aclose_clients_for_current_loop()
        assert mine.is_closed
        assert not other_client.is_closed
    finally:
        other_loop.call_soon_threadsafe(other_loop.stop)
        thread.join(timeout=2)
        other_loop.close()


@pytest.mark.asyncio
async def test_cookies_do_not_persist_between_requests():
    """cookie 隔离：第一个响应的 Set-Cookie 不得出现在第二个请求头里（PR-08）。

    池里的客户端会在不同 provider/模型之间轮换复用；httpx 默认持久化响应
    cookie 并在后续请求自动带上——共享后就是跨请求会话状态污染。
    """
    cookie_headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        cookie_headers.append(request.headers.get("cookie"))
        body = json.dumps({"choices": [{"message": {"content": "好"}, "finish_reason": "stop"}]})
        if len(cookie_headers) == 1:
            return httpx.Response(200, headers={"set-cookie": "session=abc123; Path=/"}, text=body)
        return httpx.Response(200, text=body)

    provider = OpenAICompatProvider(_config(), transport=httpx.MockTransport(handler))
    for _ in range(2):
        await provider.chat([{"role": "user", "content": "hi"}])

    assert cookie_headers[0] is None
    assert cookie_headers[1] is None, "第二次请求不得携带第一次响应的会话 cookie"
