"""助手流与生成 SSE 的租约/冻结会话行为（RF-03，从 test_dataset_scope.py 拆出）。

原文档超 500 行预算后的拆分：流级集成用例聚在这里，租约单元与切换互斥用例
留在原文件。共享夹具在 conftest（client）。
"""

import asyncio
import json
from types import SimpleNamespace

from app import database
from app.runtime import dataset_scope
from app.runtime.dataset_scope import (
    switch_lock,
)
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMDelta

# ===== 助手流：租约 + 冻结会话 =====


class _StreamOnceProvider(BaseLLMProvider):
    """先调用一次工具、再输出正文：让"每工具调用冻结会话"的路径被真正走到。"""

    def __init__(self, resolved) -> None:
        super().__init__(LLMConfig(base_url="http://fake", model="fake-model"))
        self._round = 0

    async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover - 不应触发
        raise AssertionError("流式路径不应触发一次性对话")

    async def stream_chat(self, _messages):
        yield ""  # pragma: no cover - 由 stream_chat_events 覆盖

    async def stream_chat_events(self, _messages, _tools=None):
        self._round += 1
        if self._round == 1:
            yield LLMDelta(
                tool_calls=[{"id": "t1", "function": {"name": "web_search", "arguments": "{}"}}]
            )
        else:
            yield LLMDelta(text="这是足够长的最终回答正文。")


def _seed_generation_prerequisites(client) -> None:
    assert (
        client.put(
            "/api/profile",
            json={
                "name": "张三",
                "projects": [
                    {
                        "name": "简历通",
                        "role": "核心开发",
                        "tech_stack": "Python, FastAPI",
                        "description": "开发简历生成接口",
                    }
                ],
            },
        ).status_code
        == 200
    )
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="k", model="m")
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _job(client) -> dict:
    return client.post("/api/jobs", json={"title": "后端开发工程师", "company": "示例公司"}).json()


def _wait_terminal(client, task_id: int) -> dict:
    import time

    terminal = {"completed", "cancelled", "failed"}
    deadline = time.monotonic() + 8
    body = client.get(f"/api/resumes/generate/tasks/{task_id}").json()
    while body["status"] not in terminal:
        assert time.monotonic() < deadline, f"任务未在 8s 内到达终态：{body}"
        time.sleep(0.02)
        body = client.get(f"/api/resumes/generate/tasks/{task_id}").json()
    return body


def test_assistant_stream_holds_a_lease_and_freezes_tool_sessions(client, monkeypatch):
    """流开始取租约；流内工具会话从捕获的 engine 建（不再重读全局活动库）。"""
    from app.api.assistant_stream import stream_message_events
    from app.models.assistant import ChatConversation, ChatMessage
    from app.schemas.assistant import AssistantMessageCreate

    binds: list[str] = []

    async def fake_execute(db, name, arguments, numberer=None, ctx=None):  # noqa: ARG001
        binds.append(str(db.get_bind().url))
        return SimpleNamespace(summary="已搜索", link="", text="无结果", changed=False, sources=[])

    monkeypatch.setattr("app.api.assistant_tool_exec.execute_tool_async", fake_execute)

    with database.SessionLocal() as session:
        conversation = ChatConversation(title="租约会话")
        session.add(conversation)
        session.flush()
        user_message = ChatMessage(
            conversation_id=conversation.id, role="user", content="问题", status="complete"
        )
        assistant_message = ChatMessage(
            conversation_id=conversation.id, role="assistant", content="", status="pending"
        )
        session.add_all([user_message, assistant_message])
        session.commit()
        user_id, assistant_id = user_message.id, assistant_message.id

    async def fake_search(_query: str):
        return []

    async def _consume() -> list[str]:
        events = []
        async for event in stream_message_events(
            payload=AssistantMessageCreate(content="帮我查一下", web_search=True),
            attachments=[],
            provider=_StreamOnceProvider(None),
            history=[],
            context_blocks=[],
            context_metadata={},
            user_message_id=user_id,
            assistant_message_id=assistant_id,
            generated_title="标题",
            system_prompt="系统提示",
            search_web_fn=fake_search,
        ):
            events.append(event)
        return events

    events = asyncio.run(_consume())

    assert any('"start"' in event or '"type": "start"' in event for event in events)
    assert any('"done"' in event for event in events)
    # 工具会话拿到的是当前活动引擎（未发生切换时两者本就一致），且流结束租约已释放。
    assert binds == [str(database.engine.url)]
    assert dataset_scope.leases_pending() == 0


def test_assistant_stream_reports_switch_in_progress_instead_of_crashing(client):
    """切换持锁期间建流：租约取不到 → 流内给出可读的 error 事件，不抛异常。"""
    from app.api.assistant_stream import stream_message_events
    from app.schemas.assistant import AssistantMessageCreate

    async def fake_search(_query: str):
        return []

    async def _consume() -> list[str]:
        events = []
        async for event in stream_message_events(
            payload=AssistantMessageCreate(content="问题"),
            attachments=[],
            provider=_StreamOnceProvider(None),
            history=[],
            context_blocks=[],
            context_metadata={},
            user_message_id=1,
            assistant_message_id=2,
            generated_title="标题",
            system_prompt="系统提示",
            search_web_fn=fake_search,
        ):
            events.append(event)
        return events

    with switch_lock():
        events = asyncio.run(_consume())

    assert events
    assert '"error"' in events[0]
    assert "切换" in events[0]
    assert dataset_scope.leases_pending() == 0


def test_sse_generate_reports_switch_in_progress(client, monkeypatch):
    """简历 SSE 流在切换持锁期间建流：租约失败 → SSE error 事件（可读），不留租约。"""
    _seed_generation_prerequisites(client)
    job = _job(client)

    class SuccessfulProvider(BaseLLMProvider):
        async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
            raise AssertionError("合法流式 JSON 不应触发修复调用")

        async def stream_chat(self, _messages):
            yield json.dumps(
                {
                    "summary": "具备 Python 后端开发经验。",
                    "projects": [{"name": "简历通", "role": "核心开发"}],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr(
        "app.api.resumes.create_provider", lambda resolved: SuccessfulProvider(resolved)
    )

    with switch_lock():
        response = client.post("/api/resumes/generate", json={"job_id": job["id"]})

    assert response.status_code == 200  # SSE 面上以事件报错，而不是 500
    assert '"error"' in response.text
    assert "切换" in response.text
    assert dataset_scope.leases_pending() == 0


def test_sse_generate_acquires_the_lease_before_reading_snapshots(client, monkeypatch):
    """PR-03：租约获取先于任何业务快照读取——快照与保存段同属一个数据集身份。

    注入探针记录调用顺序：acquire_lease 必须发生在资料/基线快照之前；流结束后
    租约如约释放。保存段工厂从租约身份派生（注入切换不串写由租约封死）。
    """
    _seed_generation_prerequisites(client)
    job = _job(client)

    order: list[str] = []
    real_acquire = dataset_scope.acquire_lease

    def spy_acquire(owner):
        order.append("lease")
        return real_acquire(owner)

    real_profile = __import__(
        "app.api.resumes.generate_routes", fromlist=["get_profile_detail"]
    ).get_profile_detail

    def spy_profile(db):
        order.append("profile-snapshot")
        return real_profile(db)

    real_baseline = __import__(
        "app.api.resumes.generate_routes", fromlist=["build_baseline"]
    ).build_baseline

    def spy_baseline(db):
        order.append("baseline-snapshot")
        return real_baseline(db)

    monkeypatch.setattr(dataset_scope, "acquire_lease", spy_acquire)
    monkeypatch.setattr("app.api.resumes.generate_routes.get_profile_detail", spy_profile)
    monkeypatch.setattr("app.api.resumes.generate_routes.build_baseline", spy_baseline)

    class SuccessfulProvider(BaseLLMProvider):
        async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
            raise AssertionError("合法流式 JSON 不应触发修复调用")

        async def stream_chat(self, _messages):
            yield json.dumps(
                {
                    "summary": "具备 Python 后端开发经验。",
                    "projects": [{"name": "简历通", "role": "核心开发"}],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr(
        "app.api.resumes.create_provider", lambda resolved: SuccessfulProvider(resolved)
    )

    response = client.post("/api/resumes/generate", json={"job_id": job["id"]})
    assert response.status_code == 200
    assert '"saved"' in response.text  # 生成结果成功落库

    # 租约在最前：先于资料快照，也先于事实基线快照。
    assert order.index("lease") < order.index("profile-snapshot")
    assert order.index("lease") < order.index("baseline-snapshot")
    assert dataset_scope.leases_pending() == 0


def test_sse_generate_snapshot_failure_releases_the_lease(client, monkeypatch):
    """快照阶段失败（如岗位不存在）：404 之前先把租约还回去，不挡后续切换。"""
    _seed_generation_prerequisites(client)

    response = client.post("/api/resumes/generate", json={"job_id": 999999})
    assert response.status_code == 404
    assert dataset_scope.leases_pending() == 0
