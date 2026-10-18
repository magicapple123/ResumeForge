"""简历生成任务用例的共享脚手架（行数预算拆分的产物）。

``test_resume_generate_task.py`` 在 R6（生成时定下的版式覆盖落库）新增用例后到 570 行，
超过 500 行预算，于是按「任务生命周期」与「format_config 落库」拆成两个用例文件；
两端共用的请求辅助与假 Provider 搬到这里（先例：``backup_asset_fixtures.py``、
``site_contract_support.py``）。

**纯搬迁**：辅助函数与假 Provider 的代码逐字未改，用例名与断言留在各自的测试文件里。
"""

import asyncio
import json
import time

from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider

TERMINAL_STATUSES = {"completed", "cancelled", "failed"}


def _configure(client):
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="k", model="m")
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _seed_profile(client):
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


def _job(client):
    return client.post("/api/jobs", json={"title": "后端开发工程师", "company": "示例公司"}).json()


def _get_task(client, task_id):
    response = client.get(f"/api/resumes/generate/tasks/{task_id}")
    assert response.status_code == 200
    return response.json()


def _wait_terminal(client, task_id, timeout=8.0):
    deadline = time.monotonic() + timeout
    task = _get_task(client, task_id)
    while task["status"] not in TERMINAL_STATUSES:
        if time.monotonic() >= deadline:
            raise AssertionError(f"任务 {task_id} 未在 {timeout}s 内到达终态：{task}")
        time.sleep(0.02)
        task = _get_task(client, task_id)
    return task


def _wait_status(client, task_id, status, timeout=8.0):
    deadline = time.monotonic() + timeout
    task = _get_task(client, task_id)
    while task["status"] != status:
        if time.monotonic() >= deadline:
            raise AssertionError(f"任务 {task_id} 未在 {timeout}s 内进入 {status}：{task}")
        time.sleep(0.02)
        task = _get_task(client, task_id)
    return task


def _start_with_options(client, job, options):
    return client.post(
        "/api/resumes/generate/tasks", json={"job_id": job["id"], "options": options}
    )


class EndlessProvider(BaseLLMProvider):
    """无限产出 chunk、永不结束，用于在"运行中"取消（否则取消竞态无法稳定复现）。"""

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("不应触发一次性对话")

    async def stream_chat(self, _messages):
        index = 0
        while True:
            yield f'{{"chunk": {index}}}'
            index += 1
            await asyncio.sleep(0.001)


class HangingProvider(BaseLLMProvider):
    """在"对端不发数据"的挂死上卡住的 Provider：不产出事件、也不响应 cancel_event。

    区别于 EndlessProvider 的 1ms 轮询（chunk 间隙的检查点能轮询到停止信号）：
    这里的 ``await asyncio.sleep(60)`` 模拟模型流挂在 socket read 上——检查点
    根本轮询不到，只有从外部取消 asyncio task 才能亚秒级跳出。
    """

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("不应触发一次性对话")

    async def stream_chat(self, _messages):
        await asyncio.sleep(60)  # 挂死点：cancel_event 检查点轮询不到它
        yield '{"unreachable": true}'  # pragma: no cover - 取消后永远走不到


class SuccessfulProvider(BaseLLMProvider):
    """产出合法 JSON 后立刻结束，用于验证"完成才落库"。"""

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发修复调用")

    async def stream_chat(self, _messages):
        yield json.dumps(
            {
                "summary": "具备 Python 后端开发经验。",
                "projects": [{"name": "简历通", "role": "核心开发"}],
            },
            ensure_ascii=False,
        )
