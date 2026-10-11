"""LLM 共享连接池：两家 provider 复用连接，省掉每次请求的握手开销。"""

import httpx
import pytest
from app.schemas.setting import LLMConfig
from app.services.llm.client_pool import (
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
