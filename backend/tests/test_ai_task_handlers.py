# SPDX-License-Identifier: Apache-2.0
"""本轮接入统一任务地基的四个入口：**正常完成并落 result_ref** 与 **取消真的中断**。

为什么每个 handler 各写两条：这两件事是任务化的全部价值所在。少了第一条，"结果去哪了"
没人验（``result_ref`` 的形状正是前端深链与暂存结果的输入）；少了第二条，取消会退化成
"只改数据库状态"——前端显示已取消、后端还在烧 token，而这正是本轮要消灭的形态。

取消用例一律让模型调用**挂住**（而不是在检查点上等）：只有挂在 ``await`` 上的调用被
``ctx.drive`` 的跨线程取消打断，"真取消"才算被验证过。检查点型取消另有覆盖（轮询型
handler 的 ``ctx.sleep``，见 ``tests/test_ai_tasks.py``）。
"""

from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace
from typing import Any

import pytest
from app.models.ai_task import (
    AI_TASK_KIND_JOB_ANALYSIS,
    AI_TASK_KIND_RESUME_REWRITE,
    AI_TASK_KIND_RESUME_RISK,
    AI_TASK_KIND_WEBFORM_FILL,
)
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.schemas.setting import LLMConfig
from app.services import ai_task_handlers_ai_entries as entries
from app.services.ai_task_runner import reset_ai_task_runner
from app.services.llm.base import BaseLLMProvider

TASK_PATH = "/api/ai-tasks"


@pytest.fixture(autouse=True)
def _reset_runner():
    """每个用例结束后释放执行器：不让上一个用例的线程跑进下一个用例的库。"""
    yield
    reset_ai_task_runner()


def _config() -> LLMConfig:
    return LLMConfig(base_url="http://fake", api_key="fake", model="fake-model")


class _HangingProvider(BaseLLMProvider):
    """``chat`` 永远不返回：用来验"挂起的模型调用能被跨线程取消打断"。"""

    def __init__(self) -> None:
        super().__init__(_config())

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        await asyncio.sleep(3600)
        return "{}"  # pragma: no cover - 被取消后不可达

    async def stream_chat(self, messages: list[dict]):  # pragma: no cover - 未使用
        yield ""


class _JsonProvider(BaseLLMProvider):
    """返回一段预设 JSON 的假模型。"""

    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__(_config())
        self.payload = payload

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        return json.dumps(self.payload, ensure_ascii=False)

    async def stream_chat(self, messages: list[dict]):  # pragma: no cover - 未使用
        yield ""


def _create_task(client, kind: str, payload: dict[str, Any], label: str = "") -> int:
    response = client.post(TASK_PATH, json={"kind": kind, "payload": payload, "label": label})
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def _wait(client, task_id: int, expected: str, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"{TASK_PATH}/{task_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] == expected:
            return latest
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout}s 内进入 {expected}，最后状态：{latest}")


def _wait_progress(client, task_id: int, minimum: int, timeout: float = 10.0) -> dict[str, Any]:
    """等到进度跨过某个阶段（用来确认"已经进到模型调用里了"再取消）。

    直接建完就取消会退化成"还没起跑就停了"——那样被测不到"挂起的模型调用能被跨线程打断"，
    而那正是取消用例唯一想证明的事。
    """
    deadline = time.monotonic() + timeout
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"{TASK_PATH}/{task_id}")
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["progress"] >= minimum:
            return latest
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout}s 内推进到 {minimum}%，最后状态：{latest}")


def _cancel_and_wait(client, task_id: int, timeout: float = 10.0) -> dict[str, Any]:
    """点取消 → 等终态；顺带断言它不是慢慢跑完的（<5s 说明模型调用真被打断了）。"""
    started = time.monotonic()
    response = client.post(f"{TASK_PATH}/{task_id}/cancel")
    assert response.status_code == 200, response.text
    done = _wait(client, task_id, "canceled", timeout=timeout)
    assert time.monotonic() - started < 5.0
    return done


def _configured(monkeypatch, provider: BaseLLMProvider) -> None:
    """把「配置好了模型」这件事注入 handler 自己的命名空间（不打桩被测路径本身）。"""
    monkeypatch.setattr(entries, "get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr(entries, "create_provider", lambda _config: provider)


def _resume_with_job(db_session, *, job_id: int | None) -> ResumeRecord:
    record = ResumeRecord(
        title="张三-后端开发工程师",
        job_title="后端开发工程师",
        company="示例公司",
        job_id=job_id,
        content={"name": "张三", "summary": "五年后端开发经验"},
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _job(db_session) -> Job:
    job = Job(
        title="后端开发工程师",
        company="示例公司",
        description="负责服务端接口开发与性能优化",
        requirements="三年以上 Python 经验",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


# ===== 1. 岗位解读 =====


def test_job_analysis_handler_saves_cache_and_reports_job_id(monkeypatch, client, db_session):
    job = _job(db_session)
    provider = _JsonProvider(
        {
            "summary": "该岗位负责服务端接口开发。",
            "requirements": [
                {
                    "priority": "high",
                    "category": "工作年限",
                    "requirement": "三年以上 Python 经验",
                    "evidence": "三年以上 Python 经验",
                }
            ],
            "advice": [
                {
                    "title": "补量化结果",
                    "action": "把接口承载量的数字写进项目经历",
                    "rationale": "岗位强调性能优化",
                }
            ],
        }
    )
    _configured(monkeypatch, provider)

    task_id = _create_task(client, AI_TASK_KIND_JOB_ANALYSIS, {"job_id": job.id}, "岗位解读")
    done = _wait(client, task_id, "succeeded")

    # 落点标识：前端据此生成 /jobs?job_id=<id>；`analysis` 是交付负载（用户可能已经
    # 离开弹窗，那时只有 result_ref 能把结论交回它的槽）。
    assert done["result_ref"]["job_id"] == job.id
    assert done["result_ref"]["analysis"]["requirements"][0]["category"] == "工作年限"
    assert done["progress"] == 100
    # 结果本身写回了业务表缓存（任务表只负责生命周期）。
    db_session.expire_all()
    stored = db_session.get(Job, job.id)
    assert stored is not None
    assert stored.analysis_cache["result"]["requirements"][0]["category"] == "工作年限"


def test_job_analysis_handler_cancel_interrupts_model_call(monkeypatch, client, db_session):
    job = _job(db_session)
    _configured(monkeypatch, _HangingProvider())

    task_id = _create_task(client, AI_TASK_KIND_JOB_ANALYSIS, {"job_id": job.id})
    _wait_progress(client, task_id, 20)
    _cancel_and_wait(client, task_id)

    # 真的停在模型调用之前：缓存没有被写入（否则就是"取消只是改状态"）。
    db_session.expire_all()
    stored = db_session.get(Job, job.id)
    assert stored is not None
    assert not (stored.analysis_cache or {}).get("result")


# ===== 2. 简历风险扫描 =====


def test_resume_risk_handler_returns_report_in_result_ref(client, db_session):
    # 「精通」属于绝对化表述，本地规则一定能抓到：不需要模型即可断言"有结果"。
    resume = _resume_with_job(db_session, job_id=None)
    resume.content = {
        "name": "张三",
        "summary": "精通 Python 服务端开发",
        "experience": [
            {
                "company": "甲公司",
                "title": "后端工程师",
                "bullets": ["精通订单系统的后端开发", "精通订单系统的后端开发"],
            }
        ],
    }
    db_session.commit()

    task_id = _create_task(client, AI_TASK_KIND_RESUME_RISK, {"resume_id": resume.id})
    done = _wait(client, task_id, "succeeded")

    ref = done["result_ref"]
    assert ref["resume_id"] == resume.id
    # 报告不入库，所以它必须整份跟着 result_ref 回去——否则用户离开页面就再也拿不到。
    assert ref["risk_scan"]["points"], ref
    assert ref["risk_scan"]["resume_id"] == resume.id


def test_resume_risk_handler_cancel_interrupts_model_call(monkeypatch, client, db_session):
    resume = _resume_with_job(db_session, job_id=None)
    _configured(monkeypatch, _HangingProvider())

    task_id = _create_task(client, AI_TASK_KIND_RESUME_RISK, {"resume_id": resume.id})
    _wait_progress(client, task_id, 25)
    done = _cancel_and_wait(client, task_id)
    # 取消是终态而不是失败：前端据此显示「已取消」而不是「失败」。
    assert done["error"] == "已取消"
    assert done["result_ref"] is None


# ===== 3. 岗位化修改建议（简历 AI 改写家族里唯一任务化的那一支） =====


def test_resume_rewrite_handler_returns_suggestions(monkeypatch, client, db_session):
    job = _job(db_session)
    resume = _resume_with_job(db_session, job_id=job.id)
    provider = _JsonProvider(
        {
            "suggestions": [
                {
                    "priority": "high",
                    "section": "项目经历",
                    "issue": "没有写到与服务端接口开发的对应关系",
                    "suggestion": "在已有事实里补上接口 QPS 与所用框架",
                    "evidence": ["后端开发"],
                }
            ]
        }
    )
    _configured(monkeypatch, provider)

    task_id = _create_task(client, AI_TASK_KIND_RESUME_REWRITE, {"resume_id": resume.id})
    done = _wait(client, task_id, "succeeded")

    ref = done["result_ref"]
    assert ref["resume_id"] == resume.id
    assert ref["job_id"] == job.id
    assert len(ref["suggestions"]) == 1
    assert ref["suggestions"][0]["priority"] == "high"
    # **不改正文**：建议只是候选，正文一行都没动。
    db_session.expire_all()
    stored = db_session.get(ResumeRecord, resume.id)
    assert stored is not None
    assert stored.content["summary"] == "五年后端开发经验"


def test_resume_rewrite_handler_cancel_interrupts_model_call(monkeypatch, client, db_session):
    job = _job(db_session)
    resume = _resume_with_job(db_session, job_id=job.id)
    _configured(monkeypatch, _HangingProvider())

    task_id = _create_task(client, AI_TASK_KIND_RESUME_REWRITE, {"resume_id": resume.id})
    _wait_progress(client, task_id, 25)
    _cancel_and_wait(client, task_id)


# ===== 4. 网申字段识别 =====


class _FakeSnapshot:
    """只要 handler 用到的几个字段；控件事后由补丁掉的 build_preview 忽略。"""

    id = "snap-1"
    url = "https://example.com/apply"
    title = "投递表单"
    controls: list[Any] = []


class _FakeReport:
    """预览报告的最小替身：只要 ``as_dict`` 与 ``items``。"""

    items: list[Any] = []

    def as_dict(self) -> dict[str, Any]:
        return {"items": [], "missing_data": [], "unrecognized": [], "blocked": []}


def _patch_webform(monkeypatch, *, enrich) -> None:
    """把网申预览的规则部分整体替身掉：本组用例验的是任务编排，不是匹配算法。"""
    store = SimpleNamespace(get=lambda _snapshot_id: _FakeSnapshot())
    monkeypatch.setattr("app.services.webform.get_snapshot_store", lambda: store)
    monkeypatch.setattr(
        "app.services.webform.build_webform_view",
        lambda _db: SimpleNamespace(data={}, custom_labels={}),
    )
    monkeypatch.setattr(
        "app.services.webform.build_preview",
        lambda _snapshot, _data, **_kwargs: _FakeReport(),
    )
    monkeypatch.setattr("app.services.webform.extra_profile.learnable", lambda *_a, **_k: [])
    monkeypatch.setattr("app.services.webform.default_selections", lambda _report: [])
    monkeypatch.setattr("app.services.webform.ai.build_provider", lambda _db: _HangingProvider())
    monkeypatch.setattr("app.services.webform.enrich_preview_with_ai", enrich)


def test_webform_fill_handler_stages_preview_without_writing(monkeypatch, client):
    asked: list[str] = []

    async def enrich(_snapshot, _data, _report, _provider, *, relaxed: bool = False) -> int:
        asked.append("relaxed" if relaxed else "strict")
        return 3

    _patch_webform(monkeypatch, enrich=enrich)

    task_id = _create_task(
        client, AI_TASK_KIND_WEBFORM_FILL, {"snapshot_id": "snap-1", "relaxed": True}
    )
    done = _wait(client, task_id, "succeeded")

    ref = done["result_ref"]
    assert ref["snapshot_id"] == "snap-1"
    assert ref["asked"] == 3
    # 结果只是**暂存**的预览：没有任何写页面的字段（写页面仍然只走同步的 /webform/fill）。
    assert "outcomes" not in ref
    assert ref["preview"]["items"] == []
    assert asked == ["relaxed"]


def test_webform_fill_handler_cancel_interrupts_model_call(monkeypatch, client):
    async def enrich(_snapshot, _data, _report, _provider, *, relaxed: bool = False) -> int:
        await asyncio.sleep(3600)
        return 0  # pragma: no cover - 被取消后不可达

    _patch_webform(monkeypatch, enrich=enrich)

    task_id = _create_task(client, AI_TASK_KIND_WEBFORM_FILL, {"snapshot_id": "snap-1"})
    _wait_progress(client, task_id, 35)
    _cancel_and_wait(client, task_id)


# ===== 注册表：四个 kind 都必须有人认领 =====


def test_all_new_kinds_are_registered():
    from app.services.ai_task_registry import get_ai_task_handler

    for kind in (
        AI_TASK_KIND_JOB_ANALYSIS,
        AI_TASK_KIND_RESUME_RISK,
        AI_TASK_KIND_RESUME_REWRITE,
        AI_TASK_KIND_WEBFORM_FILL,
    ):
        assert get_ai_task_handler(kind) is not None, kind
