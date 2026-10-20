# SPDX-License-Identifier: Apache-2.0
"""岗位 AI 解读接口测试。"""

import asyncio
import inspect
import json

from app.api.jobs_analysis import _run_until_disconnect
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider


class JobAnalysisProvider(BaseLLMProvider):
    def __init__(self):
        super().__init__(
            LLMConfig(base_url="http://localhost:9999", api_key="test", model="test-model")
        )
        self.messages: list[list[dict]] = []

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.messages.append(messages)
        return json.dumps(
            {
                "summary": "该岗位重点考察门店运营、人员管理和食品安全。",
                "requirements": [
                    {
                        "priority": "high",
                        "category": "职业资格",
                        "requirement": "持有食品安全相关证书",
                        "evidence": "需要食品安全管理员证",
                    }
                ],
                "advice": [
                    {
                        "title": "准备经营案例",
                        "action": "整理一段提升门店转化率的真实案例",
                        "rationale": "岗位职责强调门店经营结果",
                    }
                ],
            },
            ensure_ascii=False,
        )

    async def stream_chat(self, messages: list[dict]):
        yield ""


def test_job_analysis_uses_saved_job_without_profile(monkeypatch, client):
    job = client.post(
        "/api/jobs",
        json={
            "title": "门店店长",
            "company": "示例连锁",
            "description": "负责门店经营和人员管理",
            "requirements": "三年零售经验",
            "additional_info": "需要食品安全管理员证",
        },
    ).json()
    provider = JobAnalysisProvider()
    monkeypatch.setattr("app.api.jobs_analysis.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.jobs_analysis.create_provider", lambda _config: provider)

    response = client.post(f"/api/jobs/{job['id']}/analysis")

    assert response.status_code == 200
    assert response.json()["requirements"][0]["category"] == "职业资格"
    prompt = provider.messages[0][1]["content"]
    assert "门店店长" in prompt
    assert "食品安全管理员证" in prompt
    assert "个人资料" not in prompt


def test_job_analysis_requires_existing_job_and_model_config(client):
    missing = client.post("/api/jobs/999/analysis")
    assert missing.status_code == 404

    job = client.post("/api/jobs", json={"title": "教师"}).json()
    unconfigured = client.post(f"/api/jobs/{job['id']}/analysis")
    assert unconfigured.status_code == 400
    assert "配置大模型" in unconfigured.json()["detail"]


# ---- 断连取消（T1）：客户端走了就真取消，别把整段生成跑完再白烧 token ----


class FakeRequest:
    """第 ``disconnect_at`` 次查询起返回 True（1 表示"一开始就断开"）。"""

    def __init__(self, disconnect_at: int = 10_000) -> None:
        self.disconnect_at = disconnect_at
        self.calls = 0

    async def is_disconnected(self) -> bool:
        self.calls += 1
        return self.calls >= self.disconnect_at


def _slow_coroutine(state: dict) -> object:
    async def slow() -> str:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise
        state["finished"] = True
        return "done"

    return slow()


def test_run_until_disconnect_cancels_when_the_client_leaves():
    state: dict = {}
    request = FakeRequest(disconnect_at=1)
    coro = _slow_coroutine(state)

    result = asyncio.run(_run_until_disconnect(coro, request, poll_interval=0.01))

    # 499 由调用方据此返回；这里返回 None 就是"没人收了"的信号。
    assert result is None
    # 协程必须被取消而不是泄漏：第 0 轮就断开时它根本没机会开跑，因此断言"已关闭"
    # 而不是"内部 except 跑过"。
    assert inspect.getcoroutinestate(coro) == "CORO_CLOSED"
    assert "finished" not in state


def test_run_until_disconnect_returns_the_result_while_the_client_stays():
    async def quick() -> str:
        return "ok"

    request = FakeRequest(disconnect_at=10_000)

    assert asyncio.run(_run_until_disconnect(quick(), request, poll_interval=0.01)) == "ok"
    # 第一次判断发生在等待之前：轮询间隔不拖慢正常路径。
    assert request.calls == 1


def test_run_until_disconnect_cancels_on_a_later_poll():
    """断开发生在生成中途（第 2 次查询）：同样取消，不写缓存。"""
    state: dict = {}
    request = FakeRequest(disconnect_at=2)

    assert (
        asyncio.run(_run_until_disconnect(_slow_coroutine(state), request, poll_interval=0.01))
        is None
    )
    # 这次的协程已经跑起来了，取消必须从内部抛出（CancelledError 被 await 收走）。
    assert state.get("cancelled") is True
