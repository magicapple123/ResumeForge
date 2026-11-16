# SPDX-License-Identifier: Apache-2.0
"""动态 Action 路由的执行边界：同步动作不得占用事件循环（RF-01）。

``as_route`` 生成的 endpoint 是 ``async def``（要先 ``await request.body()``），而
``ActionSpec.run`` 按契约只能是**同步**函数。修复前它在事件循环线程里直接执行：
动作体里的 SQL、``busy_timeout`` 等待、事务提交全部挡在同一个线程上，进程内的 SSE、
轮询和健康检查一起卡住。

这里钉四件事（都是行为证据，不是"代码长什么样"）：

1. 动作运行期间另一协程仍能推进（Event/barrier：动作若占住事件循环，释放信号
   永远发不出去，动作会超时失败）。
2. ``response_model`` 的属性读取（ORM 懒加载的真实触发点）发生在 worker 线程，
   事件循环只拿到普通 dict/list。
3. ``ActionError`` / 校验失败在线程边界上仍映射成原来的 HTTP 形状。
4. 取消 await 方不会截断已在执行的动作，``Depends(get_db)`` 的覆盖仍生效。
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import pytest
from app.database import get_db
from app.services.actions import ActionError, ActionOutcome, HttpRoute, Permission, as_route
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from starlette.requests import Request
from starlette.responses import JSONResponse
from tests.actions_contract_support import ItemInput, ItemOut, _spec

_PATH = "/api/test/blocking"


class OkOut(BaseModel):
    """最小响应模型：这些用例只关心执行边界，不关心业务字段。"""

    ok: bool


def _request(method: str = "GET", *, body: bytes = b"", query: bytes = b"") -> Request:
    """最小可用 Request：够 ``_request_payload`` 读 query/body，不经过 ASGI 服务器。"""
    sent = False

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": _PATH,
            "raw_path": _PATH.encode(),
            "query_string": query,
            "headers": [(b"content-type", b"application/json")],
            "path_params": {},
            "server": ("testserver", 80),
            "client": ("testclient", 123),
        },
        receive,
    )


def _endpoint(spec):  # noqa: ANN001, ANN202 - 测试辅助
    return as_route(spec).routes[0].endpoint


class _OrmLike:
    """只有属性访问才算"读数据"的对象：模拟 ORM 的懒加载触发点。"""

    def __init__(self) -> None:
        self.reads: list[int] = []

    @property
    def item_id(self) -> int:
        self.reads.append(threading.get_ident())
        return 7

    @property
    def name(self) -> str:
        self.reads.append(threading.get_ident())
        return "样例"


def test_sync_action_runs_off_event_loop() -> None:
    """动作运行期间事件循环仍能推进——用 Event 屏障证明，不靠 sleep 凑超时。"""
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}

    def run(_db, _payload):  # noqa: ANN001, ANN202
        threads["action"] = threading.get_ident()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("同步动作等待释放信号超时：事件循环被动作占住，另一协程无法推进")
        return ActionOutcome(data={"ok": True})

    spec = _spec(
        name="blocking_action",
        permission=Permission.READ_ONLY,
        run=run,
        http=HttpRoute("GET", _PATH, OkOut),
    )
    endpoint = _endpoint(spec)

    async def scenario() -> Any:
        task = asyncio.create_task(endpoint(_request(), object()))
        # 等动作真正开始；它若跑在事件循环线程上，下面这行永远回不来。
        assert await asyncio.to_thread(entered.wait, 3.0), "动作没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    assert asyncio.run(scenario()) == {"ok": True}
    assert threads["action"] != threading.main_thread().ident, "动作仍在事件循环线程上执行"


def test_response_model_reads_happen_in_worker() -> None:
    """ORM 属性只在 worker 里读：事件循环拿到的是已物化的普通结构。"""
    orm = _OrmLike()
    loop_thread = threading.get_ident()

    def run(_db, _payload):  # noqa: ANN001, ANN202
        return ActionOutcome(data=orm)

    spec = _spec(
        name="orm_action",
        permission=Permission.READ_ONLY,
        run=run,
        http=HttpRoute("GET", _PATH, ItemOut),
    )

    data = asyncio.run(_endpoint(spec)(_request(), object()))

    # 返回值仍是**原对象**：物化只负责把属性读掉，不改变响应形状。
    # （第一版返回 dumped dict，把 `exclude=True` 字段连同由它派生的 computed_field 一起
    # 抹平了，`JobListOut.has_description` 从 true 变 false——由 test_api_jobs 抓到。）
    assert data is orm
    assert orm.reads, "response_model 没有读到属性，这个用例就没证明任何事"
    assert all(tid != loop_thread for tid in orm.reads), "属性读取回到了事件循环线程"


def test_action_error_inside_worker_keeps_http_shape() -> None:
    """worker 里抛 ActionError：仍是原来的 HTTPException(status, {code, message})。"""

    def run(_db, _payload):  # noqa: ANN001, ANN202
        raise ActionError("not_found", "对象不存在")

    spec = _spec(
        name="missing_action",
        permission=Permission.READ_ONLY,
        run=run,
        http=HttpRoute("GET", _PATH, ItemOut),
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(_endpoint(spec)(_request(), object()))

    assert caught.value.status_code == 404
    assert caught.value.detail == {"code": "not_found", "message": "对象不存在"}


def test_invalid_input_inside_worker_maps_to_422() -> None:
    """校验也在 worker 里：非法入参仍走同一张错误表（422 + invalid_input）。"""

    def run(_db, _payload):  # noqa: ANN001, ANN202
        raise AssertionError("校验失败时不应该执行动作")

    spec = _spec(
        name="write_action",
        input_model=ItemInput,
        permission=Permission.REVERSIBLE_WRITE,
        run=run,
        preview=lambda _db, _payload: "预览",
        http=HttpRoute("POST", "/api/test/items/{item_id}", OkOut),
    )

    async def scenario() -> Any:
        request = _request("POST", body=b'{"item_id": 1}')
        request.scope["path_params"] = {"item_id": "1"}
        return await _endpoint(spec)(request, object())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(scenario())

    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "invalid_input"
    assert "name" in caught.value.detail["message"]


def test_non_outcome_return_is_internal_error() -> None:
    """``run`` 返回非 ActionOutcome 仍是 internal（500），错误形状不变。"""

    spec = _spec(
        name="broken_action",
        permission=Permission.READ_ONLY,
        run=lambda _db, _payload: {"ok": True},
        http=HttpRoute("GET", _PATH, ItemOut),
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(_endpoint(spec)(_request(), object()))

    assert caught.value.status_code == 500
    assert caught.value.detail["code"] == "internal_error"


def test_cancelling_the_caller_does_not_truncate_the_action() -> None:
    """取消 await 方不会杀掉已在 worker 里执行的动作（线程不会被协程取消打断）。"""
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def run(_db, _payload):  # noqa: ANN001, ANN202
        started.set()
        release.wait(3.0)
        finished.set()
        return ActionOutcome(data={"ok": True})

    spec = _spec(
        name="slow_action",
        permission=Permission.READ_ONLY,
        run=run,
        http=HttpRoute("GET", _PATH, OkOut),
    )
    endpoint = _endpoint(spec)

    async def scenario() -> None:
        task = asyncio.create_task(endpoint(_request(), object()))
        assert await asyncio.to_thread(started.wait, 3.0), "动作没有开始"
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        release.set()
        assert await asyncio.to_thread(finished.wait, 3.0), "动作被取消连带中断"

    asyncio.run(scenario())


def test_dependency_override_still_reaches_the_action() -> None:
    """``Depends(get_db)`` 的覆盖能力保留：动作拿到的就是被覆盖的那个会话对象。"""
    seen: list[Any] = []
    sentinel = object()
    spec = _spec(
        name="override_action",
        permission=Permission.READ_ONLY,
        run=lambda db, _payload: seen.append(db) or ActionOutcome(data={"ok": True}),
        http=HttpRoute("GET", _PATH, OkOut),
    )

    application = FastAPI()
    application.include_router(as_route(spec))
    application.dependency_overrides[get_db] = lambda: sentinel

    response = TestClient(application).get(_PATH)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert seen == [sentinel]


def test_write_action_body_still_reaches_the_action() -> None:
    """POST body 解析、路径参数合并与写入标记不受执行边界改动影响。"""
    received: list[ItemInput] = []
    spec = _spec(
        name="body_action",
        input_model=ItemInput,
        permission=Permission.REVERSIBLE_WRITE,
        run=lambda _db, payload: received.append(payload) or ActionOutcome(data={"ok": True}),
        preview=lambda _db, _payload: "预览",
        http=HttpRoute("POST", "/api/test/items/{item_id}", OkOut),
    )

    async def scenario() -> Any:
        endpoint = _endpoint(spec)
        request = _request("POST", body=b'{"name": "sample"}')
        request.scope["path_params"] = {"item_id": "7"}
        return await endpoint(request, object())

    assert asyncio.run(scenario()) == {"ok": True}
    assert received[0].item_id == 7
    assert received[0].name == "sample"


def test_dynamic_route_materializes_real_orm_rows(client) -> None:
    """端到端：真实 Session + 真实 ORM 行经 worker 物化后仍返回同一份数据。

    上面几个用例用的是假 Session/假响应模型，证明的是"线程边界"；这一条补的是
    "边界本身没改变响应内容"——``GET /api/jobs`` 走 ``as_route`` 生成的动态路由，
    响应模型是 ``Page[JobListOut]``，物化失败会直接 500。
    """
    created = client.post(
        "/api/jobs",
        json={
            "title": "后端开发工程师",
            "company": "示例公司",
            "location": "北京",
            "description": "熟练掌握 Python",
        },
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    response = client.get("/api/jobs")

    assert response.status_code == 200, response.text
    body = response.json()
    assert any(item["id"] == job_id for item in body["items"])


def test_early_response_object_passes_through() -> None:
    """动作提前返回的 ``Response``（如保存冲突 409）必须原样透传，不能被 response_model 校验。

    这是 RF-01 的真实回归：``_materialize`` 曾把 ``JSONResponse`` 当成"待校验的数据"，
    于是所有"提前返回带状态码的响应"的动作都从 409 变成了 500。
    """

    def run(_db, _payload):  # noqa: ANN001, ANN202
        return ActionOutcome(data=JSONResponse({"detail": "简历已被修改"}, status_code=409))

    spec = _spec(
        name="conflict_action",
        permission=Permission.READ_ONLY,
        run=run,
        http=HttpRoute("GET", _PATH, OkOut),
    )

    result = asyncio.run(_endpoint(spec)(_request(), object()))

    assert isinstance(result, JSONResponse), type(result)
    assert result.status_code == 409
